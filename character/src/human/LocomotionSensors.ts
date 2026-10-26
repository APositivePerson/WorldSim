import type { MuJoCoEngine } from "../physics/MuJoCoEngine";
export type Vec2 = { x: number; y: number };
export interface FootObservation {
  x: number; y: number; z: number; force: number; contact: boolean;
  slip: number; pressure: Vec2;
}
/** Reads actual floor contacts and centroid motion; owns every WASM handle it creates. */
export class LocomotionSensors {
  readonly feet: FootObservation[];
  readonly com = { x: 0, y: 0, z: 1 };
  readonly velocity = { x: 0, y: 0, z: 0 };
  readonly capture = { x: 0, y: 0 };
  private footBodies: number[];
  private owners = new Map<number, number>();
  private force;
  private previous: number[][] = [];
  private previousCom: number[] = [];
  private lastTime = -1;
  constructor(readonly engine: MuJoCoEngine) {
    this.force = new engine.mj.DoubleBuffer(6);
    this.footBodies = ["left", "right"].map(side => engine.mj.mj_name2id(engine.model,1,`${side}_foot`));
    for (let b = 1; b < engine.model.nbody; b++) {
      let parent = b;
      while (parent) {
        const foot = this.footBodies.indexOf(parent);
        if (foot >= 0) { this.owners.set(b,foot); break; }
        parent = engine.model.body_parentid[parent];
      }
    }
    this.feet = this.footBodies.map(() => ({ x:0,y:0,z:0,force:0,contact:false,slip:0,pressure:{x:0,y:0} }));
    this.update();
  }
  reset() { this.lastTime = -1; this.previous = []; this.previousCom = []; this.velocity.x = this.velocity.y = this.velocity.z = 0; this.update(); }
  update() {
    const {data:d,model:m,mj} = this.engine;
    const dt = d.time - this.lastTime;
    if (this.lastTime >= 0 && dt >= 0 && dt < .0099) return;
    const valid = this.lastTime >= 0 && dt > 0 && dt < .1;
    const alpha = valid ? 1 - Math.exp(-dt * 25) : 1;
    const com = Array.from(d.subtree_com.slice(3,6)) as number[];
    for (const [i,key] of (["x","y","z"] as const).entries()) {
      this.velocity[key] = valid ? this.velocity[key] + ((com[i]-this.previousCom[i])/dt-this.velocity[key])*alpha : 0;
      this.com[key] = com[i];
    }
    this.previousCom = com;
    this.footBodies.forEach((body,i) => {
      const p = Array.from(d.xpos.slice(body*3,body*3+3)) as number[], foot = this.feet[i];
      foot.slip = valid ? foot.slip + (Math.hypot(p[0]-this.previous[i][0],p[1]-this.previous[i][1])/dt-foot.slip)*alpha : 0;
      [foot.x,foot.y,foot.z] = p; foot.force = 0; foot.pressure = {x:0,y:0}; this.previous[i] = p;
    });
    const contacts = d.contact;
    try {
      for(let i=0;i<d.ncon;i++) {
        const ct = contacts.get(i)!;
        try {
          const a=m.geom_bodyid[ct.geom1],b=m.geom_bodyid[ct.geom2];
          const owner = a===0 ? this.owners.get(b) : b===0 ? this.owners.get(a) : undefined;
          if(owner===undefined) continue;
          mj.mj_contactForce(m,d,i,this.force);
          const normal = Math.max(0,this.force.GetView()[0]) * Math.abs(ct.frame[2]);
          const foot=this.feet[owner]; foot.force+=normal;
          foot.pressure.x += normal*ct.pos[0]; foot.pressure.y += normal*ct.pos[1];
        } finally { ct.delete(); }
      }
    } finally { contacts.delete(); }
    this.feet.forEach(foot => {
      foot.contact = foot.force > this.engine.totalMass*9.81*(foot.contact ? .012 : .025);
      foot.pressure = foot.force>1 ? {x:foot.pressure.x/foot.force,y:foot.pressure.y/foot.force} : {x:foot.x,y:foot.y};
    });
    const omega=Math.sqrt(9.81/Math.max(.5,this.com.z));
    this.capture.x=this.com.x+this.velocity.x/omega;
    this.capture.y=this.com.y+this.velocity.y/omega;
    this.lastTime=d.time;
  }
  dispose() { this.force.delete(); }
}
