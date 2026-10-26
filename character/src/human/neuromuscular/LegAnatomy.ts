import { defaultProfile, type CalibrationProfile } from '../calibration/Profile';
/** Signed dLmt/dq in m/rad. Positive tension produces -coefficient * force. */
export interface LegMuscleDefinition {
  name:string; label:string; region:'ankle'|'leg'; force:number; optimal:number; slack:number; referenceLength:number;
  coefficients:Record<string,number>;
}
export function legAnatomy(side:'left'|'right',profile:CalibrationProfile=defaultProfile):LegMuscleDefinition[]{
  const sign=side==='left'?1:-1;
  return profile.muscles.map(row=>({...row,name:`nm_${side}_${row.name}`,
    coefficients:Object.fromEntries(Object.entries(row.coefficients).map(([joint,r])=>[
      `${side}_${joint}`, /ankle_roll|hip_abduction|hip_yaw/.test(joint)?r*sign:r]))}));
}
export const legMuscles=[...legAnatomy('left'),...legAnatomy('right')];
