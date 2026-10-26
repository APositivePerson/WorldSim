import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import load from "@mujoco/mujoco";
import { MuJoCoEngine } from "../src/physics/MuJoCoEngine.ts";
import { HumanController } from "../src/human/HumanController.ts";
const mj = await load(),
  xml = await readFile(
    new URL("../public/models/human-free.xml", import.meta.url),
    "utf8",
  );
function fixture() {
  const e = new MuJoCoEngine(mj, xml),
    c = new HumanController(e);
  return {
    e,
    c,
    dispose() {
      c.dispose();
      e.dispose();
    },
  };
}
function run(f: ReturnType<typeof fixture>, s: number, check?: () => void) {
  for (let i = 0; i < Math.round(s / f.e.dt); i++) {
    f.c.update(f.e.dt);
    f.e.step();
    check?.();
  }
}
test("unconstrained 6-DOF root stands on real contacts for 60 seconds, no external supporting forces", () => {
  const f = fixture();
  try {
    assert.equal(f.e.freeBase, true);
    assert.equal(f.e.model.neq, 0);
    assert.equal(f.e.model.nv, 87);
    assert.equal(f.e.model.nu, 85);
    run(f, 60, () => {
      assert.ok(f.e.data.qpos[2] > 0.89 && f.e.data.qpos[2] < 0.96);
    });
    assert.ok(f.e.data.ncon >= 4);
    assert.ok(
      Array.from(f.e.data.xfrc_applied as Float64Array).every((v) => v === 0),
    );
    assert.ok(
      Array.from(f.e.data.qfrc_applied as Float64Array).every((v) => v === 0),
    );
  } finally {
    f.dispose();
  }
});
test("balance recovers from a finite lateral physical push; upper-body actions remain physical", () => {
  const f = fixture();
  try {
    run(f, 2);
    f.e.data.xfrc_applied[6] = 35;
    run(f, 0.1);
    f.e.data.xfrc_applied[6] = 0;
    run(f, 5);
    assert.ok(Math.abs(f.e.data.qpos[0]) < 0.03);
    assert.ok(f.e.data.qpos[2] > 0.89);
    f.c.execute({ action: "raise_right_arm", duration: 2 });
    run(f, 6);
    assert.equal(f.c.status, "completed");
    assert.ok(f.e.data.qpos[2] > 0.89);
    const joint = f.e.joints.find((j) => j.name === "right_shoulder")!;
    assert.ok(f.e.data.qpos[joint.q] > 1.7);
  } finally {
    f.dispose();
  }
});
test("130-second alternating walk travels forward, both feet clear the floor, joints stay within limits", () => {
  const f = fixture();
  try {
    run(f, 2);
    f.c.execute({ action: "walk_forward" });
    let clears = [0, 0];
    let minimum = Infinity;
    let lastArm=0,maxArmJump=0;
    run(f, 130, () => {
      const d = f.e.data;
      const arm=f.c.locomotion!.armTargets.left_shoulder_flex??0;
      maxArmJump=Math.max(maxArmJump,Math.abs(arm-lastArm));lastArm=arm;
      minimum = Math.min(minimum, d.qpos[2]);
      if (Math.round(d.time * 500) % 50 === 0) {
        const state = f.c.locomotion!.getState();
        state.footHeight.forEach((h, i) => {
          if (h > 0.015) clears[i]++;
        });
        for (const j of f.e.joints) {
          assert.ok(Number.isFinite(d.qpos[j.q]));
          assert.ok(
            d.qpos[j.q] >= j.min - 0.04 && d.qpos[j.q] <= j.max + 0.04,
            j.name,
          );
        }
      }
    });
    const state = f.c.locomotion!.getState();
    assert.equal(state.mode, "walk");
    assert.ok(state.steps >= 190 && state.steps <= 240, "continuous human-scale cadence");
    assert.ok(f.e.data.qpos[1] < -60 && f.e.data.qpos[1] > -68, "actual physical travel at the default 0.5 m/s");
    assert.ok(minimum > 0.88);
    assert.ok(clears.every((n) => n > 10));
    assert.ok(maxArmJump<.01, "arm reference stays continuous across every landing");
    const learning=state.cerebellum.walking;
    assert.ok(learning.updates>150, "real left/right contact feedback trains the walking learner");
    assert.ok(Math.abs(learning.appliedLead)<=.020001);
    console.log(
      `walk validation: ${state.steps} steps, ${(-f.e.data.qpos[1]).toFixed(3)} m, min pelvis ${minimum.toFixed(3)} m, foot-clear samples ${clears.join("/")}`,
    );
    assert.ok(
      Array.from(f.e.data.xfrc_applied as Float64Array).every((v) => v === 0),
    );
  } finally {
    f.dispose();
  }
});
test("stop during swing finishes landing, settles, resumes, resets and frees scratch data", () => {
  const f = fixture();
  try {
    run(f, 1);
    f.c.execute({ action: "walk_forward" });
    run(f, 3);
    f.c.execute({ action: "stop_walk" });
    run(f, 5);
    assert.equal(f.c.locomotion!.mode, "stand");
    assert.equal(f.c.status, "completed");
    assert.ok(f.e.data.qpos[2] > 0.89);
    assert.ok(
      f.c.locomotion!.getState().footHeight.every((h) => Math.abs(h) < 0.005),
    );
    const y = f.e.data.qpos[1];
    run(f, 4);
    assert.ok(Math.abs(f.e.data.qpos[1] - y) < 0.015);
    f.c.execute({ action: "walk_forward" });
    run(f, 5);
    assert.equal(f.c.locomotion!.mode, "walk");
    f.c.reset();
    assert.equal(f.e.data.time, 0);
    assert.equal(f.c.locomotion!.steps, 0);
    assert.equal(f.c.locomotion!.mode, "stand");
    assert.ok(Math.abs(f.e.data.qpos[2] - 0.925) < 1e-8);
    assert.ok(Array.from(f.e.data.qvel as Float64Array).every((v) => v === 0));
    run(f, 5);
    assert.ok(f.e.data.qpos[2] > 0.89);
  } finally {
    f.dispose();
  }
});
