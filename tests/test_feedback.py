"""Small gesture feedback must not trigger another model decision."""
import unittest
import threading
import json
import tempfile
from pathlib import Path
from unittest.mock import Mock, patch

from brain_server import BrainSession
from agent.action_feedback import ActionFeedback, prevent_failed_repeat
from protocol import AgentAction
from scenario import load_scenario


class FeedbackTests(unittest.TestCase):
    def test_feedback_is_logged_and_acknowledged_without_new_event(self):
        session = BrainSession.__new__(BrainSession)
        session.log = Mock()
        session.send = Mock()
        session._on_event = Mock()
        session.cond = threading.Condition()
        session.action_feedback = ActionFeedback()
        session.action_feedback.register({"id": 7, "action": "wave"})
        session.on_message({"type": "action_feedback", "id": 7, "action": "wave",
                            "status": "completed", "message": "stable"})
        session.log.assert_called_once_with({"kind": "action_feedback", "id": 7,
                                            "action": "wave", "status": "completed",
                                            "message": "stable", "accepted": True, "reason": None})
        session.send.assert_called_once_with({"type": "feedback_received", "id": 7,
                                              "accepted": True, "reason": None})
        session._on_event.assert_not_called()

    def test_rejects_unknown_mismatched_and_duplicate_results(self):
        tracker = ActionFeedback()
        tracker.register({"id": 1, "action": "walk_to", "target": "counter_1"})
        base = {"id": 1, "action": "walk_to", "status": "failed", "message": "超时"}
        for patch in ({"id": 2}, {"id": True}, {"id": []},
                      {"action": "wave"}, {"status": "running"}):
            self.assertFalse(tracker.accept({**base, **patch})[0])
        self.assertEqual(tracker.snapshot()[0]["status"], "pending")
        self.assertTrue(tracker.accept(base)[0])
        self.assertFalse(tracker.accept({**base, "status": "completed"})[0])
        snapshot = tracker.snapshot()
        snapshot[0]["status"] = "completed"
        self.assertEqual(tracker.snapshot()[0]["status"], "failed")

    def test_wait_does_not_replace_running_action_and_history_is_bounded(self):
        tracker = ActionFeedback(limit=2)
        tracker.register({"id": 1, "action": "wave"})
        tracker.register({"id": 2, "action": "wait"})
        self.assertEqual(len(tracker.snapshot()), 1)
        tracker.register({"id": 3, "action": "nod"})
        tracker.register({"id": 4, "action": "walk_to", "target": "exit"})
        self.assertEqual([r["id"] for r in tracker.snapshot()], [3, 4])

    def test_failure_recovery_does_not_override_alternative_or_newer_command(self):
        failed = {"id": 1, "action": "walk_to", "target": "counter_1", "status": "failed"}
        action = AgentAction(action="walk_to", target="counter_1", goal_status="done")
        self.assertTrue(prevent_failed_repeat(action, [failed]))
        self.assertEqual((action.action, action.target, action.goal_status), ("wait", None, "in_progress"))
        self.assertIn("帮", action.speech)
        alternative = AgentAction(action="walk_to", target="help_desk")
        self.assertFalse(prevent_failed_repeat(alternative, [failed]))
        pending = {**failed, "id": 2, "status": "pending"}
        retry = AgentAction(action="walk_to", target="counter_1")
        self.assertFalse(prevent_failed_repeat(retry, [failed, pending]))

    def test_correlated_events_are_current_and_once_only(self):
        tracker = ActionFeedback()
        tracker.register({"id": 1, "action": "wave"})
        self.assertFalse(tracker.accept_event(1))
        tracker.accept({"id": 1, "action": "wave", "status": "completed"})
        self.assertTrue(tracker.accept_event(1))
        self.assertFalse(tracker.accept_event(1))
        tracker.register({"id": 2, "action": "nod"})
        self.assertFalse(tracker.accept_event(1))
        self.assertFalse(tracker.accept_event([]))

    def test_mock_body_failure_reaches_model_and_repeat_becomes_help(self):
        scenario = load_scenario("bank")
        conn = Mock()
        messages = []
        with tempfile.TemporaryDirectory() as folder, \
                patch("brain_server.config.LOG_DIR", Path(folder)), \
                patch("brain_server.threading.Thread.start"), \
                patch("agent.brain.make_client"), \
                patch("agent.brain.chat_json", return_value=json.dumps({
                    "action": "walk_to", "target": "counter_1", "goal_status": "done"
                })) as model:
            session = BrainSession(conn, scenario, next(iter(scenario.personas)),
                                   False, None, "human_3d")
            try:
                session.action_feedback.register({"id": 1, "action": "walk_to", "target": "counter_1"})
                session.cmd_id = 1
                session.on_message({"type": "action_feedback", "id": 1, "action": "walk_to",
                                    "status": "failed", "reason": "timeout", "message": "行走超时"})
                self.assertFalse(session.pending)  # wait for speech/body event
                event = {"type": "event", "command_id": 1,
                         "event": {"type": "action_failed", "content": "行走超时", "time": 42},
                         "state": {"time": 42, "location": "moving", "current_action": "wait"}}
                event["vision"] = {"captured_at": 40, "command_id": 1, "view": "person",
                                   "phase": "after_action", "observation": {
                                       "summary": "前方有障碍", "objects": [], "changes": [],
                                       "uncertainties": ["无法判断能否通过"], "comparison": "not_applicable"}}
                session.on_message(event)
                session.on_message(event)  # duplicate cannot trigger another model call
                self.assertEqual(len(session.pending), 1)

                def receive(payload):
                    message = json.loads(payload)
                    messages.append(message)
                    if message["type"] == "command":
                        session.closed = True
                conn.send.side_effect = receive
                session._decide_loop()
                model.assert_called_once()
                observation = json.loads(model.call_args.args[1][-1]["content"])
                self.assertEqual(observation["action_results"][-1]["reason"], "timeout")
                self.assertEqual(observation["vision"]["observation"]["summary"], "前方有障碍")
                self.assertIsNone(session.visual_observation)
                command = next(m for m in messages if m["type"] == "command")
                self.assertEqual((command["action"], command["goal_status"]), ("wait", "in_progress"))
                self.assertIn("帮", command["speech"])
            finally:
                session.close()


if __name__ == "__main__":
    unittest.main()
