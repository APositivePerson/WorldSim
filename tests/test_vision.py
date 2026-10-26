import base64
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from perception.vision import analyze, validate_request, VisualObservation
from perception.context import visual_context


def frame(time=1, view="person"):
    return {"image": "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8test\xff\xd9").decode(),
            "time": time, "view": view}


class VisionTests(unittest.TestCase):
    def test_agent_context_rejects_stale_wrong_command_and_observer_view(self):
        raw = {"captured_at": 10, "command_id": 3, "view": "person", "phase": "after_action",
               "observation": {"summary": "柜台被遮挡", "objects": [], "changes": [],
                               "uncertainties": ["无法确定"], "comparison": "not_applicable"}}
        self.assertIsNotNone(visual_context(raw, 12, 3))
        for changed, now, identifier in (
            (raw, 41, 3), (raw, 9, 3), (raw, 12, 4),
            ({**raw, "view": "observer"}, 12, 3),
            ({**raw, "captured_at": float("nan")}, 12, 3),
            ({**raw, "observation": {"action": "walk_to"}}, 12, 3)):
            self.assertIsNone(visual_context(changed, now, identifier))

    def test_request_rejects_remote_urls_bad_time_and_mixed_views(self):
        for frames in ([], [frame()] * 3, [{**frame(), "image": "https://example.com/a.jpg"}],
                       [frame(float("nan"))], [frame(2), frame(1)],
                       [frame(), frame(2, "observer")]):
            with self.assertRaises(ValueError):
                validate_request({"frames": frames})
        self.assertEqual(len(validate_request({"frames": [frame(), frame(2)]})[0]), 2)

    def test_call_uses_visual_model_images_without_text_reasoning_settings(self):
        observation = {"summary": "无法辨认", "objects": [], "changes": [],
                       "uncertainties": ["遮挡"], "comparison": "uncertain"}
        client = MagicMock()
        client.chat.completions.create.return_value = SimpleNamespace(
            choices=[SimpleNamespace(finish_reason="stop", message=SimpleNamespace(
                content=json.dumps(observation)))], usage=None)
        with tempfile.TemporaryDirectory() as folder, patch("perception.vision.OpenAI") as factory, \
                patch("perception.vision.config.VLM_API_KEY", "test-secret"), \
                patch("perception.vision.config.LOG_DIR", Path(folder)):
            factory.return_value.__enter__.return_value = client
            result = analyze({"frames": [frame()]})
            self.assertEqual(result["observation"]["comparison"], "not_applicable")
            kwargs = client.chat.completions.create.call_args.kwargs
            self.assertEqual(kwargs["model"], "glm-4.6v")
            self.assertNotIn("reasoning_effort", kwargs["extra_body"])
            self.assertEqual(kwargs["messages"][1]["content"][1]["type"], "image_url")
            log = next(Path(folder).glob("vision-*.json")).read_text(encoding="utf-8")
            self.assertNotIn("base64", log)
            self.assertNotIn("test-secret", log)

    def test_invalid_model_schema_cannot_be_used_as_observation(self):
        with self.assertRaises(ValueError):
            VisualObservation.model_validate({"summary": "成功", "action": "walk_to"})


if __name__ == "__main__":
    unittest.main()
