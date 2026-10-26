// Expand the physical articulation, preserving neutral body positions and mass.
import { readFile, writeFile } from "node:fs/promises";
type Node = { tag: string; a: Record<string, string>; children: Node[] };
const node = (tag: string, a: Record<string, string>, children: Node[] = []): Node => ({ tag, a, children });
function parse(xml: string) {
  const stack: Node[] = [], roots: Node[] = [];
  for (const match of xml.matchAll(/<\/?[a-zA-Z][^>]*>/g)) {
    const token = match[0];
    if (token.startsWith("</")) { stack.pop(); continue; }
    const n = node(token.match(/^<(\w+)/)![1], Object.fromEntries(
      Array.from(token.matchAll(/([\w]+)="([^"]*)"/g), (m) => [m[1], m[2]])));
    if (stack.length) stack.at(-1)!.children.push(n); else roots.push(n);
    if (!token.endsWith("/>")) stack.push(n);
  }
  return roots[0];
}
function format(n: Node, indent = ""): string {
  const attrs = Object.entries(n.a).map(([k, v]) => ` ${k}="${v}"`).join("");
  if (!n.children.length) return `${indent}<${n.tag}${attrs} />`;
  return `${indent}<${n.tag}${attrs}>\n${n.children.map((c) => format(c, indent + "  ")).join("\n")}\n${indent}</${n.tag}>`;
}
function find(n: Node, name: string): Node | undefined {
  if (n.tag === "body" && n.a.name === name) return n;
  for (const c of n.children) { const result = find(c, name); if (result) return result; }
}
for (const path of ["public/models/human.xml", "public/models/human-free.xml"]) {
  const root = parse(await readFile(path, "utf8"));
  root.children = root.children.filter((n) => n.tag !== "keyframe");
  const actuators = root.children.find((n) => n.tag === "actuator")!;
  let contact = root.children.find((n) => n.tag === "contact");
  if (!contact) { contact = node("contact", {}); root.children.push(contact); }
  // Adjacent anatomical segments overlap at joints. Explicit exclusions also
  // apply when the fixed pelvis is welded to world (default filtering differs).
  for (const child of ["torso", "left_thigh", "right_thigh"]) {
    if (!contact.children.some((n) => n.a.body1 === "pelvis" && n.a.body2 === child))
      contact.children.push(node("exclude", { body1: "pelvis", body2: child }));
  }
  function joint(body: Node, name: string, axis: string, range: string, kp = 100, kv = 10, force = 100) {
    if (body.children.some((c) => c.tag === "joint" && c.a.name === name)) return;
    body.children.unshift(node("joint", { name, axis, range }));
    actuators.children.push(node("position", { name: name + "_motor", joint: name, kp: String(kp), kv: String(kv),
      forcerange: `-${force} ${force}`, ctrllimited: "true", ctrlrange: range }));
  }
  const torso = find(root, "torso")!;
  let chest = find(root, "chest");
  if (!chest) {
    const upper = torso.children.filter((n) => n.tag === "body");
    for (const body of upper) {
      const p = body.a.pos.split(" ").map(Number); p[2] -= 0.22; body.a.pos = p.join(" ");
    }
    const geom = torso.children.find((n) => n.tag === "geom")!;
    geom.a.mass = "8"; geom.a.fromto = "0 0 0 0 0 0.21"; geom.a.size = "0.105";
    torso.children = torso.children.filter((n) => n.tag !== "body");
    chest = node("body", { name: "chest", pos: "0 0 0.22" }, [
      node("geom", { type: "capsule", fromto: "0 0 0 0 0 0.2", size: "0.115", mass: "9.5" }), ...upper,
    ]);
    torso.children.push(chest);
  }
  joint(torso, "spine_flex", "1 0 0", "-0.4 0.45", 260, 30, 180);
  joint(torso, "spine_twist", "0 0 1", "-0.55 0.55", 260, 30, 180);
  joint(chest, "chest_flex", "1 0 0", "-0.22 0.3", 260, 30, 160);
  joint(chest, "chest_sidebend", "0 1 0", "-0.2 0.2", 260, 30, 160);
  joint(chest, "chest_twist", "0 0 1", "-0.35 0.35", 260, 30, 160);
  const neck = find(root, "neck")!;
  joint(neck, "neck_pitch", "1 0 0", "-0.5 0.6", 60, 6, 35);
  joint(neck, "neck_roll", "0 1 0", "-0.35 0.35", 60, 6, 35);
  for (const [side, sign] of [["left", 1], ["right", -1]] as const) {
    let clavicle = find(root, `${side}_clavicle`);
    const arm = find(root, `${side}_upper_arm`)!;
    if (!clavicle) {
      chest.children = chest.children.filter((n) => n !== arm);
      arm.a.pos = `${sign * 0.125} 0 0`;
      clavicle = node("body", { name: `${side}_clavicle`, pos: `${sign * 0.08} 0 0.16` }, [
        node("geom", { type: "capsule", fromto: `0 0 0 ${sign * 0.125} 0 0`, size: "0.018", mass: "0.25", contype: "0", conaffinity: "0" }), arm,
      ]);
      chest.children.push(clavicle);
    }
    joint(clavicle, `${side}_scapula_elevation`, "0 1 0", "-0.25 0.25", 140, 14, 70);
    joint(clavicle, `${side}_scapula_protraction`, "0 0 1", "-0.3 0.3", 140, 14, 70);
    joint(arm, `${side}_shoulder_rotation`, "0 0 1", "-1.4 1.4", 80, 8, 90);
    // Axial humerus rotation follows abduction/flexion, so a raised arm twists
    // around its own long axis rather than yawing around the world vertical.
    const rotationIndex = arm.children.findIndex((n) => n.a.name === `${side}_shoulder_rotation`);
    const axial = arm.children.splice(rotationIndex, 1)[0];
    const lastArmJoint = arm.children.findLastIndex((n) => n.tag === "joint");
    arm.children.splice(lastArmJoint + 1, 0, axial);
    const forearm = find(root, `${side}_forearm`)!;
    // Insert axial rotation after elbow flexion so it rotates the radius/hand.
    const name = `${side}_forearm_rotation`;
    if (!forearm.children.some((c) => c.a.name === name)) {
      joint(forearm, name, "0 0 1", "-1.55 1.55", 25, 2, 12);
      const j = forearm.children.shift()!;
      const elbow = forearm.children.findIndex((c) => c.tag === "joint");
      forearm.children.splice(elbow + 1, 0, j);
    }
    const foot = find(root, `${side}_foot`)!;
    if (!find(root, `${side}_toes`)) {
      foot.children.find((n) => n.tag === "geom")!.a.mass = "0.88";
      foot.children.push(node("body", { name: `${side}_toes`, pos: "0 -0.13 -0.052" }, [
        node("geom", { type: "capsule", fromto: "-0.045 -0.015 0 0.045 -0.015 0", size: "0.016", mass: "0.12", contype: "0", conaffinity: "0" }),
      ]));
    }
    joint(find(root, `${side}_toes`)!, `${side}_toe_flex`, "1 0 0", "-0.5 0.65", 15, 1, 6);
    // Divide the old sole into hindfoot and an articulated, contacting forefoot.
    // Neutral sole outline/height stays identical; forefoot motion has real contact.
    const footGeom = foot.children.find((n) => n.tag === "geom")!;
    const halfWidth = footGeom.a.size.split(" ")[0];
    footGeom.a.pos = "0 -0.015 -0.055"; footGeom.a.size = `${halfWidth} 0.11 0.045`;
    const toes = find(root, `${side}_toes`)!;
    toes.children.find((n) => n.tag === "geom")!.a = {
      type: "box", pos: "0 -0.035 -0.003", size: `${halfWidth} 0.04 0.045`, mass: "0.12",
    };
    const toeMotor = actuators.children.find((n) => n.a.joint === `${side}_toe_flex`)!;
    Object.assign(toeMotor.a, { kp: "400", kv: "12", forcerange: "-60 60" });
    // The fixed demonstration exposes the same hip/ankle rotations as free mode.
    joint(find(root, `${side}_thigh`)!, `${side}_hip_yaw`, "0 0 1", "-0.6 0.6");
    joint(foot, `${side}_ankle_roll`, "0 1 0", "-0.5 0.5");
  }
  await writeFile(path, format(root) + "\n");
}
console.log("Expanded waist, thorax, neck, shoulder girdle, shoulder rotation, forearm rotation and forefoot joints.");
