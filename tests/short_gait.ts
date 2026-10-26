import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import load from '@mujoco/mujoco';
import {MuJoCoEngine} from '../character/src/physics/MuJoCoEngine';
import {BankController} from '../scene/physics/BankController';
const mj=await load({wasmBinary:await readFile(createRequire(import.meta.url).resolve('@mujoco/mujoco/mujoco.wasm'))});
const xml=await readFile('character/public/models/human-neuromuscular.xml','utf8');
for(const distance of [.45,.8,2]){
 const e=new MuJoCoEngine(mj,xml),c=new BankController(e);
 const tick=()=>{c.update(e.dt);e.step();assert.ok(e.data.qpos[2]>.85,JSON.stringify(c.locomotion.getState()));};
 try{
  for(let i=0;i<2/e.dt;i++)tick();
  const goal={x:e.data.qpos[0],y:e.data.qpos[1]-distance,yaw:0};c.locomotion.go(goal);
  const start=e.data.time;
  for(let i=0;i<25/e.dt&&(c.locomotion.mode==='walk'||!c.locomotion.settled);i++)tick();
  const elapsed=e.data.time-start,error=Math.hypot(e.data.qpos[0]-goal.x,e.data.qpos[1]-goal.y);
  // Record total docking time separately from steady walking speed: it also
  // includes contact confirmation and final foot placement near the target.
  assert.ok(c.locomotion.settled);assert.ok(error<.08);
  console.log('PASS short-route arrival',{distance,elapsed,error});
 }finally{c.dispose();e.dispose();}
}
