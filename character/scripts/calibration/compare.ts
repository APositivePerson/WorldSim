import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import load from '@mujoco/mujoco';
import {MuJoCoEngine} from '../../src/physics/MuJoCoEngine.ts';
import {HumanController} from '../../src/human/HumanController.ts';
import {defaultProfile,validateProfile} from '../../src/human/calibration/Profile.ts';
const frozen=await readFile('artifacts/calibration/ankle-p1.frozen.json','utf8'),report=JSON.parse(await readFile('artifacts/calibration/report.json','utf8'));
if(createHash('sha256').update(frozen).digest('hex')!==report.profileSha256)throw new Error('Frozen profile/report mismatch; rerun calibration');
const candidate=validateProfile(JSON.parse(frozen)),mj=await load(),xml=await readFile('public/models/human-neuromuscular.xml','utf8');
const results=[];
for(const condition of ['normal','delayed','blind-stand'])for(const mode of ['servo','engineering-ankle','candidate-ankle','engineering-full','candidate-full']){
 const e=new MuJoCoEngine(mj,xml),c=new HumanController(e,mode.startsWith('candidate-')?candidate:defaultProfile);
 let minHeight=Infinity,maxLocalResidualNm=0,maxDisabledMotorNm=0,failed=false;
 const phases:{name:string;height:number;speed:number;mode:string|undefined;gazeError:number|undefined}[]=[];
 const sample=()=>{
  minHeight=Math.min(minHeight,e.data.qpos[2]);
  const muscles=c.legMuscles.snapshot();maxLocalResidualNm=Math.max(maxLocalResidualNm,muscles.residual);
  maxDisabledMotorNm=Math.max(maxDisabledMotorNm,...muscles.motors.map(m=>Math.abs(m.force)));
  failed ||= !Number.isFinite(e.data.qpos[2])||e.data.qpos[2]<.75||c.locomotion?.mode==='fallen';
 };
 const run=(seconds:number)=>{for(let i=0;i<Math.round(seconds/e.dt)&&!failed;i++){c.update(e.dt);e.step();if(i%10===0)sample();}sample();};
 const phase=(name:string)=>phases.push({name,height:e.data.qpos[2],speed:Math.hypot(...Array.from(e.data.qvel.slice(0,3)) as number[]),mode:c.locomotion?.mode,gazeError:c.locomotion?.getState().sensory?.diagnostics.gazeError});
 try{
  run(2);
  if(mode!=='servo'&&!c.setLegDrive(mode.endsWith('full')?'full':'ankle'))throw new Error('Cannot enable ankle mode');
  if(!c.setSensoryMode(true))throw new Error('Cannot enable sensory mode');
  if(condition==='delayed')c.configureSenses({noiseScale:4,delayScale:2});
  run(2);phase('stand');
  const memory=JSON.stringify(c.locomotion!.cerebellum.snapshot());
  if(condition==='blind-stand'){
   c.configureSenses({vision:false});run(4);phase('vision-off');
  }else{
   c.locomotion!.setSpeed(.25);
   if(!failed&&!c.execute({action:'walk_forward'}))failed=true;
   run(3);phase('walk');
   const pushed=!failed&&c.startBalancePush();run(2);phase(pushed?'push-recovery':'push-not-started');
   c.setJoint('neck_yaw',.35);run(1);phase('head-turn');
   c.execute({action:'stop_walk'});run(6);phase('stop');
  }
  results.push({condition,mode,profile:c.legMuscles.profile.id,failed,minHeight,distanceM:-e.data.qpos[1],steps:c.locomotion?.steps,maxLocalResidualNm,maxDisabledMotorNm,memoriesUnchanged:memory===JSON.stringify(c.locomotion!.cerebellum.snapshot()),phases});
  console.log(condition,mode,failed?'FAILED':'completed','min height',minHeight.toFixed(3));
 }finally{c.dispose();e.dispose();}
}
await writeFile('artifacts/calibration/controller-comparison.json',JSON.stringify({profileSha256:report.profileSha256,
 protocol:{speedMps:.25,pushN:35,pushSeconds:.12,model:'same neuromuscular MJCF for all arms',comparison:'original position servo vs engineering/candidate ankle muscles vs engineering/candidate full-leg muscles',learning:'no new adaptation; memories checked',timing:'identical episode commands and initial state; not a matched-phase impulse test',limits:'ideal local muscle-length servo remains; public gait is not reproduced by this engineering trial'},results},null,2)+'\n');
