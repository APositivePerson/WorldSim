import * as T from "three";
import { muscles } from "../human/MuscleAnatomy";
import type { MuJoCoEngine } from "../physics/MuJoCoEngine";
export class MuscleLayer {
  readonly group = new T.Group();
  private regions: { body: number; actuator: number; sign: number; mesh: T.Mesh<T.SphereGeometry, T.MeshStandardMaterial>;
    center: T.Vector3; size: T.Vector3; native: number }[] = [];
  private q = new T.Quaternion();
  private cool = new T.Color("#af7064");
  private hot = new T.Color("#e03727");
  constructor(readonly engine: MuJoCoEngine) {
    this.group.visible = false;
    for (const region of muscles) {
      const mesh = new T.Mesh(new T.SphereGeometry(1, 20, 12),
        new T.MeshStandardMaterial({ color: this.cool, roughness: 0.8 }));
      mesh.name = region.name;
      mesh.castShadow = true;
      this.group.add(mesh);
      this.regions.push({
        body: engine.mj.mj_name2id(engine.model, 1, region.body),
        actuator: engine.joints.find((j) => j.name === region.joint)!.actuator,
        sign: region.sign, mesh, center: new T.Vector3(...region.center), size: new T.Vector3(...region.size),
        native: /biceps|triceps/.test(region.name) ? engine.mj.mj_name2id(engine.model, 19, `bio_${region.name}`) : -1,
      });
    }
  }
  sync() {
    if (!this.group.visible) return;
    const { data: d, model: m } = this.engine;
    for (const r of this.regions) {
      // Torque utilization is a load proxy, not EMG or physiological activation.
      const limit = Math.max(0.001, Math.abs(m.actuator_forcerange[r.actuator * 2 + 1]));
      const native = r.native >= 0 && m.actuator_gainprm[r.native * 10 + 2] > 0;
      const load = native ? d.act[m.actuator_actadr[r.native]] : Math.min(1, Math.max(0, r.sign * d.actuator_force[r.actuator] / limit));
      this.q.set(d.xquat[r.body * 4 + 1], d.xquat[r.body * 4 + 2],
        d.xquat[r.body * 4 + 3], d.xquat[r.body * 4]);
      r.mesh.position.copy(r.center).applyQuaternion(this.q);
      r.mesh.position.x += d.xpos[r.body * 3];
      r.mesh.position.y += d.xpos[r.body * 3 + 1];
      r.mesh.position.z += d.xpos[r.body * 3 + 2];
      r.mesh.quaternion.copy(this.q);
      r.mesh.scale.set(r.size.x * (1.12 + load * 0.12), r.size.y * (1.12 + load * 0.12), r.size.z * (1 - load * 0.04));
      r.mesh.material.color.copy(this.cool).lerp(this.hot, Math.sqrt(load));
    }
  }
}
