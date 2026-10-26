import {defaultProfile, type SpindleParameters} from '../calibration/Profile';
const clamp=(x:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,x));
/** Three intrafusal series units: a gamma-driven polar region, nonlinear
 * viscosity, and an elastic sensory region. Anatomically inspired by Mileusnic
 * et al.; coefficients below are a reduced, uncalibrated engineering model,
 * not a reproduction of that paper's fitted equations or spiking neurons. */
export class MuscleSpindle {
  constructor(readonly parameters:SpindleParameters=defaultProfile.spindle){}
  private polar=[.96,.96,.96];
  private activation=[0,0,0];
  private tension=[0,0,0];
  private sensory=[.04,.04,.04];
  private initialized=false;
  ia=0;ii=0;
  gammaStatic=.15;gammaDynamic=.15;
  reset(){this.polar.fill(this.parameters.polarRest);this.activation.fill(0);this.tension.fill(0);this.sensory.fill(this.parameters.sensoryRest);this.initialized=false;this.ia=this.ii=0;}
  update(normalizedLength:number,dt:number,gammaStatic:number,gammaDynamic:number){
    const p=this.parameters;
    this.gammaStatic=clamp(gammaStatic,0,1);this.gammaDynamic=clamp(gammaDynamic,0,1);
    const length=clamp(normalizedLength,.35,2),drives=[this.gammaDynamic,this.gammaStatic,this.gammaStatic];
    if(!this.initialized)this.polar.fill(Math.max(.2,length-p.sensoryRest));this.initialized=true;
    for(let i=0;i<3;i++){
      this.activation[i]+=(drives[i]-this.activation[i])*(1-Math.exp(-dt/p.gammaTau[i]));
      const gamma=this.activation[i],beta=p.betaBase[i]+p.betaGamma[i]*gamma;
      const active=p.activeGamma[i]*gamma,old=this.polar[i];
      let lo=.2,hi=Math.max(.201,length-.005);
      // Implicit series force equilibrium avoids an unstable explicit update
      // of the stiff sensory spring at the 2 ms whole-body physics timestep.
      for(let k=0;k<18;k++){
        const p=(lo+hi)/2,v=(p-old)/dt;
        const sensory=this.parameters.sensoryStiffness*Math.max(0,length-p-this.parameters.sensoryRest);
        const polar=this.parameters.polarStiffness*(p-this.parameters.polarRest)+active+beta*Math.sign(v)*Math.abs(v)**this.parameters.viscosityExponent;
        if(sensory>polar)lo=p;else hi=p;
      }
      this.polar[i]=(lo+hi)/2;this.sensory[i]=length-this.polar[i];this.tension[i]=p.sensoryStiffness*Math.max(0,this.sensory[i]-p.sensoryRest);
    }
    const [bag1,bag2,chain]=this.tension;
    this.ia=clamp(p.iaBias+p.iaWeights[0]*bag1+p.iaWeights[1]*bag2+p.iaWeights[2]*chain,0,p.iaMax);
    this.ii=clamp(p.iiBias+p.iiWeights[0]*bag1+p.iiWeights[1]*bag2+p.iiWeights[2]*chain,0,p.iiMax);
    return this.snapshot();
  }
  snapshot(){return {ia:this.ia,ii:this.ii,bag1:this.tension[0],bag2:this.tension[1],chain:this.tension[2],gammaStatic:this.gammaStatic,gammaDynamic:this.gammaDynamic,
    intrafusal:this.polar.map((polar,i)=>({polar,sensory:this.sensory[i],gammaActivation:this.activation[i],tension:this.tension[i]}))};}
}
