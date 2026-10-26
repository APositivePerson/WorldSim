import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as T from "three";
import load from "@mujoco/mujoco";
import { MuJoCoEngine } from "../src/physics/MuJoCoEngine.ts";
import { HumanController } from "../src/human/HumanController.ts";
import { SkinnedHuman } from "../src/rendering/SkinnedHuman.ts";
const mj = await load();
const xml = await readFile(
  new URL("../public/models/human-free.xml", import.meta.url),
  "utf8",
);
const file = await readFile(
  new URL("../public/models/human-skinned.glb", import.meta.url),
);
const bytes = file.buffer.slice(
  file.byteOffset,
  file.byteOffset + file.byteLength,
) as ArrayBuffer;
test("92-bone GLB preserves physical bindings and weighted fingers follow arm motion and reset", async () => {
  const e = new MuJoCoEngine(mj, xml),
    c = new HumanController(e);
  const skin = await SkinnedHuman.load(e, bytes);
  assert.ok(skin);
  try {
    assert.equal(skin.bindings.length, 51);
    assert.equal(skin.boneCount, 92);
    assert.equal(skin.deformation.count, 25);
    let mesh: T.SkinnedMesh | undefined;
    skin.scene.traverse((o) => {
      if (o instanceof T.SkinnedMesh) mesh = o;
    });
    assert.ok(mesh);
    assert.ok(mesh.geometry.attributes.skinWeight.count > 1000);
    const finger = skin.scene.getObjectByName("right_index_3") as T.Bone;
    assert.ok(finger instanceof T.Bone);
    assert.equal(finger.parent?.name, "right_index_2");
    const fingerIndex = mesh.skeleton.bones.indexOf(finger);
    const fingerVertex = Array.from(mesh.geometry.attributes.skinIndex.array)
      .findIndex((value, index) => index % 4 === 0 && value === fingerIndex) / 4;
    assert.ok(fingerVertex >= 0, "finger geometry must use the detail bone weights");
    const fingerBefore = mesh.localToWorld(mesh.getVertexPosition(fingerVertex, new T.Vector3())).clone();
    const fingerLocal = finger.position.clone();
    const shoulder = e.mj.mj_name2id(e.model, 1, "right_upper_arm") - 1;
    const indices = mesh.geometry.attributes.skinIndex;
    // A vertex at the shoulder pivot barely moves; use the most distal weighted
    // vertex so this checks deformation independently of mesh/export ordering.
    let vertex = -1, farthest = -1;
    const pivot = new T.Vector3().fromArray(e.data.xpos, (shoulder + 1) * 3);
    for (let i = 0; i < indices.count; i++) {
      if (indices.getX(i) !== shoulder) continue;
      const distance = mesh.localToWorld(mesh.getVertexPosition(i, new T.Vector3())).distanceToSquared(pivot);
      if (distance > farthest) { vertex = i; farthest = distance; }
    }
    assert.ok(vertex >= 0);
    const before = mesh
      .localToWorld(mesh.getVertexPosition(vertex, new T.Vector3()))
      .clone();
    c.execute({ action: "raise_right_arm" });
    for (let i = 0; i < 2000; i++) {
      c.update(e.dt);
      e.step();
    }
    skin.sync();
    for (const { bone, body } of skin.bindings) {
      const p = bone.getWorldPosition(new T.Vector3());
      assert.ok(
        p.distanceTo(new T.Vector3().fromArray(e.data.xpos, body * 3)) < 1e-7,
        bone.name,
      );
    }
    const after = mesh.localToWorld(
      mesh.getVertexPosition(vertex, new T.Vector3()),
    );
    assert.ok(mesh.localToWorld(mesh.getVertexPosition(fingerVertex, new T.Vector3()))
      .distanceTo(fingerBefore) > 0.2, "finger must follow the physically raised arm");
    assert.ok(finger.position.distanceTo(fingerLocal) < 1e-10,
      "detail bone must retain its local anatomical offset");
    assert.ok(
      after.distanceTo(before) > 0.05,
      "vertices must deform via physics-driven skinning",
    );
    c.reset();
    skin.sync();
    assert.ok(mesh.localToWorld(mesh.getVertexPosition(fingerVertex, new T.Vector3()))
      .distanceTo(fingerBefore) < 1e-6, "reset restores the detail skin too");
    for (const { bone, body } of skin.bindings) {
      assert.ok(
        bone
          .getWorldPosition(new T.Vector3())
          .distanceTo(new T.Vector3().fromArray(e.data.xpos, body * 3)) < 1e-7,
      );
    }
  } finally {
    skin.dispose();
    c.dispose();
    e.dispose();
  }
});
test("GLB load cancellation skips binding to an already disposed engine", async () => {
  const e = new MuJoCoEngine(mj, xml);
  e.dispose();
  assert.equal(await SkinnedHuman.load(e, bytes, () => true), null);
});
