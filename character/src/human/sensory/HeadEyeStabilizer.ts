import type {SensoryFrame} from './SensoryInterface';
const clamp=(v:number,limit:number)=>Math.max(-limit,Math.min(limit,v));
/** Oculomotor plant in angular coordinates. Delayed retinal feedback plus
 * vestibular feedforward controls the eye; rendering only displays this state. */
export class HeadEyeStabilizer {
  readonly eyes={active:false,yaw:0,pitch:0};
  private velocity=[0,0];
  private retinal=[0,0];
  reset(){this.eyes.yaw=this.eyes.pitch=0;this.velocity=[0,0];this.retinal=[0,0];}
  update(frame:SensoryFrame,dt:number,enabled:boolean,bias:number[]){
    this.eyes.active=true;
    const gyro=frame.vestibular?.value.gyro;
    const retinal=frame.vision?.value.retinal;
    this.retinal=retinal?.slice()??this.retinal;
    for(const [i,key] of (['yaw','pitch'] as const).entries()){
      const angular=gyro?(gyro[i===0?2:0]-bias[i===0?2:0]):0;
      const command=enabled?-angular+(retinal?retinal[i]*9:0):-this.eyes[key]*8;
      this.velocity[i]+=(clamp(command,3)-this.velocity[i])*(1-Math.exp(-dt/.012));
      this.eyes[key]=clamp(this.eyes[key]+this.velocity[i]*dt,i===0?.6:.35);
    }
  }
  snapshot(){return {...this.eyes,retinal:this.retinal.slice(),velocity:this.velocity.slice()};}
}
