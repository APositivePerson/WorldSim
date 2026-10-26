import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as T from "three";
import load from "@mujoco/mujoco";
import { MuJoCoEngine } from "../src/physics/MuJoCoEngine.ts";
import { HumanController } from "../src/human/HumanController.ts";
import { SkinnedHuman } from "../src/rendering/SkinnedHuman.ts";
const mj = await load();
const xml = await readFile(new URL("../public/models/human-free.xml", import.meta.url), "utf8");
function fixture() {
  const e = new MuJoCoEngine(mj, xml), c = new HumanController(e);
  return { e, c, run(seconds: number) {
    for (let i = 0; i < Math.round(seconds / e.dt); i++) { c.update(e.dt); e.step(); }
  }, dispose() { c.dispose(); e.dispose(); } };
}
test("continuous skin is closed; corrective shapes respond to actual physics and freeze when paused", async () => {
  const f = fixture();
  const file = await readFile(new URL("../public/models/human-skinned.glb", import.meta.url));
  const skin = await SkinnedHuman.load(f.e, file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
  assert.ok(skin);
  try {
    let mesh!: T.SkinnedMesh;
    skin.scene.traverse((o) => { if (o instanceof T.SkinnedMesh) mesh = o; });
    const report = mesh.userData.surface;
    assert.equal(report.connectedComponents, 1);
    // Inspect the actual first (continuous skin) index group, not just metadata.
    const edges = new Map<string, number>();
    const indices = mesh.geometry.index!;
    const source = mesh.geometry.getAttribute("_source_index");
    for (let i = 0; i < report.triangles * 3; i += 3) {
      const ids = [indices.getX(i), indices.getX(i + 1), indices.getX(i + 2)].map(id => source ? source.getX(id) : id);
      for (let k = 0; k < 3; k++) {
        const a = ids[k], b = ids[(k + 1) % 3], key = `${Math.min(a,b)}:${Math.max(a,b)}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    assert.ok(edges.size > 100000);
    assert.ok([...edges.values()].every((count) => count === 2), "every skin edge must have two incident faces");
    const weight = mesh.geometry.attributes.skinWeight;
    for (let i = 0; i < weight.count; i++) assert.ok(Math.abs(weight.getX(i)+weight.getY(i)+weight.getZ(i)+weight.getW(i)-1)<1e-6);
    assert.equal(Object.keys(mesh.morphTargetDictionary!).length, 29);
    assert.equal(mesh.geometry.morphAttributes.normal.length, 29);
    const normal = mesh.geometry.attributes.normal;
    for (let i=0;i<normal.count;i++) assert.ok(Math.abs(Math.hypot(normal.getX(i),normal.getY(i),normal.getZ(i))-1)<1e-4);
    f.c.setJoint("left_wrist",0.5); f.run(2); skin.sync();
    assert.ok(mesh.morphTargetInfluences![mesh.morphTargetDictionary!.left_wrist_flex]>0.6);
    assert.equal(mesh.morphTargetInfluences![mesh.morphTargetDictionary!.left_wrist_extend],0);
    f.c.setJoint("left_wrist",-0.5); f.run(2); skin.sync();
    assert.ok(mesh.morphTargetInfluences![mesh.morphTargetDictionary!.left_wrist_extend]>0.6);
    f.c.reset();
    f.c.execute({ action: "bend_left_elbow", duration: 1 }); f.run(4);
    const qpos = f.e.data.qpos.slice(), mass = f.e.totalMass;
    skin.sync();
    const elbow = mesh.morphTargetDictionary!.left_elbow_volume;
    assert.ok(mesh.morphTargetInfluences![elbow] > 0.8);
    const frozen = mesh.morphTargetInfluences!.slice(); skin.sync(); skin.sync();
    assert.deepEqual(mesh.morphTargetInfluences, frozen);
    assert.deepEqual(f.e.data.qpos, qpos); assert.equal(f.e.totalMass, mass);
    skin.corrections.enabled = false; skin.corrections.softTissue = false; skin.sync();
    assert.ok(mesh.morphTargetInfluences!.every((value) => value === 0));
    f.c.reset(); skin.sync();
    const eye = skin.scene.getObjectByName("left_eye") as T.Bone;
    const initialEye = eye.quaternion.clone(), initialPose = f.e.data.qpos.slice();
    f.c.execute({ action: "look_left", duration: 2 }); skin.sync();
    assert.deepEqual(f.e.data.qpos, initialPose, "gaze must not teleport the neck");
    assert.ok(eye.quaternion.angleTo(initialEye) > 0.1, "eyes turn before physical neck/chest motion");
  } finally { skin.dispose(); f.dispose(); }
});
test("bilateral reaching coordinates joints without teleporting; hand commands retain reach and look redirects it", () => {
  const f = fixture();
  try {
    for (const side of ["left", "right"] as const) {
      f.c.reset(); f.run(1);
      const initial = f.e.data.qpos.slice();
      assert.equal(f.c.execute({ action: side === "left" ? "reach_left" : "reach_right", duration: 2 }), true);
      assert.deepEqual(f.e.data.qpos, initial);
      f.run(6);
      assert.equal(f.c.status, "completed", f.c.error);
      assert.ok(f.c.reach.error < 0.025);
      assert.ok(f.e.data.qpos[2] > 0.88);
      const joint = (name: string) => f.e.joints.find((j) => j.name === `${side}_${name}`)!;
      assert.ok(f.e.data.qpos[joint("elbow").q] > 1);
      assert.ok(Math.abs(f.e.data.qpos[joint("wrist").q]) > 0.05);
      f.c.setFinger(side, "index", 0.8); f.run(1);
      assert.equal(f.c.reach.active, true);
      assert.ok(f.c.reach.error < 0.025);
      f.c.execute({ action: "look_left", duration: 2 });
      assert.equal(f.c.reach.active, false);
      assert.ok(f.e.gazeTarget);
      f.run(0.4);
      const neck = f.c.snapshot().find((j) => j.name === "neck_yaw")!;
      const chest = f.c.snapshot().find((j) => j.name === "chest_twist")!;
      assert.ok(neck.trajectory > 0.01);
      assert.equal(chest.trajectory, 0, "neck starts before chest");
      f.run(5); assert.equal(f.c.status, "completed");
    }
    f.c.reset();
    assert.equal(f.e.gazeTarget, null);
    assert.equal(f.c.execute({ action: "reach_right", target: [10, 10, 10] }), false);
    assert.equal(f.c.reach.active, false);
    assert.equal(f.c.execute({ action: "reach_right", target: [NaN, 0, 0] }), false);
  } finally { f.dispose(); }
});
test("native elbow muscles supply real forces with position motors disabled, fatigue and recover", () => {
  const f = fixture();
  try {
    assert.equal(f.e.model.na, 4); assert.equal(f.e.model.ntendon, 4);
    f.c.muscles.setEnabled(true);
    f.c.execute({ action: "bend_left_elbow", duration: 1.7 }); f.run(8);
    const elbow = f.e.joints.find((j) => j.name === "left_elbow")!;
    assert.ok(f.e.data.qpos[elbow.q] > 1.5);
    assert.equal(f.c.status, "completed", f.c.error);
    let muscles = f.c.muscles.snapshot().muscles;
    assert.ok(muscles.some((m) => m.side === "left" && m.force > 50));
    assert.ok(muscles.every((m) => m.motorForce === 0));
    assert.equal(f.e.model.actuator_gainprm[elbow.actuator * 10], 0);
    assert.equal(f.e.model.actuator_biasprm[elbow.actuator * 10 + 1], 0);
    f.c.muscles.setExcitation("left", 0.55, 0.55); f.run(20);
    muscles = f.c.muscles.snapshot().muscles.filter((m) => m.side === "left");
    assert.ok(muscles.every((m) => m.activation > 0.5 && m.capacity < 0.7));
    const fatigued = muscles.map((m) => m.fatigue);
    f.c.muscles.setExcitation("left", 0, 0); f.run(20);
    const rested = f.c.muscles.snapshot().muscles.filter((m) => m.side === "left");
    assert.ok(rested.every((m, i) => m.activation < 1e-5 && m.fatigue < fatigued[i] * 0.7));
    assert.ok(rested.some((m) => m.force > 1), "native passive force persists without excitation");
    f.c.reset(); assert.ok(f.c.muscles.snapshot().muscles.every((m) => m.fatigue === 0));
    f.c.muscles.setEnabled(false);
    assert.ok(f.e.model.actuator_gainprm[elbow.actuator * 10] > 0);
    assert.ok(f.c.muscles.snapshot().muscles.every((m) => Math.abs(m.force) < 1e-10));
    assert.ok(f.e.data.qpos.every(Number.isFinite));
    assert.ok(f.e.data.xfrc_applied.every((v) => v === 0));
    assert.ok(f.e.data.qfrc_applied.every((v) => v === 0));
  } finally { f.dispose(); }
});
