const smooth=(u:number)=>{u=Math.max(0,Math.min(1,u));return u*u*u*(10+u*(-15+6*u));};
export interface RollingFoot {x:number;y:number;z:number;pitch:number;toe:number;phase:string}
/** Forward is -Y. Positive foot pitch lifts the heel. Positions keep the
 * supporting heel or metatarsal point on the floor, including the toe hinge. */
export function rollingFoot(x:number,y:number,lift:number,pitch:number):RollingFoot {
  if(pitch>=0)return {x,y:y-.13+.13*Math.cos(pitch)-.052*Math.sin(pitch),
    z:.048+.13*Math.sin(pitch)+.052*Math.cos(pitch)+lift,pitch,toe:-pitch,phase:"前掌蹬离"};
  return {x,y:y+.095-.095*Math.cos(pitch)-.1*Math.sin(pitch),
    z:.1*Math.cos(pitch)-.095*Math.sin(pitch)+lift,pitch,toe:0,phase:"脚跟承重"};
}
export function rockerPitch(u:number,swing:boolean,trajectory:number,scale:number,push=0){
  if(!swing)return -.04*(1-smooth(u/.18))*scale;
  if(u<.18)return (.1+push)*smooth(u/.18)*scale;
  return ((.1+push)*(1-smooth(trajectory/.25))-.04*smooth((trajectory-.65)/.35))*scale;
}
