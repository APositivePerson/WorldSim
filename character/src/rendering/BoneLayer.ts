import * as T from "three";
import type { MuJoCoEngine } from "../physics/MuJoCoEngine";
import { fingerBones, detailBones } from "../human/Anatomy";

type Point = [number, number, number];
/** Anatomical visualization attached to rigid bodies; never adds physical mass or constraints. */
export class BoneLayer {
  readonly group = new T.Group();
  private attachments: { body: number; group: T.Group }[] = [];
  private material = new T.MeshStandardMaterial({ color: "#e5d7b5", roughness: 0.63, metalness: 0 });
  private cartilage = new T.MeshStandardMaterial({ color: "#c6d7d3", roughness: 0.48 });
  private ball = new T.SphereGeometry(1, 16, 10);
  constructor(readonly engine: MuJoCoEngine) {
    this.group.name = "anatomical-bones";
    this.group.visible = false;
    const owners = new Map<string, T.Group>();
    for (const body of engine.humanBodies) {
      const group = new T.Group();
      group.name = `bone-frame:${engine.mj.mj_id2name(engine.model, 1, body)}`;
      owners.set(engine.mj.mj_id2name(engine.model, 1, body), group);
      this.group.add(group);
      this.attachments.push({ body, group });
    }
    const ellipsoid = (parent: T.Group, name: string, center: Point, scale: Point, material = this.material) => {
      const mesh = new T.Mesh(this.ball, material);
      mesh.name = name;
      mesh.position.set(...center); mesh.scale.set(...scale);
      mesh.castShadow = true; mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };
    const tube = (parent: T.Group, name: string, points: Point[], radius: number) => {
      const curve = new T.CatmullRomCurve3(points.map(p => new T.Vector3(...p)));
      const mesh = new T.Mesh(new T.TubeGeometry(curve, Math.max(8, points.length * 5), radius, 8, false), this.material);
      mesh.name = name; mesh.castShadow = true; parent.add(mesh);
    };
    const longBone = (parent: T.Group, name: string, a: Point, b: Point, radius: number) => {
      tube(parent, name, [a, b], radius * 0.65);
      ellipsoid(parent, `${name}:proximal`, a, [radius, radius, radius * 1.15]);
      ellipsoid(parent, `${name}:distal`, b, [radius * 1.1, radius, radius * 0.85]);
    };
    for (const [side, sign] of [["left", 1], ["right", -1]] as const) {
      const arm = owners.get(`${side}_upper_arm`)!, forearm = owners.get(`${side}_forearm`)!;
      longBone(arm, `${side}:humerus`, [0, 0, -.015], [0, 0, -.265], .022);
      longBone(forearm, `${side}:radius`, [sign * .012, -.003, -.015], [sign * .014, -.002, -.263], .010);
      longBone(forearm, `${side}:ulna`, [-sign * .012, .006, -.005], [-sign * .012, .006, -.258], .009);
      const clavicle = owners.get(`${side}_clavicle`)!;
      tube(clavicle, `${side}:clavicle`, [[0, -.015, 0], [sign * .05, -.025, .005], [sign * .118, 0, 0]], .008);
      ellipsoid(clavicle, `${side}:scapula`, [sign * .065, .043, -.043], [.045, .009, .065]);
      const thigh = owners.get(`${side}_thigh`)!, shin = owners.get(`${side}_shin`)!;
      // Derive long-bone length from the actual model rather than a separate rig.
      const bodyId = (name: string) => engine.mj.mj_name2id(engine.model, 1, name);
      const knee = bodyId(`${side}_shin`), ankle = bodyId(`${side}_foot`);
      const femurLength = Math.abs(engine.model.body_pos[knee * 3 + 2]);
      const shinLength = Math.abs(engine.model.body_pos[ankle * 3 + 2]);
      longBone(thigh, `${side}:femur`, [0, 0, -.015], [0, 0, -femurLength + .015], .028);
      longBone(shin, `${side}:tibia`, [0, -.009, -.015], [0, 0, -shinLength + .02], .019);
      longBone(shin, `${side}:fibula`, [-sign * .027, .007, -.025], [-sign * .022, .007, -shinLength + .028], .008);
      ellipsoid(shin, `${side}:patella`, [0, -.037, -.005], [.024, .012, .027], this.cartilage);
      const hand = owners.get(`${side}_hand`)!;
      for (let i = 0; i < 8; i++) ellipsoid(hand, `${side}:carpal:${i}`, [((i % 4) - 1.5) * .013, 0, -.006 - Math.floor(i / 4) * .014], [.007, .006, .008]);
      for (const finger of fingerBones.filter(f => f.name.startsWith(side) && f.name.endsWith("_1"))) {
        const joint = bodyId(finger.name), end = Array.from(engine.model.body_pos.slice(joint * 3, joint * 3 + 3)) as Point;
        longBone(hand, `${finger.name}:metacarpal`, [end[0] * .35, 0, -.018], end, .0045);
      }
      const foot = owners.get(`${side}_foot`)!;
      ellipsoid(foot, `${side}:calcaneus`, [0, .035, -.05], [.026, .037, .022]);
      for (let i = 0; i < 5; i++) {
        const x = sign * (-.035 + i * .018);
        longBone(foot, `${side}:metatarsal:${i}`, [x * .5, -.005, -.045], [x, -.125, -.05], .006);
      }
    }
    for (const finger of fingerBones) longBone(owners.get(finger.name)!, `${finger.name}:phalanx`, [0, 0, -.002], finger.tip, finger.radius * .48);
    for (const detail of detailBones.filter(d => d.name.includes("toe_"))) {
      const parent = owners.get(detail.parent);
      if (parent) longBone(parent, `${detail.name}:phalanx`, detail.position,
        detail.position.map((v, i) => v + detail.tip[i]) as Point, .004);
    }
    for (const name of ["torso", "chest", "neck"]) {
      const parent = owners.get(name)!;
      const count = name === "neck" ? 7 : name === "chest" ? 12 : 5;
      const spacing = name === "neck" ? .022 : name === "chest" ? .022 : .04;
      for (let i = 0; i < count; i++) {
        const z = i * spacing - (name === "chest" ? .08 : 0), width = name === "neck" ? .015 : .023;
        ellipsoid(parent, `${name}:vertebra:${i}`, [0, .025, z], [width, width * .8, spacing * .36]);
        ellipsoid(parent, `${name}:disc:${i}`, [0, .025, z - spacing * .43], [width * .9, width * .7, .003], this.cartilage);
        tube(parent, `${name}:spinous:${i}`, [[0, .025, z], [0, .06, z - .007]], .005);
      }
    }
    const chest = owners.get("chest")!;
    for (let rib = 0; rib < 12; rib++) {
      const z = -.10 + rib * .024, width = .095 + Math.sin(rib / 12 * Math.PI) * .05;
      for (const sign of [-1, 1]) {
        const points = Array.from({ length: 17 }, (_, i) => {
          const a = i / 16 * Math.PI;
          return [sign * width * Math.sin(a), .065 * Math.cos(a), z - .024 * Math.sin(a)] as Point;
        });
        tube(chest, `rib:${sign}:${rib}`, points, .0045);
      }
    }
    longBone(chest, "sternum", [0, -.067, -.08], [0, -.067, .15], .012);
    const pelvis = owners.get("pelvis")!;
    for (const sign of [-1, 1]) {
      const points: Point[] = [[0, .035, .035], [sign * .085, .055, .065], [sign * .13, .015, .025], [sign * .10, -.055, -.06], [sign * .045, -.065, -.07], [0, -.035, -.035]];
      tube(pelvis, `pelvis:${sign}`, points, .018);
    }
    ellipsoid(pelvis, "sacrum", [0, .044, -.01], [.035, .016, .055]);
    const head = owners.get("head")!;
    ellipsoid(head, "cranium", [0, .012, .025], [.071, .068, .09]);
    tube(head, "mandible", [[-.06, -.02, -.035], [-.045, -.06, -.07], [0, -.075, -.088], [.045, -.06, -.07], [.06, -.02, -.035]], .011);
    for (const sign of [-1, 1]) {
      const socket = Array.from({ length: 25 }, (_, i) => {
        const a = i / 24 * Math.PI * 2;
        return [sign * .032 + Math.cos(a) * .024, -.065, .018 + Math.sin(a) * .019] as Point;
      });
      tube(head, `orbit:${sign}`, socket, .005);
    }
    this.sync();
  }
  sync() {
    const d = this.engine.data;
    for (const { body, group } of this.attachments) {
      group.position.fromArray(d.xpos, body * 3);
      group.quaternion.set(d.xquat[body * 4 + 1], d.xquat[body * 4 + 2], d.xquat[body * 4 + 3], d.xquat[body * 4]);
    }
  }
}
