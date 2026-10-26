import {reflexExcitation} from './Reflex';
import {defaultProfile, validateProfile, type CalibrationProfile} from '../calibration/Profile';
import type {MuJoCoEngine,Joint} from '../../physics/MuJoCoEngine';
import {legAnatomy,type LegMuscleDefinition} from './LegAnatomy';
import {HillMuscle} from './HillMuscle';
import {MuscleSpindle} from './MuscleSpindle';
export type LegDriveMode='servo'|'ankle'|'full';
const clamp=(x:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,x));
type Afferent={time:number;ia:number;ii:number;ib:number}[];
export class LegMuscleController {
  mode:LegDriveMode='servo';
  reflexes=true;
  gammaStatic=.2;gammaDynamic=.2;
  readonly available:boolean;
  private units:{definition:LegMuscleDefinition;actuator:number;tendon:number;muscle:HillMuscle;spindle:MuscleSpindle;length:number;reflex:number;queue:Afferent;afferent?:Afferent[number]}[]=[];
  private motors:Joint[];
  private previousDisable:number;
  private previousGroups:number[];
  private requested:number[]=[];
  private residual=0;
  readonly profile:CalibrationProfile;
  constructor(private engine:MuJoCoEngine, profile:CalibrationProfile=defaultProfile){
    this.profile=validateProfile(profile);
    const legMuscles=[...legAnatomy('left',this.profile),...legAnatomy('right',this.profile)];
    this.gammaStatic=this.profile.reflex.gammaStatic;this.gammaDynamic=this.profile.reflex.gammaDynamic;
    const {mj,model:m}=engine;
    for(const definition of legMuscles){const actuator=mj.mj_name2id(m,19,definition.name);if(actuator<0)continue;
      const tendon=m.actuator_trnid[actuator*2],start=m.tendon_adr[tendon];
      const expected=Object.entries(definition.coefficients);
      if(m.tendon_num[tendon]!==expected.length||expected.some(([name,r])=>{
        const joint=mj.mj_name2id(m,3,name);
        return !Array.from({length:m.tendon_num[tendon]},(_,k)=>start+k).some(w=>m.wrap_type[w]===1&&m.wrap_objid[w]===joint&&Math.abs(m.wrap_prm[w]-r)<1e-12);
      }))throw new Error('Muscle geometry does not match compiled MJCF; regenerate the model');
      const mechanics=definition.region==='ankle'?this.profile.ankleHill:this.profile.hill;
      if(definition.force*mechanics.tendonForceCap>m.actuator_ctrlrange[actuator*2+1]+1e-6)throw new Error('Muscle capacity exceeds compiled actuator limit; regenerate the model');
      this.units.push({definition,actuator,tendon,muscle:new HillMuscle(definition,definition.region==='ankle'?this.profile.ankleHill:this.profile.hill),spindle:new MuscleSpindle(this.profile.spindle),length:0,reflex:0,queue:[]});}
    this.available=this.units.length===legMuscles.length;
    this.motors=engine.joints.filter(j=>/^(left|right)_(hip(_yaw|_abduction)?|knee|ankle(_roll)?|toe_flex)$/.test(j.name));
    this.previousDisable=m.opt.disableactuator;this.previousGroups=this.motors.map(j=>m.actuator_group[j.actuator]);this.reset();
  }
  owns(name:string){return this.mode==='full'?this.motors.some(j=>j.name===name):this.mode==='ankle'&&/_(ankle|ankle_roll)$/.test(name);}
  setMode(mode:LegDriveMode){
    if(!['servo','ankle','full'].includes(mode)||(!this.available&&mode!=='servo'))return false;
    if(mode===this.mode)return true;
    this.mode=mode;this.engine.legMuscleDrive=mode;const m=this.engine.model;
    this.motors.forEach((j,i)=>m.actuator_group[j.actuator]=this.owns(j.name)?3:this.previousGroups[i]===3?0:this.previousGroups[i]);
    m.opt.disableactuator=(m.opt.disableactuator&~8)|(mode==='servo'?(this.previousDisable&8):8);
    this.reset();this.engine.mj.mj_forward(m,this.engine.data);return true;
  }
  configure(options:{reflexes?:boolean;gammaStatic?:number;gammaDynamic?:number}){
    if(!options||typeof options!=='object'||Array.isArray(options)||Object.entries(options).some(([k,v])=>k==='reflexes'?typeof v!=='boolean':!['gammaStatic','gammaDynamic'].includes(k)||typeof v!=='number'||!Number.isFinite(v)||v<0||v>1))return false;
    Object.assign(this,options);if(options.reflexes!==undefined)this.units.forEach(u=>{u.queue=[];u.afferent=undefined;u.reflex=0;});return true;
  }
  reset(){
    const d=this.engine.data;
    for(const u of this.units){u.length=u.definition.referenceLength+d.ten_length[u.tendon];u.muscle.reset(u.length);u.spindle.reset();u.queue=[];u.afferent=undefined;u.reflex=0;d.ctrl[u.actuator]=0;}
    this.requested=[];this.residual=0;
  }
  update(dt:number,references:Record<string,number>,state=this.engine.data){
    if(!this.available||this.mode==='servo')return;
    const {model:m,data:d}=this.engine;
    const selected=this.units.filter(u=>this.mode==='full'||u.definition.region==='ankle');
    const motors=this.motors.filter(j=>this.owns(j.name));
    // Actuator-internal muscle-length servo. CNS/root feedback still uses the
    // selected body estimator. This ideal local length loop is distinct from
    // the delayed Ia/II reflex; it is not a claim of a full spinal neural model.
    const local=(name:string,velocity=false):number=>{
      const single=this.units.find(u=>Object.keys(u.definition.coefficients).length===1&&u.definition.coefficients[name]!==undefined);
      if(single)return (velocity?d.ten_velocity[single.tendon]:d.ten_length[single.tendon])/single.definition.coefficients[name];
      const u=this.units.find(u=>u.definition.name.endsWith('tibialis_posterior')&&u.definition.coefficients[name]!==undefined)!;
      let length=velocity?d.ten_velocity[u.tendon]:d.ten_length[u.tendon];
      for(const [j,r] of Object.entries(u.definition.coefficients))if(j!==name)length-=r*local(j,velocity);
      return length/u.definition.coefficients[name];
    };
    const target=motors.map(j=>{
      const a=j.actuator*10,kp=m.actuator_gainprm[a],kv=-m.actuator_biasprm[a+2];
      const q=local(j.name),v=local(j.name,true);
      return clamp(kp*(clamp(references[j.name]??state.qpos[j.q],j.min,j.max)-q)-kv*v,m.actuator_forcerange[j.actuator*2],m.actuator_forcerange[j.actuator*2+1]);
    });
    const low:number[]=[],span:number[]=[],matrix:number[][]=motors.map(()=>[]);
    selected.forEach((u,k)=>{
      u.length=u.definition.referenceLength+d.ten_length[u.tendon];
      low[k]=u.muscle.predict(u.length,0,dt);span[k]=Math.max(.01,u.muscle.predict(u.length,1,dt)-low[k]);
      motors.forEach((j,i)=>matrix[i][k]=-(u.definition.coefficients[j.name]??0)*span[k]);
    });
    const b=target.map((v,i)=>v-selected.reduce((s,u,k)=>s-(u.definition.coefficients[motors[i].name]??0)*low[k],0));
    const x=selected.map(()=>0),prediction=motors.map(()=>0);
    // Bounded coordinate descent: tensile muscles cannot push. Multiarticular
    // columns simultaneously contribute at hip/knee/ankle, not separate motors.
    for(let pass=0;pass<16;pass++)selected.forEach((_,k)=>{
      let numerator=0,denominator=1e-8;
      for(let i=0;i<motors.length;i++){numerator+=matrix[i][k]*(b[i]-prediction[i]);denominator+=matrix[i][k]**2;}
      const next=clamp(x[k]+numerator/denominator,0,1),change=next-x[k];x[k]=next;
      for(let i=0;i<motors.length;i++)prediction[i]+=matrix[i][k]*change;
    });
    selected.forEach((u,k)=>{
      const desired=low[k]+span[k]*x[k];let lo=0,hi=1;
      for(let i=0;i<7;i++){const mid=(lo+hi)/2;if(u.muscle.predict(u.length,mid,dt)<desired)lo=mid;else hi=mid;}
      const opposite=selected.filter(v=>v!==u&&Object.entries(u.definition.coefficients).some(([j,r])=>r*(v.definition.coefficients[j]??0)<0));
      const a=u.afferent,r=this.profile.reflex;
      u.reflex=this.reflexes?reflexExcitation(r,a,opposite.map(v=>v.afferent?.ia??r.iaReference)):0;
      const elastic=u.muscle.advance(u.length,(lo+hi)/2+u.reflex,dt);
      d.ctrl[u.actuator]=elastic;
      const sense=u.spindle.update(u.muscle.fiber/u.definition.optimal,dt,clamp(this.gammaStatic+r.staticAlphaCoupling*u.muscle.activation,0,1),clamp(this.gammaDynamic+r.dynamicAlphaCoupling*u.muscle.activation,0,1));
      u.queue.push({time:d.time,ia:sense.ia,ii:sense.ii,ib:u.muscle.force/u.definition.force});
      while(u.queue.length&&u.queue[0].time<=d.time-r.delay+1e-9)u.afferent=u.queue.shift();
    });
    const actual=motors.map(j=>selected.reduce((sum,u)=>sum-(u.definition.coefficients[j.name]??0)*d.ctrl[u.actuator],0));
    this.requested=target;this.residual=Math.hypot(...actual.map((v,i)=>v-target[i]));
  }
  snapshot(){const {data:d}=this.engine;return {profile:this.profile.id,available:this.available,mode:this.mode,reflexes:this.reflexes,gammaStatic:this.gammaStatic,gammaDynamic:this.gammaDynamic,residual:this.residual,
    motors:this.motors.filter(j=>this.owns(j.name)).map((j,i)=>({name:j.name,desired:this.requested[i]??0,force:d.actuator_force[j.actuator],passiveDamping:this.engine.model.dof_damping[j.v]})),
    muscles:this.units.map(u=>({name:u.definition.name,label:u.definition.label,active:this.mode==='full'||this.mode==='ankle'&&u.definition.region==='ankle',...u.muscle.snapshot(),elasticForce:u.muscle.force,force:-d.actuator_force[u.actuator],viscousForce:-this.engine.model.tendon_damping[u.tendon]*d.ten_velocity[u.tendon],
      spindle:u.spindle.snapshot(),afferent:u.afferent?{...u.afferent,age:d.time-u.afferent.time}:null,reflex:u.reflex}))};}
  dispose(){this.engine.legMuscleDrive='servo';this.engine.model.opt.disableactuator=(this.engine.model.opt.disableactuator&~8)|(this.previousDisable&8);this.motors.forEach((j,i)=>this.engine.model.actuator_group[j.actuator]=this.previousGroups[i]);this.units.forEach(u=>{this.engine.data.ctrl[u.actuator]=0;this.engine.model.tendon_damping[u.tendon]=0;});}
}
