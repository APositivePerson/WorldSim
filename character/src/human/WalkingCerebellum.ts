import {WalkingLoadLearning} from "./WalkingLoadLearning";
export type WalkingLearningMode = "learn" | "frozen" | "off";
const clamp = (v:number, a:number, b:number) => Math.max(a, Math.min(b,v));

/** Learns the lag between a commanded foot landing and measured floor contact.
 * Separate left/right and speed contexts prevent a single timing offset from
 * being reused indiscriminately. No external-force or future-state inputs.
 */
export class WalkingCerebellum {
  readonly load=new WalkingLoadLearning();
  private mode:WalkingLearningMode="learn";
  private delays=Array.from({length:2},()=>[0,0,0]);
  private counts=Array.from({length:2},()=>[0,0,0]);
  private updates=0;
  private samples=0;
  private error=0;
  private lastError=0;
  private active=false;
  private applied=0;
  private context(speed:number){return speed<.4?0:speed<.65?1:2;}
  setMode(mode:WalkingLearningMode){
    if(!["learn","frozen","off"].includes(mode))return false;
    this.mode=mode;this.load.setMode(mode);return true;
  }
  start(){this.active=true;this.applied=0;}
  stop(){this.active=false;this.applied=0;}
  predict(side:number,speed:number){
    const bin=this.context(speed);
    this.applied=this.mode!=="off"&&this.counts[side][bin]>=2?clamp(this.delays[side][bin]*.5,-.02,.02):0;
    return this.applied;
  }
  observe(side:number,speed:number,nominalTime:number,actualTime:number,appliedLead:number){
    if(![speed,nominalTime,actualTime,appliedLead].every(Number.isFinite)
      ||actualTime<.2||actualTime>nominalTime+.35)return;
    const bin=this.context(speed), delay=this.delays[side][bin];
    // The command was advanced by appliedLead. Undo that change when learning
    // the plant lag, rather than learning half the lag from a corrected trial.
    const residual=clamp(actualTime-(nominalTime+delay-appliedLead),-.12,.12);
    this.lastError=actualTime-nominalTime;
    this.error=this.samples ? this.error*.9+Math.abs(residual)*.1 : Math.abs(residual);
    this.samples++;
    if(this.mode==="learn"){
      this.delays[side][bin]=clamp(delay+.2*residual,-.02,.06);
      this.counts[side][bin]++;this.updates++;
    }
  }
  reset(){
    this.stop();this.load.reset();this.delays.forEach(row=>row.fill(0));this.counts.forEach(row=>row.fill(0));
    this.updates=0;this.samples=0;this.error=0;this.lastError=0;
  }
  snapshot(){return {load:this.load.snapshot(),mode:this.mode,active:this.active,updates:this.updates,samples:this.samples,
    predictionError:this.error,lastLandingError:this.lastError,appliedLead:this.applied,
    delays:this.delays.map(row=>row.slice()),counts:this.counts.map(row=>row.slice())};}
}
