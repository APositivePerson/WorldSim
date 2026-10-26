import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import load from '@mujoco/mujoco';
import {MuJoCoEngine} from '../character/src/physics/MuJoCoEngine';
import {BankController} from '../scene/physics/BankController';
import {bankModel} from '../scene/BankLayout';
const mj=await load({wasmBinary:await readFile(createRequire(import.meta.url).resolve('@mujoco/mujoco/mujoco.wasm'))});
const xml=bankModel(await readFile('character/public/models/human-neuromuscular.xml','utf8'));
const results=[];
for(const mode of ['servo','ankle','full'] as const){
  const e=new MuJoCoEngine(mj,xml),c=new BankController(e);let minHeight=Infinity,maxMuscleForce=0,maxDisabledMotor=0;
  function tick(){
    const before=Array.from(e.data.qpos),velocity=Array.from(e.data.qvel);c.update(e.dt);
    assert.deepEqual(Array.from(e.data.qpos),before,'control must not teleport the customer');
    assert.deepEqual(Array.from(e.data.qvel),velocity);
    assert.ok(Array.from(e.data.ctrl).every(Number.isFinite));e.step();
    minHeight=Math.min(minHeight,e.data.qpos[2]);assert.ok(e.data.qpos[2]>.85,`${mode} fell`);
    if(Math.round(e.data.time/e.dt)%100===0){
      const s=c.legMuscles.snapshot();maxMuscleForce=Math.max(maxMuscleForce,...s.muscles.map(m=>m.force));
      maxDisabledMotor=Math.max(maxDisabledMotor,...s.motors.map(m=>Math.abs(m.force)));
    }
  }
  const run=(seconds:number)=>{for(let i=0;i<Math.round(seconds/e.dt);i++)tick();};
  function done(){for(let i=0;i<20/e.dt&&c.status==='running';i++)tick();assert.equal(c.status,'completed',c.error);}
  try{
    run(3);assert.ok(c.legMuscles.available&&c.physicalEyes.available);
    assert.equal(c.setLegDrive(mode),true);run(2);
    assert.equal(c.setEyeTarget([NaN,0,1]),false);
    assert.equal(c.legMuscles.configure({gammaStatic:NaN}),false);
    // Real finite external impulse; controller never receives its force value.
    e.data.xfrc_applied[6]=35;run(.12);e.data.xfrc_applied[6]=0;run(3);
    assert.ok(c.locomotion.settled,'push recovery');
    assert.ok(c.performAction({id:'wave-'+mode,action:'wave'}));done();
    assert.equal(c.result().id,'wave-'+mode);
    assert.ok(c.executeAction({action:'reset_pose',duration:1}));done();
    assert.ok(c.executeAction({action:'turn_head_left',duration:1}));done();run(1);
    assert.ok(c.physicalEyes.snapshot().eyes.every(eye=>eye.angles[0]<-.2),'physical eyes compensate head turn');
    assert.ok(c.executeAction({action:'reset_pose',duration:1}));done();
    const start={x:e.data.qpos[0],y:e.data.qpos[1]},goal={x:start.x+.025,y:start.y-.15,yaw:.16};
    assert.ok(c.locomotion.go(goal));assert.equal(c.setLegDrive(mode==='full'?'servo':'full'),false);
    for(let i=0;i<100/e.dt&&(c.locomotion.mode==='walk'||!c.locomotion.settled);i++)tick();
    assert.ok(c.locomotion.settled,JSON.stringify(c.locomotion.getState()));
    assert.ok(Math.hypot(e.data.qpos[0]-goal.x,e.data.qpos[1]-goal.y)<.08,'physical arrival');
    assert.ok(Math.abs(c.locomotion.yaw-goal.yaw)<.12,'physical orientation');
    assert.ok(c.locomotion.steps>0);assert.ok(start.y-e.data.qpos[1]>.06);
    if(mode!=='servo'){assert.ok(maxMuscleForce>100);assert.equal(maxDisabledMotor,0);}
    const result={mode,minHeight,steps:c.locomotion.steps,position:Array.from(e.data.qpos.slice(0,3)),yaw:c.locomotion.yaw,maxMuscleForce,maxDisabledMotor};
    results.push(result);console.log('PASS integrated bank body',result);
  }finally{c.dispose();e.dispose();}
}
await mkdir('logs',{recursive:true});await writeFile('logs/human-bank-physics.json',JSON.stringify(results,null,2)+'\n');
