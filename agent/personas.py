"""顾客人设。每个场景的人设放在 scenarios/<场景id>/personas.json 里。"""
from scenario import DEFAULT_SCENARIO, load_scenario


def personas(scene_id: str = DEFAULT_SCENARIO) -> dict[str, dict]:
    return load_scenario(scene_id).personas
