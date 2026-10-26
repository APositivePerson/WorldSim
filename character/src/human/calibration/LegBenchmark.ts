import type {CalibrationProfile} from './Profile';
import {column,type CalibrationTrial} from './Data';
import {HillMuscle} from '../neuromuscular/HillMuscle';
/** Three simultaneous sagittal joint demands. This is a static feasibility
 * benchmark, not force identification or proof of dynamic gait feasibility. */
export function sagittalLegBenchmark(trials:CalibrationTrial[],profiles:CalibrationProfile[]){
 const joints=['hip','knee','ankle'] as const,signs=[-1,1,-1];
 return trials.map(t=>{
  if(t.kind!=='gait'||t.split!=='holdout')throw new Error('Leg benchmark requires gait holdouts');
  const angles=[column(t,'hip_flex_rad'),column(t,'knee_flex_rad'),column(t,'ankle_df_rad')];
  const targets=[column(t,'hip_flex_Nm'),column(t,'knee_flex_Nm'),column(t,'ankle_df_Nm')].map(a=>a.map(v=>v/t.bodyMassKg!));
  const results=profiles.map(p=>{
   const muscles=p.muscles,states=angles[0].map((_,i)=>{
    const passive:number[]=[],span:number[]=[],matrix:number[][]=joints.map(()=>[]);
    muscles.forEach((def,k)=>{
     const mechanics=def.region==='ankle'?p.ankleHill:p.hill;
     const length=def.referenceLength+joints.reduce((s,joint,j)=>s+(def.coefficients[joint]??0)*signs[j]*angles[j][i],0);
     const m=new HillMuscle(def,mechanics);m.reset(length);m.activation=0;
     passive[k]=m.predict(length,0,1e6);m.activation=1;span[k]=Math.max(0,m.predict(length,1,1e6)-passive[k]);
     joints.forEach((joint,j)=>matrix[j][k]=-signs[j]*(def.coefficients[joint]??0)*span[k]/p.appliesTo.massKg);
    });
    const offset=joints.map((joint,j)=>muscles.reduce((s,def,k)=>s-signs[j]*(def.coefficients[joint]??0)*passive[k]/p.appliesTo.massKg,0));
    const x=muscles.map(()=>0),predicted=offset.slice();
    for(let pass=0;pass<60;pass++)muscles.forEach((_,k)=>{
     let num=0,den=1e-12;
     for(let j=0;j<3;j++){num+=matrix[j][k]*(targets[j][i]-predicted[j]);den+=matrix[j][k]**2;}
     const next=Math.max(0,Math.min(1,x[k]+num/den)),delta=next-x[k];x[k]=next;
     for(let j=0;j<3;j++)predicted[j]+=matrix[j][k]*delta;
    });
    return {predictionNmPerKg:predicted,residualNmPerKg:predicted.map((v,j)=>v-targets[j][i]),allocation:x};
   });
   return {profile:p.id,rmseNmPerKg:Object.fromEntries(joints.map((joint,j)=>[joint,Math.sqrt(states.reduce((s,v)=>s+v.residualNmPerKg[j]**2,0)/states.length)])),states};
  });
  return {id:t.id,speedMps:t.speedMps,phase:column(t,'phase'),joints,targetsNmPerKg:targets,profiles:results,
   limitation:'Simultaneous hip/knee/ankle sagittal static demands only; other angles set to neutral, frontal/transverse/toe demands unmeasured. Allocations are non-unique feasibility variables, not inferred human muscle forces. No physical time, activation continuity, EMG or power validation.'};
 });
}
