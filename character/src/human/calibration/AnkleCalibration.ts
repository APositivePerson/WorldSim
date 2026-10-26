import {reflexExcitation,type AfferentSample} from '../neuromuscular/Reflex';
import {HillMuscle} from '../neuromuscular/HillMuscle';
import {MuscleSpindle} from '../neuromuscular/MuscleSpindle';
import {defaultProfile,validateProfile,type CalibrationProfile} from './Profile';
import {assertDisjoint,column,type CalibrationTrial} from './Data';
import protocol from './protocol.json';
const clip=(x:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,x));
const names=['soleus','gastrocnemius','tibialis_anterior','tibialis_posterior','peroneus_longus'];
export interface FitValues {slackScale:number;passiveScale:number;measurementBiasNm:number;forceScale:number;reflexGainScale:number;reflexDelaySeconds:number}
export const initialValues:FitValues=Object.fromEntries(Object.entries(protocol.parameters).map(([k,v])=>[k,v.initial])) as unknown as FitValues;
export function candidateProfile(base:CalibrationProfile,v:FitValues):CalibrationProfile {
  const p=structuredClone(base);p.id=base.id+'-ankle-pilot';p.status='candidate-limited-evidence';
  for(const m of p.muscles)if(m.region==='ankle'){m.slack*=v.slackScale;}
  p.ankleHill.passiveScale=v.passiveScale;p.ankleHill.activeForceScale=v.forceScale;
  p.reflex.iaGain*=v.reflexGainScale;p.reflex.iiGain*=v.reflexGainScale;p.reflex.delay=v.reflexDelaySeconds;
  return validateProfile(p);
}
export interface Replay {prediction:number[];observed:number[];valid:boolean[];time:number[];forceCapSamples:number;emgClippedSamples:number}
/** Prescribed measured kinematics -> same Hill implementation as runtime. No PD
 * reference servo, inverse torque allocation or measured torque in the inputs. */
export function replayAnkle(t:CalibrationTrial,p:CalibrationProfile,biasNm=0):Replay {
  if(t.clock!=='seconds')throw new Error('Phase ensemble has no physical time; cannot replay dynamics');
  const q=column(t,'ankle_df_rad'),knee=column(t,'knee_flex_rad'),time=column(t,'time_s'),observed=column(t,'ankle_df_Nm');
  const channels=Object.fromEntries(['soleus','gastrocnemius','tibialis_anterior'].map(n=>[n,t.columns.includes(n+(t.kind==='reflex'?'_drive':'_emg'))?column(t,n+(t.kind==='reflex'?'_drive':'_emg')):q.map(()=>0)]));
  const units=p.muscles.filter(m=>names.includes(m.name)).map(def=>({def,m:new HillMuscle(def,p.ankleHill),s:new MuscleSpindle(p.spindle),queue:[] as (AfferentSample&{time:number})[],a:undefined as undefined|AfferentSample}));
  const prediction:number[]=[],valid:boolean[]=[];let forceCapSamples=0,emgClippedSamples=0;
  const length=(def:typeof p.muscles[number],i:number)=>def.referenceLength-(def.coefficients.ankle??0)*q[i]+(def.coefficients.knee??0)*knee[i];
  units.forEach(u=>u.m.reset(length(u.def,0)));
  for(let i=0;i<q.length;i++){
    const dt=i?time[i]-time[i-1]:time[1]-time[0];
    const substeps=Math.ceil(dt/.002-1e-8);let torque=0;
    for(let step=1;step<=substeps;step++){
      const alpha=step/substeps,previous=Math.max(0,i-1),now=i?time[previous]+alpha*dt:time[0];torque=0;
      for(const u of units){
        const signal=channels[u.def.name];
        let drive=t.kind==='passive'?0:signal?signal[previous]+alpha*(signal[i]-signal[previous]):0;
        if(drive>1&&step===substeps)emgClippedSamples++;
        if(t.kind==='reflex'){
          const r=p.reflex,a=u.a;
          const opposite=units.filter(v=>(v.def.coefficients.ankle??0)*(u.def.coefficients.ankle??0)<0);
          drive+=reflexExcitation(r,a,opposite.map(v=>v.a?.ia??r.iaReference));
        }
        const l=length(u.def,previous)+alpha*(length(u.def,i)-length(u.def,previous));
        const force=u.m.advance(l,drive,dt/substeps);
        torque+=(u.def.coefficients.ankle??0)*force;
        if(force>=u.def.force*p.ankleHill.tendonForceCap*.999&&step===substeps)forceCapSamples++;
        if(t.kind==='reflex'){
          const r=p.reflex,s=u.s.update(u.m.fiber/u.def.optimal,dt/substeps,r.gammaStatic+r.staticAlphaCoupling*u.m.activation,r.gammaDynamic+r.dynamicAlphaCoupling*u.m.activation);
          u.queue.push({time:now,ia:s.ia,ii:s.ii,ib:force/u.def.force});while(u.queue.length&&u.queue[0].time<=now-r.delay+1e-9)u.a=u.queue.shift();
        }
      }
    }
    prediction.push(torque+biasNm);
    valid.push(time[i]-time[0]>=protocol.mask.warmupSeconds&&Math.abs(q[i])<=protocol.mask.maxAnkleAngleRad&&(t.kind!=='passive'||Math.max(...Object.values(channels).map(a=>a[i]))<=protocol.mask.passiveMaxNormalizedEmg));
  }
  return {prediction,observed,valid,time,forceCapSamples,emgClippedSamples};
}
export function metrics(r:Replay){
  const errors=r.prediction.flatMap((p,i)=>r.valid[i]?[p-r.observed[i]]:[]);
  if(!errors.length)throw new Error('No eligible samples');
  const rmse=Math.sqrt(errors.reduce((s,e)=>s+e*e,0)/errors.length);
  return {rmseNm:rmse,meanErrorNm:errors.reduce((s,e)=>s+e,0)/errors.length,maxAbsErrorNm:Math.max(...errors.map(Math.abs)),samples:errors.length,excluded:r.valid.length-errors.length,forceCapSamples:r.forceCapSamples,emgClippedSamples:r.emgClippedSamples};
}
/** Trial-balanced, normalized loss. Optimizer receives training trials only. */
function loss(trials:CalibrationTrial[],base:CalibrationProfile,v:FitValues,keys:(keyof FitValues)[]){
  const p=candidateProfile(base,v);
  const error=trials.reduce((s,t)=>s+(metrics(replayAnkle(t,p,v.measurementBiasNm)).rmseNm/protocol.optimizer.torqueScaleNm)**2,0)/trials.length;
  return error+protocol.optimizer.priorWeight*keys.reduce((s,k)=>{const b=protocol.parameters[k];return s+((v[k]-b.initial)/(b.range[1]-b.range[0]))**2;},0);
}
export function fitStage(trials:CalibrationTrial[],base:CalibrationProfile,previous:FitValues,stage:'passive'|'active'|'reflex'){
  if(!trials.length||trials.some(t=>t.split!=='train'||t.kind!==stage))throw new Error('Fit stage accepts matching training trials only');
  const keys=(Object.keys(protocol.parameters) as (keyof FitValues)[]).filter(k=>protocol.parameters[k].stage===stage);
  const values={...previous};let best=loss(trials,base,values,keys),evaluations=1;
  for(let pass=0;pass<protocol.optimizer.passes;pass++)for(const k of keys){
    const bounds=protocol.parameters[k].range,step=(bounds[1]-bounds[0])*protocol.optimizer.initialStepFraction*2**(-Math.floor(pass/2));
    const current=values[k];let next=current;
    for(const direction of [-1,1]){
      const attempt={...values,[k]:clip(current+direction*step,bounds[0],bounds[1])},score=loss(trials,base,attempt,keys);evaluations++;
      if(score<best){best=score;next=attempt[k];}
    }
    values[k]=next;
  }
  return {values,objective:best,evaluations,trainingTrials:trials.map(t=>t.id),frozenParameters:(Object.keys(protocol.parameters) as (keyof FitValues)[]).filter(k=>!keys.includes(k)),atBounds:keys.filter(k=>values[k]===protocol.parameters[k].range[0]||values[k]===protocol.parameters[k].range[1])};
}
export function calibrateAnkle(trials:CalibrationTrial[],base=defaultProfile){
  const train=trials.filter(t=>t.split==='train'),holdout=trials.filter(t=>t.split==='holdout');assertDisjoint(train,holdout);
  const passive=fitStage(train.filter(t=>t.kind==='passive'),base,initialValues,'passive');
  const active=fitStage(train.filter(t=>t.kind==='active'),base,passive.values,'active');
  const reflexTrials=train.filter(t=>t.kind==='reflex');
  const reflex=reflexTrials.length?{status:'effective-loop-fit',...fitStage(reflexTrials,base,active.values,'reflex')}:{status:'not-identifiable',reason:'No verified perturbation recording with a separate baseline drive. Ia/II/gamma parameters retained; zero-phase EMG envelopes cannot identify neural latency.'};
  const values='values' in reflex?reflex.values:active.values;
  const candidate=candidateProfile(base,values);
  // Every parameter is now frozen. Holdouts are evaluated once, never used to choose a candidate.
  const validation=holdout.filter(t=>t.kind!=='gait').map(t=>{
    const rawBaseline=metrics(replayAnkle(t,base,0)),rawCandidate=metrics(replayAnkle(t,candidate,0)),baseline=metrics(replayAnkle(t,base,values.measurementBiasNm)),fitted=metrics(replayAnkle(t,candidate,values.measurementBiasNm));
    return {id:t.id,kind:t.kind,subject:t.subject,baseline,rawBaseline,rawCandidate,candidate:fitted,pass:fitted.rmseNm<=protocol.acceptance.maxHoldoutTorqueRmseNm&&fitted.rmseNm<=baseline.rmseNm*(1+protocol.acceptance.maxRelativeRegression)};
  });
  const transfer=gaitCapacity(holdout.filter(t=>t.kind==='gait'),base,candidate);
  return {protocol:protocol.id,values,profile:candidate,stages:{passive,active,reflex},validation,gait:transfer,
    acceptance:{torqueHoldoutsPass:validation.length>0&&validation.every(v=>v.pass),deployable:false,reason:'Pilot fit only: no individual anatomy/ultrasound identification, no verified reflex perturbation data, and gait ensembles lack time and EMG. Closed-loop tests are engineering checks, not human validation.'}};
}
/** Static feasible torque envelope only. No timing/velocity/power claim from a phase ensemble. */
export function gaitCapacity(trials:CalibrationTrial[],base:CalibrationProfile,candidate:CalibrationProfile){
 return trials.map(t=>{
  const q=column(t,'ankle_df_rad'),k=column(t,'knee_flex_rad'),target=column(t,'ankle_df_Nm').map(v=>v/t.bodyMassKg!);
  const profiles=[base,candidate].map(p=>{
   const min:number[]=[],max:number[]=[];
   q.forEach((angle,i)=>{
    let lo=0,hi=0;
    for(const def of p.muscles.filter(m=>m.region==='ankle')){
     const length=def.referenceLength-(def.coefficients.ankle??0)*angle+(def.coefficients.knee??0)*k[i];
     const muscle=new HillMuscle(def,p.ankleHill);muscle.reset(length);
     // Static equilibrium obtained by a long-time, zero-rate solve; active lag settled explicitly.
     muscle.activation=0;const passive=muscle.predict(length,0,1e6);
     muscle.activation=1;const active=muscle.predict(length,1,1e6),r=def.coefficients.ankle??0;
     lo+=Math.min(r*passive,r*active);hi+=Math.max(r*passive,r*active);
    }
    min.push(lo/p.appliesTo.massKg);max.push(hi/p.appliesTo.massKg);
   });
   return {profile:p.id,minNmPerKg:min,maxNmPerKg:max,outsideCapacityFraction:target.filter((v,i)=>v<min[i]||v>max[i]).length/target.length};
  });
  return {id:t.id,speedMps:t.speedMps,kind:'static-capacity-only',targetNmPerKg:target,phase:column(t,'phase'),profiles,exceedsModelRomFraction:q.filter(v=>Math.abs(v)>protocol.mask.maxAnkleAngleRad).length/q.length};
 });
}

/** Local training-only sensitivity, not confidence intervals or a uniqueness proof. */
export function trainingSensitivity(trials:CalibrationTrial[],base:CalibrationProfile,values:FitValues){
 const keys=['slackScale','passiveScale','measurementBiasNm','forceScale'] as const;
 const train=trials.filter(t=>t.split==='train'&&t.kind!=='gait');
 const columns=keys.map(key=>{
  const bounds=protocol.parameters[key].range,step=(bounds[1]-bounds[0])*.01;
  const lo=clip(values[key]-step,bounds[0],bounds[1]),hi=clip(values[key]+step,bounds[0],bounds[1]);
  const low={...values,[key]:lo},high={...values,[key]:hi};
  return train.flatMap(t=>{
   const a=replayAnkle(t,candidateProfile(base,low),low.measurementBiasNm),b=replayAnkle(t,candidateProfile(base,high),high.measurementBiasNm);
   return a.prediction.flatMap((v,i)=>a.valid[i]?[(b.prediction[i]-v)/(hi-lo)*(bounds[1]-bounds[0])]:[]);
  });
 });
 const dot=(a:number[],b:number[])=>a.reduce((s,v,i)=>s+v*b[i],0);
 const rms=columns.map(a=>Math.sqrt(dot(a,a)/a.length));
 const pairs=[];
 for(let i=0;i<keys.length;i++)for(let j=i+1;j<keys.length;j++)pairs.push({a:keys[i],b:keys[j],cosine:dot(columns[i],columns[j])/Math.sqrt(Math.max(1e-30,dot(columns[i],columns[i])*dot(columns[j],columns[j])))});
 return {method:'finite differences normalized by predeclared parameter range; training samples only',confidenceIntervals:null,
  rmsTorqueSensitivityNm:Object.fromEntries(keys.map((k,i)=>[k,rms[i]])),pairs,warning:'Low sensitivity or near-collinear columns indicate local identifiability problems. This is not a statistical uncertainty estimate; individual muscle force and gamma parameters remain unidentified.'};
}
