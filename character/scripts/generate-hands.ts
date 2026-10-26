// Idempotently build both MJCF hands from the same anatomy used by the GLB.
import { readFile, writeFile } from "node:fs/promises";
import * as T from "three";
import { fingerBones, fingerFlexLimit, type FingerName } from "../src/human/Anatomy.ts";
function subtree(name: string): string {
  const children = fingerBones.filter((b) => b.parent === name);
  return children.map((b) => {
    const segment = Number(b.name.at(-1));
    const mass = [0.012, 0.008, 0.004][segment - 1];
    const q = new T.Quaternion().setFromEuler(new T.Euler(b.rotationX ?? 0, b.rotationY ?? 0, 0));
    const thumb = b.name.includes("_thumb_");
    const limit = fingerFlexLimit(b.name.split("_")[1] as FingerName, segment);
    const sign = b.name.startsWith("left") ? 1 : -1;
    const axis = new T.Vector3(0, 0, -sign).applyQuaternion(q.clone().invert());
    const extra = segment === 1 ? thumb
      ? `<joint name="${b.name.split("_thumb")[0]}_thumb_opposition" axis="${axis.toArray().join(" ")}" range="0 2.1" damping="0.02" armature="0.00004" />`
      : `<joint name="${b.name.replace("_1", "_spread")}" axis="0 1 0" range="-0.22 0.22" damping="0.012" armature="0.00002" />`
      : "";
    return `<body name="${b.name}" pos="${b.position.join(" ")}" quat="${q.w} ${q.x} ${q.y} ${q.z}">
      ${extra}
      <joint name="${b.name}_flex" axis="-1 0 0" range="0 ${limit}" damping="0.012" armature="0.00002" />
      <geom type="capsule" fromto="0 0 0 ${b.tip.join(" ")}" size="${b.radius}" mass="${mass}" contype="${thumb ? 4 : 2}" conaffinity="${thumb ? 3 : 1}" solref="0.008 1" />
      ${subtree(b.name)}
    </body>`;
  }).join("\n");
}
for (const path of ["public/models/human.xml", "public/models/human-free.xml"]) {
  let xml = await readFile(path, "utf8");
  // New joint coordinates invalidate the old free-base keyframe.
  xml = xml.replace(/\s*<keyframe>[\s\S]*?<\/keyframe>/, "");
  for (const side of ["left", "right"]) {
    const start = xml.indexOf(`<body name="${side}_hand"`);
    const tags = /<body\b[^>]*>|<\/body>/g;
    tags.lastIndex = start;
    let depth = 0, end = start, match;
    while ((match = tags.exec(xml))) {
      depth += match[0].startsWith("</") ? -1 : 1;
      if (depth === 0) { end = tags.lastIndex; break; }
    }
    if (end === start) throw new Error(`Missing hand: ${path} ${side}`);
    xml = xml.slice(0, start) + `<body name="${side}_hand" pos="0 0 -0.28">
      <joint name="${side}_wrist" axis="1 0 0" range="-0.7 0.7" damping="0.2" armature="0.0002" />
      <joint name="${side}_wrist_deviation" axis="0 1 0" range="-0.4 0.4" damping="0.2" armature="0.0002" />
      <geom type="ellipsoid" pos="0 0 -0.015" size="0.037 0.021 0.04" mass="0.33" />
      ${subtree(`${side}_hand`)}
    </body>` + xml.slice(end);
  }
  xml = xml.replace(/\s*<position name="(?:left|right)_(?:wrist(?:_deviation)?|thumb_opposition|(?:thumb|index|middle|ring|little)_(?:\d_flex|spread))_motor"[^>]*\/>/g, "");
  const actuators = ["left", "right"].map((side) =>
    `<position name="${side}_wrist_motor" joint="${side}_wrist" kp="12" kv="0.6" forcerange="-5 5" ctrllimited="true" ctrlrange="-0.7 0.7" />`,
  );
  for (const bone of fingerBones) {
    const limit = fingerFlexLimit(bone.name.split("_")[1] as FingerName, Number(bone.name.at(-1)));
    actuators.push(`<position name="${bone.name}_flex_motor" joint="${bone.name}_flex" kp="1.5" kv="0.045" forcerange="-0.45 0.45" ctrllimited="true" ctrlrange="0 ${limit}" />`);
  }
  for (const side of ["left", "right"]) {
    actuators.push(`<position name="${side}_wrist_deviation_motor" joint="${side}_wrist_deviation" kp="12" kv="0.6" forcerange="-5 5" ctrllimited="true" ctrlrange="-0.4 0.4" />`);
    actuators.push(`<position name="${side}_thumb_opposition_motor" joint="${side}_thumb_opposition" kp="2.5" kv="0.07" forcerange="-0.9 0.9" ctrllimited="true" ctrlrange="0 2.1" />`);
    for (const finger of ["index", "middle", "ring", "little"]) actuators.push(`<position name="${side}_${finger}_spread_motor" joint="${side}_${finger}_spread" kp="1.5" kv="0.045" forcerange="-0.45 0.45" ctrllimited="true" ctrlrange="-0.22 0.22" />`);
  }
  xml = xml.replace("</actuator>", actuators.join("\n    ") + "\n  </actuator>");
  await writeFile(path, xml);
}
console.log("Generated 30 physical hand segments, opposed thumbs, finger spread and 2-axis wrists; each hand remains 0.45 kg including fingers.");
