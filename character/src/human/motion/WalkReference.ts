import recording from "./cmu-walk.json";
const channels: Record<string,number[]> = recording.channels;
export const walkSource = recording.meta;
export function sampleWalk(channel: string, phase: number) {
  const values=channels[channel]; if(!values) return 0;
  const t=((phase%1)+1)%1*values.length, i=Math.floor(t), u=t-i;
  // Periodic Catmull-Rom keeps velocity continuous across frame/stride seams.
  const read=(offset:number)=>values[(i+offset+values.length)%values.length];
  const a=read(-1),b=read(0),c=read(1),d=read(2);
  return .5*((2*b)+(-a+c)*u+(2*a-5*b+4*c-d)*u*u+(-a+3*b-3*c+d)*u*u*u);
}
/** Time-warp the recorded airborne foot trajectory to the contact-safe swing. */
export function recordedLift(side: "left"|"right", progress: number) {
  const start=side==="right" ? .30 : .80, end=start+.40;
  const p=Math.max(0,Math.min(1,progress));
  const channel=`${side}_foot_height`;
  const baseline=sampleWalk(channel,start)*(1-p)+sampleWalk(channel,end)*p;
  return Math.max(0,Math.min(1,(sampleWalk(channel,start+.40*p)-baseline)*1.35))
    * Math.min(1,p/.08,(1-p)/.08);
}
