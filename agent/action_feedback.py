"""Session-local command tracking; physical execution remains owned by the body."""
from collections import OrderedDict
from copy import deepcopy
import math


def navigation_context(value, places=None):
    """Bounded execution facts only; never copy a map, image or arbitrary client fields."""
    if not isinstance(value, dict):
        return None
    result = {}
    for key in ("status", "target", "location", "obstaclePhase", "obstacleSource", "failureCode", "lastPlanningError"):
        if isinstance(value.get(key), str):
            result[key] = value[key][:384]
    for key in ("distance", "replans", "planningAttempts", "blockedTime"):
        number = value.get(key)
        if type(number) in (int, float) and math.isfinite(number) and 0 <= number <= 1e9:
            result[key] = number
    for key in ("unavailable_targets", "retryable_targets"):
        targets = value.get(key)
        result[key] = list(dict.fromkeys(t for t in targets[:32] if isinstance(t, str)
                                        and len(t) <= 128 and (places is None or t in places))) if isinstance(targets, list) else []
    # An inconsistent report must never unlock a failed goal.
    result["retryable_targets"] = [t for t in result["retryable_targets"] if t not in result["unavailable_targets"]]
    return result


class ActionFeedback:
    def __init__(self, limit=128):
        self.commands = OrderedDict()
        self.limit = limit
        self.event_ids = set()
        self.recovery_ids = set()

    def register(self, command):
        if command["action"] == "wait":
            return
        self.commands[command["id"]] = {
            "id": command["id"], "action": command["action"],
            "target": command.get("target"), "status": "pending",
        }
        while len(self.commands) > self.limit:
            identifier, _ = self.commands.popitem(last=False)
            self.event_ids.discard(identifier)
            self.recovery_ids.discard(identifier)

    def accept_event(self, identifier, event_type=None):
        """Only a current, finished command may trigger a correlated decision."""
        if type(identifier) is not int or identifier not in self.commands:
            return False
        if (identifier != next(reversed(self.commands))
                or self.commands[identifier]["status"] == "pending"
                or identifier in self.event_ids):
            return False
        status = self.commands[identifier]["status"]
        if (self.commands[identifier]["action"] == "walk_to" and
                (event_type == "action_done" and status != "completed"
                 or event_type == "action_failed" and status not in ("failed", "interrupted"))):
            return False
        self.event_ids.add(identifier)
        return True

    def accept_progress(self, message):
        identifier = message.get("id")
        if type(identifier) is not int or identifier not in self.commands:
            return False, "unknown_id"
        record = self.commands[identifier]
        seq = message.get("seq")
        if (identifier != next(reversed(self.commands)) or record["status"] != "pending"
                or record["action"] != "walk_to" or message.get("action") != "walk_to"
                or message.get("target") != record.get("target")):
            return False, "not_current_navigation"
        if type(seq) is not int or seq <= record.get("progress_seq", 0):
            return False, "stale_progress"
        if message.get("phase") not in ("blocked", "replanning", "moving"):
            return False, "invalid_phase"
        nav = navigation_context(message.get("navigation"))
        if not nav or nav.get("status") != "running" or nav.get("target") != record.get("target"):
            return False, "invalid_navigation"
        record.update(progress_seq=seq, phase=message["phase"], navigation=nav)
        return True, None

    def accept_available(self, identifier, navigation):
        if type(identifier) is not int or identifier not in self.commands or identifier in self.recovery_ids:
            return False
        if self.commands[next(reversed(self.commands))]["status"] == "pending":
            return False
        record = self.commands[identifier]
        if (record["action"] != "walk_to" or record["status"] != "failed" or not navigation
                or record.get("target") not in navigation.get("retryable_targets", [])):
            return False
        self.recovery_ids.add(identifier)
        return True

    def accept(self, message):
        identifier = message.get("id")
        if type(identifier) is not int:
            return False, "invalid_id"
        record = self.commands.get(identifier)
        if record is None:
            return False, "unknown_id"
        if message.get("action") != record["action"]:
            return False, "action_mismatch"
        status = message.get("status")
        if status not in ("completed", "failed", "interrupted"):
            return False, "invalid_status"
        if record["status"] != "pending":
            return False, "duplicate_or_conflicting_result"
        navigation = navigation_context(message.get("navigation"))
        if navigation:
            if (record["action"] != "walk_to" or navigation.get("target") != record.get("target")
                    or message.get("target") != record.get("target")):
                return False, "navigation_target_mismatch"
            if status == "completed" and (navigation.get("status") != "completed"
                    or navigation.get("location") != record.get("target")
                    or navigation.get("distance", math.inf) >= .08):
                return False, "invalid_arrival"
            record["navigation"] = navigation
        record.update(status=status, message=str(message.get("message") or ""),
                      reason=str(message.get("reason") or ""))
        return True, None

    def snapshot(self):
        return deepcopy(list(self.commands.values())[-16:])


def prevent_failed_repeat(action, results, navigation=None):
    """A failed action needs new evidence before an identical automatic retry."""
    latest = results[-1] if results else None
    unavailable = navigation.get("unavailable_targets", []) if navigation else []
    retryable = navigation.get("retryable_targets", []) if navigation else []
    blocked_walk = action.action == "walk_to" and action.target in unavailable
    if (blocked_walk or latest and latest["status"] == "failed"
            and action.action == latest["action"]
            and action.target == latest.get("target") and action.target not in retryable):
        action.action, action.target = "wait", None
        action.goal_status = "in_progress"
        action.speech = "刚才没能完成，能请您帮我一下吗？"
        return ["目标仍不可达或同一动作刚失败，已改为等待并求助；需新可达证据后才能重试"]
    return []
