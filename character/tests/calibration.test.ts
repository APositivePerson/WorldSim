import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {defaultProfile,validateProfile} from '../src/human/calibration/Profile.ts';
import {validateDataset,assertDisjoint,type CalibrationTrial} from '../src/human/calibration/Data.ts';
import {candidateProfile,fitStage,initialValues,metrics,replayAnkle} from '../src/human/calibration/AnkleCalibration.ts';
import {legAnatomy} from '../src/human/neuromuscular/LegAnatomy.ts';
const ankle=validateDataset(JSON.parse(await readFile('assets/calibration/ankle-p1.json','utf8')));
const gait=validateDataset(JSON.parse(await readFile('assets/calibration/gait-wbds01.json','utf8')));

test('parameter provenance and bounds reject malformed plants before simulation',()=>{
 assert.equal(validateProfile(defaultProfile).muscles.length,17);
 for(const mutate of [
  (p:typeof defaultProfile)=>p.muscles[0].slack=0,
  (p:typeof defaultProfile)=>p.ankleHill.activationRise=0,
  (p:typeof defaultProfile)=>p.spindle.gammaTau=[0,.1,.08],
  (p:typeof defaultProfile)=>p.reflex.rateScale=0,
  (p:typeof defaultProfile)=>p.muscles[0].force=Infinity,
  (p:typeof defaultProfile)=>delete p.fields['ankleHill.passiveScale'],
 ]){const p=structuredClone(defaultProfile);mutate(p);assert.throws(()=>validateProfile(p));}
});

test('public imports preserve source clocks, physical signs, normalization and trial split',()=>{
 const train=ankle.trials.filter(t=>t.split==='train'),held=ankle.trials.filter(t=>t.split==='holdout');assertDisjoint(train,held);
 assert.equal(train.length,3);assert.equal(held.length,5);
 assert.ok(ankle.trials.every(t=>typeof t.sourceSha256==='string'&&t.sourceSha256.length===64));
 assert.ok(gait.trials.every(t=>t.clock==='gait_phase'&&t.samples[0][0]===0&&t.samples.at(-1)![0]===1));
 assert.throws(()=>replayAnkle(gait.trials[0],defaultProfile));
 const malformed=structuredClone(ankle);malformed.trials[0].samples[3][0]=malformed.trials[0].samples[2][0];assert.throws(()=>validateDataset(malformed));
 assert.throws(()=>assertDisjoint(train,[{...held[0],sourceSha256:train[0].sourceSha256}]));
 assert.throws(()=>fitStage(held.filter(t=>t.kind==='passive'),defaultProfile,initialValues,'passive'));
});

test('canonical dorsiflexion stretches plantarflexors and conserves signed virtual work',()=>{
 const soleus=legAnatomy('left')[0],r=soleus.coefficients.left_ankle,qDF=.1,force=100;
 const dLength=r*(-qDF),modelTorque=-r*force,canonicalTorque=-modelTorque;
 assert.ok(dLength>0);assert.ok(canonicalTorque<0);
 assert.ok(Math.abs(canonicalTorque*qDF+force*dLength)<1e-12);
 const right=legAnatomy('right');assert.equal(right[0].coefficients.right_ankle,r);
 const gastro=legAnatomy('left')[1];
 assert.ok(gastro.coefficients.left_knee*.5<0,'positive model knee flexion shortens gastrocnemius');
 assert.equal(right[2].coefficients.right_ankle_roll,-legAnatomy('left')[2].coefficients.left_ankle_roll);
});

test('ankle candidate leaves full leg mechanics and geometry fixed, passive frozen during active fit',()=>{
 const base=JSON.stringify(defaultProfile),passive=candidateProfile(defaultProfile,{...initialValues,slackScale:.93,passiveScale:.2});
 const active=candidateProfile(defaultProfile,{...initialValues,slackScale:.93,passiveScale:.2,forceScale:1.2});
 assert.deepEqual(active.hill,defaultProfile.hill);
 assert.deepEqual(active.muscles.filter(m=>m.region==='leg'),defaultProfile.muscles.filter(m=>m.region==='leg'));
 assert.deepEqual(active.muscles.map(m=>m.coefficients),defaultProfile.muscles.map(m=>m.coefficients));
 const t=ankle.trials.find(t=>t.kind==='passive')!;
 assert.deepEqual(replayAnkle(t,passive).prediction,replayAnkle(t,active).prediction);
 assert.equal(JSON.stringify(defaultProfile),base);
});

test('synthetic recovery checks optimizer without presenting synthetic data as human validation',()=>{
 const t:CalibrationTrial={id:'synthetic-active',subject:'synthetic',sourceSha256:'synthetic-test-only',kind:'active',split:'train',clock:'seconds',processing:{synthetic:true},
 columns:['time_s','ankle_df_rad','knee_flex_rad','ankle_df_Nm','soleus_emg','gastrocnemius_emg','tibialis_anterior_emg'],
 samples:Array.from({length:250},(_,i)=>[i*.01,.06*Math.sin(i*.015),0,0,.2+.1*Math.sin(i*.02),.15,.02])};
 const truth=candidateProfile(defaultProfile,{...initialValues,forceScale:1.25});
 const target=replayAnkle(t,truth).prediction;t.samples.forEach((row,i)=>row[3]=target[i]);
 const before=metrics(replayAnkle(t,defaultProfile)).rmseNm;
 const fit=fitStage([t],defaultProfile,initialValues,'active');
 const after=metrics(replayAnkle(t,candidateProfile(defaultProfile,fit.values))).rmseNm;
 assert.ok(after<before*.2,JSON.stringify({before,after,fit}));
 assert.equal(fit.values.slackScale,1);assert.equal(fit.values.passiveScale,.08);
 assert.equal(fit.values.reflexDelaySeconds,.012);
 const bad=structuredClone(ankle);bad.trials[0].kind='reflex';assert.throws(()=>validateDataset(bad));
});

test('three-joint static benchmark respects knee flexion torque sign and bounded shared allocations',async()=>{
 const {sagittalLegBenchmark}=await import('../src/human/calibration/LegBenchmark.ts');
 const trial:CalibrationTrial={id:'synthetic-leg',subject:'synthetic',kind:'gait',split:'holdout',clock:'gait_phase',sourceSha256:'synthetic-test-only',bodyMassKg:65.41,speedMps:1,processing:{synthetic:true},
 columns:['phase','hip_flex_rad','knee_flex_rad','ankle_df_rad','hip_flex_Nm','knee_flex_Nm','ankle_df_Nm'],samples:[[0,0,0,0,0,-50,0],[1,0,0,0,0,-50,0]]};
 const result=sagittalLegBenchmark([trial],[defaultProfile])[0].profiles[0];
 assert.ok(result.rmseNmPerKg.knee<.001);assert.ok(result.rmseNmPerKg.hip<.001);assert.ok(result.rmseNmPerKg.ankle<.001);
 assert.ok(result.states.every(s=>s.allocation.every(v=>v>=0&&v<=1)));
 assert.ok(result.states[0].predictionNmPerKg[1]<0,'extension is negative canonical knee flexion torque');
});
