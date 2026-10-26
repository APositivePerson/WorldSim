export type TrialKind='passive'|'active'|'reflex'|'gait';
export interface CalibrationTrial {
  id:string;subject:string;kind:TrialKind;split:'train'|'holdout';clock:'seconds'|'gait_phase';
  columns:string[];samples:number[][];bodyMassKg?:number;speedMps?:number;
  sourceFile?:string;sourceSha256:string|Record<string,string>;processing:Record<string,unknown>;
}
export interface CalibrationDataset {schemaVersion:number;source:string;license:{name:string;url:string};trials:CalibrationTrial[]}
export function validateDataset(value:unknown):CalibrationDataset {
  const d=value as CalibrationDataset;
  if(!d||d.schemaVersion!==1||!d.source||!d.license?.name||!Array.isArray(d.trials))throw new Error('Invalid dataset metadata');
  const ids=new Set<string>();
  for(const t of d.trials){
    if(!t.id||ids.has(t.id)||!t.subject||!['passive','active','reflex','gait'].includes(t.kind)||!['train','holdout'].includes(t.split)||!t.sourceSha256||!t.processing)throw new Error('Invalid trial metadata');
    ids.add(t.id);
    if(t.clock!=='seconds'&&t.clock!=='gait_phase')throw new Error('Unknown recording clock');
    if((t.kind==='gait')!==(t.clock==='gait_phase'))throw new Error('Phase-only data cannot identify timing parameters');
    const required=[t.clock==='seconds'?'time_s':'phase','ankle_df_rad','knee_flex_rad','ankle_df_Nm'];
    if(t.kind==='gait')required.push('hip_flex_rad','hip_flex_Nm','knee_flex_Nm');
    if(t.kind==='active')required.push('soleus_emg','gastrocnemius_emg','tibialis_anterior_emg');
    // Reflex replay needs an explicitly measured/estimated non-reflex baseline;
    // total observed EMG must never be fed back as feedforward + reflex again.
    if(t.kind==='reflex'){
      required.push('soleus_drive','gastrocnemius_drive','tibialis_anterior_drive');
      if(t.processing.perturbationTimingVerified!==true||t.processing.latencyPreserving!==true||!t.processing.baselineDriveSource)throw new Error('Reflex baseline/timing not established');
    }
    if(new Set(t.columns).size!==t.columns.length||required.some(c=>!t.columns.includes(c)))throw new Error('Missing or duplicate channels');
    if(t.samples.length<2)throw new Error('Empty recording');
    const ti=t.columns.indexOf(required[0]);let prev=-Infinity;
    for(const row of t.samples){
      if(row.length!==t.columns.length||row.some(v=>!Number.isFinite(v))||row[ti]<=prev)throw new Error('Non-finite or non-monotonic recording');
      if(t.clock==='seconds'&&prev!==-Infinity&&row[ti]-prev>.021)throw new Error('Recording gap: split trial instead of interpolating a missing interval');
      if(t.clock==='gait_phase'&&(row[ti]<0||row[ti]>1))throw new Error('Invalid gait phase');
      prev=row[ti];
    }
    if(t.kind==='gait'&&(!(t.bodyMassKg!>0)||!(t.speedMps!>0)))throw new Error('Gait normalization metadata missing');
  }
  return structuredClone(d);
}
export function column(t:CalibrationTrial,name:string):number[]{
  const i=t.columns.indexOf(name);if(i<0)throw new Error(`Missing ${name}`);return t.samples.map(row=>row[i]);
}
export function assertDisjoint(train:CalibrationTrial[],holdout:CalibrationTrial[]){
  const ids=new Set(train.map(t=>t.id));
  const hashes=new Set(train.flatMap(t=>typeof t.sourceSha256==='string'?[t.sourceSha256]:Object.values(t.sourceSha256)));
  if(holdout.some(t=>ids.has(t.id)||(typeof t.sourceSha256==='string'?[t.sourceSha256]:Object.values(t.sourceSha256)).some(h=>hashes.has(h))))throw new Error('Train/holdout trial leakage');
}
