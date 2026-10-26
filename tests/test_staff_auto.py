import threading
import time
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from scenario import load_scenario
from staff_auto import BrowserStaff, MAX_STAFF_TURNS


class StaffTests(unittest.TestCase):
    def make(self, decide=None, physical=False):
        sc = load_scenario("bank")
        profile = "human_3d" if physical else "human_demo"
        session = SimpleNamespace(closed=False, last_command=None, use_tts=False,
                                  state={"time": 0, "location": "counter_1" if physical else "help_desk"},
                                  send=Mock(), log=Mock(), scenario=sc, body_profile=profile,
                                  caps=sc.capabilities(profile),
                                  bank_state={"ticket": "A001", "called_counter": "counter_1"})
        agent = SimpleNamespace(system_prompt="base", decide=Mock(side_effect=decide) if decide else
                                Mock(return_value=("robot", "您好", "迎接")))
        with patch("staff_auto.StaffAgent", return_value=agent):
            staff = BrowserStaff(session)
        return session, agent, staff

    def wait(self, check):
        for _ in range(100):
            if check():
                return
            time.sleep(.01)
        self.fail("worker timed out")

    def test_opening_duplicates_and_actual_customer_context(self):
        session, agent, staff = self.make()
        staff.request(None)
        self.wait(lambda: not staff.busy)
        staff.request(None)
        self.assertEqual(agent.decide.call_count, 1)
        session.last_command = {"id": 1, "speech": "补卡", "action": "wave", "goal_status": "in_progress"}
        staff.request(99)
        self.assertEqual(agent.decide.call_count, 1)
        staff.request(1)
        self.wait(lambda: not staff.busy)
        self.assertIn("顾客说：补卡", agent.decide.call_args.args[0]["recent"])

    def test_inflight_request_is_not_duplicated_and_close_discards_result(self):
        gate = threading.Event()
        session, agent, staff = self.make(lambda _: (gate.wait(2) and "robot", "您好", ""))
        staff.request(None)
        staff.request(None)
        session.closed = True
        gate.set()
        self.wait(lambda: agent.decide.call_count == 1)
        time.sleep(.05)
        self.assertFalse(any(c.args[0]["type"] == "staff_command" for c in session.send.call_args_list))

    def test_limit_terminal_and_error(self):
        s, agent, staff = self.make()
        staff.turns = MAX_STAFF_TURNS
        staff.request(None)
        agent.decide.assert_not_called()
        self.assertEqual(s.send.call_args.args[0]["type"], "auto_finished")
        s, agent, staff = self.make()
        s.last_command = {"id": 1, "goal_status": "done"}
        staff.request(1)
        agent.decide.assert_not_called()
        s, agent, staff = self.make(lambda _: (_ for _ in ()).throw(RuntimeError("offline")))
        staff.request(None)
        self.wait(lambda: any(c.args[0]["type"] == "auto_finished" for c in s.send.call_args_list))
        self.assertFalse(staff.busy)

    def test_physical_staff_sees_real_bank_state_and_keeps_teller_role(self):
        s, agent, staff = self.make(lambda _: ("teller", "请出示身份证", "核实"), physical=True)
        staff.request(None)
        self.wait(lambda: any(c.args[0]["type"] == "staff_command" for c in s.send.call_args_list))
        customer = agent.decide.call_args.args[0]["customer"]
        self.assertEqual(customer["location"], "counter_1")
        self.assertEqual(customer["ticket"], "A001")
        response = next(c.args[0] for c in s.send.call_args_list if c.args[0]["type"] == "staff_command")
        self.assertEqual(response["speaker"], "teller")


if __name__ == "__main__":
    unittest.main()
