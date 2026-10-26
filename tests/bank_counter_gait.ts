import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import load from '@mujoco/mujoco';
import {MuJoCoEngine} from '../character/src/physics/MuJoCoEngine';
import {BankController} from '../scene/physics/BankController';
import {Navigator} from '../scene/physics/Navigator';
import {bankModel,DESTINATIONS} from '../scene/BankLayout';
const mj=await load({wasmBinary:await readFile(createRequire(import.meta.url).resolve('@mujoco/mujoco/mujoco.wasm'))});
const e=new MuJoCoEngine(mj,bankModel(await readFile('character/public/models/human-neuromuscular.xml','utf8')));
const start=DESTINATIONS.waiting_area;e.data.qpos[0]=start.x;e.data.qpos[1]=start.y;e.data.qpos[3]=Math.cos(start.yaw/2);e.data.qpos[6]=Math.sin(start.yaw/2);mj.mj_forward(e.model,e.data);
const c=new BankController(e),nav=new Navigator(c);
try{
 const tick=()=>{c.update(e.dt);e.step();nav.update(e.dt);assert.ok(e.data.qpos[2]>.85,JSON.stringify(c.locomotion.getState()));};
 for(let i=0;i<3/e.dt;i++)tick();assert.ok(nav.go('counter_1'));
 for(let i=0;i<200/e.dt&&nav.status==='running';i++)tick();
 assert.equal(nav.status,'completed',JSON.stringify(nav.getState()));console.log('PASS turned natural gait to counter',e.data.time,nav.getState().distance);
}finally{c.dispose();e.dispose();}
