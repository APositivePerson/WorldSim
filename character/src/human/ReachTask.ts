import type { MuJoCoEngine, Joint } from "../physics/MuJoCoEngine";
import type { MjData } from "@mujoco/mujoco";
import type { Side } from "./Anatomy";
const smooth=(x:number)=> { x=Math.max(0,Math.min(1,x));return x*x*(3-2*x); };
export class ReachTask {
  active=false; side:Side="right"; error=0; progress=0;
  target:[number,number,number]=[0,0,0];
  private normalStart=[0,-1,0];
  private normalEnd=[0,0,1];
  private directionStart=[0,0,-1];
  private directionEnd:number[]|null=null;
  private start=[0,0,0]; private duration=2; private elapsed=0;
  private relative=false; private offset=[0,0,0]; private rootStart=[0,0,0];
  private data:MjData|null=null; private joints:Joint[]=[]; private hand=0; private last:Record<string,number>={}; private counter=0;
  constructor(readonly engine:MuJoCoEngine){}
  canReach(side: Side, target: readonly number[]) {
    const { data, model, mj } = this.engine;
    const shoulder = mj.mj_name2id(model, 1, `${side}_upper_arm`);
    return shoulder >= 0 && target.length === 3 && target.every(Number.isFinite)
      && Math.hypot(...target.map((v, i) => v - data.xpos[shoulder * 3 + i])) <= 0.57;
  }
  begin(side:Side,duration:number,world?:[number,number,number],frame?:{normal:[number,number,number];direction:[number,number,number]}) {
    const {data:d,model:m,mj}=this.engine;
    if(world!==undefined&&(!Array.isArray(world)||world.length!==3||world.some((v)=>typeof v!=="number"||!Number.isFinite(v))))return false;
    this.side=side;this.duration=duration;this.elapsed=0;this.progress=0;this.counter=0;this.last={};
    this.hand=mj.mj_name2id(m,1,`${side}_hand`);
    const root=Array.from(d.xpos.slice(3,6)) as number[];
    this.rootStart=root;this.start=this.point(d);this.normalStart=[-d.xmat[this.hand*9+1],-d.xmat[this.hand*9+4],-d.xmat[this.hand*9+7]];
    this.normalEnd=frame?.normal??[0,0,1]; this.directionEnd=frame?.direction??null;
    this.directionStart=[-d.xmat[this.hand*9+2],-d.xmat[this.hand*9+5],-d.xmat[this.hand*9+8]];
    this.relative=!world;this.offset=[side==="left"?0.23:-0.23,-0.30,0.28];
    this.target=world??this.offset.map((v,i)=>v+root[i]) as [number,number,number];
    if(this.target.some((v)=>!Number.isFinite(v)))return false;
    if(!this.canReach(side,this.target))return false;
    this.joints=["scapula_elevation","scapula_protraction","shoulder","shoulder_flex","shoulder_rotation","elbow","forearm_rotation","wrist","wrist_deviation"]
      .map((n)=>this.engine.joints.find((j)=>j.name===`${side}_${n}`)!);
    this.data??=new this.engine.mj.MjData(m);
    this.active=true;return true;
  }
  private point(d:MjData) {
    const b=this.hand,k=b*9;
    return [0,1,2].map((i)=>d.xpos[b*3+i]-0.01*d.xmat[k+i*3+1]-0.035*d.xmat[k+i*3+2]);
  }
  palmPosition(){return this.point(this.engine.data) as [number,number,number];}
  cancel(){this.active=false;this.last={};}
  owns(name:string){return this.active&&(this.joints.some((j)=>j.name===name)||["spine_flex","chest_flex","neck_pitch"].includes(name));}
  update(dt:number):Record<string,number> {
    if(!this.active)return {};
    const {data:live,model:m,mj}=this.engine,d=this.data!;
    this.elapsed+=dt;this.progress=Math.min(1,this.elapsed/this.duration);
    if(this.relative) this.target=this.offset.map((v,i)=>v+live.xpos[3+i]) as [number,number,number];
    const s=smooth(this.progress),rootShift=this.relative?this.target.map((_,i)=>live.xpos[3+i]-this.rootStart[i]):[0,0,0];
    const target=this.target.map((v,i)=>this.start[i]+rootShift[i]+(v-this.start[i]-rootShift[i])*s);
    this.error=Math.hypot(...this.target.map((v,i)=>v-this.point(live)[i]));
    if(this.counter++%10!==0)return this.last;
    d.qpos.set(live.qpos);
    for(const j of this.joints)d.qpos[j.q]=this.last[j.name]??live.qpos[j.q];
    const mix=(start:number[],end:number[])=>{
      const v=start.map((x,i)=>x*(1-s)+end[i]*s), length=Math.hypot(...v);
      return (length<1e-6?end:v.map((x)=>x/length)).map((x)=>x*0.06);
    };
    const desired=[...target,...mix(this.normalStart,this.normalEnd),...(this.directionEnd?mix(this.directionStart,this.directionEnd):[])];
    const dimensions=desired.length;
    const read=()=> {mj.mj_kinematics(m,d);const k=this.hand*9;return [...this.point(d),-d.xmat[k+1]*0.06,-d.xmat[k+4]*0.06,-d.xmat[k+7]*0.06,...(this.directionEnd?[-d.xmat[k+2]*0.06,-d.xmat[k+5]*0.06,-d.xmat[k+8]*0.06]:[])];};
    for(let it=0;it<7;it++) {
      const p=read(),e=desired.map((v,i)=>v-p[i]);if(Math.hypot(...e)<0.001)break;
      const columns=this.joints.map((j)=> {
        d.qpos[j.q]+=1e-5;const after=read();d.qpos[j.q]-=1e-5;
        return after.map((v,i)=>(v-p[i])/1e-5);
      });
      const a=Array.from({length:dimensions},(_,r)=>Array.from({length:dimensions},(_,c)=>columns.reduce((sum,col)=>sum+col[r]*col[c],r===c?0.0002:0)));
      const b=e.slice();
      for(let pivot=0;pivot<dimensions;pivot++) {
        const divisor=a[pivot][pivot];for(let c=pivot;c<dimensions;c++)a[pivot][c]/=divisor;b[pivot]/=divisor;
        for(let r=0;r<dimensions;r++)if(r!==pivot){const v=a[r][pivot];for(let c=pivot;c<dimensions;c++)a[r][c]-=v*a[pivot][c];b[r]-=v*b[pivot];}
      }
      this.joints.forEach((j,i)=> {
        const delta=columns[i].reduce((sum,v,k)=>sum+v*b[k],0);
        // Keep shoulder-girdle motion modest; shoulder/elbow supply most reach.
        const scale=j.name.includes("scapula")?0.35:j.name.includes("wrist")?0.6:1;
        // The default forward reach must keep the upper arm outside the ribcage.
        // From inward-facing resting palms, unconstrained IK can otherwise fold
        // the shoulder through the torso and stall against physical collisions.
        const shoulder = this.relative && j.name === `${this.side}_shoulder`;
        const min = shoulder && this.side === "right" ? Math.max(0,j.min) : j.min;
        const max = shoulder && this.side === "left" ? Math.min(0,j.max) : j.max;
        d.qpos[j.q]=Math.max(min,Math.min(max,d.qpos[j.q]+Math.max(-0.1,Math.min(0.1,delta*scale))));
      });
    }
    this.last=Object.fromEntries(this.joints.map((j)=>[j.name,d.qpos[j.q]]));
    const trunk=this.directionEnd?1:s;
    this.last.spine_flex=0.015*trunk;this.last.chest_flex=0.02*trunk;this.last.neck_pitch=0.18*trunk;
    return this.last;
  }
  snapshot(){return this.active?{side:this.side,target:this.target.slice(),error:this.error,progress:this.progress}:null;}
  dispose(){this.data?.delete();this.data=null;}
}
