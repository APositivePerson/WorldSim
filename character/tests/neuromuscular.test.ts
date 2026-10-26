import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import * as T from 'three';
import load from '@mujoco/mujoco';
import {MuJoCoEngine} from '../src/physics/MuJoCoEngine.ts';
import {HumanController} from '../src/human/HumanController.ts';
import {HillMuscle} from '../src/human/neuromuscular/HillMuscle.ts';
import {MuscleSpindle} from '../src/human/neuromuscular/MuscleSpindle.ts';
import {legMuscles} from '../src/human/neuromuscular/LegAnatomy.ts';
import {SimulationLoop} from '../src/physics/SimulationLoop.ts';
import {SkinnedHuman} from '../src/rendering/SkinnedHuman.ts';
const mj=await load(),xml=await readFile('public/models/human-neuromuscular.xml','utf8');
function fixture(){const e=new MuJoCoEngine(mj,xml),c=new HumanController(e);return {e,c,
 run(t:number,check?:()=>void){for(let i=0;i<Math.round(t/e.dt);i++){c.update(e.dt);e.step();check?.();}},dispose(){c.dispose();e.dispose();}};}
function gaze(f:ReturnType<typeof fixture>,target:number[]){return f.c.physicalEyes.snapshot().eyes.map(eye=>{
 const b=eye.body,q=new T.Quaternion(f.e.data.xquat[b*4+1],f.e.data.xquat[b*4+2],f.e.data.xquat[b*4+3],f.e.data.xquat[b*4]);
 return new T.Vector3(0,-1,0).applyQuaternion(q).angleTo(new T.Vector3().fromArray(target).sub(new T.Vector3().fromArray(f.e.data.xpos,b*3)));
});}

test('series-elastic muscle has activation lag, tendon strain, passive force and bounded equilibrium',()=>{
 const m=new HillMuscle({force:3000,optimal:.12,slack:.2});
 m.advance(.32,.4,.002);assert.ok(m.activation>0&&m.activation<.4);
 for(let i=0;i<300;i++)m.advance(.32,.4,.002);
 assert.ok(m.force>900&&m.force<1500);assert.ok(m.fiber<.12);assert.ok(m.tendonLength>.2);
 const force=m.force;m.advance(.325,.4,.002);assert.ok(m.force>force,'stretch must change force mechanically before a neural delay');
 m.reset(.35);for(let i=0;i<300;i++)m.advance(.35,0,.002);assert.ok(m.force>1,'passive parallel fiber force remains at zero activation');
 m.reset();assert.equal(m.activation,0);assert.equal(m.force,0);
});

test('bag1/bag2/chain spindle differentiates stretch rates and gamma sensitivity',()=>{
 const ramp=(speed:number,gamma:number)=>{const s=new MuscleSpindle();for(let i=0;i<100;i++)s.update(1,.002,.2,gamma);let peak=0;
  for(let l=1;l<1.1;l+=speed*.002)peak=Math.max(peak,s.update(l,.002,.2,gamma).ia);return peak;};
 assert.ok(ramp(2,.2)>ramp(.2,.2)+15);assert.ok(ramp(2,.8)>ramp(2,.1)+30);
 const low=new MuscleSpindle(),high=new MuscleSpindle();for(let i=0;i<500;i++){low.update(1.05,.002,0,.2);high.update(1.05,.002,.8,.2);}
 assert.ok(high.ii>low.ii+20);assert.ok(high.snapshot().bag2>low.snapshot().bag2);
 high.reset();assert.equal(high.ia,0);
});

test('expanded model retains mass and avatar, has six-muscle eye plants and all leg axes',async()=>{
 const f=fixture();let skin:SkinnedHuman|null=null;
 try{
  assert.equal(f.e.totalMass,65.41);assert.equal(f.e.model.nbody-1,53);assert.equal(f.e.joints.length,81);assert.equal(f.e.model.nu,131);assert.equal(f.e.model.ntendon,50);
  assert.ok(f.c.legMuscles.available&&f.c.physicalEyes.available);
  for(const side of ['left','right'])for(const axis of ['hip','hip_yaw','hip_abduction','knee','ankle','ankle_roll','toe_flex']){
   const coefficients=legMuscles.map(f=>f.coefficients[`${side}_${axis}`]??0);assert.ok(coefficients.some(v=>v>0)&&coefficients.some(v=>v<0));
  }
  const file=await readFile('public/models/human-skinned.glb');skin=await SkinnedHuman.load(f.e,file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength) as ArrayBuffer);assert.ok(skin);
  f.c.setEyeTarget([.2,-.5,1.65]);f.run(1);skin.sync();
  const bone=skin.scene.getObjectByName('left_eye') as T.Bone,id=mj.mj_name2id(f.e.model,1,'left_eye'),head=mj.mj_name2id(f.e.model,1,'head');
  const q=(b:number)=>new T.Quaternion(f.e.data.xquat[b*4+1],f.e.data.xquat[b*4+2],f.e.data.xquat[b*4+3],f.e.data.xquat[b*4]);
  assert.ok(bone.quaternion.angleTo(q(head).invert().multiply(q(id)))<1e-6,'render must follow the physical eye rather than an ideal look-at');
 }finally{skin?.dispose();f.dispose();}
});

test('ankle/full muscle drive stands, receives pushes, walks and stops with owned motors off',async()=>{
 const results=[];
 for(const [mode,sensory] of [['ankle',false],['full',false],['full',true]] as const){
  const f=fixture();try{
   f.run(2);const pose=f.e.data.qpos.slice(),damping=f.e.model.dof_damping.slice();
   assert.equal(f.c.setLegDrive(mode),true);assert.deepEqual(f.e.data.qpos,pose,'mode change must not teleport the body');
   assert.deepEqual(f.e.model.dof_damping,damping,'muscle mode must not add hidden stabilizing joint damping');
   assert.equal(f.c.locomotion!.maximumNaturalSpeed,.25);assert.equal(f.c.locomotion!.setSpeed(.4),false);
   f.run(3);if(sensory){assert.equal(f.c.setSensoryMode(true),true);f.run(2);}
   let minimum=1,peakForce=0,maxStrain=0,maxReflex=0;
   const check=()=>{
    minimum=Math.min(minimum,f.e.data.qpos[2]);assert.ok(f.e.data.qpos[2]>.88);
    const state=f.c.legMuscles.snapshot();assert.equal(state.motors.length,mode==='full'?14:4);
    assert.ok(state.motors.every(m=>m.force===0));
    for(const u of state.muscles.filter(u=>u.active)){
     peakForce=Math.max(peakForce,u.force);maxStrain=Math.max(maxStrain,u.tendonStrain);maxReflex=Math.max(maxReflex,Math.abs(u.reflex));
     assert.ok(u.force>=-1e-8&&Number.isFinite(u.fiberVelocity));
     if(u.afferent)assert.ok(u.afferent.age>=.012-1e-8);
    }
   };
   f.run(3,check);assert.equal(f.c.startBalancePush(),true);f.run(3,check);
   assert.equal(f.c.execute({action:'walk_forward'}),true);assert.equal(f.c.setLegDrive('servo'),false);
   let sample=0;f.run(12,()=>{if(sample++%10===0)check();});
   assert.equal(f.c.locomotion!.mode,'walk');assert.ok(f.c.locomotion!.steps>15);assert.ok(-f.e.data.qpos[1]>2.3);
   const distance=-f.e.data.qpos[1];f.c.execute({action:'stop_walk'});f.run(7,check);assert.equal(f.c.locomotion!.mode,'stand');
   assert.ok(Math.hypot(...Array.from(f.e.data.qvel.slice(0,3)) as number[])<.04);
   assert.ok(peakForce>100&&maxStrain>.001&&maxReflex>1e-5);
   // Sum the actual tensile transmission, including a biarticular muscle's
   // contribution at each joint. No external joint-force assistance is allowed.
   for(const motor of f.c.legMuscles.snapshot().motors){
    const j=f.e.joints.find(j=>j.name===motor.name)!;
    const expected=legMuscles.reduce((sum,u)=>{const a=mj.mj_name2id(f.e.model,19,u.name);return sum+(u.coefficients[j.name]??0)*f.e.data.actuator_force[a];},0);
    assert.ok(Math.abs(f.e.data.qfrc_actuator[j.v]-expected)<1e-7);
   }
   assert.ok(Array.from(f.e.data.qfrc_applied as Float64Array).every(v=>v===0));assert.ok(Array.from(f.e.data.xfrc_applied as Float64Array).every(v=>v===0));
   results.push({mode,sensory,distance,steps:f.c.locomotion!.steps,minimum,peakForce,maxStrain,maxReflex});
   const before=JSON.stringify(f.c.legMuscles.snapshot()),loop=new SimulationLoop(f.e,f.c);loop.paused=true;loop.advance(.5);assert.equal(JSON.stringify(f.c.legMuscles.snapshot()),before);
   f.c.reset();assert.equal(f.c.legMuscles.mode,mode);assert.ok(f.c.legMuscles.snapshot().muscles.every(m=>m.activation===0&&m.spindle.ia===0&&m.afferent===null));
   f.run(2);assert.equal(f.c.setLegDrive('servo'),true);f.run(1);assert.equal(f.e.model.opt.disableactuator&8,0);assert.ok(f.e.data.qpos[2]>.89);
  }finally{f.dispose();}
 }
 await mkdir('artifacts/neuromuscular',{recursive:true});await writeFile('artifacts/neuromuscular/legs.json',JSON.stringify(results,null,2));
});

test('gamma and afferent ablation alter a real reflex force, with no stale delayed packets',()=>{
 const f=fixture();try{
  f.run(2);assert.equal(f.c.setLegDrive('ankle'),true);f.run(2);
  assert.equal(f.c.legMuscles.configure({gammaStatic:NaN}),false);assert.equal(f.c.legMuscles.configure({reflexes:1} as never),false);
  const before=f.c.legMuscles.snapshot().muscles[0];f.c.legMuscles.configure({gammaStatic:.9});f.run(.4);
  const after=f.c.legMuscles.snapshot().muscles[0];assert.ok(after.afferent!.ia>before.afferent!.ia+10);assert.ok(Math.abs(after.reflex-before.reflex)>.001);
  const joint=f.e.joints.find(j=>j.name==='left_ankle')!;f.e.data.qfrc_applied[joint.v]=-8;f.run(.08);f.e.data.qfrc_applied[joint.v]=0;f.run(.1);
  assert.ok(f.c.legMuscles.snapshot().muscles.some(u=>Math.abs(u.reflex)>.001));
  f.c.legMuscles.configure({reflexes:false});assert.ok(f.c.legMuscles.snapshot().muscles.every(u=>u.afferent===null&&u.reflex===0));
  f.run(.05);assert.ok(f.c.legMuscles.snapshot().muscles.every(u=>u.reflex===0));
  assert.ok(f.e.data.qpos[2]>.89);
 }finally{f.dispose();}
});

test('physical eye muscles stabilize gaze, show a unilateral weakness deficit and finite convergence',async()=>{
 const results=[];
 for(const condition of ['off','on','weak']){
  const f=fixture();try{
   const target=[0,-100,1.65];assert.equal(f.c.setEyeTarget(target),true);f.run(2);
   f.c.physicalEyes.enabled=condition!=='off';if(condition==='weak')assert.equal(f.c.physicalEyes.setStrength('eye_right_lateral_rectus',0),true);
   const initial=f.e.data.qpos.slice();f.c.setJoint('neck_yaw',.35);assert.deepEqual(f.e.data.qpos,initial);
   let sum=0,count=0,peak=0,rate=0;f.run(2,()=>{const errors=gaze(f,target);sum+=(errors[0]+errors[1])/2;count++;peak=Math.max(peak,...errors);rate=Math.max(rate,...f.c.physicalEyes.snapshot().eyes.flatMap(e=>e.velocity.map(Math.abs)));});
   const final=gaze(f,target);assert.ok(rate<12);results.push({condition,mean:sum/count,peak,final,rate});
   if(condition==='on'){
    assert.ok(final.every(e=>e<.01));assert.ok(f.c.physicalEyes.snapshot().eyes.every(e=>e.angles[0]<-.3));
    f.c.setJoint('neck_yaw',0);f.run(2);f.c.setEyeTarget([0,-.5,1.65]);f.run(2);
    const eyes=f.c.physicalEyes.snapshot().eyes;assert.ok(eyes[0].angles[0]<-.03&&eyes[1].angles[0]>.03,'near fixation requires separate left/right convergence');
    assert.ok(gaze(f,[0,-.5,1.65]).every(e=>e<.02));
   }
   if(condition==='weak')assert.ok(final[1]>final[0]+.15);
  }finally{f.dispose();}
 }
 assert.ok(results[1].mean<results[0].mean*.1);
 await mkdir('artifacts/neuromuscular',{recursive:true});await writeFile('artifacts/neuromuscular/eyes.json',JSON.stringify(results,null,2));
});
