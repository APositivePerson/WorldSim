import loadMujoco from '@mujoco/mujoco';
import wasmUrl from '@mujoco/mujoco/mujoco.wasm?url';
import {MuJoCoEngine} from '../character/src/physics/MuJoCoEngine';
import {bankModel} from './BankLayout';
import {TEST_BARRIER} from './ObstacleTest';
export async function loadBank(obstacles:(typeof TEST_BARRIER)[]=[]){
  const [mj,response]=await Promise.all([loadMujoco({locateFile:(path:string)=>path.endsWith('.wasm')?wasmUrl:path}),fetch('/bank/models/human-neuromuscular.xml')]);
  if(!response.ok)throw Error(`MJCF HTTP ${response.status}`);
  return new MuJoCoEngine(mj,bankModel(await response.text(),obstacles));
}
