import engineering from './profiles/engineering-v1.json';

type Muscle = Omit<typeof engineering.muscles[number], 'region'> & {region:'ankle'|'leg'};
export type CalibrationProfile = Omit<typeof engineering, 'muscles'|'fields'|'sources'> & {
  muscles:Muscle[];
  fields:Record<string,{unit:string;range:number[];source:string;rangeMeaning:string;appliesTo:string}>;
  sources:Record<string,{title:string;url:string|null;evidence:string}>;
};
export type HillParameters = CalibrationProfile['hill'];
export type SpindleParameters = CalibrationProfile['spindle'];
export type ReflexParameters = CalibrationProfile['reflex'];
export const defaultProfile = engineering as CalibrationProfile;

/** Validate before constructing a plant. Bounds are engineering limits, not a claim of human variability. */
export function validateProfile(value:unknown):CalibrationProfile {
  if(!value||typeof value!=='object')throw new Error('Invalid calibration profile');
  const p=value as CalibrationProfile;
  if(p.version!==1||typeof p.id!=='string'||!p.id||!p.appliesTo||!p.sources||!p.fields||p.muscles?.length!==17)throw new Error('Invalid profile schema');
  const check=(path:string,x:unknown,metaKey=path)=>{
    const m=p.fields[path]??p.fields[metaKey];
    if(!m||!m.unit||!m.appliesTo||!m.rangeMeaning||!p.sources[m.source]||m.range.length!==2||!m.range.every(Number.isFinite)||m.range[0]>m.range[1])throw new Error(`Missing metadata: ${path}`);
    const a=Array.isArray(x)?x:[x];
    if(!a.length||a.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<m.range[0]||v>m.range[1]))throw new Error(`Out of range: ${path}`);
  };
  for(const section of ['hill','ankleHill','spindle','reflex','eyes'] as const){
    if(!p[section]||Object.keys(p[section]).sort().join()!==Object.keys(defaultProfile[section]).sort().join())throw new Error(`Invalid ${section} schema`);
    for(const [k,v] of Object.entries(p[section]))check(`${section}.${k}`,v);
  }
  if(p.eyeRoutes?.length!==6)throw new Error('Invalid eye routing');
  p.eyeRoutes.forEach((route,i)=>{
    if(route.name!==defaultProfile.eyeRoutes[i].name)throw new Error('Invalid eye route topology');
    for(const key of ['insertion','pulley'] as const){
      if(route[key].length!==3)throw new Error('Invalid route coordinates');
      check(`eyeRoutes.${route.name}.${key}`,route[key],`eyeRoutes.*.${key}`);
    }
  });
  if(p.eyes.center.length!==3)throw new Error('Invalid eye center');
  for(const key of ['yawRange','pitchRange','torsionRange'] as const)if(p.eyes[key].length!==2||p.eyes[key][0]>=p.eyes[key][1])throw new Error('Invalid eye range');
  const names=new Set<string>();
  p.muscles.forEach((m,i)=>{
    const original=defaultProfile.muscles[i];
    if(m.name!==original.name||m.region!==original.region||names.has(m.name)||Object.keys(m.coefficients).sort().join()!==Object.keys(original.coefficients).sort().join())throw new Error('Invalid muscle topology');
    names.add(m.name);
    for(const k of ['force','optimal','slack','referenceLength'] as const){check(`muscles.${m.name}.${k}`,m[k],`muscles.*.${k}`);if(m[k]<=0)throw new Error('Non-positive muscle parameter');}
    Object.values(m.coefficients).forEach(v=>check(`muscles.${m.name}.coefficients`,v,'muscles.*.coefficients'));
  });
  for(const k of ['gammaTau','betaBase','betaGamma','activeGamma','iaWeights','iiWeights'] as const)if(p.spindle[k].length!==3)throw new Error(`Invalid spindle ${k}`);
  for(const x of [p.ankleHill.activationRise,p.ankleHill.activationFall,p.ankleHill.tendonStrainAtUnitForce,p.ankleHill.forceLengthWidth,p.ankleHill.maxVelocity,p.ankleHill.shorteningShape,p.ankleHill.eccentricVelocityScale,p.hill.activationRise,p.hill.activationFall,p.hill.tendonStrainAtUnitForce,p.hill.forceLengthWidth,p.hill.maxVelocity,p.hill.shorteningShape,p.hill.eccentricVelocityScale,p.reflex.rateScale,...p.spindle.gammaTau])if(x<=0)throw new Error('Non-positive divisor');
  return structuredClone(p);
}
validateProfile(defaultProfile);
