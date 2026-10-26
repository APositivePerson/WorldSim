import * as T from "three";
import { detailBones, fingerBones } from "../human/Anatomy";
import type { MuJoCoEngine } from "../physics/MuJoCoEngine";

/** Extra anatomical landmarks inherit body transforms, with no physics writes. */
export class AnatomicalSkeleton {
  readonly group = new T.Group();
  private attachments: { body: number; group: T.Group }[] = [];
  constructor(readonly engine: MuJoCoEngine) {
    const owners = new Map<string, { body: number; group: T.Group; origin: T.Vector3 }>();
    for (let b = 1; b < engine.model.nbody; b++) {
      const name = engine.mj.mj_id2name(engine.model, 1, b);
      const group = new T.Group();
      this.group.add(group);
      this.attachments.push({ body: b, group });
      owners.set(name, { body: b, group, origin: new T.Vector3() });
    }
    const material = new T.LineBasicMaterial({
      color: 0xf4aa48, depthTest: false, transparent: true, opacity: 0.9,
    });
    const line = (group: T.Group, points: T.Vector3[]) => {
      const mesh = new T.Line(new T.BufferGeometry().setFromPoints(points), material);
      mesh.renderOrder = 3;
      group.add(mesh);
    };
    for (const detail of detailBones) {
      const parent = owners.get(detail.parent)!;
      const origin = parent.origin.clone().add(new T.Vector3(...detail.position));
      owners.set(detail.name, { ...parent, origin });
      line(parent.group, [origin, origin.clone().add(new T.Vector3(...detail.tip))]);
    }
    for (const finger of fingerBones) {
      line(owners.get(finger.name)!.group, [new T.Vector3(), new T.Vector3(...finger.tip)]);
    }
    const torso = owners.get("chest")!.group;
    // Six pairs of ribs connect the posterior spine to the anterior sternum.
    for (let rib = 0; rib < 6; rib++) {
      const z = -0.08 + rib * 0.036, width = 0.12 + Math.sin(rib / 5 * Math.PI) * 0.045;
      for (const sign of [-1, 1]) {
        const points = Array.from({ length: 25 }, (_, i) => {
          const a = i / 24 * Math.PI;
          return new T.Vector3(sign * width * Math.sin(a),
            0.077 * Math.cos(a), z - 0.025 * Math.sin(a));
        });
        line(torso, points);
      }
    }
    line(torso, [new T.Vector3(0, -0.077, -0.08), new T.Vector3(0, -0.077, 0.13)]);
    for (const [name, width, depth, z] of [
      ["pelvis", 0.14, 0.085, 0], ["head", 0.085, 0.08, 0],
    ] as const) {
      line(owners.get(name)!.group, Array.from({ length: 49 }, (_, i) => {
        const a = i / 48 * Math.PI * 2;
        return new T.Vector3(width * Math.cos(a), depth * Math.sin(a), z);
      }));
    }
  }
  sync() {
    const d = this.engine.data;
    for (const { body, group } of this.attachments) {
      group.position.fromArray(d.xpos, body * 3);
      group.quaternion.set(d.xquat[body * 4 + 1], d.xquat[body * 4 + 2],
        d.xquat[body * 4 + 3], d.xquat[body * 4]);
    }
  }
}
