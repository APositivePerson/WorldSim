import load from '@mujoco/mujoco';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {MuJoCoEngine} from '../character/src/physics/MuJoCoEngine';
import {BankController} from '../scene/physics/BankController';
import {Navigator} from '../scene/physics/Navigator';
import {bankModel,blockingAlong,DESTINATIONS} from '../scene/BankLayout';
import {TEST_BARRIER} from '../scene/ObstacleTest';
// @ts-ignore browser module is exercised unchanged against the real physical facade.
import {ActionRunner,navigationSummary} from '../web/actions.mjs';

const kind=process.argv[2],address=process.argv[3];
assert(['normal','detour','blocked'].includes(kind)&&address,'usage: <normal|detour|blocked> <ws-url>');
const mj=await load({wasmBinary:await readFile(createRequire(import.meta.url).resolve('@mujoco/mujoco/mujoco.wasm'))});
const xml=await readFile('character/public/models/human-free.xml','utf8');
const red={...TEST_BARRIER,x:.25,h:.2};
const yellow={...TEST_BARRIER,name:'test_barrier_lower',x:red.x-1.1,y:-1,w:.8,d:.5,h:.05};
const obstacles=kind==='normal'?[]:kind==='blocked'?[{...red,x:0,w:9,h:TEST_BARRIER.h}]:[red,yellow];
const engine=new MuJoCoEngine(mj,bankModel(xml,obstacles)),controller=new BankController(engine),nav=new Navigator(controller);
const socket=new WebSocket(address),messages:any[]=[],feedback:any[]=[],waiters:{test:()=>boolean;resolve:()=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}[]=[];
function notify(){for(const w of [...waiters])if(w.test()){clearTimeout(w.timer);waiters.splice(waiters.indexOf(w),1);w.resolve();}}
function until(test:()=>boolean){return new Promise<void>((resolve,reject)=>{if(test())return resolve();const w={test,resolve,reject,timer:setTimeout(()=>reject(Error(`WebSocket wait timeout: ${JSON.stringify(messages)}`)),30000)};waiters.push(w);});}
const human={navigate:(target:string)=>nav.go(target),stopNavigation:()=>nav.stop(),cancelAction:()=>controller.cancel(),
 getState:()=>({time:engine.data.time,navigation:nav.getState(),locomotion:controller.locomotion.getState()})};
let terminal:any;
const runner=new ActionRunner(()=>human,(f:any)=>{feedback.push(f);socket.send(JSON.stringify(f));if(f.type==='action_feedback')terminal=f;});
function event(type:string,commandId?:number){socket.send(JSON.stringify({type:'event',command_id:commandId,
 event:{type,content:type,time:engine.data.time},state:{time:engine.data.time,location:nav.location,posture:'standing',current_action:'wait',navigation:navigationSummary(human.getState())}}));}
socket.addEventListener('message',e=>{messages.push(JSON.parse(String(e.data)));notify();});
try{
 await new Promise<void>((resolve,reject)=>{socket.addEventListener('open',()=>resolve(),{once:true});socket.addEventListener('error',()=>reject(Error('socket failed')),{once:true});});
 socket.send(JSON.stringify({type:'hello',version:1,scenario:'bank',persona:'wang',body_profile:'human_3d',mode:'manual',capabilities:{actions:['walk_to','wait'],places:['help_desk','entrance','exit'],look_targets:[]}}));
 await until(()=>messages.some(m=>m.type==='ready'));event('scene_start');await until(()=>messages.some(m=>m.type==='command'));
 const first=messages.find(m=>m.type==='command');assert.equal(first.action,'walk_to');runner.execute(first);
 async function walk(){
  terminal=null;let lastPrint=-1;
  for(let i=0;i<1800/engine.dt&&!terminal;i++){
   controller.update(engine.dt);engine.step();nav.update(engine.dt);runner.tick();
   const tick=Math.floor(engine.data.time/100);if(tick!==lastPrint){lastPrint=tick;console.log(kind,'sim',Math.round(engine.data.time),'replans',nav.replans);}
   if(i%500===0)await new Promise(r=>setImmediate(r));
  }
  assert(terminal,'physical action did not finish');
  await until(()=>messages.some(m=>m.type==='feedback_received'&&m.id===terminal.id));
  assert.equal(messages.find(m=>m.type==='feedback_received'&&m.id===terminal.id).accepted,true);
 }
 await walk();
 if(kind==='blocked'){
  assert.equal(terminal.status,'failed');assert(['blocked_timeout','replan_limit'].includes(terminal.reason));
  assert(terminal.navigation.planningAttempts>1);
  event('action_failed',first.id);await until(()=>messages.filter(m=>m.type==='command').length===2);
  const help=messages.filter(m=>m.type==='command')[1];assert.equal(help.action,'wait');assert.equal(help.goal_status,'in_progress');assert(help.speech);
  // Unrelated speech must not unlock the failed goal.
  event('robot_speech');await until(()=>messages.filter(m=>m.type==='command').length===3);
  assert.equal(messages.filter(m=>m.type==='command')[2].action,'wait');
  const id=mj.mj_name2id(engine.model,5,'bank_test_barrier');engine.model.geom_contype[id]=0;engine.model.geom_conaffinity[id]=0;mj.mj_forward(engine.model,engine.data);
  for(let i=0;i<10/engine.dt&&!nav.getState().retryable_targets.includes('help_desk');i++){controller.update(engine.dt);engine.step();nav.update(engine.dt);}
  if(!nav.getState().retryable_targets.includes('help_desk'))console.log('RECOVERY CHECK',JSON.stringify({
   navigation:nav.getState(),goalBlockers:blockingAlong(DESTINATIONS.help_desk,DESTINATIONS.help_desk,nav.localMap.obstacles),
   startBlockers:blockingAlong({x:engine.data.qpos[0],y:engine.data.qpos[1]},{x:engine.data.qpos[0],y:engine.data.qpos[1]},nav.localMap.obstacles)}));
  assert(nav.getState().retryable_targets.includes('help_desk'));assert.equal(nav.status,'failed');
  event('navigation_available',first.id);await until(()=>messages.filter(m=>m.type==='command').length===4);
  const retry=messages.filter(m=>m.type==='command')[3];assert.equal(retry.action,'walk_to');runner.execute(retry);await walk();
  assert.equal(terminal.status,'completed');event('action_done',retry.id);
  await until(()=>messages.filter(m=>m.type==='command').length===5);
 }else{
  assert.equal(terminal.status,'completed');assert.equal(nav.location,'help_desk');assert(nav.getState().distance<.08);
  assert.equal(kind==='detour'?nav.replans>0:nav.replans===0,true);
  event('action_done',first.id);await until(()=>messages.filter(m=>m.type==='command').length===2);
 }
 assert.equal(messages.filter(m=>m.type==='command').at(-1).action,'wait');
 assert(!messages.some(m=>m.type==='error'));assert(!feedback.some(f=>f.type==='action_feedback'&&f.status==='completed'&&f.navigation.distance>=.08));
 console.log('PASS REAL PHYSICS + WEBSOCKET + BRAIN',JSON.stringify({kind,time:engine.data.time,commands:messages.filter(m=>m.type==='command').length,progress:feedback.filter(f=>f.type==='action_progress').length,location:nav.location,distance:nav.getState().distance}));
}finally{for(const w of waiters)clearTimeout(w.timer);socket.close();controller.dispose();engine.dispose();}
