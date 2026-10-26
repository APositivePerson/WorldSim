import type {ReflexParameters} from '../calibration/Profile';
export interface AfferentSample {ia:number;ii:number;ib:number}
/** Shared spinal excitation correction; Ia/II are rates, Ib a normalized force proxy. */
export function reflexExcitation(r:ReflexParameters,a:AfferentSample|undefined,antagonistIa:number[]){
 if(!a)return 0;
 const inhibition=antagonistIa.reduce((s,ia)=>s+Math.max(0,(ia-r.iaReference)/r.rateScale),0)/Math.max(1,antagonistIa.length);
 const u=r.iaGain*(a.ia-r.iaReference)/r.rateScale+r.iiGain*(a.ii-r.iiReference)/r.rateScale-r.inhibitionGain*inhibition-r.ibGain*Math.max(0,a.ib-1);
 return Math.max(-r.limit,Math.min(r.limit,u));
}
