// Reproducible, project-owned GLB. No downloaded model or third-party asset license.
import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import load from "@mujoco/mujoco";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MuJoCoEngine } from "../src/physics/MuJoCoEngine.ts";
import { detailBones, fingerBones } from "../src/human/Anatomy.ts";
import { createCorrectives } from "./create-correctives.ts";
import { muscles } from "../src/human/MuscleAnatomy.ts";
// GLTFExporter uses the standard browser FileReader for its binary Blob output.
class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob) {
    blob.arrayBuffer().then((b) => {
      this.result = b;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob: Blob) {
    blob.arrayBuffer().then((b) => {
      this.result = `data:${blob.type};base64,${Buffer.from(b).toString("base64")}`;
      this.onloadend?.();
    });
  }
}
Object.assign(globalThis, { FileReader: NodeFileReader });
const mj = await load(),
  engine = new MuJoCoEngine(
    mj,
    await readFile("public/models/human.xml", "utf8"),
  );
// Author an A-pose so arms/hands are not accidentally welded to the torso/thigh.
for (const [name, angle] of [["left_shoulder", -0.35], ["right_shoulder", 0.35]] as const) {
  const joint = engine.joints.find((j) => j.name === name)!;
  engine.data.qpos[joint.q] = angle;
}
engine.mj.mj_forward(engine.model, engine.data);
const shapes: Record<string, unknown>[] = [];
const m = engine.model,
  d = engine.data,
  C = new T.Matrix4().makeRotationX(-Math.PI / 2),
  scene = new T.Scene();
const bones: T.Bone[] = [],
  world: T.Matrix4[] = [],
  geometries: T.BufferGeometry[] = [];
for (let b = 1; b < m.nbody; b++) {
  const bone = new T.Bone();
  bone.name = mj.mj_id2name(m, 1, b);
  bone.userData.mujocoBody = bone.name;
  const q = new T.Quaternion(
    d.xquat[b * 4 + 1],
    d.xquat[b * 4 + 2],
    d.xquat[b * 4 + 3],
    d.xquat[b * 4],
  );
  const W = new T.Matrix4()
    .compose(
      new T.Vector3().fromArray(d.xpos, b * 3),
      q,
      new T.Vector3(1, 1, 1),
    )
    .premultiply(C);
  world[b] = W;
  const p = m.body_parentid[b];
  const local = p ? world[p].clone().invert().multiply(W) : W;
  local.decompose(bone.position, bone.quaternion, bone.scale);
  bones[b - 1] = bone;
  if (p) bones[p - 1].add(bone);
  else scene.add(bone);
}
// Keep physical bones in MuJoCo body order; append inherited detail bones.
const boneIndex = new Map(bones.map((bone, index) => [bone.name, index]));
const bindWorld = new Map(bones.map((bone, index) => [bone.name, world[index + 1]]));
for (const detail of detailBones) {
  const bone = new T.Bone();
  bone.name = detail.name;
  bone.position.fromArray(detail.position);
  bones[boneIndex.get(detail.parent)!].add(bone);
  bindWorld.set(bone.name, bindWorld.get(detail.parent)!.clone().multiply(
    new T.Matrix4().makeTranslation(...detail.position),
  ));
  boneIndex.set(bone.name, bones.length);
  bones.push(bone);
}
const skin = "#c99578", shirt = "#36787e", trousers = "#34495e";
// Geometry is authored in body-local coordinates, independent of collision shapes.
function add(geo: T.BufferGeometry, owner: string, hex: string) {
  if (geo.userData.continuous) { geo.dispose(); return; }
  const count = geo.attributes.position.count;
  const indices = new Uint16Array(count * 4);
  const weights = new Float32Array(count * 4);
  const colors = new Float32Array(count * 3);
  const color = new T.Color(hex);
  const local = new T.Vector3();
  const parent = bones[boneIndex.get(owner)!].parent;
  for (let i = 0; i < count; i++) {
    local.fromBufferAttribute(geo.attributes.position, i);
    indices[i * 4] = boneIndex.get(owner)!;
    weights[i * 4] = 1;
    let secondary: string | undefined, blend = 0;
    if (owner === "torso") {
      secondary = "chest"; blend = T.MathUtils.clamp((local.z - 0.14) / 0.18, 0, 1);
    } else if (owner.endsWith("_foot")) {
      secondary = owner.replace("_foot", "_toes");
      blend = T.MathUtils.clamp((-local.y - 0.1) / 0.08, 0, 1);
    }
    if (secondary && blend > 0) {
      indices[i * 4 + 1] = boneIndex.get(secondary)!;
      weights[i * 4] = 1 - blend; weights[i * 4 + 1] = blend;
    }
    colors.set([color.r, color.g, color.b], i * 3);
  }
  geo.applyMatrix4(bindWorld.get(owner)!);
  geo.setAttribute("skinIndex", new T.Uint16BufferAttribute(indices, 4));
  geo.setAttribute("skinWeight", new T.Float32BufferAttribute(weights, 4));
  geo.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  // All parts share the same attribute layout and index format.
  geo.deleteAttribute("uv");
  if (!geo.userData.continuous) geometries.push(geo);
  else geo.dispose();
}
function solid(geo: T.BufferGeometry, owner: string, color: string, parameters: Record<string, unknown>) {
  geo.userData.continuous = true;
  shapes.push({ ...parameters, owner, color, matrix: bindWorld.get(owner)!.toArray() });
}
function ellipsoid(owner: string, center: number[], size: number[], color: string) {
  const geo = new T.SphereGeometry(1, 24, 16);
  geo.scale(size[0], size[1], size[2]);
  geo.translate(center[0], center[1], center[2]);
  if ([skin, shirt, trousers, "#263746", "#cad1ce"].includes(color))
    solid(geo, owner, color, { kind: "ellipsoid", center, size });
  add(geo, owner, color);
}
function capsule(owner: string, start: number[], end: number[], radius: number, color: string) {
  const a = new T.Vector3(...start), b = new T.Vector3(...end);
  const geo = new T.CapsuleGeometry(radius, a.distanceTo(b), 8, 20);
  geo.applyQuaternion(new T.Quaternion().setFromUnitVectors(
    new T.Vector3(0, 1, 0), b.clone().sub(a).normalize(),
  ));
  geo.translate(...a.add(b).multiplyScalar(0.5).toArray());
  if (color === skin) solid(geo, owner, color, { kind: "capsule", start, end, radius });
  add(geo, owner, color);
}
// Elliptical rings give the waist, rib cage and limbs a human silhouette.
function contour(owner: string, rings: number[][], color: string) {
  const positions: number[] = [], indices: number[] = [];
  const sides = 32;
  for (const [z, width, depth, offsetY = 0] of rings) {
    for (let j = 0; j <= sides; j++) {
      const angle = j / sides * Math.PI * 2;
      const x = width * Math.cos(angle);
      let y = offsetY + depth * Math.sin(angle);
      if (owner === "torso" && Math.sin(angle) < 0) {
        // Broad, continuous pectoral volume, smoothly merging into the shirt.
        const chest = Math.exp(-(((z - 0.29) / 0.085) ** 2))
          * Math.exp(-(((Math.abs(x) - 0.08) / 0.07) ** 2));
        y -= 0.008 * chest * -Math.sin(angle);
      }
      if (owner.endsWith("_hand") && Math.sin(angle) < 0) {
        const sign = owner.startsWith("left") ? 1 : -1;
        const thenar = Math.exp(-(((sign * x - 0.024) / 0.022) ** 2) - (((z + 0.015) / 0.03) ** 2));
        y -= 0.007 * thenar * -Math.sin(angle);
      }
      positions.push(x, y, z);
    }
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j, b = a + sides + 1;
      if (rings[0][0] < rings[rings.length - 1][0])
        indices.push(a, a + 1, b, b, a + 1, b + 1);
      else indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  solid(geo, owner, color, { kind: "contour", rings: rings.map((r) => [r[0], r[1], r[2], r[3] ?? 0]) });
  add(geo, owner, color);
}
contour("pelvis", [
  [-0.13, 0.018, 0.025], [-0.10, 0.119, 0.078, 0.008],
  [-0.055, 0.147, 0.100, 0.012], [0.005, 0.149, 0.098, 0.006],
  [0.06, 0.135, 0.088], [0.105, 0.122, 0.080], [0.115, 0.035, 0.03],
], trousers);
contour("torso", [
  [-0.025, 0.08, 0.06], [0, 0.127, 0.085], [0.08, 0.124, 0.084],
  [0.18, 0.145, 0.100], [0.28, 0.157, 0.107, -0.004],
  [0.35, 0.176, 0.092], [0.385, 0.160, 0.081],
  [0.415, 0.113, 0.064], [0.445, 0.047, 0.043], [0.45, 0.02, 0.025],
], shirt);
// Tapered neck and jaw, with a flatter facial plane rather than intersecting balls.
contour("neck", [
  [-0.015, 0.047, 0.043], [0.018, 0.041, 0.041, 0.004],
  [0.075, 0.036, 0.038, 0.006], [0.13, 0.039, 0.040, 0.005],
  [0.155, 0.025, 0.025],
], skin);
contour("head", [
  [-0.112, 0.018, 0.021, -0.027], [-0.095, 0.039, 0.041, -0.019],
  [-0.068, 0.059, 0.057, -0.008], [-0.027, 0.075, 0.068, 0.001],
  [0.018, 0.081, 0.076, 0.007], [0.062, 0.080, 0.076, 0.012],
  [0.100, 0.061, 0.060, 0.013], [0.123, 0.025, 0.026, 0.011],
  [0.129, 0.001, 0.001, 0.01],
], skin);
ellipsoid("head", [0, -0.068, 0.007], [0.012, 0.018, 0.032], skin);
ellipsoid("head", [0, -0.086, -0.014], [0.015, 0.014, 0.012], skin);
ellipsoid("head", [0, -0.062, -0.084], [0.028, 0.012, 0.014], skin);
for (const sign of [-1, 1]) {
  ellipsoid("head", [sign * 0.079, 0.004, -0.008], [0.012, 0.017, 0.027], skin);
  ellipsoid("head", [sign * 0.046, -0.047, -0.020], [0.029, 0.023, 0.027], skin);
  ellipsoid(`${sign > 0 ? "left" : "right"}_eye`, [0, 0, 0], [0.013, 0.006, 0.0065], "#ede6dd");
  ellipsoid(`${sign > 0 ? "left" : "right"}_eye`, [0, -0.0055, 0], [0.0045, 0.0016, 0.0045], "#354347");
  capsule("head", [sign * 0.020, -0.071, 0.041], [sign * 0.047, -0.066, 0.039], 0.0027, "#46342e");
}
capsule("head", [-0.020, -0.071, -0.057], [0, -0.074, -0.059], 0.002, "#895a51");
capsule("head", [0, -0.074, -0.059], [0.020, -0.071, -0.057], 0.002, "#895a51");
const hair = new T.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.43);
hair.rotateX(Math.PI / 2);
hair.scale(0.083, 0.079, 0.124);
hair.translate(0, 0.012, 0.010);
add(hair, "head", "#3c302c");
for (const side of ["left", "right"]) {
  const arm = `${side}_upper_arm`, forearm = `${side}_forearm`;
  // Sloping trapezius and deltoid merge into the torso and sleeve.
  const sign = side === "left" ? 1 : -1;
  ellipsoid("chest", [sign * 0.115, 0.005, 0.166], [0.068, 0.061, 0.026], shirt);
  ellipsoid(arm, [0, 0, -0.035], [0.050, 0.052, 0.061], shirt);
  contour(arm, [
    [0.012, 0, 0], [0, 0.049, 0.05], [-0.07, 0.056, 0.056],
    [-0.085, 0.049, 0.047], [-0.09, 0.048, 0.046],
  ], shirt);
  contour(arm, [
    [-0.085, 0, 0], [-0.09, 0.046, 0.044], [-0.16, 0.043, 0.047, -0.005], [-0.23, 0.036, 0.037],
    [-0.28, 0.033, 0.035], [-0.3, 0, 0],
  ], skin);
  ellipsoid(forearm, [0, 0, 0], [0.034, 0.035, 0.036], skin);
  contour(forearm, [
    [0.015, 0, 0], [0, 0.034, 0.035], [-0.07, 0.04, 0.039],
    [-0.16, 0.032, 0.030], [-0.235, 0.025, 0.023], [-0.270, 0.024, 0.020], [-0.292, 0.019, 0.016], [-0.30, 0.005, 0.005],
  ], skin);
  contour(`${side}_hand`, [
    [0.025, 0.020, 0.016], [0.010, 0.024, 0.017], [-0.009, 0.032, 0.019],
    [-0.031, 0.039, 0.020], [-0.049, 0.039, 0.018], [-0.060, 0.029, 0.014],
    [-0.067, 0.008, 0.008],
  ], skin);
  ellipsoid(`${side}_hand`, [sign * 0.022, -0.012, -0.018], [0.016, 0.011, 0.026], skin);
  ellipsoid(`${side}_hand`, [-sign * 0.025, -0.010, -0.033], [0.013, 0.011, 0.025], skin);
  // A thin web joins the first metacarpal to the palm without filling the gap.
  ellipsoid(`${side}_hand`, [sign * 0.030, -0.008, -0.023], [0.009, 0.007, 0.015], skin);
  contour(`${side}_thigh`, [
    [0.035, 0, 0], [0, 0.070, 0.079], [-0.1, 0.070, 0.075],
    [-0.23, 0.060, 0.064], [-0.35, 0.052, 0.055],
    [-0.395, 0.05, 0.053], [-0.41, 0, 0],
  ], trousers);
  ellipsoid(`${side}_shin`, [0, -0.008, 0], [0.052, 0.053, 0.056], trousers);
  contour(`${side}_shin`, [
    [0.02, 0, 0], [0, 0.05, 0.052], [-0.1, 0.059, 0.061, 0.008],
    [-0.19, 0.048, 0.049, 0.006], [-0.32, 0.032, 0.035],
    [-0.375, 0.032, 0.034], [-0.39, 0, 0],
  ], trousers);
  ellipsoid(`${side}_foot`, [0, -0.055, -0.052], [0.068, 0.145, 0.043], "#263746");
  ellipsoid(`${side}_foot`, [0, -0.058, -0.081], [0.069, 0.146, 0.016], "#cad1ce");
  // Three small laces make the shoe direction visible at a glance.
  for (let i = 0; i < 3; i++) capsule(`${side}_foot`,
    [-0.028, -0.04 - i * 0.023, -0.014],
    [0.028, -0.04 - i * 0.023, -0.014], 0.0025, "#cad1ce");
}
// Muscle volume is part of the body's skin; it does not add physical mass.
for (const muscle of muscles) {
  if (/biceps|triceps|forearm/.test(muscle.name))
    ellipsoid(muscle.body, muscle.center, muscle.size, skin);
}
for (const detail of fingerBones) {
  const length = -detail.tip[2], r = detail.radius, segment = Number(detail.name.at(-1));
  // Anatomical taper, a modest joint head and rounded fingertip.
  contour(detail.name, [
    [r * 0.6, 0.001, 0.001], [0, r * 1.06, r * 0.95],
    [-length * 0.18, r, r * 0.90], [-length * 0.65, r * 0.90, r * 0.86],
    [-length, r * (segment === 3 ? 0.72 : 0.92), r * 0.84],
    [-length - r * 0.75, 0.001, 0.001],
  ], skin);
  if (segment === 3) {
    const nail = new T.SphereGeometry(1, 20, 12);
    nail.scale(r * 0.67, 0.0009, length * 0.28);
    nail.translate(0, r * 0.86, -length * 0.66);
    add(nail, detail.name, "#d8b39f");
  }
}
const temp = await mkdtemp(join(tmpdir(), "human-surface-"));
const rig = bones.map((bone) => ({ name: bone.name, parent: bone.parent instanceof T.Bone ? bone.parent.name : null, position: bone.position.toArray() }));
await writeFile(join(temp, "input.json"), JSON.stringify({ shapes, rig }));
execFileSync(process.env.PYTHON || "python3", ["scripts/remesh-human.py", join(temp, "input.json"), temp], { stdio: "inherit" });
const surface = new T.BufferGeometry();
for (const [name, size, type] of [["position", 3, "float"], ["normal", 3, "float"], ["color", 3, "float"],
  ["skinIndex", 4, "uint16"], ["skinWeight", 4, "float"], ["index", 1, "uint32"]] as const) {
  const file = await readFile(join(temp, name + ".bin"));
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const array = type === "uint16" ? new Uint16Array(buffer) : type === "uint32" ? new Uint32Array(buffer) : new Float32Array(buffer);
  if (name === "index") surface.setIndex(new T.BufferAttribute(array, 1));
  else surface.setAttribute(name, new T.BufferAttribute(array, size));
}
const report = JSON.parse(await readFile(join(temp, "report.json"), "utf8"));
await rm(temp, { recursive: true });
const geometry = mergeGeometries([surface, ...geometries]),
  material = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.01 });
geometry.userData = { continuousSurfaceVertices: report.vertices, continuousSurfaceTriangles: report.triangles, ...report };
const correctiveNames = createCorrectives(geometry, report.vertices, bindWorld);
const mesh = new T.SkinnedMesh(geometry, material);
mesh.morphTargetDictionary = Object.fromEntries(correctiveNames.map((name, i) => [name, i]));
mesh.morphTargetInfluences = correctiveNames.map(() => 0);
mesh.name = "HumanSkin";
mesh.userData.surface = report;
mesh.userData.correctives = correctiveNames;
scene.add(mesh);
scene.updateMatrixWorld(true);
mesh.bind(new T.Skeleton(bones));
scene.userData = {
  upAxis: "Y",
  physicsSource: "human.xml",
  license: "CC0-1.0",
  surface: report,
  correctives: correctiveNames,
  boneContract:
    "51 physical body bones + 16 visual detail/eye bones; meters; A-pose bind pose; no animation clips",
};
const bytes = await new GLTFExporter().parseAsync(scene, { binary: true });
if (!(bytes instanceof ArrayBuffer)) throw new Error("Expected binary GLB");
await writeFile("artifacts/human-authoring.glb", new Uint8Array(bytes));
console.log(
  `Generated authoring GLB: ${bytes.byteLength} bytes, ${bones.length} bones, ${geometry.attributes.position.count} vertices`,
);
mesh.skeleton.dispose();
geometry.dispose();
surface.dispose();
material.dispose();
geometries.forEach((g) => g.dispose());
engine.dispose();
