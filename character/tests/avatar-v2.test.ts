import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as T from "three";
import load from "@mujoco/mujoco";
import { MuJoCoEngine } from "../src/physics/MuJoCoEngine.ts";
import { HumanController } from "../src/human/HumanController.ts";
import { SkinnedHuman } from "../src/rendering/SkinnedHuman.ts";

test("v2 ships embedded skin assets and weighted auxiliary bones that deform real vertices", async () => {
  const mj = await load();
  const engine = new MuJoCoEngine(mj, await readFile(new URL("../public/models/human.xml", import.meta.url), "utf8"));
  const controller = new HumanController(engine);
  const bytes = await readFile(new URL("../public/models/human-skinned.glb", import.meta.url));
  const metadata = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  assert.equal(metadata.images.length, 4);
  assert.deepEqual(metadata.images.map((i: { name: string }) => i.name), ["skin-v2-albedo", "skin-v2-normal", "skin-v2-roughness", "skin-v2-thickness"]);
  const skin = await SkinnedHuman.load(engine, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  assert.ok(skin);
  try {
    let mesh!: T.SkinnedMesh;
    skin.scene.traverse(o => { if (o instanceof T.SkinnedMesh) mesh = o; });
    assert.equal(skin.deformation.count, 25);
    assert.ok(mesh.geometry.getAttribute("uv"));
    const indices = mesh.geometry.getAttribute("skinIndex"), weights = mesh.geometry.getAttribute("skinWeight");
    const sample = (name: string) => {
      const j = mesh.skeleton.bones.findIndex(b => b.name === name);
      assert.ok(j >= 0, name);
      let vertex = -1, maximum = 0;
      for (let i = 0; i < indices.count; i++) for (let k = 0; k < 4; k++) {
        if (indices.getComponent(i, k) === j && weights.getComponent(i, k) > maximum) {
          vertex = i; maximum = weights.getComponent(i, k);
        }
      }
      assert.ok(vertex >= 0 && maximum > .1, `${name} must influence the skin`);
      return vertex;
    };
    const jaw = sample("jaw_deform"), lid = sample("left_lid_upper");
    for (const name of ["left_forearm_twist_1", "right_forearm_twist_3", "left_shoulder_deform_1", "torso_deform_1", "chest_deform_2", "left_brow_deform", "right_cheek_deform"]) sample(name);
    const beforeJaw = mesh.getVertexPosition(jaw, new T.Vector3()).clone();
    const beforeLid = mesh.getVertexPosition(lid, new T.Vector3()).clone();
    const qpos = engine.data.qpos.slice();
    assert.equal(skin.deformation.setFace({ jawOpen: .7, smile: .5, browRaise: .6, blink: 1, autoBlink: false }), true);
    skin.sync(); mesh.skeleton.update();
    assert.deepEqual(engine.data.qpos, qpos);
    assert.ok(mesh.getVertexPosition(jaw, new T.Vector3()).distanceTo(beforeJaw) > .003);
    assert.ok(mesh.getVertexPosition(lid, new T.Vector3()).distanceTo(beforeLid) > .002);
    assert.equal(skin.deformation.setFace({ jawOpen: NaN }), false);
    assert.equal(skin.deformation.setFace({ blink: 2 }), false);
    controller.setJoint("right_forearm_rotation", 1);
    for (let i = 0; i < 1000; i++) { controller.update(engine.dt); engine.step(); }
    const joint = engine.joints.find(j => j.name === "right_forearm_rotation")!;
    assert.ok(engine.data.qpos[joint.q] > .8);
    const before = engine.data.qpos.slice();
    skin.sync();
    const helper = skin.scene.getObjectByName("right_forearm_twist_1") as T.Bone;
    assert.ok(Math.abs(helper.rotation.z + engine.data.qpos[joint.q] * .82) < .0001);
    assert.deepEqual(engine.data.qpos, before);
    skin.deformation.enabled = false; skin.sync();
    assert.ok(helper.quaternion.angleTo(new T.Quaternion()) < 1e-8);
  } finally { skin.dispose(); controller.dispose(); engine.dispose(); }
});
