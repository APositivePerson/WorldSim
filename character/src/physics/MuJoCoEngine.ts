import type { MainModule, MjModel, MjData } from "@mujoco/mujoco";
export interface Joint {
  name: string;
  id: number;
  actuator: number;
  q: number;
  v: number;
  min: number;
  max: number;
}
export class MuJoCoEngine {
  readonly model: MjModel;
  readonly data: MjData;
  readonly joints: Joint[] = [];
  readonly humanBodies: number[] = [];
  private humanSet = new Set<number>();
  physicalEyes=false;
  legMuscleDrive:'servo'|'ankle'|'full'='servo';
  gazeTarget: [number, number, number] | null = null;
  sensoryEyes:{active:boolean;yaw:number;pitch:number}|null=null;
  constructor(
    readonly mj: MainModule,
    xml: string,
  ) {
    this.model = mj.MjModel.from_xml_string(xml);
    try {
      this.data = new mj.MjData(this.model);
    } catch (e) {
      this.model.delete();
      throw e;
    }
    const m = this.model;
    const pelvis = mj.mj_name2id(m,1,"pelvis");
    for(let b=1;b<m.nbody;b++) {
      let root=b;
      while(m.body_parentid[root]!==0)root=m.body_parentid[root];
      if(pelvis<0||root===pelvis){this.humanBodies.push(b);this.humanSet.add(b);}
    }
    for (let a = 0; a < m.nu; a++) {
      if (m.actuator_trntype[a] !== 0 && m.actuator_trntype[a] !== 1) continue;
      const j = m.actuator_trnid[a * 2];
      this.joints.push({
        name: mj.mj_id2name(m, 3, j),
        id: j,
        actuator: a,
        q: m.jnt_qposadr[j],
        v: m.jnt_dofadr[j],
        min: m.jnt_range[j * 2],
        max: m.jnt_range[j * 2 + 1],
      });
    }
    this.reset();
  }
  isHumanBody(body:number) { return this.humanSet.has(body); }
  get dt() {
    return this.model.opt.timestep;
  }
  get freeBase() {
    return this.model.njnt > 0 && this.model.jnt_type[0] === 0;
  }
  get totalMass() {
    let mass = 0;
    for (const body of this.humanBodies) mass += this.model.body_mass[body];
    return mass;
  }
  setTotalMass(kg: number) {
    if (!Number.isFinite(kg) || kg < 45 || kg > 100) throw new Error("体重须在 45–100 kg 之间");
    // Official API scales both masses and inertias, including the finger bodies.
    if(this.humanBodies.length===this.model.nbody-1)this.mj.mj_setTotalmass(this.model, kg);
    else {
      const scale=kg/this.totalMass;
      for(const b of this.humanBodies){this.model.body_mass[b]*=scale;for(let a=0;a<3;a++)this.model.body_inertia[b*3+a]*=scale;}
    }
    this.mj.mj_setConst(this.model, this.data);
    this.reset();
  }
  bodyState() {
    return {
      mass: this.totalMass,
      weight: this.totalMass * Math.abs(this.model.opt.gravity[2]),
      centerOfMass: Array.from(this.data.subtree_com.slice(3, 6)) as number[],
      segments: this.humanBodies.map((b) => ({
        name: this.mj.mj_id2name(this.model, 1, b),
        mass: this.model.body_mass[b],
      })),
    };
  }
  reset() {
    if (this.model.nkey > 0)
      this.mj.mj_resetDataKeyframe(this.model, this.data, 0);
    else this.mj.mj_resetData(this.model, this.data);
    this.mj.mj_forward(this.model, this.data);
  }
  step() {
    this.mj.mj_step(this.model, this.data);
    this.mj.mj_forward(this.model, this.data);
  }
  dispose() {
    this.data.delete();
    this.model.delete();
  }
}
