import type { MuJoCoEngine } from "../physics/MuJoCoEngine";
import { sampleWalk } from "./motion/WalkReference";
const clamp=(v:number,limit:number)=>Math.max(-limit,Math.min(limit,v));
/** Captured posture plus bounded trunk feedback. User/task ownership lives in HumanController. */
export class WholeBodyCoordinator {
  readonly arms: Record<string,number> = {};
  readonly trunk: Record<string,number> = {};
  private blend=0;
  constructor(readonly engine:MuJoCoEngine, private state=()=>engine.data) {}
  reset() { this.blend=0; Object.keys(this.arms).forEach(k=>delete this.arms[k]); Object.keys(this.trunk).forEach(k=>delete this.trunk[k]); }
  update(phase:number, walking:boolean, strength:number, dt:number) {
    this.blend+=((walking?1:0)-this.blend)*(1-Math.exp(-dt*3));
    const weight=this.blend*strength, d=this.state();
    const [w,x,y,z]=Array.from(d.qpos.slice(3,7)) as number[];
    const roll=Math.atan2(2*(w*x+y*z),1-2*(x*x+y*y));
    const pitch=Math.asin(clamp(2*(w*y-z*x),1));
    for(const side of ["left","right"] as const) {
      this.arms[`${side}_shoulder_flex`]=clamp(sampleWalk(`${side}_shoulder_flex`,phase)*.58,.26)*weight;
      this.arms[`${side}_elbow`]=(.12+Math.max(0,sampleWalk(`${side}_elbow`,phase))*.45)*weight;
    }
    for(const region of ["spine","chest"]) {
      this.trunk[`${region}_flex`]=(clamp(sampleWalk(`${region}_flex`,phase)*.4,.035)-clamp(roll*.12,.025))*weight;
      this.trunk[`${region}_sidebend`]=(clamp(sampleWalk(`${region}_sidebend`,phase)*.4,.035)-clamp(pitch*.12,.025))*weight;
      this.trunk[`${region}_twist`]=clamp(sampleWalk(`${region}_twist`,phase)*.55,.04)*weight;
    }
  }
}
