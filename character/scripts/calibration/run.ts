import {sagittalLegBenchmark} from '../../src/human/calibration/LegBenchmark.ts';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validateDataset} from '../../src/human/calibration/Data.ts';
import {calibrateAnkle,replayAnkle,metrics,trainingSensitivity} from '../../src/human/calibration/AnkleCalibration.ts';
import {defaultProfile} from '../../src/human/calibration/Profile.ts';
const protocolRaw=await readFile('src/human/calibration/protocol.json','utf8');
const ankleRaw=await readFile('assets/calibration/ankle-p1.json','utf8'),gaitRaw=await readFile('assets/calibration/gait-wbds01.json','utf8');
const ankle=validateDataset(JSON.parse(ankleRaw)),gait=validateDataset(JSON.parse(gaitRaw));
console.log('Fitting passive -> active -> eligible reflex, using training trials only…');
const report=calibrateAnkle([...ankle.trials,...gait.trials]);
const sensitivity=trainingSensitivity(ankle.trials,defaultProfile,report.values);
const profile=report.profile;
const fullLeg=sagittalLegBenchmark(gait.trials,[defaultProfile,profile]);
profile.appliesTo.population='RUB-p1 left-ankle effective pilot; mirrored to both legs in generic 65.41 kg simulation; not individual anatomy';
profile.sources['rub-p1']={title:'van der Zee et al. UltraTimTrack dataset, participant 1; constrained effective ankle pilot fit',url:ankle.source,evidence:'fitted aggregate parameters; no individual geometry, no reflex identification'};
for(const path of ['ankleHill.passiveScale','ankleHill.activeForceScale'])profile.fields[path]={...profile.fields[path],source:'rub-p1'};
for(const m of profile.muscles.filter(m=>m.region==='ankle'))profile.fields[`muscles.${m.name}.slack`]={...profile.fields['muscles.*.slack'],source:'rub-p1',appliesTo:'shared effective slack scale; cannot identify individual tendon slack length'};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const implementationSha256=Object.fromEntries(await Promise.all(['src/human/calibration/LegBenchmark.ts','src/human/calibration/AnkleCalibration.ts','src/human/calibration/Data.ts','src/human/calibration/Profile.ts','src/human/neuromuscular/HillMuscle.ts','src/human/neuromuscular/MuscleSpindle.ts','src/human/neuromuscular/Reflex.ts','scripts/calibration/prepare_data.py'].map(async path=>[path,hash(await readFile(path,'utf8'))])));
const frozen=JSON.stringify(profile,null,2)+'\n';
const predictions=ankle.trials.map(t=>({id:t.id,kind:t.kind,split:t.split,
 baseline:replayAnkle(t,defaultProfile,report.values.measurementBiasNm),candidate:replayAnkle(t,profile,report.values.measurementBiasNm)}));
const training=ankle.trials.filter(t=>t.split==='train').map(t=>({id:t.id,...metrics(replayAnkle(t,profile,report.values.measurementBiasNm))}));
await mkdir('artifacts/calibration',{recursive:true});
await writeFile('artifacts/calibration/ankle-p1.frozen.json',frozen);
await writeFile('artifacts/calibration/report.json',JSON.stringify({...report,profile:undefined,training,sensitivity,fullLeg,
 profileSha256:hash(frozen),protocolSnapshot:JSON.parse(protocolRaw),protocolSha256:hash(protocolRaw),baselineProfileSha256:hash(JSON.stringify(defaultProfile)),implementationSha256,inputSha256:{ankle:hash(ankleRaw),gait:hash(gaitRaw)},
 numericalMethod:'Prescribed kinematics, 100 Hz recorded signals, linearly interpolated into <=2 ms implicit Hill integration; no ideal length servo; no torque-derived excitation. Separate static capacity analysis for phase-only gait.',
 comparison:'Same learned observation offset applied to both baseline and candidate; raw torque errors also reported. Offset is a measurement nuisance, never a runtime assist.',
 assumptions:['Knee extended; no individual anthropometry for RUB-p1','EMG is a proxy for excitation, not measured neural command','Unmeasured tibialis posterior/peroneal active drives set to zero','No gravity/footplate correction supplied; constant observation offset estimated on training passive data','Single-subject pilot; not a population or personal human calibration']},null,2)+'\n');
await writeFile('artifacts/calibration/predictions.json',JSON.stringify(predictions));
console.log(JSON.stringify({values:report.values,validation:report.validation,acceptance:report.acceptance},null,2));
