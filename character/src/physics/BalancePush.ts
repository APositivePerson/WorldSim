import type {MuJoCoEngine} from './MuJoCoEngine';
/** Explicit test stimulus; never passed to the sensory estimator. */
export class BalancePush {
  private until=-1;
  private applied=0;
  private count=0;
  private peak=0;
  private origin=0;
  private measuringUntil=-1;
  constructor(private engine:MuJoCoEngine){}
  get active(){return this.until>=0;}
  start(){if(this.active)return false;this.until=this.engine.data.time+.12;this.measuringUntil=this.engine.data.time+2;this.origin=this.engine.data.qpos[0];this.peak=0;this.count++;return true;}
  snapshot(){return {active:this.active,force:this.applied,count:this.count,peak:this.peak};}
  reset(){this.stop();this.count=0;this.peak=0;}
  update(){if(this.engine.data.time<this.measuringUntil)this.peak=Math.max(this.peak,Math.abs(this.engine.data.qpos[0]-this.origin));
    const force=this.active&&this.engine.data.time<this.until-1e-9?35:0;
    this.engine.data.xfrc_applied[6]+=force-this.applied;this.applied=force;
    if(!force)this.until=-1;
  }
  stop(){this.engine.data.xfrc_applied[6]-=this.applied;this.applied=0;this.until=-1;this.measuringUntil=-1;}
}
