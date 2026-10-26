import {defaultProfile, type CalibrationProfile} from '../calibration/Profile';
import type {MuJoCoEngine} from '../../physics/MuJoCoEngine';
import {SensoryInterface,type SensoryFrame} from '../sensory/SensoryInterface';
const clamp=(x:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,x));
/** Real eye hinges, orbital springs, and six spatial muscle actuators per eye.
 * Neural position integration produces a command; it never writes eye qpos. */
export class PhysicalEyes {
  readonly available:boolean;
  enabled=true;
  private input:SensoryInterface|null=null;
  private eyes:{side:'left'|'right';body:number;joints:{id:number;q:number;v:number}[];target:number[];muscles:{name:string;a:number;gain:number[];bias:number[];range:number[];strength:number}[]}[]=[];
  constructor(private engine:MuJoCoEngine, private parameters:CalibrationProfile['eyes']=defaultProfile.eyes){
    const {mj,model:m}=engine;
    for(const side of ['left','right'] as const){
      const body=mj.mj_name2id(m,1,side+'_eye');if(body<0)continue;
      const joints=['yaw','pitch','torsion'].map(axis=>{const id=mj.mj_name2id(m,3,`${side}_eye_${axis}`);return {id,q:m.jnt_qposadr[id],v:m.jnt_dofadr[id]};});
      const muscles=['lateral_rectus','medial_rectus','superior_rectus','inferior_rectus','superior_oblique','inferior_oblique'].map(kind=>{
        const name=`eye_${side}_${kind}`,a=mj.mj_name2id(m,19,name);return {name,a,gain:Array.from(m.actuator_gainprm.slice(a*10,a*10+10)) as number[],bias:Array.from(m.actuator_biasprm.slice(a*10,a*10+10)) as number[],range:Array.from(m.actuator_lengthrange.slice(a*2,a*2+2)) as number[],strength:1};});
      if(muscles.every(f=>f.a>=0))this.eyes.push({side,body,joints,target:[0,0,0],muscles});
    }
    this.available=this.eyes.length===2;
    if(this.available){this.input=new SensoryInterface(engine);engine.physicalEyes=true;}
  }
  distantFixation(){if(this.input&&!this.engine.gazeTarget)this.input.target.set(0,-100,1.65);}
  setTarget(target:number[]){if(!this.input||!Array.isArray(target)||target.length!==3||target.some(v=>typeof v!=='number'||!Number.isFinite(v)))return false;this.input.target.fromArray(target);return true;}
  setStrength(name:string,value:number){
    if(!Number.isFinite(value)||value<0||value>1)return false;
    const f=this.eyes.flatMap(e=>e.muscles).find(f=>f.name===name);if(!f)return false;
    f.strength=value;f.gain[2]=f.bias[2]=this.parameters.force*value;
    const m=this.engine.model;m.actuator_gainprm[f.a*10+2]=f.gain[2];m.actuator_biasprm[f.a*10+2]=f.bias[2];return true;
  }
  private moment(a:number,v:number){const d=this.engine.data,start=d.moment_rowadr[a],count=d.moment_rownnz[a];
    for(let k=start;k<start+count;k++)if(d.moment_colind[k]===v)return d.actuator_moment[k];return 0;}
  update(dt:number,frame?:SensoryFrame,bias=[0,0,0],stabilize=true){
    if(!this.available)return;
    const {mj,model:m,data:d}=this.engine;
    if(!frame&&this.engine.gazeTarget)this.input!.target.fromArray(this.engine.gazeTarget);
    const observed=frame??this.input!.sample(d.time,{yaw:0,pitch:0});
    const gyro=observed.vestibular?.value.gyro;
    for(const [index,eye] of this.eyes.entries()){
      if(!this.enabled){eye.muscles.forEach(f=>d.ctrl[f.a]=0);continue;}
      const retinal=observed.vision?.value.retinalEyes?.[index]??observed.vision?.value.retinal;
      for(let k=0;k<2;k++){
        const angular=gyro?gyro[k===0?2:0]-bias[k===0?2:0]:0;
        const velocity=stabilize? -angular+(retinal?retinal[k]*this.parameters.retinalGain:0):-eye.target[k]*this.parameters.relaxationGain;
        eye.target[k]=clamp(eye.target[k]+clamp(velocity,-this.parameters.maxCommandRate,this.parameters.maxCommandRate)*dt,(k===0?this.parameters.yawRange:this.parameters.pitchRange)[0],(k===0?this.parameters.yawRange:this.parameters.pitchRange)[1]);
      }
      const torque=eye.joints.map((j,k)=>this.parameters.positionGain*(eye.target[k]-d.qpos[j.q])-this.parameters.velocityGain*d.qvel[j.v]+m.jnt_stiffness[j.id]*d.qpos[j.q]);
      const matrix:number[][]=[[],[],[]],base=torque.map(v=>v);
      eye.muscles.forEach((f,k)=>{
        const capacity=-mj.mju_muscleGain(d.actuator_length[f.a],d.actuator_velocity[f.a],f.range,m.actuator_acc0[f.a],f.gain);
        const passive=mj.mju_muscleBias(d.actuator_length[f.a],f.range,m.actuator_acc0[f.a],f.bias);
        eye.joints.forEach((j,i)=>{const moment=this.moment(f.a,j.v);matrix[i][k]=-moment*Math.max(0,capacity);base[i]-=moment*passive;});
      });
      const x=eye.muscles.map(()=>0),result=[0,0,0];
      for(let pass=0;pass<18;pass++)eye.muscles.forEach((_,k)=>{
        let n=0,denom=1e-12;for(let i=0;i<3;i++){n+=matrix[i][k]*(base[i]-result[i]);denom+=matrix[i][k]**2;}
        const next=clamp(x[k]+n/denom,0,1),delta=next-x[k];x[k]=next;for(let i=0;i<3;i++)result[i]+=matrix[i][k]*delta;
      });
      eye.muscles.forEach((f,k)=>{
        const a=d.act[m.actuator_actadr[f.a]],tau=x[k]>a?this.parameters.activationRise:this.parameters.activationFall;
        d.ctrl[f.a]=clamp(a+(x[k]-a)/Math.max(.05,1-Math.exp(-dt/tau)),0,1);
      });
    }
  }
  reset(){this.input?.reset();this.eyes.forEach(e=>{e.target.fill(0);e.muscles.forEach(f=>{this.engine.data.ctrl[f.a]=0;});});}
  snapshot(){const {data:d,model:m}=this.engine;return {available:this.available,enabled:this.enabled,eyes:this.eyes.map(e=>({side:e.side,body:e.body,target:e.target.slice(),
    angles:e.joints.map(j=>d.qpos[j.q]),velocity:e.joints.map(j=>d.qvel[j.v]),
    muscles:e.muscles.map(f=>({name:f.name,strength:f.strength,excitation:d.ctrl[f.a],activation:d.act[m.actuator_actadr[f.a]],force:-d.actuator_force[f.a],length:d.actuator_length[f.a]}))}))};}
  dispose(){this.input?.dispose();this.eyes.flatMap(e=>e.muscles).forEach(f=>{this.engine.data.ctrl[f.a]=0;this.engine.model.actuator_gainprm[f.a*10+2]=this.parameters.force;this.engine.model.actuator_biasprm[f.a*10+2]=this.parameters.force;});this.engine.physicalEyes=false;}
}
