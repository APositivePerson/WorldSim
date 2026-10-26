import * as T from 'three';
import type {MuJoCoEngine} from '../../physics/MuJoCoEngine';
export type SensoryOptions={vision:boolean;vestibular:boolean;proprioception:boolean;plantar:boolean;headEyes:boolean;noiseScale:number;delayScale:number};
export const defaultSensoryOptions:SensoryOptions={vision:true,vestibular:true,proprioception:true,plantar:true,headEyes:true,noiseScale:1,delayScale:1};
export interface Observation<T>{sampledAt:number;deliveredAt:number;value:T;uncertainty:number}
export interface Sole {force:number;pads:number[];contact:boolean;flat:boolean}
export type SensoryFrame={time:number;proprio?:Observation<{q:number[];v:number[]}>;vestibular?:Observation<{gyro:number[];specificForce:number[]}>;
  plantar?:Observation<Sole[]>;vision?:Observation<{headPosition:number[];headQuaternion:number[];retinal:number[];retinalEyes?:number[][]}>};
const quaternion=(q:ArrayLike<number>,k:number)=>new T.Quaternion(q[k+1],q[k+2],q[k+3],q[k]);
/** Sole owner of live physical reads in the sensory control path. Vision is a
 * matched-landmark pose/bearing proxy; proprioception is a joint-sensing proxy.
 * It does not simulate a retina image pipeline or muscle spindle neurons. */
export class SensoryInterface {
  alignBodyRates=false;
  options={...defaultSensoryOptions};
  readonly target=new T.Vector3(0,-3,1.65);
  private queue:SensoryFrame[]=[];
  private last=-1;
  private lastVision=-1;
  private seed=9137;
  private previousHead=new T.Quaternion();
  private previousVelocity=new T.Vector3();
  private initialized=false;
  private head:number;
  private headJp;
  private headJr;
  private contactForce;
  private owners=new Map<number,number>();
  constructor(private engine:MuJoCoEngine){
    const {mj,model:m}=engine;this.head=mj.mj_name2id(m,1,'head');
    this.headJp=new mj.DoubleBuffer(m.nv*3);this.headJr=new mj.DoubleBuffer(m.nv*3);this.contactForce=new mj.DoubleBuffer(6);
    const feet=['left','right'].map(s=>mj.mj_name2id(m,1,s+'_foot'));
    for(let b=1;b<m.nbody;b++){let p=b;while(p){const i=feet.indexOf(p);if(i>=0){this.owners.set(b,i);break;}p=m.body_parentid[p];}}
  }
  configure(patch:Partial<SensoryOptions>){
    if(!patch||typeof patch!=="object"||Array.isArray(patch)||Object.entries(patch).some(([key,v])=>!Object.hasOwn(defaultSensoryOptions,key)||
      (key==='noiseScale'||key==='delayScale'?typeof v!=='number'||!Number.isFinite(v)||v<.25||v>4:typeof v!=='boolean')))return false;
    for(const [option,channel] of [['proprioception','proprio'],['vestibular','vestibular'],['plantar','plantar'],['vision','vision']] as const){
      if(patch[option]!==undefined&&patch[option]!==this.options[option])for(const frame of this.queue)delete frame[channel];
    }
    Object.assign(this.options,patch);return true;
  }
  private noise(scale:number){this.seed=(1664525*this.seed+1013904223)>>>0;return (this.seed/4294967296*2-1)*scale*this.options.noiseScale;}
  reset(){this.alignBodyRates=false;this.queue=[];this.last=-1;this.lastVision=-1;this.seed=9137;this.initialized=false;}
  sample(time:number,eyes:{yaw:number;pitch:number}):SensoryFrame {
    if(this.last<0||time-this.last>=.00399){
      const {data:d,model:m,mj}=this.engine,dt=this.last<0?.004:time-this.last;
      const hq=quaternion(d.xquat,this.head*4),inverse=hq.clone().invert();
      mj.mj_jacBody(m,d,this.headJp,this.headJr,this.head);
      const jp=this.headJp.GetView(),velocity=new T.Vector3();
      for(let a=0;a<3;a++){let value=0;for(let j=0;j<m.nv;j++)value+=jp[a*m.nv+j]*d.qvel[j];velocity.setComponent(a,value);}
      const acceleration=this.initialized?velocity.clone().sub(this.previousVelocity).divideScalar(dt):new T.Vector3();
      const delta=this.previousHead.clone().invert().multiply(hq);
      if(delta.w<0)delta.set(-delta.x,-delta.y,-delta.z,-delta.w);
      const vector=new T.Vector3(delta.x,delta.y,delta.z),length=vector.length();
      const gyro=this.initialized&&length>1e-12?vector.multiplyScalar(2*Math.atan2(length,delta.w)/(length*dt)):new T.Vector3();
      const specific=acceleration.sub(new T.Vector3(0,0,-9.81)).applyQuaternion(inverse);
      const soles:Sole[]=[0,1].map(()=>({force:0,pads:[0,0,0,0],contact:false,flat:false}));
      const contacts=d.contact;
      try{for(let i=0;i<d.ncon;i++){const ct=contacts.get(i)!;try{
        const a=m.geom_bodyid[ct.geom1],b=m.geom_bodyid[ct.geom2],owner=a===0?this.owners.get(b):b===0?this.owners.get(a):undefined;
        if(owner===undefined)continue;
        mj.mj_contactForce(m,d,i,this.contactForce);
        const force=Math.max(0,this.contactForce.GetView()[0])*Math.abs(ct.frame[2]);
        const foot=mj.mj_name2id(m,1,(owner===0?'left':'right')+'_foot');
        const local=new T.Vector3(ct.pos[0]-d.xpos[foot*3],ct.pos[1]-d.xpos[foot*3+1],ct.pos[2]-d.xpos[foot*3+2]).applyQuaternion(quaternion(d.xquat,foot*4).invert());
        soles[owner].pads[(local.y>-.03?0:2)+(local.x>0?0:1)]+=force;
      }finally{ct.delete();}}}finally{contacts.delete();}
      const weight=this.engine.totalMass*9.81;
      for(const sole of soles){sole.pads=sole.pads.map(f=>Math.max(0,f+this.noise(.025)));sole.force=sole.pads.reduce((a,b)=>a+b,0);
        sole.contact=sole.force>weight*.025;sole.flat=sole.pads[0]+sole.pads[1]>weight*.025&&sole.pads[2]+sole.pads[3]>weight*.025;}
      const direction=this.target.clone().sub(new T.Vector3().fromArray(d.xpos,this.head*3)).applyQuaternion(inverse);
      const retinal=[Math.atan2(direction.x,-direction.y)-eyes.yaw+this.noise(.0003),-Math.atan2(direction.z,Math.hypot(direction.x,direction.y))-eyes.pitch+this.noise(.0003)];
      const retinalEyes=this.engine.physicalEyes?['left','right'].map(side=>{
        const eye=mj.mj_name2id(m,1,side+'_eye');
        const direction=this.target.clone().sub(new T.Vector3().fromArray(d.xpos,eye*3)).applyQuaternion(quaternion(d.xquat,eye*4).invert());
        return [Math.atan2(direction.x,-direction.y)+this.noise(.0003),-Math.atan2(direction.z,Math.hypot(direction.x,direction.y))+this.noise(.0003)];
      }):undefined;
      const record:SensoryFrame={time};
      const packet=<V>(delay:number,value:V,uncertainty:number):Observation<V>=>({sampledAt:time,deliveredAt:time+delay*this.options.delayScale,value,uncertainty:uncertainty*this.options.noiseScale});
      if(this.options.proprioception)record.proprio=packet(.012,{q:this.engine.joints.map(j=>d.qpos[j.q]+this.noise(.00002)),v:this.engine.joints.map(j=>d.qvel[j.v]+this.noise(.0005))},.00002);
      if(this.options.vestibular)record.vestibular=packet(.006,{gyro:gyro.toArray().map((v,i)=>v+[.0003,-.0002,.0005][i]+this.noise(.0002)),specificForce:specific.toArray().map(v=>v+this.noise(.006))},.006);
      const visualPosition=Array.from(d.xpos.slice(this.head*3,this.head*3+3)) as number[];
      if(this.options.vision&&(this.lastVision<0||time-this.lastVision>=.0199)){this.lastVision=time;record.vision=packet(.06,{headPosition:visualPosition.map(v=>v+this.noise(.0003)),headQuaternion:new T.Quaternion().setFromEuler(new T.Euler(this.noise(.0002),this.noise(.0002),this.noise(.0002))).multiply(hq).toArray(),retinal,retinalEyes},.0003); }
      if(this.options.plantar)record.plantar=packet(.014,soles,.025);
      this.queue.push(record);this.queue=this.queue.filter(f=>time-f.time<.6);
      this.previousHead.copy(hq);this.previousVelocity.copy(velocity);this.initialized=true;this.last=time;
    }
    const out:SensoryFrame={time};
    for(const key of ['proprio','vestibular','plantar','vision'] as const){
      const enabled=key==='proprio'?this.options.proprioception:this.options[key];
      if(!enabled)continue;
      for(let i=this.queue.length-1;i>=0;i--){const p=this.queue[i][key];if(p&&p.deliveredAt<=time+1e-9){Object.assign(out,{[key]:p});break;}}
    }
    // Align angular-rate and joint-rate evidence before subtracting voluntary
    // neck/trunk motion. Unequal delays otherwise masquerade as root rotation.
    if(this.alignBodyRates&&out.proprio&&out.vestibular){
      for(let i=this.queue.length-1;i>=0;i--){const p=this.queue[i].vestibular;
        if(p&&p.deliveredAt<=time+1e-9&&p.sampledAt<=out.proprio.sampledAt+1e-9){out.vestibular=p;break;}
      }
    }
    return out;
  }
  dispose(){this.headJp.delete();this.headJr.delete();this.contactForce.delete();}
}
