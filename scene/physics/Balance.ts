import type {MuJoCoEngine} from '../../character/src/physics/MuJoCoEngine';
export type Foot = {x:number;y:number;yaw:number};
export const clamp=(v:number,a:number)=>Math.max(-a,Math.min(a,v));
export const wrap=(v:number)=>Math.atan2(Math.sin(v),Math.cos(v));

// Desired contact wrenches are mapped to LEG ACTUATORS, never applied to the root.
export class Balance {
  private jp;private jr;private feet:number[];
  constructor(readonly engine:MuJoCoEngine){
    this.jp=new engine.mj.DoubleBuffer(3*engine.model.nv);this.jr=new engine.mj.DoubleBuffer(3*engine.model.nv);
    this.feet=['left','right'].map(s=>engine.mj.mj_name2id(engine.model,1,s+'_foot'));
  }
  apply(targets:Record<string,number>,root:Foot&{vx?:number;vy?:number;ax?:number;ay?:number;vyaw?:number},feet:Foot[],swing:number,lift:number){
    const {mj,model:m,data:d}=this.engine,mass=this.engine.totalMass;
    const [w,x,y,z]=Array.from(d.qpos.slice(3,7)) as number[];
    const cy=Math.cos(root.yaw/2),sy=Math.sin(root.yaw/2),sign=cy*w+sy*z<0?-1:1;
    const error=[-cy*x+sy*y,-cy*y-sy*x,sy*w-cy*z].map(v=>2*v*sign);
    // MuJoCo freejoint angular velocity is in the body's local frame.
    const R=[1-2*(y*y+z*z),2*(x*y-w*z),2*(x*z+w*y),2*(x*y+w*z),1-2*(x*x+z*z),2*(y*z-w*x),2*(x*z-w*y),2*(y*z+w*x),1-2*(x*x+y*y)];
    const omega=[0,1,2].map(i=>R[i*3]*d.qvel[3]+R[i*3+1]*d.qvel[4]+R[i*3+2]*d.qvel[5]);
    const F=[mass*clamp((root.ax??0)+30*(root.x-d.qpos[0])+10*((root.vx??0)-d.qvel[0]),3),mass*clamp((root.ay??0)+30*(root.y-d.qpos[1])+10*((root.vy??0)-d.qvel[1]),3),mass*(9.81+clamp(100*(.925-d.qpos[2])-20*d.qvel[2],5))];
    const com=d.subtree_com,moments=error.map((v,i)=>600*v+80*((i===2?root.vyaw??0:0)-omega[i]));
    moments[0]+=(com[4]-d.qpos[1])*F[2]-(com[5]-d.qpos[2])*F[1];
    moments[1]+=(com[5]-d.qpos[2])*F[0]-(com[3]-d.qpos[0])*F[2];
    moments[2]+=(com[3]-d.qpos[0])*F[1]-(com[4]-d.qpos[1])*F[0];
    const dx=feet[0].x-feet[1].x,dy=feet[0].y-feet[1].y;
    let weight=Math.max(0,Math.min(1,((root.x-feet[1].x)*dx+(root.y-feet[1].y)*dy)/(dx*dx+dy*dy)));
    const weights=[weight,1-weight];if(lift>.001){weights[swing]=0;weights[1-swing]=1;}
    this.feet.forEach((foot,i)=>{
      mj.mj_jacBody(m,d,this.jp,this.jr,foot);const jp=this.jp.GetView(),jr=this.jr.GetView(),nv=m.nv;
      const f=F.map(v=>v*weights[i]),r=[d.xpos[foot*3]-d.qpos[0],d.xpos[foot*3+1]-d.qpos[1],d.xpos[foot*3+2]-d.qpos[2]];
      const cross=[r[1]*f[2]-r[2]*f[1],r[2]*f[0]-r[0]*f[2],r[0]*f[1]-r[1]*f[0]];
      const torque=moments.map((v,k)=>v*weights[i]-cross[k]),c=Math.cos(feet[i].yaw),s=Math.sin(feet[i].yaw);
      const tx=clamp(c*torque[0]+s*torque[1],f[2]*.12),ty=clamp(-s*torque[0]+c*torque[1],f[2]*.06);
      const tw=[c*tx-s*ty,s*tx+c*ty,clamp(torque[2],f[2]*.05)];
      for(const j of this.engine.joints){
        if(!j.name.startsWith(i===0?'left_':'right_')||!/(hip|knee|ankle)/.test(j.name))continue;
        let tau=d.qfrc_bias[j.v];for(let k=0;k<3;k++)tau-=jp[k*nv+j.v]*f[k]+jr[k*nv+j.v]*tw[k];
        targets[j.name]+=tau/m.actuator_gainprm[j.actuator*10];
      }
    });
  }
  dispose(){this.jp.delete();this.jr.delete();}
}
