import type { MuJoCoEngine } from "../physics/MuJoCoEngine";
import type { LocomotionSensors } from "./LocomotionSensors";
export interface RootReference { x:number; y:number; z?:number; vx?:number; vy?:number; vz?:number; ax?:number; ay?:number; az?:number; roll?:number; pitch?:number; yaw?:number; groundWrench?:boolean }
export class BalanceController {
  private jp;
  private jr;
  private feet: number[];
  private inertia;
  private acceleration:number[];
  private rootBody:number;
  readonly residual = { force: 0, torque: 0 };
  readonly wrenches = [Array(6).fill(0) as number[], Array(6).fill(0) as number[]];
  constructor(readonly engine: MuJoCoEngine,private state?:()=>MuJoCoEngine["data"]) {
    const { mj, model: m } = engine;
    this.jp = new mj.DoubleBuffer(3 * m.nv);
    this.jr = new mj.DoubleBuffer(3 * m.nv);
    this.inertia=new mj.DoubleBuffer(m.nv);this.acceleration=Array(m.nv).fill(0);
    this.rootBody=mj.mj_name2id(m,1,"pelvis");
    this.feet = ["left", "right"].map((s) => mj.mj_name2id(m, 1, s + "_foot"));
  }
  apply(
    targets: Record<string, number>,
    root: RootReference,
    swing: number,
    lift: number,
    sensors?: Pick<LocomotionSensors,"feet">,
    jointAccelerations?:Record<string,number>,
  ) {
    const { mj, model: m } = this.engine;
    const d=this.state?.()??this.engine.data;
    const mass = this.engine.totalMass;
    const [w, x, y, z] = Array.from(d.qpos.slice(3, 7)) as number[];
    const angles = [
      Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)),
      Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - z * x)))),
      Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)),
    ];
    const clamp = (v: number, a: number) => Math.max(-a, Math.min(a, v));
    const F = [
      mass * clamp((root.ax??0)+30 * (root.x - d.qpos[0]) + 10 * ((root.vx??0)-d.qvel[0]), 3),
      mass * clamp((root.ay??0)+30 * (root.y - d.qpos[1]) + 10 * ((root.vy??0)-d.qvel[1]), 3),
      mass * (9.81 + clamp((root.az??0)+100 * ((root.z??.925) - d.qpos[2]) + 20 * ((root.vz??0)-d.qvel[2]), 5)),
    ];
    const com = d.subtree_com;
    const desiredAngles=[root.roll??0,root.pitch??0,root.yaw??0];
    const moments = angles.map((a, i) => 600 * (desiredAngles[i]-a) - 80 * d.qvel[3 + i]);
    moments[0] += (com[4] - d.qpos[1]) * F[2] - (com[5] - d.qpos[2]) * F[1];
    moments[1] += (com[5] - d.qpos[2]) * F[0] - (com[3] - d.qpos[0]) * F[2];
    moments[2] += (com[3] - d.qpos[0]) * F[1] - (com[4] - d.qpos[1]) * F[0];
    let inertial:Float64Array|undefined;
    if(jointAccelerations){
      this.acceleration.fill(0);
      for(let i=0;i<3;i++)this.acceleration[i]=F[i]/mass-(i===2?9.81:0);
      for(const j of this.engine.joints)this.acceleration[j.v]=jointAccelerations[j.name]??0;
      mj.mj_mulM(m,d,this.inertia,this.acceleration);
      inertial=this.inertia.GetView();
      for(let i=0;i<3;i++)F[i]=inertial![i]+d.qfrc_bias[i];
      const r=d.xmat,k=this.rootBody*9;
      for(let i=0;i<3;i++){
        let dynamicMoment=0,angularVelocity=0;
        for(let a=0;a<3;a++){
          dynamicMoment+=r[k+i*3+a]*(inertial![3+a]+d.qfrc_bias[3+a]);
          angularVelocity+=r[k+i*3+a]*d.qvel[3+a];
        }
        moments[i]=dynamicMoment+600*(desiredAngles[i]-angles[i])-80*angularVelocity;
      }
    }
    let weights = [Math.max(0, Math.min(1, 0.5 + root.x / 0.2)), 0];
    if(root.groundWrench){
      const left=d.xpos[this.feet[0]*3],right=d.xpos[this.feet[1]*3];
      weights[0]=Math.max(0,Math.min(1,(root.x-right)/Math.max(.08,left-right)));
    }
    weights[1] = 1 - weights[0];
    if (lift > 0.001) {
      weights[swing] = 0;
      weights[1 - swing] = 1;
    }
    const arms=this.feet.map(foot=>[d.xpos[foot*3]-d.qpos[0],d.xpos[foot*3+1]-d.qpos[1],d.xpos[foot*3+2]-d.qpos[2]]);
    // Minimise centroidal wrench error subject to unilateral contact, friction
    // pyramids and centre-of-pressure bounds. This allocates joint torques;
    // it never applies forces to the root or edits a body pose.
    const active=this.feet.map((_,i)=>(lift>.001&&i===swing)?false:!sensors||sensors.feet[i].contact);
    if(sensors && sensors.feet.every(foot=>foot.force<1) && d.time<.05) active.fill(true);
    const A=Array.from({length:6},()=>Array(12).fill(0));
    const nominal=Array(12).fill(0);
    arms.forEach((r,i)=>{
      const k=i*6;for(let a=0;a<3;a++){A[a][k+a]=1;A[a+3][k+a+3]=1;}
      A[3][k+1]=-r[2];A[3][k+2]=r[1];A[4][k]=r[2];A[4][k+2]=-r[0];A[5][k]=-r[1];A[5][k+1]=r[0];
      const force=F.map(v=>v*weights[i]);
      const cross=[r[1]*force[2]-r[2]*force[1],r[2]*force[0]-r[0]*force[2],r[0]*force[1]-r[1]*force[0]];
      force.forEach((v,a)=>{nominal[k+a]=v;nominal[k+3+a]=clamp(moments[a]*weights[i]-cross[a],force[2]*[.11,.055,.04][a]);});
    });
    const desired=[...F,...moments],solution=nominal.slice();
    for(let iteration=0;iteration<32;iteration++) {
      const error=A.map((row,i)=>row.reduce((s,v,k)=>s+v*solution[k],-desired[i]));
      const gradient=solution.map((value,k)=>A.reduce((s,row,i)=>s+row[k]*error[i],.025*(value-nominal[k])));
      for(let k=0;k<12;k++)solution[k]-=.12*gradient[k];
      for(let i=0;i<2;i++) {
        const k=i*6;if(!active[i]){solution.fill(0,k,k+6);continue;}
        const fz=solution[k+2]=Math.max(0,Math.min(mass*9.81*1.8,solution[k+2]));
        solution[k]=clamp(solution[k],.7*fz);solution[k+1]=clamp(solution[k+1],.7*fz);
        if(root.groundWrench) {
          // Wrenches are expressed at the ankle body, not on the ground.
          // tau = [copY*fz + height*fy, -copX*fz - height*fx, tauZ].
          const height=d.xpos[this.feet[i]*3+2];
          solution[k+3]=height*solution[k+1]+Math.max(-.195*fz,Math.min(.09*fz,solution[k+3]-height*solution[k+1]));
          solution[k+4]=-height*solution[k]+clamp(solution[k+4]+height*solution[k],.065*fz);
          solution[k+5]=clamp(solution[k+5],.08*fz);
        } else for(let a=0;a<3;a++)solution[k+3+a]=clamp(solution[k+3+a],[.11,.055,.04][a]*fz);
      }
    }
    const residual=A.map((row,i)=>row.reduce((s,v,k)=>s+v*solution[k],-desired[i]));
    this.residual.force=Math.hypot(...residual.slice(0,3));this.residual.torque=Math.hypot(...residual.slice(3));
    this.feet.forEach((foot, i) => {
      mj.mj_jacBody(m, d, this.jp, this.jr, foot);
      const jp = this.jp.GetView(),
        jr = this.jr.GetView(),
        nv = m.nv;
      const force = solution.slice(i*6,i*6+3),torque=solution.slice(i*6+3,i*6+6);
      this.wrenches[i]=[...force,...torque];
      const side = i === 0 ? "left" : "right";
      for (const j of this.engine.joints) {
        if (!j.name.startsWith(side + "_") || !/(hip|knee|ankle)/.test(j.name))
          continue;
        let tau = d.qfrc_bias[j.v]+(inertial?.[j.v]??0);
        for (let k = 0; k < 3; k++)
          tau -= jp[k * nv + j.v] * force[k] + jr[k * nv + j.v] * torque[k];
        targets[j.name] += tau / m.actuator_gainprm[j.actuator*10];
      }
    });
  }
  dispose() {
    this.jp.delete();
    this.jr.delete();
    this.inertia.delete();
  }
}
