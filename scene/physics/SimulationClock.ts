/** Same 100 ms catch-up limit as the upstream SimulationLoop. */
export class SimulationClock {
  private accumulator=0;
  private realTime=0;
  private simulationTime=0;
  private droppedTime=0;
  private speed=1;
  constructor(private dt:number,private step:()=>void){}
  resetAccumulator(){this.accumulator=0;}
  advance(realSeconds:number,speed=1,paused=false){
    if(paused){this.resetAccumulator();return;}
    const elapsed=Number.isFinite(realSeconds)?Math.max(0,realSeconds):0;
    this.speed=speed;this.realTime+=elapsed;
    const incoming=elapsed*speed;
    this.droppedTime+=Math.max(0,incoming-.1);
    this.accumulator+=Math.min(incoming,.1);
    while(this.accumulator>=this.dt){this.step();this.simulationTime+=this.dt;this.accumulator-=this.dt;}
  }
  snapshot(){return{speed:this.speed,realTime:this.realTime,simulationTime:this.simulationTime,droppedTime:this.droppedTime,realTimeFactor:this.realTime>0?this.simulationTime/this.realTime:1};}
}
