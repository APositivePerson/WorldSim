import * as T from "three";
/** Bind-space shape keys. Runtime weights come from measured joint angles. */
export function createCorrectives(geometry: T.BufferGeometry, surfaceCount: number, world: Map<string,T.Matrix4>) {
  const definitions: { name: string; delta: (p:T.Vector3,n:T.Vector3)=>T.Vector3 }[] = [];
  const frames = new Map(Array.from(world, ([name,m]) => [name,{inv:m.clone().invert(),rotation:new T.Matrix3().setFromMatrix4(m)}]));
  const gaussian = (p:T.Vector3,c:T.Vector3,s:T.Vector3) => { const x=(p.x-c.x)/s.x,y=(p.y-c.y)/s.y,z=(p.z-c.z)/s.z; return Math.exp(-(x*x+y*y+z*z)); };
  const local = (name:string,p:T.Vector3) => p.clone().applyMatrix4(frames.get(name)!.inv);
  const vector = (name:string,p:T.Vector3) => p.applyMatrix3(frames.get(name)!.rotation);
  for (const [side,sign] of [["left",1],["right",-1]] as const) {
    definitions.push({ name:`${side}_shoulder_volume`, delta:(p,n) => {
      const q=local(`${side}_upper_arm`,p);
      return n.clone().multiplyScalar(0.006*gaussian(q,new T.Vector3(0,0,-0.025),new T.Vector3(0.09,0.08,0.09)));
    }});
    definitions.push({ name:`${side}_elbow_volume`, delta:(p,n) => {
      const q=local(`${side}_forearm`,p),arm=local(`${side}_upper_arm`,p);
      const joint=gaussian(q,new T.Vector3(),new T.Vector3(0.065,0.065,0.055));
      const belly=gaussian(arm,new T.Vector3(0,-0.025,-0.16),new T.Vector3(0.05,0.05,0.09));
      return n.clone().multiplyScalar(joint*(q.y<0?-0.0015:0.0045)+belly*0.006);
    }});
    definitions.push({ name:`${side}_knee_volume`, delta:(p,n) => {
      const q=local(`${side}_shin`,p);
      return n.clone().multiplyScalar(gaussian(q,new T.Vector3(),new T.Vector3(0.075,0.075,0.075))*(q.y>0?-0.001:0.005));
    }});
    definitions.push({ name:`${side}_palm_cup`, delta:(p) => {
      const q=local(`${side}_hand`,p);
      const g=gaussian(q,new T.Vector3(0,-0.01,-0.035),new T.Vector3(0.045,0.035,0.04));
      return vector(`${side}_hand`,new T.Vector3(-q.x*0.06,0.003*Math.max(0,1-Math.abs(q.x)/0.04),0.001).multiplyScalar(g));
    }});
    definitions.push({ name:`${side}_thumb_web`, delta:(p,n) => {
      const q=local(`${side}_hand`,p);
      const g=gaussian(q,new T.Vector3(sign*0.035,-0.018,-0.015),new T.Vector3(0.026,0.03,0.034));
      return vector(`${side}_hand`,new T.Vector3(-sign*0.004,0.001,0).multiplyScalar(g)).addScaledVector(n,0.0008*g);
    }});
    definitions.push({ name:`${side}_shoulder_forward`, delta:(p,n) => {
      const q=local(`${side}_upper_arm`,p);
      return n.clone().multiplyScalar(0.0045*gaussian(q,new T.Vector3(0,0.025,-0.025),new T.Vector3(0.08,0.065,0.075)));
    }});
    for (const direction of ["flex", "extend"] as const) {
      definitions.push({ name:`${side}_wrist_${direction}`, delta:(p,n) => {
        const q=local(`${side}_hand`,p);
        const joint=gaussian(q,new T.Vector3(0,0,0.006),new T.Vector3(0.030,0.024,0.026));
        const compressed=direction==="flex"?q.y<0:q.y>0;
        // A shallow crease on the compressed side, volume on the outer wrist.
        const crease=Math.exp(-(((q.z-0.002)/0.0035)**2));
        return n.clone().multiplyScalar(joint*(compressed?-0.0012*crease:0.0027));
      }});
    }
    for (const finger of ["index","middle","ring","little"]) {
      definitions.push({ name:`${side}_${finger}_knuckle`, delta:(p,n) => {
        const q=local(`${side}_${finger}_1`,p);
        const joint=gaussian(q,new T.Vector3(0,0.002,0),new T.Vector3(0.010,0.013,0.014));
        return n.clone().multiplyScalar(joint*(q.y>0?0.0026:-0.0006));
      }});
    }
    definitions.push({ name:`${side}_hip_flex`, delta:(p,n) => {
      const q=local(`${side}_thigh`,p);
      const joint=gaussian(q,new T.Vector3(0,0.015,-0.01),new T.Vector3(0.11,0.11,0.12));
      return n.clone().multiplyScalar(joint*(q.y>0?0.0045:-0.0015));
    }});
    definitions.push({ name:`${side}_soft_tissue`, delta:(p,n) => {
      const q=local(`${side}_upper_arm`,p);
      return n.clone().multiplyScalar(0.0025*gaussian(q,new T.Vector3(0,-0.02,-0.16),new T.Vector3(0.055,0.055,0.10)));
    }});
  }
  definitions.push({name:"breathing",delta:(p,n)=> {
    const q=local("chest",p);
    return n.clone().multiplyScalar(0.0025*gaussian(q,new T.Vector3(0,-0.02,0.045),new T.Vector3(0.22,0.14,0.17)));
  }});
  const targets:T.BufferAttribute[]=[];
  for (const definition of definitions) {
    const values=new Float32Array(geometry.attributes.position.count*3);
    const p=new T.Vector3(),normal=new T.Vector3();
    for(let i=0;i<surfaceCount;i++) {
      p.fromBufferAttribute(geometry.attributes.position,i);
      normal.fromBufferAttribute(geometry.attributes.normal,i);
      const d=definition.delta(p,normal);values.set(d.toArray(),i*3);
    }
    const attribute=new T.Float32BufferAttribute(values,3);attribute.name=definition.name;targets.push(attribute);
  }
  geometry.morphAttributes.position=targets;
  geometry.morphTargetsRelative=true;
  return definitions.map((d)=>d.name);
}
