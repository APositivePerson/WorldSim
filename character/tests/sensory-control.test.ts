import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import load from '@mujoco/mujoco';
import {MuJoCoEngine} from '../src/physics/MuJoCoEngine.ts';
import {HumanController} from '../src/human/HumanController.ts';
import {SimulationLoop} from '../src/physics/SimulationLoop.ts';
import {BalanceController} from '../src/human/BalanceController.ts';
import {SensoryInterface,type SensoryOptions} from '../src/human/sensory/SensoryInterface.ts';
const mj=await load(),xml=await readFile(new URL('../public/models/human-free.xml',import.meta.url),'utf8');
function fixture(){const e=new MuJoCoEngine(mj,xml),c=new HumanController(e);return {e,c,
  run(t:number,check?:()=>void){for(let i=0;i<Math.round(t/e.dt);i++){c.update(e.dt);e.step();check?.();}},
  dispose(){c.dispose();e.dispose();}};}

test('sensory packets respect sampling/delivery times and runtime configuration',()=>{
  const f=fixture(),input=new SensoryInterface(f.e);
  try{
    assert.equal(input.configure({noiseScale:NaN}),false);
    assert.equal(input.configure({vision:1} as never),false);
    assert.equal(input.configure([] as never),false);
    assert.equal(input.configure({toString:true} as never),false);
    assert.equal(input.sample(0,{yaw:0,pitch:0}).vision,undefined);
    for(let i=0;i<50;i++){
      f.run(.002);const frame=input.sample(f.e.data.time,{yaw:0,pitch:0});
      for(const key of ['proprio','vestibular','plantar','vision'] as const){
        const p=frame[key];if(!p)continue;
        assert.ok(p.sampledAt<=p.deliveredAt&&p.deliveredAt<=frame.time+1e-9);
        const minimum={proprio:.012,vestibular:.006,plantar:.014,vision:.06}[key];
        assert.ok(frame.time-p.sampledAt>=minimum-1e-9);
      }
    }
    assert.ok(input.sample(f.e.data.time,{yaw:0,pitch:0}).vision);
    input.configure({vision:false});assert.equal(input.sample(f.e.data.time,{yaw:0,pitch:0}).vision,undefined);
    input.configure({vision:true});assert.equal(input.sample(f.e.data.time,{yaw:0,pitch:0}).vision,undefined,'reopening eyes must wait for a new delayed observation');
    input.reset();assert.equal(input.sample(f.e.data.time,{yaw:0,pitch:0}).plantar,undefined);
  }finally{input.dispose();f.dispose();}
});

test('sensory inverse dynamics responds to the estimated state without reading live state',()=>{
  const f=fixture();let balance:BalanceController|undefined;
  try{
    f.run(2);assert.equal(f.c.setSensoryMode(true),true);f.run(1);
    const system=f.c.locomotion!.sensory!;
    balance=new BalanceController(f.e,()=>system.data);
    const reference=Object.fromEntries(f.e.joints.filter(j=>/(hip|knee|ankle)/.test(j.name)).map(j=>[j.name,system.data.qpos[j.q]]));
    const a={...reference};balance.apply(a,{x:0,y:0,z:.925},1,0);
    const q=f.e.data.qpos.slice(),v=f.e.data.qvel.slice(),bias=f.e.data.qfrc_bias.slice(),x=f.e.data.xpos.slice();
    f.e.data.qpos[0]+=.2;f.e.data.qvel[0]=2;f.e.data.qfrc_bias.fill(999);f.e.data.xpos.fill(10);
    const b={...reference};balance.apply(b,{x:0,y:0,z:.925},1,0);assert.deepEqual(a,b);
    f.e.data.qpos.set(q);f.e.data.qvel.set(v);f.e.data.qfrc_bias.set(bias);f.e.data.xpos.set(x);
    system.data.qpos[0]+=.01;mj.mj_forward(f.e.model,system.data);
    const changed={...reference};balance.apply(changed,{x:0,y:0,z:.925},1,0);assert.notDeepEqual(changed,a);
    assert.equal(f.c.execute({action:'walk_forward'}),true);
    f.c.execute({action:'stop_walk'});f.run(6);
    assert.equal(f.c.startCerebellumExperiment('learn'),false);
    assert.equal(f.c.setSensoryMode(false),true);assert.equal(f.e.sensoryEyes,null);
  }finally{balance?.dispose();f.dispose();}
});

test('restricted sensory conditions stand, recover from a finite push and preserve motor memories',async()=>{
  const results=[];
  for(const [name,options] of [['oracle',null],['full',{}],['eyesClosed',{vision:false}],['noVestibular',{vestibular:false}],['limited',{noiseScale:4,delayScale:2}]] as [string,Partial<SensoryOptions>|null][]){
    const f=fixture();try{
      f.run(2);
      const remembered=f.c.locomotion!.cerebellum.walking;
      for(let i=0;i<8;i++){remembered.observe(0,.5,.51,.54,0);remembered.load.observe(0,.5,2,1,.8);}
      assert.ok(remembered.snapshot().delays[0][1]>0);
      if(options){assert.equal(f.c.setSensoryMode(true),true);assert.equal(f.c.configureSenses(options),true);}
      let minimum=1,positionError=0,maxPushDisplacement=0;
      f.run(30,()=>{minimum=Math.min(minimum,f.e.data.qpos[2]);assert.ok(f.e.data.qpos[2]>.89);
        const s=f.c.locomotion!.sensory;if(s)positionError=Math.max(positionError,Math.hypot(...[0,1,2].map(i=>f.e.data.qpos[i]-s.data.qpos[i])));});
      const memoryBefore=f.c.locomotion!.cerebellum.snapshot(),system=f.c.locomotion!.sensory;
      const biasBefore=system?.estimate.bias.slice(),updates=system?.estimate.quality.biasUpdates;
      assert.equal(f.c.startBalancePush(),true);
      f.run(.2,()=>{minimum=Math.min(minimum,f.e.data.qpos[2]);
        if(system)positionError=Math.max(positionError,Math.hypot(...[0,1,2].map(i=>f.e.data.qpos[i]-system.data.qpos[i])));
        maxPushDisplacement=Math.max(maxPushDisplacement,Math.abs(f.e.data.qpos[0]));});
      assert.equal(f.c.balancePush.active,false);assert.equal(f.e.data.xfrc_applied[6],0);
      const rejected=system?.estimate.quality.rejected;
      const quarantineUpdates=system?.estimate.quality.biasUpdates;
      f.run(1);
      if(system){
        assert.ok(system.estimate.quality.rejected>0);
        assert.equal(system.estimate.quality.biasUpdates,quarantineUpdates,'motion recovery must quarantine persistent calibration');
        assert.ok(Math.hypot(...system.estimate.bias.map((v,i)=>v-biasBefore![i]))<.0001);
        if(options!.vestibular!==false)assert.ok(updates!>0,'stable periods must actually calibrate the sensor');
        else assert.equal(updates,0);
      }
      f.run(5);
      assert.equal(f.c.locomotion!.mode,'stand');assert.ok(Math.abs(f.e.data.qpos[0])<.005);
      assert.ok(Math.hypot(...Array.from(f.e.data.qvel.slice(0,6)) as number[])<.03);
      assert.ok(maxPushDisplacement>.001,'test must cause measurable physical motion');
      assert.deepEqual(f.c.locomotion!.cerebellum.snapshot(),memoryBefore,'a standing push must not create persistent leg/cued-trial compensation');
      if(system){
        const snapshot=system.estimate.snapshot();
        assert.equal(snapshot.channels.vision===null,options!.vision===false);
        assert.ok(positionError<.006);
      }
      assert.ok(Array.from(f.e.data.qfrc_applied as Float64Array).every(v=>v===0));
      assert.ok(Array.from(f.e.data.xfrc_applied as Float64Array).every(v=>v===0));
      results.push({name,options,minimum,positionError,maxPushDisplacement,remainingOffset:f.e.data.qpos[0],rejected,calibration:system?.estimate.snapshot()});
    }finally{f.dispose();}
  }
  await mkdir('artifacts/sensory',{recursive:true});await writeFile('artifacts/sensory/balance.json',JSON.stringify(results,null,2));
});

test('head turn uses finite-speed vestibular/retinal eye compensation and freezes on pause',async()=>{
  const results=[];
  for(const headEyes of [false,true]){
    const f=fixture();try{
      f.run(2);assert.equal(f.c.setSensoryMode(true),true);f.c.configureSenses({headEyes});f.run(3);
      f.c.setJoint('neck_yaw',.35);
      let sum=0,count=0,peak=0,previous=0,maxRate=0;
      f.run(2,()=>{
        const state=f.c.locomotion!.getState().sensory!;
        maxRate=Math.max(maxRate,Math.abs(state.gaze.yaw-previous)/f.e.dt);previous=state.gaze.yaw;
        sum+=state.diagnostics.gazeError;count++;peak=Math.max(peak,state.diagnostics.gazeError);
      });
      const neck=f.e.joints.find(j=>j.name==='neck_yaw')!;
      assert.ok(f.e.data.qpos[neck.q]>.3,'head must physically turn');
      assert.ok(maxRate<=3.001);
      const state=f.c.locomotion!.getState().sensory!;
      results.push({headEyes,meanError:sum/count,peakError:peak,finalError:state.diagnostics.gazeError,eyeYaw:state.gaze.yaw,maxRate});
      const snapshot=JSON.stringify(state),loop=new SimulationLoop(f.e,f.c);loop.paused=true;loop.advance(.5);assert.equal(JSON.stringify(f.c.locomotion!.getState().sensory),snapshot);
      if(headEyes)assert.ok(state.gaze.yaw<-.3);
      f.c.reset();assert.equal(f.c.locomotion!.sensory!.gaze.eyes.yaw,0);assert.equal(f.c.locomotion!.sensory!.estimate.quality.biasUpdates,0);
      assert.ok(Object.values(f.c.locomotion!.sensory!.estimate.snapshot().channels).every(v=>v===null));
    }finally{f.dispose();}
  }
  assert.ok(results[1].meanError<results[0].meanError*.15);
  assert.ok(results[1].peakError<.025);
  await mkdir('artifacts/sensory',{recursive:true});await writeFile('artifacts/sensory/gaze.json',JSON.stringify(results,null,2));
});

test('reset and disposal remove only the test push component',()=>{
  const f=fixture();try{
    f.run(2);f.e.data.xfrc_applied[6]=4;assert.equal(f.c.startBalancePush(),true);f.run(.02);
    assert.equal(f.e.data.xfrc_applied[6],39);f.c.balancePush.stop();assert.equal(f.e.data.xfrc_applied[6],4);
    assert.equal(f.c.startBalancePush(),true);f.run(.02);f.c.reset();
    assert.equal(f.e.data.xfrc_applied[6],0);assert.equal(f.c.balancePush.active,false);
  }finally{f.dispose();}
});

test('neck compensation reduces actual head tilt after the same physical push',async()=>{
  const results=[];
  for(const headEyes of [false,true]){
    const f=fixture();try{
      f.run(2);assert.equal(f.c.setSensoryMode(true),true);f.c.configureSenses({headEyes});f.run(3);
      assert.equal(f.c.startBalancePush(),true);
      let sum=0,count=0,peak=0;
      f.run(3,()=>{const angle=f.c.locomotion!.getState().sensory!.diagnostics.headTilt;
        sum+=angle;count++;peak=Math.max(peak,angle);});
      results.push({headEyes,peak,mean:sum/count});
      assert.ok(f.e.data.qpos[2]>.89);
    }finally{f.dispose();}
  }
  assert.ok(results[1].mean<results[0].mean*.95);
  assert.ok(results[1].peak<results[0].peak);
  await mkdir('artifacts/sensory',{recursive:true});await writeFile('artifacts/sensory/head-tilt.json',JSON.stringify(results,null,2));
});
