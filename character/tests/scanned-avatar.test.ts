import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as T from "three";
import load from "@mujoco/mujoco";
import { MuJoCoEngine } from "../src/physics/MuJoCoEngine.ts";
import { HumanController } from "../src/human/HumanController.ts";
import { SkinnedHuman } from "../src/rendering/SkinnedHuman.ts";
const scanPath = new URL("../artifacts/scanned-private/runtime/eric.glb", import.meta.url);
test("locally licensed photographic scan preserves physical bindings, fingers and source provenance", { skip: !existsSync(scanPath) }, async () => {
  const mj = await load();
  const engine = new MuJoCoEngine(mj, await readFile(new URL("../public/models/human.xml", import.meta.url), "utf8"));
  const controller = new HumanController(engine);
  const file = await readFile(scanPath);
  const gltf = JSON.parse(file.subarray(20,20+file.readUInt32LE(12)).toString());
  assert.equal(gltf.images.length,4);
  assert.match(gltf.asset.copyright,/NOT CC0/);
  const avatar = await SkinnedHuman.load(engine,file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength) as ArrayBuffer);
  assert.ok(avatar);
  try {
    assert.equal(avatar.bindings.length,51);assert.equal(avatar.boneCount,99);
    const mesh = avatar.scene.getObjectByName("ScannedHumanEric") as T.SkinnedMesh;
    assert.equal(mesh.userData.scanAsset.retargeted,true);
    const weights=mesh.geometry.getAttribute("skinWeight");
    for(let i=0;i<weights.count;i++)assert.ok(Math.abs(weights.getX(i)+weights.getY(i)+weights.getZ(i)+weights.getW(i)-1)<1e-5);
    const index=mesh.skeleton.bones.findIndex(b=>b.name==="right_index_3"),indices=mesh.geometry.getAttribute("skinIndex");
    const vertex=Array.from({length:indices.count},(_,i)=>i).find(i=>indices.getX(i)===index&&weights.getX(i)>.5)!;
    assert.ok(vertex>=0);
    const before=mesh.getVertexPosition(vertex,new T.Vector3()).clone();
    controller.setFinger("right","index",1);
    for(let i=0;i<1000;i++){controller.update(engine.dt);engine.step();}
    const physical=engine.data.qpos.slice();avatar.sync();
    assert.deepEqual(engine.data.qpos,physical);
    assert.ok(mesh.getVertexPosition(vertex,new T.Vector3()).distanceTo(before)>.02);
    for(const {bone,body} of avatar.bindings)assert.ok(bone.getWorldPosition(new T.Vector3()).distanceTo(new T.Vector3().fromArray(engine.data.xpos,body*3))<1e-7);
    assert.equal(avatar.deformation.setFace({blink:1,jawOpen:.3}),true);avatar.sync();
    assert.ok((avatar.scene.getObjectByName("scan_eyelid_l") as T.Bone).rotation.x>.1);
  } finally {avatar.dispose();controller.dispose();engine.dispose();}
});
