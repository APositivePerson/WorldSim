"""Validate visual evidence before it enters an Agent observation."""
import math
from perception.vision import VisualObservation

MAX_VISUAL_AGE = 30.0  # simulation seconds; callers also check body motion


def visual_context(raw, now, latest_id):
    if not isinstance(raw, dict):
        return None
    try:
        stamp = raw["captured_at"]
        identifier = raw["command_id"]
        if type(stamp) not in (int, float) or not math.isfinite(stamp):
            return None
        if type(now) not in (int, float) or not math.isfinite(now):
            return None
        if not 0 <= now - stamp <= MAX_VISUAL_AGE:
            return None
        if identifier is not None and type(identifier) is not int:
            return None
        if identifier != latest_id or raw.get("view") != "person":
            return None
        if raw.get("phase") not in ("before_decision", "after_action"):
            return None
        observation = VisualObservation.model_validate(raw["observation"])
        return {"captured_at": stamp, "command_id": identifier, "view": "person",
                "phase": raw["phase"], "observation": observation.model_dump()}
    except (KeyError, TypeError, ValueError):
        return None
