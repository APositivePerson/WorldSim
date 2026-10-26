import load from '@mujoco/mujoco';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {MuJoCoEngine} from '../character/src/physics/MuJoCoEngine';
import {BankController} from '../scene/physics/BankController';
import {bankModel} from '../scene/BankLayout';
const mj=await load({wasmBinary:await readFile(createRequire(import.meta.url).resolve('@mujoco/mujoco/mujoco.wasm'))});
const engine=new MuJoCoEngine(mj,bankModel(await readFile('character/public/models/human-neuromuscular.xml','utf8')));
const controller=new BankController(engine);
function tick(){
  const before=Array.from(engine.data.qpos),velocity=Array.from(engine.data.qvel);
  controller.update(engine.dt);
  assert.deepEqual(Array.from(engine.data.qpos),before);assert.deepEqual(Array.from(engine.data.qvel),velocity);
  assert(Array.from(engine.data.ctrl).every(Number.isFinite));engine.step();
  assert(engine.data.qpos[2]>.85,'fell');
}
function seconds(n:number){for(let i=0;i<n/engine.dt;i++)tick();}
function done(observe=()=>{}){
  let n=0;while(controller.status==='running'&&n++<35/engine.dt){tick();observe();}
  assert.equal(controller.status,'completed',JSON.stringify({error:controller.error,reach:controller.reach.snapshot()}));
}
try{
  seconds(3);
  assert.equal(controller.muscles.enabled,false);
  assert(Array.from(engine.model.tendon_stiffness).every(v=>v===0));
  assert.equal(controller.executeAction({action:'reach_left',target:[99,99,99]}),false);
  assert.equal(controller.executeAction({action:'raise_right_arm',duration:NaN}),false);
  for(const action of ['wave','nod','shake_head','hand_over','take']){
    const joint=action==='wave'?'right_shoulder':action==='nod'?'neck_pitch':'neck_yaw';
    const q=engine.joints.find(j=>j.name===joint)!.q;let low=Infinity,high=-Infinity;
    assert(controller.performAction({id:action,action}));done(()=>{low=Math.min(low,engine.data.qpos[q]);high=Math.max(high,engine.data.qpos[q]);});
    assert.equal(controller.result().id,action);
    if(action==='wave'){assert(high>1);assert(Math.abs(engine.data.qpos[q])<.14);}
    if(action==='nod'){assert(high>.2);assert(Math.abs(engine.data.qpos[q])<.14);}
    if(action==='shake_head'){assert(low<-.25&&high>.25);assert(Math.abs(engine.data.qpos[q])<.14);}
    if(['hand_over','take'].includes(action))assert(controller.reach.error<.025);
    console.log('PASS action',action,engine.data.time,controller.reach.snapshot());
  }
  assert(controller.executeAction({action:'reset_pose'}));done();
  assert(controller.setFinger('right','index',.7));done();
  assert(controller.performAction({id:'cancel',action:'wave'}));seconds(.3);controller.cancel();
  assert.equal(controller.status,'interrupted');seconds(2);assert.equal(controller.status,'interrupted');
  assert(controller.executeAction({action:'reset_pose'}));done();
  // Actual physical turn, then repeat reach in world coordinates facing +Y.
  controller.locomotion.go({x:engine.data.qpos[0],y:engine.data.qpos[1],yaw:Math.PI});
  let n=0;while((controller.locomotion.mode==='walk'||!controller.locomotion.settled)&&n++<220/engine.dt)tick();
  assert(controller.locomotion.settled,'turn did not settle');
  assert(Math.abs(Math.abs(controller.locomotion.yaw)-Math.PI)<.12);
  assert(controller.performAction({id:'turned-reach',action:'hand_over'}));done();
  assert(controller.reach.error<.025);
  console.log('PASS physical turn + rotated reach',controller.reach.snapshot());
  // New upper-body references really reach ctrl rather than only being telemetry.
  controller.executeAction({action:'reset_pose'});done();
  controller.locomotion.go({x:engine.data.qpos[0],y:engine.data.qpos[1]+.15,yaw:Math.PI});
  seconds(2);const shoulder=engine.joints.find(j=>j.name==='left_shoulder_flex')!;
  controller.setMotionReference(0);controller.update(engine.dt);const without=engine.data.ctrl[shoulder.actuator];
  controller.setMotionReference(1);controller.update(engine.dt);const withReference=engine.data.ctrl[shoulder.actuator];
  assert(Math.abs(withReference-without)>.001,'reference did not participate in joint control');
  console.log('PASS recorded reference participates in control');
}finally{controller.dispose();engine.dispose();}
