import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import load from '@mujoco/mujoco';
import {MuJoCoEngine} from '../character/src/physics/MuJoCoEngine';
import {BankController} from '../scene/physics/BankController';
const mj=await load({wasmBinary:await readFile(createRequire(import.meta.url).resolve('@mujoco/mujoco/mujoco.wasm'))});
const xml=await readFile('character/public/models/human-neuromuscular.xml','utf8');
for(const [yaw,mode] of [[0,'servo'],[Math.PI/2,'servo'],[Math.PI,'servo'],[-1.1,'servo'],[0,'ankle'],[1.1,'full']] as const){
 const e=new MuJoCoEngine(mj,xml);
 e.data.qpos[3]=Math.cos(yaw/2);e.data.qpos[6]=Math.sin(yaw/2);mj.mj_forward(e.model,e.data);
 const c=new BankController(e);let minHeight=Infinity,peakSpeed=0,naturalTime=0,naturalDistance=0;
 const tick=()=>{const q=Array.from(e.data.qpos),v=Array.from(e.data.qvel);c.update(e.dt);
  assert.deepEqual(Array.from(e.data.qpos),q);assert.deepEqual(Array.from(e.data.qvel),v);
  e.step();minHeight=Math.min(minHeight,e.data.qpos[2]);peakSpeed=Math.max(peakSpeed,Math.hypot(e.data.qvel[0],e.data.qvel[1]));
  if(c.locomotion.naturalCoordinator){naturalTime+=e.dt;naturalDistance+=(e.data.qvel[0]*Math.sin(yaw)-e.data.qvel[1]*Math.cos(yaw))*e.dt;}
  assert.ok(e.data.qpos[2]>.85,JSON.stringify({yaw,time:e.data.time,pose:Array.from(e.data.qpos.slice(0,7)),state:c.locomotion.getState()}));};
 try{
  for(let i=0;i<3/e.dt;i++)tick();
  assert.ok(c.setLegDrive(mode));
  const start={x:e.data.qpos[0],y:e.data.qpos[1]},goal={x:start.x+2*Math.sin(yaw),y:start.y-2*Math.cos(yaw),yaw};
  c.locomotion.go(goal);
  for(let i=0;i<160/e.dt&&(c.locomotion.mode==='walk'||!c.locomotion.settled);i++)tick();
  const distance=Math.hypot(e.data.qpos[0]-goal.x,e.data.qpos[1]-goal.y);
  console.log({yaw,mode,time:e.data.time,minHeight,peakSpeed,distance,steps:c.locomotion.steps,naturalTime,naturalDistance,naturalAverageSpeed:naturalDistance/naturalTime});
  assert.ok(naturalDistance>.8);assert.ok(naturalDistance/naturalTime>.1);
  assert.ok(peakSpeed>.2);assert.ok(distance<.08);assert.ok(c.locomotion.settled);
 }finally{c.dispose();e.dispose();}
}
