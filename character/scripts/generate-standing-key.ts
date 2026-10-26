// Recompute the reset key after editing leg geometry. Runtime motion never writes qpos.
import load from "@mujoco/mujoco";
import { readFile, writeFile } from "node:fs/promises";
import { MuJoCoEngine } from "../src/physics/MuJoCoEngine.ts";
import { LegIK } from "../src/human/LegIK.ts";
const path = "public/models/human-free.xml";
let xml = (await readFile(path, "utf8")).replace(
  /\s*<keyframe>[\s\S]*?<\/keyframe>/,
  "",
);
const mj = await load(),
  e = new MuJoCoEngine(mj, xml),
  ik = new LegIK(e);
const seed: Record<string, number> = {};
for (const side of ["left", "right"]) {
  seed[side + "_hip"] = -0.3;
  seed[side + "_knee"] = 0.6;
  seed[side + "_ankle"] = -0.3;
}
try {
  const targets = ik.solve(
    { x: 0, y: 0 },
    [
      { x: 0.1, y: 0, z: 0.1 },
      { x: -0.1, y: 0, z: 0.1 },
    ],
    seed,
  );
  const q = e.model.qpos0.slice();
  q[2] = 0.925;
  const ctrl = new Float64Array(e.model.nu);
  for (const j of e.joints) {
    q[j.q] = targets[j.name] ?? 0;
    ctrl[j.actuator] = targets[j.name] ?? 0;
  }
  xml = xml.replace(
    "</mujoco>",
    `  <keyframe>\n    <key name="stand" qpos="${Array.from(q).join(" ")}" ctrl="${Array.from(ctrl).join(" ")}"/>\n  </keyframe>\n</mujoco>\n`,
  );
  await writeFile(path, xml);
  console.log("Updated standing keyframe");
} finally {
  ik.dispose();
  e.dispose();
}
