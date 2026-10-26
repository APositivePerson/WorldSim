import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as T from "three";
import load from "@mujoco/mujoco";
import { MuJoCoEngine } from "../src/physics/MuJoCoEngine.ts";
import { HumanController } from "../src/human/HumanController.ts";
import { SkinnedHuman } from "../src/rendering/SkinnedHuman.ts";
import { MuscleLayer } from "../src/rendering/MuscleLayer.ts";
const mj = await load();
const xml = await readFile(new URL("../public/models/human-free.xml", import.meta.url), "utf8");
function fixture() {
  const e = new MuJoCoEngine(mj, xml), c = new HumanController(e);
  return { e, c, run(seconds: number) {
    for (let i = 0; i < Math.round(seconds / e.dt); i++) { c.update(e.dt); e.step(); }
  }, dispose() { c.dispose(); e.dispose(); } };
}
test("finger joints move through torque, deform their skin, reopen, and preserve hand mass", async () => {
  const f = fixture();
  const file = await readFile(new URL("../public/models/human-skinned.glb", import.meta.url));
  const skin = await SkinnedHuman.load(f.e, file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
  assert.ok(skin);
  try {
    assert.equal(f.e.joints.filter((j) => j.name.endsWith("_flex") && /index|middle|ring|little|thumb/.test(j.name)).length, 30);
    const masses = f.e.bodyState().segments;
    for (const side of ["left", "right"]) {
      const mass = masses.filter((b) => b.name === `${side}_hand` || new RegExp(`^${side}_(index|middle|ring|little|thumb)_`).test(b.name))
        .reduce((s, b) => s + b.mass, 0);
      assert.ok(Math.abs(mass - 0.45) < 1e-9);
    }
    f.run(2);
    skin.sync();
    const tip = skin.scene.getObjectByName("right_index_3")!;
    const before = tip.getWorldPosition(new T.Vector3());
    const index = f.e.joints.find((j) => j.name === "right_index_1_flex")!;
    const little = f.e.joints.find((j) => j.name === "right_little_1_flex")!;
    const initial = f.e.data.qpos[index.q];
    const restingLittle = f.e.data.qpos[little.q];
    f.c.setFinger("right", "index", 1);
    assert.equal(f.e.data.qpos[index.q], initial, "command must not teleport the joint");
    f.run(2); skin.sync();
    assert.ok(f.e.data.qpos[index.q] > 0.7);
    assert.ok(Math.abs(f.e.data.qpos[little.q] - restingLittle) < 0.03, "other fingers retain their resting curl independently");
    assert.ok(tip.getWorldPosition(new T.Vector3()).distanceTo(before) > 0.025);
    f.c.execute({ action: "open_hands", duration: 0.5 }); f.run(2);
    assert.ok(Math.abs(f.e.data.qpos[index.q]) < 0.1);
    f.c.setJoint("right_wrist", 0.4); f.run(2);
    const wrist = f.e.joints.find((j) => j.name === "right_wrist")!;
    assert.ok(f.e.data.qpos[wrist.q] > 0.3);
    f.c.execute({ action: "bend_left_elbow", duration: 2 }); f.run(0.2);
    f.c.execute({ action: "close_left_hand", duration: 2 }); f.run(0.2);
    f.c.execute({ action: "close_right_hand", duration: 0.5 }); f.run(3);
    for (const side of ["left", "right"]) {
      const finger = f.e.joints.find((j) => j.name === `${side}_index_1_flex`)!;
      assert.ok(f.e.data.qpos[finger.q] > 0.7, "new hand commands retain pending targets on other joints");
    }
    const elbow = f.e.joints.find((j) => j.name === "left_elbow")!;
    assert.ok(f.e.data.qpos[elbow.q] > 1.5, "hand commands must not cancel the arm pose");
  } finally { skin.dispose(); f.dispose(); }
});
test("resting palms face the thighs, fingers curl gently and explicit opening still wins", () => {
  const f = fixture();
  try {
    f.run(2);
    for (const [side, sign] of [["left", -1], ["right", 1]] as const) {
      const hand = f.e.mj.mj_name2id(f.e.model, 1, `${side}_hand`);
      assert.ok(-f.e.data.xmat[hand * 9 + 1] * sign > .7, "palm should face inward");
      const finger = f.e.joints.find(j => j.name === `${side}_ring_1_flex`)!;
      assert.ok(f.e.data.qpos[finger.q] > .1 && f.e.data.qpos[finger.q] < .4);
    }
    f.c.execute({ action: "open_hands", duration: .5 }); f.run(2);
    for (const j of f.e.joints.filter(j => /_(index|middle|ring|little)_\d_flex$/.test(j.name)))
      assert.ok(Math.abs(f.e.data.qpos[j.q]) < .06, "explicit opening must override the resting curl");
  } finally { f.dispose(); }
});
test("walking arms alternate, explicit arm poses take control, and stopping returns arms to rest", () => {
  const f = fixture();
  try {
    f.c.execute({ action: "walk_forward" });
    let lo = Infinity, hi = -Infinity;
    const left = f.e.joints.find((j) => j.name === "left_shoulder_flex")!;
    const right = f.e.joints.find((j) => j.name === "right_shoulder_flex")!;
    for (let i = 0; i < 18 / f.e.dt; i++) {
      f.c.update(f.e.dt); f.e.step();
      if (i > 3000) {
        lo = Math.min(lo, f.e.data.qpos[left.q]); hi = Math.max(hi, f.e.data.qpos[left.q]);
        assert.ok(Math.abs(f.e.data.qpos[left.q] + f.e.data.qpos[right.q]) < 0.12);
      }
    }
    assert.ok(hi - lo > 0.3, "arms must actually swing in physics");
    f.c.execute({ action: "raise_right_arm", duration: 1 }); f.run(4);
    const shoulder = f.e.joints.find((j) => j.name === "right_shoulder")!;
    assert.ok(f.e.data.qpos[shoulder.q] > 1.7);
    f.c.execute({ action: "lower_arms", duration: 1 }); f.run(2);
    f.c.execute({ action: "stop_walk" }); f.run(7);
    assert.equal(f.c.locomotion!.mode, "stand");
    assert.ok(Math.abs(f.e.data.qpos[left.q]) < 0.08);
    assert.ok(Math.abs(f.e.data.qpos[right.q]) < 0.08);
  } finally { f.dispose(); }
});
test("body weight scales mass and inertia together; 45 and 100 kg models stand and walk", () => {
  for (const kg of [45, 100]) {
    const f = fixture();
    try {
      const mass = f.e.totalMass, inertia = f.e.model.body_inertia[3];
      f.e.setTotalMass(kg); f.c.reset();
      assert.ok(Math.abs(f.e.totalMass - kg) < 1e-8);
      assert.ok(Math.abs(f.e.model.body_inertia[3] / inertia - kg / mass) < 1e-8);
      assert.ok(Math.abs(f.e.bodyState().weight - kg * 9.81) < 1e-6);
      const actuator=f.e.joints.find(j=>j.name==="left_knee")!.actuator;
      const originalGain=f.e.model.actuator_gainprm[actuator*10];
      f.run(8); f.c.execute({ action: "walk_forward" }); f.run(16);
      assert.equal(f.c.locomotion!.mode, "walk");
      assert.ok(f.c.locomotion!.steps >= 3);
      assert.ok(f.e.data.qpos[2] > 0.88);
      f.c.execute({action:"stop_walk"});f.run(6);
      assert.equal(f.c.locomotion!.mode,"stand");
      assert.equal(f.e.model.actuator_gainprm[actuator*10],originalGain,"restore standing controller gain");
      f.c.execute({action:"walk_forward"});f.run(.8);f.c.reset();
      assert.equal(f.e.model.actuator_gainprm[actuator*10],originalGain,"reset during walking also restores gain");
      assert.throws(() => f.e.setTotalMass(NaN));
      assert.throws(() => f.e.setTotalMass(0));
    } finally { f.dispose(); }
  }
});
test("muscle load layer follows actual body motion and does not change physics or mass", () => {
  const f = fixture();
  const layer = new MuscleLayer(f.e);
  try {
    const mass = f.e.totalMass;
    layer.group.visible = true;
    f.c.execute({ action: "bend_left_elbow" }); f.run(3);
    const qpos = f.e.data.qpos.slice();
    layer.sync();
    assert.deepEqual(f.e.data.qpos, qpos);
    assert.equal(f.e.totalMass, mass);
    const muscle = layer.group.getObjectByName("left_biceps") as T.Mesh<T.SphereGeometry, T.MeshStandardMaterial>;
    assert.ok(Number.isFinite(muscle.position.z));
    assert.ok(muscle.scale.x > 0.039);
    assert.ok(muscle.material.color.r > 0);
  } finally {
    layer.group.traverse((o) => { if (o instanceof T.Mesh) { o.geometry.dispose(); o.material.dispose(); } });
    f.dispose();
  }
});
test("mirrored thumbs open beside the index, then oppose over the four curled fingers with contact", () => {
  const f = fixture();
  function localTip(side: "left" | "right") {
    const d = f.e.data;
    const id = (name: string) => f.e.mj.mj_name2id(f.e.model, 1, name);
    const palm = id(`${side}_hand`), thumb = id(`${side}_thumb_3`);
    const rotation = (b: number) => new T.Quaternion(d.xquat[b * 4 + 1], d.xquat[b * 4 + 2], d.xquat[b * 4 + 3], d.xquat[b * 4]);
    return new T.Vector3(0, 0, -0.022).applyQuaternion(rotation(thumb))
      .add(new T.Vector3().fromArray(d.xpos, thumb * 3))
      .sub(new T.Vector3().fromArray(d.xpos, palm * 3)).applyQuaternion(rotation(palm).invert());
  }
  try {
    f.c.execute({ action: "open_hands", duration: .5 });
    f.run(1);
    for (const [side, sign] of [["left", 1], ["right", -1]] as const) {
      assert.ok(localTip(side).x * sign > 0.075, "open thumb must protrude at the index side of the palm");
      f.c.execute({ action: side === "left" ? "close_left_hand" : "close_right_hand", duration: 2 });
      f.run(0.5);
      const opposition = f.e.joints.find((j) => j.name === `${side}_thumb_opposition`)!;
      const index = f.e.joints.find((j) => j.name === `${side}_index_1_flex`)!;
      assert.ok(f.e.data.qpos[index.q] > 0.25, "four fingers lead the closing motion");
      assert.ok(Math.abs(f.e.data.qpos[opposition.q]) < 0.15, "thumb closes later to stay outside the fist");
      f.run(3);
      const tip = localTip(side);
      assert.ok(tip.y < -0.035, `thumb remains on the palmar outside, ${side}: ${tip.toArray()}`);
      assert.ok(tip.x * sign < 0.03 && tip.x * sign > -0.04, "thumb crosses toward the index/middle rather than disappearing inside the palm");
      let touches = false;
      for (let i = 0; i < f.e.data.ncon; i++) {
        const contact = f.e.data.contact.get(i)!;
        const names = [contact.geom1, contact.geom2].map((g) => f.e.mj.mj_id2name(f.e.model, 1, f.e.model.geom_bodyid[g]));
        if (names.some((n) => n.startsWith(`${side}_thumb_`)) && names.some((n) => new RegExp(`^${side}_(index|middle|ring|little)_`).test(n))) {
          touches = true;
          assert.ok(contact.dist > -0.002, "thumb/finger contact must not deeply penetrate");
        }
      }
      assert.ok(touches, "thumb must actually contact the curled fingers");
      f.c.execute({ action: "open_hands", duration: 1 }); f.run(2);
      assert.ok(localTip(side).x * sign > 0.075, "thumb can release and reopen");
    }
  } finally { f.dispose(); }
});
test("waist, thorax, neck, shoulder girdle, forearm and wrist are independent physical articulations", async () => {
  const e = new MuJoCoEngine(mj, await readFile(new URL("../public/models/human.xml", import.meta.url), "utf8"));
  const c = new HumanController(e);
  try {
    assert.equal(e.model.nu, 85);
    for (const name of ["spine_flex", "spine_twist", "chest_flex", "chest_sidebend", "chest_twist",
      "neck_pitch", "neck_roll", "left_scapula_elevation", "right_scapula_protraction",
      "left_shoulder_rotation", "right_forearm_rotation", "right_wrist_deviation", "left_index_spread", "right_toe_flex"]) {
      c.reset();
      const joint = e.joints.find((j) => j.name === name)!;
      assert.ok(joint, name);
      const before = e.data.qpos[joint.q];
      // Elevation is negative for the left mirrored clavicle; depression with
      // a hanging arm is correctly constrained by contact with the thigh.
      const target = name === "left_scapula_elevation" ? -0.12 : 0.12;
      c.setJoint(name, target);
      assert.equal(e.data.qpos[joint.q], before, "joint command must not write qpos");
      for (let i = 0; i < 600; i++) { c.update(e.dt); e.step(); }
      assert.ok(e.data.qpos[joint.q] * Math.sign(target) > 0.07, `${name} must physically articulate`);
    }
    c.reset();
    const run = () => { for (let i = 0; i < 1000; i++) { c.update(e.dt); e.step(); } };
    c.setJoint("left_shoulder", -0.9); run();
    const hand = e.mj.mj_name2id(e.model, 1, "left_hand");
    const position = () => new T.Vector3().fromArray(e.data.xpos, hand * 3);
    const orientation = () => new T.Quaternion(e.data.xquat[hand * 4 + 1], e.data.xquat[hand * 4 + 2], e.data.xquat[hand * 4 + 3], e.data.xquat[hand * 4]);
    const before = position(), rotation = orientation();
    c.setJoint("left_shoulder_rotation", 0.5); run();
    assert.ok(orientation().angleTo(rotation) > 0.3, "a raised arm must twist about the humerus");
    assert.ok(position().distanceTo(before) < 0.025, "axial shoulder rotation should not orbit the straight arm around the torso");
  } finally { c.dispose(); e.dispose(); }
});
