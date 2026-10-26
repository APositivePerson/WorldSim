import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as T from "three";
import load from "@mujoco/mujoco";
import { MuJoCoEngine } from "../src/physics/MuJoCoEngine.ts";
import { HumanController } from "../src/human/HumanController.ts";
import { HumanRenderer } from "../src/rendering/HumanRenderer.ts";
import { SkinSurface } from "../src/rendering/SkinSurface.ts";

test("imported materials retain authored transparency when leaving skeleton view", () => {
  const material = new T.MeshStandardMaterial({ opacity: .6, transparent: true, depthWrite: false });
  const mesh = new T.Mesh(new T.BoxGeometry(), material);
  mesh.castShadow = false;
  const surface = new SkinSurface(mesh);
  surface.setOpacity(.18);
  assert.equal(material.opacity, .6 * .18);
  surface.setOpacity(1);
  assert.equal(material.opacity, .6);
  assert.equal(material.transparent, true);
  assert.equal(material.depthWrite, false);
  assert.equal(mesh.castShadow, false);
  assert.equal(mesh.geometry.getAttribute("skinSurface"), undefined);
  surface.dispose(); mesh.geometry.dispose(); material.dispose();
});

test("solid bones and skin detail preserve the physical rig and follow joint movement", async () => {
  const mj = await load();
  const engine = new MuJoCoEngine(mj, await readFile(new URL("../public/models/human.xml", import.meta.url), "utf8"));
  const controller = new HumanController(engine), renderer = new HumanRenderer(engine);
  try {
    const file = await readFile(new URL("../public/models/human-skinned.glb", import.meta.url));
    await renderer.loadSkin(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
    const before = engine.data.qpos.slice(), mass = engine.totalMass;
    renderer.setBoneVisible(true);
    renderer.setSurfaceOpacity(.18);
    renderer.sync();
    assert.deepEqual(engine.data.qpos, before);
    assert.equal(engine.totalMass, mass);
    assert.equal(renderer.avatar!.boneCount, 92);
    let skinVertices = 0, maskedClothing = 0;
    renderer.avatar!.scene.traverse(o => {
      if (!(o instanceof T.SkinnedMesh)) return;
      const mask = o.geometry.getAttribute("skinSurface");
      if (!mask) return;
      const color = o.geometry.getAttribute("color");
      for (let i = 0; i < mask.count; i++) {
        if (mask.getX(i) > .5) skinVertices++;
        if (color.getX(i) < color.getY(i) && mask.getX(i) > 0) maskedClothing++;
      }
      assert.equal((o.material as T.Material).opacity, .18);
      assert.equal((o.material as T.Material).depthWrite, false);
    });
    assert.ok(skinVertices > 1000, `skin mask: ${skinVertices}`);
    assert.equal(maskedClothing, 0, "skin shading must exclude blue/green clothes");
    const frame = renderer.boneLayer.group.getObjectByName("bone-frame:right_hand")!;
    const initial = frame.position.clone();
    controller.execute({ action: "raise_right_arm" });
    for (let i = 0; i < 1600; i++) { controller.update(engine.dt); engine.step(); }
    renderer.sync();
    const id = mj.mj_name2id(engine.model, 1, "right_hand");
    assert.ok(frame.position.distanceTo(initial) > .2);
    assert.ok(frame.position.distanceTo(new T.Vector3().fromArray(engine.data.xpos, id * 3)) < 1e-8);
    assert.ok(renderer.boneLayer.group.getObjectByName("right:radius"));
    assert.ok(renderer.boneLayer.group.getObjectByName("right:ulna"));
    assert.ok(renderer.boneLayer.group.getObjectByName("rib:1:11"));
    renderer.setSkinVisible(false);
    for (const [g, mesh] of renderer.meshes) if (engine.isHumanBody(engine.model.geom_bodyid[g])) assert.equal(mesh.visible, false);
    renderer.setBoneVisible(false);
    renderer.setSurfaceOpacity(1);
    renderer.setSkinVisible(true);
    controller.reset(); renderer.sync();
    for (const value of frame.position.toArray()) assert.ok(Number.isFinite(value));
  } finally { renderer.dispose(); controller.dispose(); engine.dispose(); }
});
