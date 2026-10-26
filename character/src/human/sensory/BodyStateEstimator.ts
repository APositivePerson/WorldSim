import * as T from 'three';
import {ContactEstimator} from './ContactEstimator';
import type {MuJoCoEngine} from '../../physics/MuJoCoEngine';
import type {SensoryFrame} from './SensoryInterface';
const qread=(a:ArrayLike<number>,k:number)=>new T.Quaternion(a[k+1],a[k+2],a[k+3],a[k]);
const write=(a:Float64Array,q:T.Quaternion)=>{a[3]=q.w;a[4]=q.x;a[5]=q.y;a[6]=q.z;};
const clamp=(x:number,l:number)=>Math.max(-l,Math.min(l,x));
/** Stance odometry on a calibrated horizontal floor, fused with head inertial
 * and delayed landmark observations. No access to live MjData is permitted. */
export class BodyStateEstimator {
  readonly data;
  readonly anchors:T.Vector3[]=[];
  readonly bias=[0,0,0];
  readonly quality={position:0,orientation:0,available:0,stableTime:0,biasUpdates:0,rejected:0};
  private head:number;
  private feet:number[];
  private soleGeoms:number[][];
  private jac;
  private last=-1;
  private cooldown=0;
  private lastBiasSample=-1;
  locomoting=false;
  dynamic=false;
  readonly contactEstimate=new ContactEstimator();
  readonly contacts=[false,false];
  readonly touchdownCount=[0,0];
  private lastVisual=-1;
  private history:{time:number;position:T.Vector3;head:T.Vector3;orientation:T.Quaternion;relativeHead:T.Quaternion}[]=[];
  private observations:SensoryFrame={time:0};
  constructor(private modelAccess:Pick<MuJoCoEngine,'mj'|'model'|'joints'|'totalMass'>){
    const {mj,model:m}=modelAccess;this.data=new mj.MjData(m);this.jac=new mj.DoubleBuffer(m.nv*3);
    this.head=mj.mj_name2id(m,1,'head');this.feet=['left','right'].map(s=>mj.mj_name2id(m,1,s+'_foot'));
    this.soleGeoms=this.feet.map(foot=>Array.from({length:m.ngeom},(_,g)=>g).filter(g=>{
      let b=m.geom_bodyid[g];while(b&&b!==foot)b=m.body_parentid[b];return b===foot&&m.geom_type[g]===6;
    }));this.reset();
  }
  reset(){
    const {mj,model:m}=this.modelAccess;
    if(m.nkey)mj.mj_resetDataKeyframe(m,this.data,0);else mj.mj_resetData(m,this.data);
    mj.mj_forward(m,this.data);this.anchors.splice(0,2,...this.feet.map(b=>new T.Vector3().fromArray(this.data.xpos,b*3)));
    this.contactEstimate.reset();this.lastVisual=-1;this.history=[];this.dynamic=false;this.locomoting=false;this.contacts.fill(false);this.touchdownCount.fill(0);
    this.observations={time:0};this.bias.fill(0);this.last=-1;this.cooldown=0;this.lastBiasSample=-1;
    Object.assign(this.quality,{position:0,orientation:0,available:0,stableTime:0,biasUpdates:0,rejected:0});
  }
  update(frame:SensoryFrame){
    if(this.last>=0&&frame.time-this.last<.0099)return;
    const dt=this.last<0?.01:Math.min(.04,frame.time-this.last);this.last=frame.time;this.observations=frame;
    const {mj,model:m,joints}=this.modelAccess,d=this.data;
    const oldVelocity=new T.Vector3().fromArray(d.qvel,0);
    const oldPosition=new T.Vector3().fromArray(d.qpos,0),oldQuaternion=qread(d.qpos,3);
    const proprio=frame.proprio?.value,vest=frame.vestibular?.value,soles=frame.plantar?.value,vision=frame.vision?.value;
    if(proprio){const age=Math.min(.04,frame.time-frame.proprio!.sampledAt);
      joints.forEach((j,i)=>{d.qpos[j.q]=Math.max(j.min,Math.min(j.max,proprio.q[i]+proprio.v[i]*age));d.qvel[j.v]=proprio.v[i];});}
    this.contactEstimate.update(soles,frame.plantar?.sampledAt??frame.time,this.modelAccess.totalMass*9.81);
    mj.mj_forward(m,d);
    this.feet.forEach((b,i)=>{
      if(this.contactEstimate.feet[i].contact&&!this.contacts[i]&&this.dynamic){
        this.anchors[i].fromArray(d.xpos,b*3);this.touchdownCount[i]++;
      }
      this.contacts[i]=this.contactEstimate.feet[i].contact;
    });
    const head=qread(d.xquat,this.head*4),gyro=new T.Vector3(...(vest?.gyro??[0,0,0])).sub(new T.Vector3(...this.bias));
    const rootOmega=gyro.clone().applyQuaternion(head);
    mj.mj_jacBody(m,d,null,this.jac,this.head);
    const jr=this.jac.GetView();
    for(let a=0;a<3;a++){let jointRate=0;for(const j of joints)jointRate+=jr[a*m.nv+j.v]*d.qvel[j.v];rootOmega.setComponent(a,rootOmega.getComponent(a)-jointRate);}
    const predicted=oldQuaternion.clone(),rate=rootOmega.length();
    if(vest&&rate>1e-10)predicted.premultiply(new T.Quaternion().setFromAxisAngle(rootOmega.clone().normalize(),rate*dt));
    // Compute relative limb/head transforms using only the estimated joints.
    write(d.qpos,new T.Quaternion());d.qpos[0]=d.qpos[1]=d.qpos[2]=0;mj.mj_kinematics(m,d);
    const relativeHead=qread(d.xquat,this.head*4);
    const past=frame.vision?this.history.reduce<typeof this.history[number]|undefined>((best,h)=>
      !best||Math.abs(h.time-frame.vision!.sampledAt)<Math.abs(best.time-frame.vision!.sampledAt)?h:best,undefined):undefined;
    const flat=proprio&&soles?this.feet.map((b,i)=>soles[i].contact&&soles[i].flat?qread(d.xquat,b*4).invert():null):[];
    const candidates=flat.filter((q):q is T.Quaternion=>q!==null);
    let orientation=predicted;
    if(candidates.length&&!this.dynamic){let fused=candidates[0].clone();if(candidates.length===2)fused.slerp(candidates[1],.5);orientation.slerp(fused,this.touchdownCount.some(n=>n>0)?.2:.75);}
    if(vision){
      const visualHead=new T.Quaternion().fromArray(vision.headQuaternion);
      if(vest&&gyro.length()>1e-9)visualHead.multiply(new T.Quaternion().setFromAxisAngle(gyro.clone().normalize(),gyro.length()*Math.min(.15,frame.time-frame.vision!.sampledAt)));
      if(this.dynamic&&past){
        if(frame.vision!.sampledAt>this.lastVisual){
          const measured=new T.Quaternion().fromArray(vision.headQuaternion).multiply(past.relativeHead.clone().invert());
          const correction=measured.multiply(past.orientation.clone().invert());
          const applied=new T.Quaternion().slerp(correction.normalize(),.65).normalize();
          orientation.premultiply(applied);
          for(const h of this.history){h.orientation.premultiply(applied).normalize();h.head.applyQuaternion(applied);}
        }
      }else orientation.slerp(visualHead.multiply(relativeHead.clone().invert()),candidates.length?.025:.4);
    }
    const specific=new T.Vector3(...(vest?.specificForce??[0,0,9.81]));
    const predictedHead=orientation.clone().multiply(relativeHead);
    const acceleration=specific.clone().applyQuaternion(predictedHead).sub(new T.Vector3(0,0,9.81));
    if(vest&&Math.abs(specific.length()-9.81)<.05){
      const correction=new T.Quaternion().setFromUnitVectors(specific.clone().normalize().applyQuaternion(predictedHead),new T.Vector3(0,0,1));
      orientation.premultiply(new T.Quaternion().slerp(correction,candidates.length?.002:.025));
    }
    orientation.normalize();write(d.qpos,orientation);mj.mj_kinematics(m,d);
    const position=new T.Vector3(),headRelative=new T.Vector3().fromArray(d.xpos,this.head*3);let total=0;
    if(proprio&&soles)this.feet.forEach((b,i)=>{if(!soles[i].contact)return;
      if(this.dynamic&&this.soleGeoms[i].length){
        // Known horizontal floor, using the estimated foot/toe geometry only.
        const bottom=Math.min(...this.soleGeoms[i].map(g=>d.geom_xpos[g*3+2]-
          [0,1,2].reduce((sum,k)=>sum+Math.abs(d.geom_xmat[g*9+6+k])*m.geom_size[g*3+k],0)));
        this.anchors[i].z=d.xpos[b*3+2]-bottom;
      }
      const weight=soles[i].force;
      position.addScaledVector(this.anchors[i].clone().sub(new T.Vector3().fromArray(d.xpos,b*3)),weight);total+=weight;});
    if(total>1)position.divideScalar(total);else position.copy(oldPosition).addScaledVector(new T.Vector3().fromArray(d.qvel,0),dt);
    if(vision){
      if(this.dynamic&&past){
        if(frame.vision!.sampledAt>this.lastVisual){
          const correction=new T.Vector3().fromArray(vision.headPosition).sub(past.head).sub(past.position).multiplyScalar(.65);
          if(total>1)correction.z=0;
          position.add(correction);oldPosition.add(correction);
          this.anchors.forEach(a=>a.add(correction));this.history.forEach(h=>h.position.add(correction));
          this.lastVisual=frame.vision!.sampledAt;
        }
      }else{
        const visualPosition=new T.Vector3().fromArray(vision.headPosition).sub(headRelative)
          .addScaledVector(new T.Vector3().fromArray(d.qvel,0),Math.min(.15,frame.time-frame.vision!.sampledAt));
        position.lerp(visualPosition,total>1?.015:.4);
      }
    }
    position.lerp(oldPosition,.15);d.qpos[0]=position.x;d.qpos[1]=position.y;d.qpos[2]=position.z;
    for(let i=0;i<3;i++)d.qvel[i]=d.qvel[i]*.35+clamp((position.getComponent(i)-oldPosition.getComponent(i))/dt,1)*.65;
    const dq=oldQuaternion.clone().invert().multiply(orientation);if(dq.w<0)dq.set(-dq.x,-dq.y,-dq.z,-dq.w);
    const rotation=new T.Vector3(dq.x,dq.y,dq.z),angle=2*Math.atan2(rotation.length(),dq.w);
    if(rotation.length()>1e-10)rotation.normalize().multiplyScalar(angle/dt);
    const angularAlpha=!this.dynamic&&this.touchdownCount.some(n=>n>0)?.15:.65;
    for(let i=0;i<3;i++)d.qvel[3+i]=d.qvel[3+i]*(1-angularAlpha)+clamp(rotation.getComponent(i),2)*angularAlpha;
    const gaitFeedback=this.dynamic||this.touchdownCount.some(n=>n>0);
    d.time=frame.time;mj.mj_forward(m,d);
    if(proprio&&soles&&gaitFeedback){
      const velocity=new T.Vector3();let load=0;
      this.feet.forEach((b,i)=>{
        if(!this.contacts[i])return;
        mj.mj_jacBody(m,d,this.jac,null,b);const jac=this.jac.GetView(),weight=soles[i].force;
        for(let a=0;a<3;a++){
          let relative=0;for(let v=3;v<m.nv;v++)relative+=jac[a*m.nv+v]*d.qvel[v];
          velocity.setComponent(a,velocity.getComponent(a)-relative*weight);
        }
        load+=weight;
      });
      if(load>1){velocity.divideScalar(load);for(let i=0;i<3;i++)d.qvel[i]=this.dynamic?clamp(velocity.getComponent(i),1.5):oldVelocity.getComponent(i)*.85+clamp(velocity.getComponent(i),1.5)*.15;}
      mj.mj_forward(m,d);
    }
    this.history.push({time:frame.time,position:new T.Vector3().fromArray(d.qpos),head:new T.Vector3().fromArray(d.xpos,this.head*3).sub(new T.Vector3().fromArray(d.qpos)),orientation:orientation.clone(),relativeHead:relativeHead.clone()});
    this.history=this.history.filter(h=>frame.time-h.time<.6);
    const available=[proprio,vest,soles,vision].filter(Boolean).length;
    this.quality.available=available;
    this.quality.position=this.dynamic?(vision?.02:Math.min(1,this.quality.position+dt*.04)):total>1?.001+(frame.proprio?.uncertainty??0)*4:vision?.006+frame.vision!.uncertainty*3:Math.min(1,this.quality.position+dt*.05);
    this.quality.orientation=this.dynamic?(vision?.01:Math.min(1,this.quality.orientation+dt*.005)):candidates.length?.002+(frame.proprio?.uncertainty??0)*8:vision?.005+frame.vision!.uncertainty*3:Math.min(1,this.quality.orientation+dt*.01);
    // Zero-rate calibration only. Transient acceleration/motion quarantines
    // sensor-bias updates; this phase never learns a persistent leg correction.
    const moving=this.locomoting||acceleration.length()>.18||new T.Vector3().fromArray(d.qvel,0).length()>.012
      ||Math.hypot(...Array.from(d.qvel.slice(3,6)) as number[])>.02||joints.some(j=>Math.abs(d.qvel[j.v])>.035);
    if(moving||!proprio||!vest||!soles?.every(s=>s.flat)){this.cooldown=1.5;this.quality.stableTime=0;this.quality.rejected++;}
    else {this.cooldown=Math.max(0,this.cooldown-dt);this.quality.stableTime+=dt;}
    if(vest&&this.cooldown===0&&this.quality.stableTime>2&&frame.vestibular!.sampledAt>this.lastBiasSample){
      vest.gyro.forEach((v,i)=>this.bias[i]+= .002*(clamp(v,.003)-this.bias[i]));this.quality.biasUpdates++;this.lastBiasSample=frame.vestibular!.sampledAt;
    }
  }
  snapshot(){return {position:Array.from(this.data.qpos.slice(0,3)),quaternion:Array.from(this.data.qpos.slice(3,7)),velocity:Array.from(this.data.qvel.slice(0,6)),
    contacts:this.contacts.slice(),contactEstimate:this.contactEstimate.feet.map(f=>({...f})),touchdowns:this.touchdownCount.slice(),anchors:this.anchors.map(p=>p.toArray()),uncertainty:{...this.quality},gyroBias:this.bias.slice(),channels:Object.fromEntries((['proprio','vestibular','plantar','vision'] as const).map(k=>[k,this.observations[k]?{sampledAt:this.observations[k]!.sampledAt,age:this.observations.time-this.observations[k]!.sampledAt}:null]))};}
  dispose(){this.data.delete();this.jac.delete();}
}
