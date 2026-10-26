"""Execution facts reach the decision, progress does not create extra decisions."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from agent.action_feedback import ActionFeedback, navigation_context, prevent_failed_repeat
from protocol import AgentAction, Event, Observation
from scenario import load_scenario
from agent.brain import CustomerBrain
from brain_server import BrainSession


def nav(status='failed', **extra):
    return {'status': status, 'target': 'help_desk', 'location': 'moving', 'distance': 2,
            'failureCode': 'blocked_timeout', 'replans': 0, 'planningAttempts': 58,
            'unavailable_targets': ['help_desk'], 'retryable_targets': [], **extra}


class NavigationLoopTests(unittest.TestCase):
    def test_progress_is_monotonic_and_cannot_terminate_or_wake_decision(self):
        tracker = ActionFeedback()
        tracker.register({'id': 1, 'action': 'walk_to', 'target': 'help_desk'})
        progress = {'id': 1, 'type': 'action_progress', 'action': 'walk_to', 'target': 'help_desk',
                    'seq': 1, 'phase': 'blocked', 'navigation': nav('running')}
        self.assertTrue(tracker.accept_progress(progress)[0])
        self.assertFalse(tracker.accept_progress(progress)[0])
        self.assertEqual(tracker.snapshot()[0]['status'], 'pending')
        self.assertFalse(tracker.accept_event(1, 'action_failed'))
        self.assertFalse(tracker.accept_progress({**progress, 'seq': 2, 'target': 'exit'})[0])

    def test_terminal_evidence_and_event_type_must_agree(self):
        tracker = ActionFeedback()
        tracker.register({'id': 1, 'action': 'walk_to', 'target': 'help_desk'})
        failure = {'id': 1, 'action': 'walk_to', 'target': 'help_desk', 'status': 'failed',
                   'reason': 'blocked_timeout', 'navigation': nav()}
        self.assertTrue(tracker.accept(failure)[0])
        self.assertEqual(tracker.snapshot()[0]['navigation']['planningAttempts'], 58)
        self.assertFalse(tracker.accept_event(1, 'action_done'))
        self.assertTrue(tracker.accept_event(1, 'action_failed'))
        self.assertFalse(tracker.accept_progress({'id': 1, 'seq': 8})[0])
        tracker.register({'id': 2, 'action': 'walk_to', 'target': 'help_desk'})
        self.assertFalse(tracker.accept({**failure, 'id': 2, 'status': 'completed'})[0])
        self.assertTrue(tracker.accept({**failure, 'id': 2, 'status': 'completed',
            'navigation': nav('completed', location='help_desk', distance=.01)})[0])

    def test_blocked_goal_survives_speech_and_gestures_but_alternatives_are_allowed(self):
        results = [{'id': 3, 'action': 'wave', 'status': 'completed'}]
        retry = AgentAction(action='walk_to', target='help_desk')
        self.assertTrue(prevent_failed_repeat(retry, results, nav()))
        self.assertEqual(retry.action, 'wait')
        alternative = AgentAction(action='walk_to', target='ticket_machine')
        self.assertFalse(prevent_failed_repeat(alternative, results, nav()))
        cleared = nav(unavailable_targets=[], retryable_targets=['help_desk'])
        retry = AgentAction(action='walk_to', target='help_desk')
        self.assertFalse(prevent_failed_repeat(retry, [{'action': 'walk_to', 'target': 'help_desk', 'status': 'failed'}], cleared))

    def test_model_receives_actual_navigation_and_failure_guard_runs_on_later_speech(self):
        scene = load_scenario('bank')
        with patch('agent.brain.make_client'), patch('agent.brain.chat_json', return_value=json.dumps({
                'action': 'walk_to', 'target': 'help_desk', 'goal_status': 'done'})) as model:
            brain = CustomerBrain(next(iter(scene.personas.values())), scene, profile='human_3d')
            obs = Observation(time=200, location='moving', posture='standing', current_action='wait',
                events=[Event('robot_speech', '请再试一次')], navigation=nav(),
                action_results=[{'id': 1, 'action': 'walk_to', 'target': 'help_desk', 'status': 'failed'}])
            action, _ = brain.decide(obs)
            actual = json.loads(model.call_args.args[1][-1]['content'])
            self.assertEqual(actual['navigation']['planningAttempts'], 58)
            self.assertEqual((action.action, action.goal_status), ('wait', 'in_progress'))
            self.assertIn('帮', action.speech)

    def test_recovery_event_is_correlated_and_once_only_and_progress_does_not_wake(self):
        scene = load_scenario('bank')
        with tempfile.TemporaryDirectory() as folder, patch('brain_server.config.LOG_DIR', Path(folder)), \
                patch('brain_server.threading.Thread.start'), patch('agent.brain.make_client'):
            s = BrainSession(Mock(), scene, next(iter(scene.personas)), False, None, 'human_3d')
            try:
                s.cmd_id = 1
                s.action_feedback.register({'id': 1, 'action': 'walk_to', 'target': 'help_desk'})
                s.on_message({'type': 'action_progress', 'id': 1, 'action': 'walk_to', 'target': 'help_desk',
                    'seq': 1, 'phase': 'blocked', 'navigation': nav('running')})
                self.assertFalse(s.pending)
                s.on_message({'type': 'action_feedback', 'id': 1, 'action': 'walk_to', 'target': 'help_desk',
                    'status': 'failed', 'navigation': nav()})
                event = {'type': 'event', 'command_id': 1, 'event': {'type': 'navigation_available', 'time': 240},
                         'state': {'time': 240, 'navigation': nav()}}
                s.on_message(event)
                self.assertFalse(s.pending)
                event['state']['navigation'] = nav(unavailable_targets=[], retryable_targets=['help_desk'])
                s.on_message(event); s.on_message(event)
                self.assertEqual(len(s.pending), 1)
                self.assertEqual(s.pending[0].type, 'navigation_available')
            finally:
                s.close()

    def test_navigation_payload_is_bounded_and_does_not_copy_map(self):
        result = navigation_context({**nav(), 'cells': list(range(10000)), 'distance': float('nan'),
            'unavailable_targets': ['help_desk', 'invented'], 'retryable_targets': ['help_desk']}, ['help_desk'])
        self.assertNotIn('cells', result); self.assertNotIn('distance', result)
        self.assertEqual(result['unavailable_targets'], ['help_desk'])
        self.assertEqual(result['retryable_targets'], [])

    def test_business_failure_can_follow_completed_take_gesture(self):
        tracker = ActionFeedback()
        tracker.register({'id': 1, 'action': 'take'})
        tracker.accept({'id': 1, 'action': 'take', 'status': 'completed'})
        self.assertTrue(tracker.accept_event(1, 'action_failed'))

    def test_old_goal_clearance_cannot_interrupt_a_new_pending_action(self):
        tracker = ActionFeedback()
        tracker.register({'id': 1, 'action': 'walk_to', 'target': 'help_desk'})
        tracker.accept({'id': 1, 'action': 'walk_to', 'status': 'failed'})
        tracker.register({'id': 2, 'action': 'wave'})
        cleared = nav(unavailable_targets=[], retryable_targets=['help_desk'])
        self.assertFalse(tracker.accept_available(1, cleared))
        tracker.accept({'id': 2, 'action': 'wave', 'status': 'completed'})
        self.assertTrue(tracker.accept_available(1, cleared))


if __name__ == '__main__':
    unittest.main()
