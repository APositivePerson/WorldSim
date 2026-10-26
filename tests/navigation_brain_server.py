"""Real WebSocket/BrainSession/CustomerBrain with a deterministic provider fixture.

Deliberately proposes an unsafe same-goal retry on failure, exercising the runtime guard.
No network model, speech synthesis or recognition is called by this test server.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import agent.brain
from brain_server import make_handler
from websockets.sync.server import serve


def decide(_client, messages, **_kwargs):
    observation = json.loads(messages[-1]['content'])
    kinds = {e['type'] for e in observation['events']}
    if 'action_done' in kinds:
        return json.dumps({'action': 'wait', 'speech': '已到达，请问接下来怎么办？', 'goal_status': 'in_progress'})
    if 'action_failed' in kinds or 'robot_speech' in kinds:
        return json.dumps({'action': 'walk_to', 'target': 'help_desk', 'goal_status': 'done'})
    return json.dumps({'action': 'walk_to', 'target': 'help_desk', 'goal_status': 'in_progress'})


if __name__ == '__main__':
    agent.brain.make_client = lambda: None
    agent.brain.chat_json = decide
    with serve(make_handler(False, None), '127.0.0.1', 0) as server:
        print(f'ws://127.0.0.1:{server.socket.getsockname()[1]}', flush=True)
        server.serve_forever()
