import type {WalkingLearningMode} from "./WalkingCerebellum";
export type LoadPhase=0|1|2; // heel loading, single support, trailing-foot push
const clamp=(v:number,limit:number)=>Math.max(-limit,Math.min(limit,v));
const memory=()=>Array.from({length:2},()=>Array.from({length:3},()=>[0,0,0]));
/** Online residual model in body-weight units. Phase and speed contexts are
 * separate. Policy changes are small and latched by the gait on the next step. */
export class WalkingLoadLearning {
  private mode:WalkingLearningMode="learn";
  private bias=memory();
  private counts=memory();
  private pattern=memory().map(row=>row.map(phases=>phases.map(()=>Array(8).fill(0) as number[])));
  private updates=0;
  private samples=0;
  private error=0;
  private rawError=0;
  private bin(speed:number){return speed<.4?0:speed<.65?1:2;}
  setMode(mode:WalkingLearningMode){this.mode=mode;}
  observe(side:number,speed:number,phase:LoadPhase,expected:number,actual:number,progress=.5){
    if(![speed,expected,actual,progress].every(Number.isFinite)||expected<.05||actual<0||actual>2.5)return;
    const bin=this.bin(speed),timeBin=Math.max(0,Math.min(7,Math.floor(progress*8)));
    const residual=clamp(actual-expected,.6),prediction=this.pattern[side][bin][phase][timeBin];
    this.error=this.samples?.98*this.error+.02*Math.abs(residual-prediction):Math.abs(residual-prediction);
    this.rawError=this.samples?.98*this.rawError+.02*Math.abs(residual):Math.abs(residual);
    this.samples++;
    if(this.mode==="learn"){
      this.bias[side][bin][phase]+= .025*(residual-this.bias[side][bin][phase]);
      this.pattern[side][bin][phase][timeBin]+=.08*(residual-prediction);
      this.counts[side][bin][phase]++;this.updates++;
    }
  }
  corrections(side:number,speed:number){
    const bin=this.bin(speed),b=this.bias[side][bin],n=this.counts[side][bin];
    if(this.mode==="off")return {push:0,transfer:0};
    return {push:n[2]>=8?clamp(-b[2]*.01,.004):0,
      transfer:n[0]>=8?clamp(-b[0]*.003,.0015):0};
  }
  reset(){this.bias=memory();this.counts=memory();this.pattern.forEach(row=>row.forEach(phases=>phases.forEach(bins=>bins.fill(0))));this.updates=0;this.samples=0;this.error=0;this.rawError=0;}
  snapshot(){return {samples:this.samples,updates:this.updates,predictionError:this.error,uncorrectedError:this.rawError,
    pattern:this.pattern.map(row=>row.map(phases=>phases.map(bins=>bins.slice()))),
    bias:this.bias.map(row=>row.map(v=>v.slice())),counts:this.counts.map(row=>row.map(v=>v.slice()))};}
}
