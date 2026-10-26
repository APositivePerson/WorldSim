import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import load from "@mujoco/mujoco";
import { MuJoCoEngine } from "../src/physics/MuJoCoEngine.ts";
import { HumanController } from "../src/human/HumanController.ts";
import { sampleWalk, recordedLift, walkSource } from "../src/human/motion/WalkReference.ts";
const mj=await load(),xml=await readFile(new URL('../public/models/human-free.xml',import.meta.url),'utf8');
function fixture(){const e=new MuJoCoEngine(mj,xml),c=new HumanController(e);return {e,c,run(seconds:number,check?:()=>void){for(let i=0;i<seconds/e.dt;i++){c.update(e.dt);e.step();check?.();}},dispose(){c.dispose();e.dispose();}};}
test('recorded reference is reproducible, cyclic, asymmetric and not a generated sine wave',async()=>{
  for(const [name,hash] of Object.entries(walkSource.sha256)){
    const file=await readFile(new URL(`../assets/motions/cmu/${name}`,import.meta.url));
    assert.equal(createHash('sha256').update(file).digest('hex'),hash);
  }
  for(const channel of ['left_shoulder_flex','right_elbow','chest_twist','pelvis_height']){
    assert.ok(Math.abs(sampleWalk(channel,1-1e-7)-sampleWalk(channel,1e-7))<1e-5);
    const values=Array.from({length:100},(_,i)=>sampleWalk(channel,i/100));
    assert.ok(Math.max(...values)-Math.min(...values)>.005);
  }
  assert.ok(Math.abs(sampleWalk('left_shoulder_flex',.25)+sampleWalk('right_shoulder_flex',.25))>.05);
  for(const side of ['left','right'] as const){assert.equal(recordedLift(side,0),0);assert.equal(recordedLift(side,1),0);assert.ok(recordedLift(side,.4)>.1);}
});
test('speed changes, contact feedback, recorded posture and walking push recovery remain physical',()=>{
  for(const speed of [.015,.03,.045]){
    const f=fixture();try{
      f.run(2);const gait=f.c.locomotion!;
      assert.equal(gait.setSpeed(speed),true);assert.equal(gait.setSpeed(NaN),false);assert.equal(gait.setSpeed(2),false);
      assert.equal(gait.setReferenceStrength(1.1),false);
      f.c.execute({action:'walk_forward'});
      let maxCorrection=0,maxTrunk=0,unsupportedSteps=0;
      const check=()=>{
        const state=gait.getState();
        assert.ok(f.e.data.qpos[2]>.88,'upright root');
        for(const wrench of state.balance.wrenches){
          assert.ok(wrench[2]>=0);assert.ok(Math.abs(wrench[0])<=.7*wrench[2]+1e-7);assert.ok(Math.abs(wrench[1])<=.7*wrench[2]+1e-7);
          assert.ok(Math.abs(wrench[3])<=.11*wrench[2]+1e-7);assert.ok(Math.abs(wrench[4])<=.055*wrench[2]+1e-7);
        }
        maxCorrection=Math.max(maxCorrection,Math.abs(state.balance.landingCorrection.x),Math.abs(state.balance.landingCorrection.y));
        maxTrunk=Math.max(maxTrunk,Math.abs(gait.bodyTargets.chest_twist??0));
      };
      let previous=0;
      f.run(18,()=>{if(Math.round(f.e.data.time/f.e.dt)%10===0){check();if(gait.steps>previous){if(!gait.sensors.feet.some(foot=>foot.contact))unsupportedSteps++;previous=gait.steps;}}});
      const before=gait.steps;
      f.e.data.xfrc_applied[6]=25;f.run(.1);f.e.data.xfrc_applied[6]=0;
      f.run(18,()=>{if(Math.round(f.e.data.time/f.e.dt)%25===0)check();});
      assert.equal(gait.mode,'walk');
      // At the slowest setting an 18-second window contains only 3–4 steps.
      const minimumSteps=Math.max(2,Math.floor(18*speed/.07*.65));
      assert.ok(gait.steps>=before+minimumSteps,JSON.stringify({speed,before,state:gait.getState()}));assert.equal(unsupportedSteps,0);
      assert.ok(maxCorrection>1e-4&&maxCorrection<=.010001);assert.ok(maxTrunk>.001,'captured trunk motion is used');
      const left=gait.sensors.feet[0],right=gait.sensors.feet[1];assert.ok(left.force+right.force>f.e.totalMass*9.81*.5);
      f.c.execute({action:'stop_walk'});f.run(9);
      assert.equal(gait.mode,'stand');assert.ok(gait.settled);
      assert.ok(Array.from(f.e.data.qfrc_applied as Float64Array).every(v=>v===0));
      assert.ok(Array.from(f.e.data.xfrc_applied as Float64Array).every(v=>v===0));
      console.log(`motion ${speed}: steps=${gait.steps}, travel=${(-f.e.data.qpos[1]).toFixed(3)}m, correction=${(maxCorrection*1000).toFixed(2)}mm`);
    }finally{f.dispose();}
  }
});
test('reference weight changes actual motor targets and manual torso commands keep ownership',()=>{
  const f=fixture();try{
    f.run(2);f.c.execute({action:'walk_forward'});f.run(5);
    const gait=f.c.locomotion!,phase=gait.getState().motion.phase;
    gait.coordinator.update(phase,true,0,.002);
    assert.equal(gait.armTargets.left_shoulder_flex,0);assert.equal(gait.bodyTargets.chest_twist,0);
    gait.coordinator.update(phase,true,1,.002);
    assert.ok(Math.abs(gait.armTargets.left_shoulder_flex)>.001);
    f.c.execute({action:'twist_torso',duration:1});f.run(4);
    assert.equal(f.c.status,'completed');
    assert.ok(Math.abs(f.c.snapshot().find(j=>j.name==='chest_twist')!.target-.12)<1e-8);
    f.c.execute({action:'stop_walk'});f.run(8);
    assert.ok(Math.abs(f.c.snapshot().find(j=>j.name==='chest_twist')!.actual-.12)<.04);
  }finally{f.dispose();}
});
test('an external walking impulse changes sensed capture point and the next landing correction',()=>{
  const pushed=fixture(),control=fixture();
  try{
    for(const f of [pushed,control]){f.run(2);f.c.locomotion!.setSpeed(.03);f.c.execute({action:'walk_forward'});f.run(8);}
    pushed.e.data.xfrc_applied[6]=25;pushed.run(.1);pushed.e.data.xfrc_applied[6]=0;control.run(.1);
    assert.ok(pushed.c.locomotion!.sensors.capture.x-control.c.locomotion!.sensors.capture.x>.001);
    let correctionDifference=0;
    for(let sample=0;sample<120;sample++){
      pushed.run(.1);control.run(.1);
      const a=pushed.c.locomotion!.getState().balance.landingCorrection,b=control.c.locomotion!.getState().balance.landingCorrection;
      correctionDifference=Math.max(correctionDifference,Math.abs(a.x-b.x));
    }
    assert.ok(correctionDifference>1e-5,'feedback must actually modify the landing reference');
    assert.equal(pushed.c.locomotion!.mode,'walk');
    const phase=pushed.c.locomotion!.getState().motion.phase;
    pushed.c.locomotion!.setSpeed(.015);pushed.run(.002);
    const next=pushed.c.locomotion!.getState().motion.phase;
    assert.ok(((next-phase+1)%1)<.003,'speed changes cannot jump or rewind reference phase');
  }finally{pushed.dispose();control.dispose();}
});
