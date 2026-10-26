import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import load from '@mujoco/mujoco';
import {MuJoCoEngine} from '../src/physics/MuJoCoEngine.ts';
import {HumanController} from '../src/human/HumanController.ts';
import {NaturalWalking} from '../src/human/NaturalWalking.ts';
import {WholeBodyCoordinator} from '../src/human/WholeBodyCoordinator.ts';
import {ContactEstimator} from '../src/human/sensory/ContactEstimator.ts';
import type {SensoryOptions,Sole} from '../src/human/sensory/SensoryInterface.ts';
const mj=await load(),xml=await readFile('public/models/human-free.xml','utf8');
function fixture(){const e=new MuJoCoEngine(mj,xml),c=new HumanController(e);return {e,c,
 run(t:number,check?:()=>void){for(let i=0;i<Math.round(t/e.dt);i++){c.update(e.dt);e.step();check?.();}},
 dispose(){c.dispose();e.dispose();}};}

test('delivered contact evidence rejects threshold chatter and reports heel/forefoot phases',()=>{
 const c=new ContactEstimator(),sole=(force:number,pads=[force/2,force/2,0,0]):Sole=>({force,pads,contact:force>25,flat:false});
 c.update([sole(40),sole(0)],0,1000);assert.equal(c.feet[0].phase,'heel');
 c.update([sole(18),sole(0)],.01,1000);assert.equal(c.feet[0].contact,true,'hysteresis retains a lightly loaded stance foot');
 c.update([sole(0),sole(0)],.014,1000);assert.equal(c.feet[0].contact,true,'brief unloading must not switch support');
 c.update([sole(0),sole(0)],.024,1000);assert.equal(c.feet[0].phase,'swing');
 c.update([sole(40,[0,0,20,20]),sole(0)],.034,1000);assert.equal(c.feet[0].phase,'forefoot');
 const count=c.feet[0].touchdowns;c.update([sole(0),sole(0)],.034,1000);assert.equal(c.feet[0].touchdowns,count);
 c.update(undefined,.04,1000);assert.equal(c.feet[0].phase,'uncertain');assert.equal(c.feet[0].contact,false);
 c.reset();assert.equal(c.feet[0].touchdowns,0);
});

test('oracle/full/delayed sensory walking: motion, turn, push recovery, stop and unchanged memories',async()=>{
 const results=[];
 for(const [name,options,speed] of [['oracle',null,.4],['sensory',{},.4],['oracleSlow',null,.25],['delayed',{noiseScale:4,delayScale:2},.25]] as [string,Partial<SensoryOptions>|null,number][]){
  const f=fixture();try{
   f.run(2);if(options){assert.equal(f.c.setSensoryMode(true),true);assert.equal(f.c.configureSenses(options),true);}
   assert.equal(f.c.locomotion!.setSpeed(speed),true);f.run(2);
   const g=f.c.locomotion!,memory=JSON.stringify(g.cerebellum.snapshot());
   assert.equal(f.c.execute({action:'walk_forward'}),true);
   let minHeight=1,maxError=0,correction=0,maxQuaternionError=0;
   const sample=()=>{minHeight=Math.min(minHeight,f.e.data.qpos[2]);const s=g.sensory;
    if(s){maxError=Math.max(maxError,Math.hypot(...[0,1,2].map(i=>f.e.data.qpos[i]-s.data.qpos[i])));
      maxQuaternionError=Math.max(maxQuaternionError,Math.abs(Math.hypot(...Array.from(s.data.qpos.slice(3,7)) as number[])-1));
      correction=Math.max(correction,Math.hypot(s.walking.landingCorrection.x,s.walking.landingCorrection.y));}
    assert.notEqual(g.mode,'fallen');assert.ok(f.e.data.qpos[2]>.87);};
   f.run(4,sample);assert.equal(f.c.startBalancePush(),true);f.run(2,sample);
   assert.equal(f.c.balancePush.active,false);assert.equal(f.e.data.xfrc_applied[6],0);
   f.c.setJoint('neck_yaw',.35);f.run(2,sample);
   const gaze=g.getState().sensory?.diagnostics.gazeError;
   if(gaze!==undefined)assert.ok(gaze<.04,'distant fixation must survive a voluntary head turn while walking');
   f.run(22,sample);
   assert.ok(g.steps>35);assert.ok(-f.e.data.qpos[1]>speed*30*.85);
   if(options){assert.equal(JSON.stringify(g.cerebellum.snapshot()),memory);assert.ok(maxQuaternionError<1e-10);assert.ok(correction>0);}
   const walk={referenceSpeed:speed,distance:-f.e.data.qpos[1],steps:g.steps,minHeight,maxError,correction,gaze};
   f.c.execute({action:'stop_walk'});f.run(8,sample);assert.equal(g.mode,'stand');
   assert.ok(Math.hypot(...Array.from(f.e.data.qvel.slice(0,3)) as number[])<.04);
   const stopped=Array.from(f.e.data.qpos.slice(0,3));
   if(options){assert.ok(g.sensory!.estimate.touchdownCount.every(n=>n>10));
     assert.equal(f.c.setSensoryMode(false),true);f.run(2);assert.ok(f.e.data.qpos[2]>.89);
     assert.ok(Math.hypot(f.e.data.qpos[0]-stopped[0],f.e.data.qpos[1]-stopped[1])<.08,'oracle handover must retain the final world location');}
   results.push({name,...walk,stopped});
  }finally{f.dispose();}
 }
 await mkdir('artifacts/sensory',{recursive:true});await writeFile('artifacts/sensory/walking.json',JSON.stringify(results,null,2));
});

test('eyes closed during walking triggers a sensed, bounded stop rather than oracle fallback',()=>{
 const f=fixture();try{
  f.run(2);assert.equal(f.c.setSensoryMode(true),true);f.run(2);assert.equal(f.c.execute({action:'walk_forward'}),true);f.run(3);
  assert.equal(f.c.configureSenses({vision:false}),true);const origin=f.e.data.qpos[1];
  f.run(7,()=>{assert.notEqual(f.c.locomotion!.mode,'fallen');assert.ok(f.e.data.qpos[2]>.87);});
  const g=f.c.locomotion!;assert.equal(g.mode,'stand');assert.equal(g.sensory!.safetyStop,true);
  assert.equal(g.sensory!.estimate.snapshot().channels.vision,null);assert.ok(origin-f.e.data.qpos[1]<1);
  assert.ok(Math.hypot(...Array.from(f.e.data.qvel.slice(0,3)) as number[])<.04);
 }finally{f.dispose();}
});


test('walking feedback is isolated from live state and uses sensed support and capture-point error',()=>{
 const f=fixture();const allocated:NaturalWalking[]=[];
 try{
  f.run(2);assert.equal(f.c.setSensoryMode(true),true);f.run(2);
  const system=f.c.locomotion!.sensory!;
  assert.equal(f.c.locomotion!.setSpeed(.03),false);
  for(const channel of ['proprioception','plantar'] as const){
   f.c.configureSenses({[channel]:false});assert.equal(f.c.execute({action:'walk_forward'}),false);
   f.c.configureSenses({[channel]:true});
  }
  f.run(.1);
  const guarded=new Proxy(f.e,{get(target,key){if(key==='data')throw new Error('live data reached walking feedback');return Reflect.get(target,key);}});
  const build=(captureOffset:number,support=true)=>{
   const obs={feet:system.feet.map(foot=>({...foot,contact:support,force:support?foot.force:0})),com:{...system.com},velocity:{...system.velocity},capture:{x:system.capture.x+captureOffset,y:system.capture.y}};
   const coordinator=new WholeBodyCoordinator(guarded,()=>system.data);
   const walk=new NaturalWalking(guarded,obs,coordinator,undefined,()=>system.data,true);allocated.push(walk);walk.begin();return walk;
  };
  const neutral=build(0),pushed=build(.05),blocked=build(0,false);
  for(let i=0;i<120;i++){neutral.update(.002,.5,false);pushed.update(.002,.5,false);blocked.update(.002,.5,false);}
  assert.ok(pushed.landingCorrection.x>neutral.landingCorrection.x+.001,'rightward sensed error must move the target rightward');
  assert.ok(pushed.landingCorrection.x<=.018);
  assert.equal(blocked.phase,'支撑不足 · 等待承重','elapsed time alone cannot authorize unloading without sensed support');
  // Even after a nominal cycle, missing a new contact must never count a step.
  for(let i=0;i<500;i++)blocked.update(.002,.5,false);
  assert.equal(blocked.steps,0);
 }finally{allocated.forEach(w=>w.dispose());f.dispose();}
});

test('sensory braking settles from different swing phases with normal and doubled delays',()=>{
 for(const delayScale of [1,2])for(const duration of [3,3.2,3.4]){
  const f=fixture();try{
   f.run(2);assert.equal(f.c.setSensoryMode(true),true);f.c.configureSenses({delayScale,noiseScale:delayScale===2?4:1});f.run(2);
   assert.equal(f.c.execute({action:'walk_forward'}),true);f.run(duration);
   f.c.execute({action:'stop_walk'});f.run(7,()=>assert.ok(f.e.data.qpos[2]>.87,`delay ${delayScale}, stop ${duration}`));
   assert.equal(f.c.locomotion!.mode,'stand');assert.ok(Math.hypot(...Array.from(f.e.data.qvel.slice(0,3)) as number[])<.04,JSON.stringify({delayScale,duration,velocity:Array.from(f.e.data.qvel.slice(0,6)),estimate:f.c.locomotion!.sensory!.estimate.snapshot()}));
  }finally{f.dispose();}
 }
});

test('left/right physical impulses change sensed and measured landings and recover without learning',async()=>{
 const results=[];
 for(const sign of [-1,1]){
  const control=fixture(),pushed=fixture();try{
   for(const f of [control,pushed]){f.run(2);assert.equal(f.c.setSensoryMode(true),true);f.run(2);assert.equal(f.c.execute({action:'walk_forward'}),true);f.run(6.2);}
   // Start in early swing and compare the same foot at its next landing,
   // not a sliding stance foot or an arbitrary frame after the perturbation.
   for(let i=0;i<1000;i++){
    const phase=control.c.locomotion!.sensory!.walking.observation();
    if(phase.progress>.2&&phase.progress<.3&&phase.airborne)break;
    control.run(.002);pushed.run(.002);
   }
   const g=pushed.c.locomotion!,swing=g.sensory!.walking.observation().swing;
   const startSteps=g.steps,body=mj.mj_name2id(pushed.e.model,1,(swing===0?'left':'right')+'_foot');
   const memory=JSON.stringify(g.cerebellum.snapshot());
   let correction=0,controlLanding:number|undefined,pushedLanding:number|undefined;
   for(let i=0;i<700;i++){
    pushed.e.data.xfrc_applied[6]=i<60?sign*35:0;
    control.run(.002);pushed.run(.002);
    const a=pushed.c.locomotion!,b=control.c.locomotion!;
    correction=Math.max(correction,sign*(a.sensory!.walking.landingCorrection.x-b.sensory!.walking.landingCorrection.x));
    if(a.steps>startSteps&&pushedLanding===undefined)pushedLanding=pushed.e.data.xpos[body*3];
    if(b.steps>startSteps&&controlLanding===undefined)controlLanding=control.e.data.xpos[body*3];
   }
   pushed.e.data.xfrc_applied[6]=0;
   assert.notEqual(controlLanding,undefined);assert.notEqual(pushedLanding,undefined);
   const actualLanding=sign*(pushedLanding!-controlLanding!);
   assert.ok(correction>.0002,`sign ${sign}: sensed correction ${correction}`);
   assert.ok(actualLanding>.0005,`sign ${sign}: measured landing ${actualLanding}`);
   pushed.run(4);assert.equal(pushed.c.locomotion!.mode,'walk');assert.ok(pushed.e.data.qpos[2]>.88);
   assert.equal(JSON.stringify(pushed.c.locomotion!.cerebellum.snapshot()),memory);
   assert.ok(Array.from(pushed.e.data.xfrc_applied as Float64Array).every(v=>v===0));
   results.push({sign,correction,actualLanding});
  }finally{control.dispose();pushed.dispose();}
 }
 await mkdir('artifacts/sensory',{recursive:true});await writeFile('artifacts/sensory/reactive-landing.json',JSON.stringify(results,null,2));
});
