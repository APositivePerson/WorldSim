import load from '@mujoco/mujoco';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {MuJoCoEngine} from '../character/src/physics/MuJoCoEngine';
import {BankController} from '../scene/physics/BankController';
import {Navigator} from '../scene/physics/Navigator';
import {BankWorkflow} from '../scene/BankWorkflow';
import {bankModel,DESTINATIONS,planPath} from '../scene/BankLayout';
const mj=await load({wasmBinary:await readFile(createRequire(import.meta.url).resolve('@mujoco/mujoco/mujoco.wasm'))});
const xml=bankModel(await readFile('character/public/models/human-neuromuscular.xml','utf8'));
const e=new MuJoCoEngine(mj,xml),c=new BankController(e),nav=new Navigator(c),bank=new BankWorkflow(nav);
let minimum=10,maximumForce=0,clears=[0,0];const reports=[];
const footIds=['left','right'].map(s=>mj.mj_name2id(e.model,1,s+'_foot'));
function run(seconds:number){
  for(let i=0;i<Math.round(seconds/e.dt);i++){
    const before=Array.from(e.data.qpos),velocity=Array.from(e.data.qvel);
    c.update(e.dt);nav.update(e.dt);bank.update(e.dt,e.data.time);
    assert.deepEqual(Array.from(e.data.qpos),before,'controller rewrote live qpos');
    assert.deepEqual(Array.from(e.data.qvel),velocity,'controller rewrote live qvel');
    if(i%50===0){
      assert(Array.from(e.data.xfrc_applied).every(x=>x===0));assert(Array.from(e.data.qfrc_applied).every(x=>x===0));
      for(const j of e.joints){assert(Number.isFinite(e.data.qpos[j.q]));assert(e.data.qpos[j.q]>=j.min-.05&&e.data.qpos[j.q]<=j.max+.05,j.name);}
      footIds.forEach((id,i)=>{if(e.data.xpos[id*3+2]>.115)clears[i]++;});
    }
    e.step();minimum=Math.min(minimum,e.data.qpos[2]);
    assert(e.data.qpos[2]>.85,`fell at ${e.data.time} towards ${nav.target}: ${JSON.stringify(c.locomotion.getState())}`);
  }
}
try{
  assert.equal(e.model.neq,0);assert.equal(e.model.nu,131);assert(c.physicalEyes.available&&c.legMuscles.available);run(3);
  assert.equal(bank.take(e.data.time).ok,false);
  for(const target of ['help_desk','ticket_machine','waiting_area','counter_1']){
    console.log('START',target,planPath({x:e.data.qpos[0],y:e.data.qpos[1]},DESTINATIONS[target]));
    assert(nav.go(target));let iterations=0;
    while(nav.status==='running'&&iterations++<40){run(40);console.log('PROGRESS',target,e.data.time.toFixed(0),JSON.stringify(c.locomotion.getState()));}
    if(nav.status!=='completed')await writeFile('logs/physical-route-failure.json',JSON.stringify({state:nav.getState(),events:nav.events,body:c.locomotion.getState()},null,2));
    assert.equal(nav.status,'completed',nav.error);
    assert(nav.getState().distance<.08);assert(c.locomotion.settled);
    const row={target,time:e.data.time,state:nav.getState(),position:Array.from(e.data.qpos.slice(0,3)),yaw:c.locomotion.yaw};reports.push(row);console.log('ARRIVED',JSON.stringify(row));
    if(target==='ticket_machine'){assert(bank.take(e.data.time).ok);const ticket=bank.ticket;bank.take(e.data.time);assert.equal(bank.ticket,ticket);assert.equal(bank.called_counter,null);}
    if(target==='waiting_area'){run(17);assert.equal(bank.called_counter,'counter_1');assert.equal(bank.drain().length,1);assert.equal(bank.drain().length,0);}
  }
  assert(clears.every(x=>x>10));await writeFile('logs/physical-route.json',JSON.stringify({minimum,clears,reports},null,2));
  console.log('PASS complete physical route',minimum,clears);
}finally{c.dispose();e.dispose();}
