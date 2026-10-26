import * as T from "three";
import type { MuJoCoEngine } from "../physics/MuJoCoEngine";
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
class TissueSpring {
  value=0; velocity=0;
  update(target:number,dt:number,frequency=10,damping=0.65) {
    const count=Math.max(1,Math.ceil(dt/0.008)),h=dt/count;
    for(let i=0;i<count;i++) {
      this.velocity+=(frequency*frequency*(target-this.value)-2*damping*frequency*this.velocity)*h;
      this.value+=this.velocity*h;
    }
    return clamp(this.value);
  }
  reset(){this.value=0;this.velocity=0;}
}
/** Shape keys never alter rigid-body qpos or collision geometry. */
export class CorrectiveSkin {
  enabled=true; softTissue=true;
  private meshes:T.SkinnedMesh[]=[];
  private last=0;
  private breath=new TissueSpring();
  private soft=[new TissueSpring(),new TissueSpring()];
  private joint=new Map<string,{q:number;v:number;actuator:number}>();
  private eyes:T.Bone[]=[];
  private head:number;
  private inverse=new T.Quaternion();
  private direction=new T.Vector3();
  constructor(readonly engine:MuJoCoEngine,scene:T.Object3D) {
    scene.traverse((o)=>{if(o instanceof T.SkinnedMesh&&o.morphTargetDictionary)this.meshes.push(o);});
    for(const j of engine.joints)this.joint.set(j.name,j);
    this.head=engine.mj.mj_name2id(engine.model,1,"head");
    for(const side of ["left","right"]) {const eye=scene.getObjectByName(`${side}_eye`);if(eye instanceof T.Bone)this.eyes.push(eye);}
  }
  update() {
    const d=this.engine.data;
    if(this.head>=0) {
      const b=this.head;
      this.inverse.set(d.xquat[b*4+1],d.xquat[b*4+2],d.xquat[b*4+3],d.xquat[b*4]).invert();
      for(const eye of this.eyes) {
        if(this.engine.physicalEyes)continue; // Bone pose already follows the simulated eye body.
        if(this.engine.sensoryEyes?.active){
          const {pitch,yaw}=this.engine.sensoryEyes;
          eye.quaternion.setFromEuler(new T.Euler(pitch,0,yaw,"ZXY"));continue;
        }
        if(!this.engine.gazeTarget){eye.quaternion.identity();continue;}
        this.direction.fromArray(this.engine.gazeTarget).sub(new T.Vector3().fromArray(d.xpos,b*3)).applyQuaternion(this.inverse).sub(eye.position);
        const yaw=Math.max(-0.45,Math.min(0.45,Math.atan2(this.direction.x,-this.direction.y)));
        const pitch=Math.max(-0.25,Math.min(0.25,-Math.atan2(this.direction.z,Math.hypot(this.direction.x,this.direction.y))));
        eye.quaternion.setFromEuler(new T.Euler(pitch,0,yaw,"ZXY"));
      }
    }
    if(d.time<this.last){this.breath.reset();this.soft.forEach((s)=>s.reset());}
    const dt=Math.max(0,Math.min(0.1,d.time-this.last));this.last=d.time;
    const angle=(name:string)=> {const j=this.joint.get(name);return j?d.qpos[j.q]:0;};
    const values:Record<string,number>={};
    for(const [i,side] of ["left","right"].entries()) {
      values[`${side}_shoulder_volume`]=clamp(Math.hypot(angle(`${side}_shoulder`),angle(`${side}_shoulder_flex`))/1.6);
      values[`${side}_elbow_volume`]=clamp(angle(`${side}_elbow`)/1.8);
      values[`${side}_knee_volume`]=clamp(angle(`${side}_knee`)/1.8);
      values[`${side}_palm_cup`]=clamp(["index","middle","ring","little"].reduce((s,f)=>s+angle(`${side}_${f}_1_flex`),0)/4.4);
      values[`${side}_thumb_web`]=clamp(angle(`${side}_thumb_opposition`)/1.8);
      values[`${side}_shoulder_forward`]=clamp(angle(`${side}_shoulder_flex`)/1.4);
      const wrist=angle(`${side}_wrist`);
      values[`${side}_wrist_flex`]=clamp(wrist/0.6);
      values[`${side}_wrist_extend`]=clamp(-wrist/0.6);
      values[`${side}_hip_flex`]=clamp(-angle(`${side}_hip`)/1.1);
      for(const finger of ["index","middle","ring","little"])
        values[`${side}_${finger}_knuckle`]=clamp(angle(`${side}_${finger}_1_flex`)/1.1);
      const j=this.joint.get(`${side}_elbow`);
      const load=j?Math.min(1,Math.abs(d.qfrc_actuator[j.v])/25+Math.abs(d.qvel[j.v])*0.08):0;
      values[`${side}_soft_tissue`]=this.softTissue?this.soft[i].update(load,dt):0;
    }
    values.breathing=this.softTissue?this.breath.update(0.5+0.5*Math.sin(d.time*Math.PI*2*0.22),dt,7,0.9):0;
    for(const mesh of this.meshes) {
      for(const [name,index] of Object.entries(mesh.morphTargetDictionary!))
        mesh.morphTargetInfluences![index]=(name==="breathing"||name.endsWith("_soft_tissue")?this.softTissue:this.enabled)?(values[name]??0):0;
    }
  }
}
