import * as T from 'three';
import type {MuJoCoEngine} from '../../character/src/physics/MuJoCoEngine';
import type {LocomotionSensors} from '../../character/src/human/LocomotionSensors';
import {NaturalWalking,type WalkingObservations} from '../../character/src/human/NaturalWalking';
import {WalkingCerebellum} from '../../character/src/human/WalkingCerebellum';

/** Run upstream's forward gait in a fixed heading frame. Only scratch data is
 * rotated; joint commands are frame invariant and drive the real body. */
export class NaturalGait {
  private data;
  private bias;
  private heading=0;
  private rotation=new T.Quaternion();
  private quaternion=new T.Quaternion();
  private observed:{-readonly [K in keyof WalkingObservations]:WalkingObservations[K]};
  readonly gait:NaturalWalking;
  readonly learning=new WalkingCerebellum();
  constructor(private engine:MuJoCoEngine,private sensors:LocomotionSensors){
    this.data=new engine.mj.MjData(engine.model);
    this.bias=new engine.mj.DoubleBuffer(engine.model.nv);
    const local=Object.create(engine) as MuJoCoEngine;
    Object.defineProperty(local,'data',{value:this.data});
    this.observed={feet:[],com:{x:0,y:0,z:0},velocity:{x:0,y:0,z:0},capture:{x:0,y:0}} as unknown as WalkingObservations;
    this.gait=new NaturalWalking(local,this.observed,undefined,this.learning);
  }
  private point(p:{x:number;y:number}){const c=Math.cos(this.heading),s=Math.sin(this.heading);return{x:c*p.x+s*p.y,y:-s*p.x+c*p.y};}
  world(p:{x:number;y:number}){const c=Math.cos(this.heading),s=Math.sin(this.heading);return{x:c*p.x-s*p.y,y:s*p.x+c*p.y};}
  private sample(){
    const e=this.engine,d=this.data,live=e.data;
    d.qpos.set(live.qpos);d.qvel.set(live.qvel);d.time=live.time;
    const p=this.point({x:live.qpos[0],y:live.qpos[1]}),v=this.point({x:live.qvel[0],y:live.qvel[1]});
    d.qpos[0]=p.x;d.qpos[1]=p.y;d.qvel[0]=v.x;d.qvel[1]=v.y;
    const q=this.quaternion.set(live.qpos[4],live.qpos[5],live.qpos[6],live.qpos[3]).premultiply(this.rotation);
    d.qpos[3]=q.w;d.qpos[4]=q.x;d.qpos[5]=q.y;d.qpos[6]=q.z;
    // This scratch state supplies only kinematics, mass and velocity bias.
    // Do not repeat collision, tendon, actuator and constraint construction.
    e.mj.mj_kinematics(e.model,d);e.mj.mj_comPos(e.model,d);
    e.mj.mj_crb(e.model,d);e.mj.mj_comVel(e.model,d);
    e.mj.mj_rne(e.model,d,0,this.bias);d.qfrc_bias.set(this.bias.GetView());
    this.observed.feet=this.sensors.feet.map(f=>({...f,...this.point(f),pressure:this.point(f.pressure)}));
    this.observed.com={...this.sensors.com,...this.point(this.sensors.com)};
    this.observed.velocity={...this.sensors.velocity,...this.point(this.sensors.velocity)};
    this.observed.capture={...this.sensors.capture,...this.point(this.sensors.capture)};
  }
  begin(heading:number){this.heading=heading;this.rotation.setFromAxisAngle(new T.Vector3(0,0,1),-heading);this.sample();this.gait.coordinator.reset();this.gait.begin();}
  update(dt:number,speed:number,stopping:boolean,strength=1){this.sample();return this.gait.update(dt,speed,stopping,strength);}
  dispose(){this.gait.dispose();this.bias.delete();this.data.delete();}
}
