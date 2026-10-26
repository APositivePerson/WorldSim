import {defaultProfile, type HillParameters} from '../calibration/Profile';
const clip=(x:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,x));
export interface MuscleParameters {force:number;optimal:number;slack:number}
/** Series-elastic Hill unit. A bounded implicit equilibrium solves tendon force
 * against active force-length-velocity plus parallel passive force. */
export class HillMuscle {
  activation=0;
  excitation=0;
  fiber:number;
  velocity=0;
  force=0;
  tendonLength:number;
  constructor(readonly parameters:MuscleParameters, readonly mechanics:HillParameters=defaultProfile.hill){this.fiber=parameters.optimal;this.tendonLength=parameters.slack;}
  reset(length=this.parameters.optimal+this.parameters.slack){this.activation=this.excitation=this.force=this.velocity=0;this.fiber=Math.max(.45*this.parameters.optimal,length-this.parameters.slack);this.tendonLength=this.parameters.slack;}
  private nextActivation(u:number,dt:number){const tau=u>this.activation?this.mechanics.activationRise:this.mechanics.activationFall;return this.activation+(u-this.activation)*(1-Math.exp(-dt/tau));}
  private equilibrium(length:number,activation:number,dt:number){
    const p=this.parameters,h=this.mechanics,old=this.fiber;
    const evaluate=(fiber:number)=>{
      const strain=Math.max(0,(length-fiber-p.slack)/p.slack);
      const tendon=p.force*Math.min(h.tendonForceCap,(strain/h.tendonStrainAtUnitForce)**2);
      const l=fiber/p.optimal,v=(fiber-old)/(dt*p.optimal),vmax=h.maxVelocity;
      const fv=v<0?Math.max(0,(vmax+v)/(vmax-v/h.shorteningShape)):1+h.eccentricExtra*v/(v+vmax*h.eccentricVelocityScale);
      const active=h.activeForceScale*activation*Math.exp(-(((l-1)/h.forceLengthWidth)**2))*fv;
      const passive=h.passiveScale*Math.max(0,(l-1)/h.forceLengthWidth)**2;
      return {tendon,residual:tendon-p.force*(active+passive)};
    };
    let lo=.35*p.optimal,hi=Math.max(lo+.001,length);
    for(let k=0;k<22;k++){const mid=(lo+hi)/2;if(evaluate(mid).residual>0)lo=mid;else hi=mid;}
    const fiber=(lo+hi)/2;return {fiber,force:evaluate(fiber).tendon};
  }
  predict(length:number,u:number,dt:number){return this.equilibrium(length,this.nextActivation(clip(u,0,1),dt),dt).force;}
  advance(length:number,u:number,dt:number){
    this.excitation=clip(u,0,1);this.activation=this.nextActivation(this.excitation,dt);
    const state=this.equilibrium(length,this.activation,dt);
    this.velocity=(state.fiber-this.fiber)/dt;this.fiber=state.fiber;this.force=state.force;this.tendonLength=Math.max(0,length-this.fiber);
    return this.force;
  }
  snapshot(){return {excitation:this.excitation,activation:this.activation,force:this.force,fiberLength:this.fiber,fiberVelocity:this.velocity,tendonLength:this.tendonLength,
    tendonStrain:(this.tendonLength-this.parameters.slack)/this.parameters.slack};}
}
