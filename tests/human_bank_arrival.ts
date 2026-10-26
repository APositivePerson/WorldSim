import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import load from '@mujoco/mujoco';
import {MuJoCoEngine} from '../character/src/physics/MuJoCoEngine';
import {BankController} from '../scene/physics/BankController';
import {Navigator} from '../scene/physics/Navigator';
import {bankModel,DESTINATIONS} from '../scene/BankLayout';
const mj=await load({wasmBinary:await readFile(createRequire(import.meta.url).resolve('@mujoco/mujoco/mujoco.wasm'))});
const xml=bankModel(await readFile('character/public/models/human-neuromuscular.xml','utf8'));
const results=[];
for(const fixture of [{target:'ticket_machine',x:-3.1385,y:-2.575,yaw:-1.678},{target:'waiting_area',x:2.1,y:.9,yaw:Math.PI/2}]){
 const e=new MuJoCoEngine(mj,xml);
 // Initial test fixture only; all following motion must come from engine.step.
 e.data.qpos[0]=fixture.x;e.data.qpos[1]=fixture.y;e.data.qpos[3]=Math.cos(fixture.yaw/2);
 e.data.qpos[4]=e.data.qpos[5]=0;e.data.qpos[6]=Math.sin(fixture.yaw/2);mj.mj_forward(e.model,e.data);
 const c=new BankController(e),nav=new Navigator(c);
 const tick=()=>{c.update(e.dt);e.step();nav.update(e.dt);assert.ok(e.data.qpos[2]>.85);};
 try{
  for(let i=0;i<3/e.dt;i++)tick();assert.ok(nav.go(fixture.target));
  for(let i=0;i<240/e.dt&&nav.status==='running';i++)tick();
  if(nav.status!=='completed')await writeFile('logs/arrival-failure.json',JSON.stringify({state:nav.getState(),events:nav.events},null,2));
  assert.equal(nav.status,'completed',JSON.stringify(nav.getState()));
  assert.ok(nav.getState().distance<.08);assert.ok(c.locomotion.settled);
  assert.ok(Math.abs(Math.atan2(Math.sin(c.locomotion.yaw-DESTINATIONS[fixture.target].yaw),Math.cos(c.locomotion.yaw-DESTINATIONS[fixture.target].yaw)))<.12);
  const result={target:fixture.target,time:e.data.time,distance:nav.getState().distance,replans:nav.replans,steps:c.locomotion.steps};
  results.push(result);console.log('PASS actual goal region',result);
 }finally{c.dispose();e.dispose();}
}
await writeFile('logs/human-bank-arrival.json',JSON.stringify(results,null,2)+'\n');
