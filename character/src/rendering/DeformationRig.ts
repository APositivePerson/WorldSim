import * as T from "three";
import type { MuJoCoEngine } from "../physics/MuJoCoEngine";

export interface FaceControls { jawOpen: number; smile: number; browRaise: number; blink: number; autoBlink: boolean; }
export const neutralFace: FaceControls = { jawOpen: 0, smile: 0, browRaise: 0, blink: 0, autoBlink: true };
export function validFace(patch: Partial<FaceControls>) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return false;
  return Object.entries(patch).every(([key, value]) => key === "autoBlink" ? typeof value === "boolean"
    : ["jawOpen", "smile", "browRaise", "blink"].includes(key) && typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1);
}
type Helper = { bone: T.Bone; rest: T.Vector3; role: string; side?: string; half?: string; fraction?: number; parentRegion?: string };
/** Secondary deformation follows measured physics; facial pose never writes physical joints. */
export class DeformationRig {
  readonly face: FaceControls = { ...neutralFace };
  enabled = true;
  private helpers: Helper[] = [];
  private joint = new Map<string, number>();
  private axis = new T.Vector3(0, 0, 1);
  private chest = new T.Quaternion();
  private region = new T.Quaternion();
  constructor(readonly engine: MuJoCoEngine, scene: T.Object3D) {
    for (const j of engine.joints) this.joint.set(j.name, j.q);
    scene.traverse(o => {
      if (o instanceof T.Bone && o.userData.humanDeform)
        this.helpers.push({ bone: o, rest: o.position.clone(), ...o.userData.humanDeform });
    });
  }
  get count() { return this.helpers.length; }
  setFace(patch: Partial<FaceControls>) {
    if (!validFace(patch)) return false;
    Object.assign(this.face, patch);
    return true;
  }
  update() {
    const { data } = this.engine;
    const angle = (name: string) => { const q = this.joint.get(name); return q === undefined ? 0 : data.qpos[q]; };
    this.chest.setFromEuler(new T.Euler(angle("chest_flex"), angle("chest_sidebend"), angle("chest_twist"), "ZYX"));
    // A short asymmetric blink repeats in simulation time, so pause freezes it.
    const phase = data.time % 4.7;
    const auto = this.face.autoBlink && phase > 3.8 && phase < 4.02
      ? Math.sin(Math.PI * (phase - 3.8) / .22) ** 2 : 0;
    const blink = Math.max(this.face.blink, auto);
    for (const h of this.helpers) {
      const bone = h.bone;
      bone.position.copy(h.rest); bone.quaternion.identity(); bone.scale.setScalar(1);
      if (!this.enabled) continue;
      switch (h.role) {
        case "forearmTwist":
          bone.quaternion.setFromAxisAngle(this.axis, -(1 - h.fraction!) * angle(`${h.side}_forearm_rotation`));
          break;
        case "shoulder":
          bone.quaternion.setFromAxisAngle(this.axis, -(1 - h.fraction!) * angle(`${h.side}_shoulder_rotation`));
          break;
        case "spine":
          if (h.parentRegion === "torso") bone.quaternion.slerp(this.chest, h.fraction! * .35);
          else bone.quaternion.slerp(this.region.copy(this.chest).invert(), (1 - h.fraction!) * .28);
          break;
        case "jaw": bone.rotation.x = this.face.jawOpen * .32; break;
        case "eyelid": bone.rotation.x = blink * (h.half === "upper" ? .82 : -.82); break;
        case "brow": bone.position.z += this.face.browRaise * .005; break;
        case "cheek":
          bone.position.z += this.face.smile * .004;
          bone.position.x += (h.side === "left" ? 1 : -1) * this.face.smile * .002;
          break;
        case "lip":
          bone.position.z += h.half === "upper" ? this.face.smile * .001 : -this.face.jawOpen * .001;
          bone.scale.x = 1 + this.face.smile * .08;
          break;
      }
    }
  }
  snapshot() { return { ...this.face, enabled: this.enabled, deformationBones: this.count }; }
}
