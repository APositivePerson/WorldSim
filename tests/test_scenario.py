"""场景文件和能力交集：大脑只会用到场景提供、且身体声明能做的动作和目标。"""
import unittest

from protocol import AgentAction
from scenario import SCENARIOS_DIR, load_scenario


class ScenarioTests(unittest.TestCase):
    def test_every_scenario_loads(self):
        for folder in SCENARIOS_DIR.iterdir():
            if (folder / "scene.json").exists():
                sc = load_scenario(folder.name)
                self.assertIn(sc.start_place(), sc.places)
                self.assertIn(sc.greeter, sc.staff)
                self.assertTrue(sc.personas, folder.name)

    def test_body_capabilities_restrict_actions_and_targets(self):
        sc = load_scenario("bank")
        caps = sc.capabilities(None, {"actions": ["wait", "walk_to", "look_at"],
                                      "places": ["help_desk", "counter_1"], "look_targets": ["robot"]})
        self.assertEqual(caps.places, ["counter_1", "help_desk"])
        act, errors = AgentAction.from_dict({"action": "walk_to", "target": "counter_3"}, caps)
        self.assertEqual(act.action, "wait")
        self.assertTrue(errors)
        act, errors = AgentAction.from_dict({"action": "sit"}, caps)
        self.assertEqual(act.action, "wait")
        act, errors = AgentAction.from_dict({"action": "walk_to", "target": "counter_1"}, caps)
        self.assertEqual((act.action, act.target, errors), ("walk_to", "counter_1", []))

    def test_no_places_removes_walk(self):
        caps = load_scenario("bank").capabilities("human_demo")
        self.assertNotIn("walk_to", caps.actions)
        self.assertEqual(sorted(caps.look_targets), ["help_desk", "robot"])

    def test_staff_only_speaks_at_their_post(self):
        sc = load_scenario("bank")
        self.assertEqual(sc.fix_speaker("teller", "entrance"), "robot")
        self.assertEqual(sc.fix_speaker("teller", "counter_2"), "teller")
        self.assertEqual(sc.fix_speaker("robot", "counter_2"), "robot")


if __name__ == "__main__":
    unittest.main()
