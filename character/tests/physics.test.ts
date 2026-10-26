import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import loadMujoco from "@mujoco/mujoco";
import { MuJoCoEngine } from "../src/physics/MuJoCoEngine.ts";
import { HumanController } from "../src/human/HumanController.ts";
import { SimulationLoop } from "../src/physics/SimulationLoop.ts";
import { HumanRenderer } from "../src/rendering/HumanRenderer.ts";
import { actions, type ActionName } from "../src/human/ActionDefinitions.ts";
const mj = await loadMujoco();
const xml = await readFile(
  new URL("../public/models/human.xml", import.meta.url),
  "utf8",
);
function fixture() {
  const engine = new MuJoCoEngine(mj, xml);
  const controller = new HumanController(engine);
  return { engine, controller, loop: new SimulationLoop(engine, controller) };
}
function run(f: ReturnType<typeof fixture>, seconds: number) {
  for (let i = 0; i < Math.round(seconds / f.engine.dt); i++) {
    f.controller.update(f.engine.dt);
    f.engine.step();
  }
}
test("official WASM initializes and simple MJCF actually falls under gravity", () => {
  const e = new MuJoCoEngine(
    mj,
    '<mujoco><worldbody><body pos="0 0 2"><freejoint/><geom type="sphere" size="0.1" mass="1"/></body></worldbody></mujoco>',
  );
  try {
    const start = e.data.qpos[2];
    for (let i = 0; i < 100; i++) e.step();
    assert.ok(e.data.qpos[2] < start - 0.1);
    assert.ok(e.data.qvel[2] < 0);
  } finally {
    e.dispose();
  }
});
test("51-segment model, named joints and all position actuators are mapped", () => {
  const f = fixture();
  try {
    assert.equal(f.engine.model.nbody - 1, 51);
    assert.equal(f.engine.joints.length, 81);
    assert.equal(f.engine.model.nu, 85);
    assert.ok(f.engine.joints.every((j) => j.name && j.min < j.max));
    assert.ok(f.engine.joints.some((j) => j.name === "right_shoulder"));
  } finally {
    f.controller.dispose();
      f.engine.dispose();
  }
});
test("every action changes physical state through ctrl, respects limits and holds", () => {
  for (const action of Object.keys(actions) as ActionName[]) {
    const f = fixture();
    try {
      if (action === "lower_arms" || action === "reset_pose") {
        f.controller.execute({ action: "raise_right_arm", duration: 0.5 });
        run(f, 2);
      }
      assert.equal(f.controller.execute({ action, duration: 1 }), true);
      run(f, 0.25);
      if (action === "raise_right_arm") {
        const j = f.engine.joints.find((j) => j.name === "right_shoulder")!;
        assert.ok(f.engine.data.ctrl[j.actuator] > 0);
        assert.ok(f.engine.data.qpos[j.q] > 0.01);
        assert.ok(
          Math.abs(f.engine.data.qpos[j.q] - f.engine.data.ctrl[j.actuator]) >
            0.0001,
          "target and actual must differ during motion",
        );
      }
      run(f, 7);
      assert.equal(
        f.controller.status,
        "completed",
        `${action}: ${f.controller.error}`,
      );
      for (const j of f.controller.snapshot()) {
        assert.ok(
          Number.isFinite(j.actual) && Number.isFinite(j.velocity),
          action,
        );
        assert.ok(
          j.actual >= j.min - 0.03 && j.actual <= j.max + 0.03,
          `${action} ${j.name}: ${j.actual}`,
        );
        assert.ok(
          Math.abs(j.actual - j.target) < 0.14,
          `${action} ${j.name} error: ${j.actual - j.target}`,
        );
      }
    } finally {
      f.controller.dispose();
      f.engine.dispose();
    }
  }
});
test("pause, speed, bounded catch-up, reset, command validation", () => {
  const f = fixture();
  try {
    f.loop.paused = true;
    f.loop.advance(1);
    assert.equal(f.engine.data.time, 0);
    f.loop.paused = false;
    f.loop.speed = 0.5;
    f.loop.advance(0.04);
    assert.ok(Math.abs(f.engine.data.time - 0.02) < 1e-6);
    const before = f.engine.data.time;
    f.loop.advance(100);
    assert.ok(f.engine.data.time - before <= 0.101);
    assert.ok(f.loop.dropped > 49);
    assert.equal(
      f.controller.executeAction({ action: "bad" as ActionName }),
      false,
    );
    assert.equal(f.controller.status, "failed");
    assert.equal(
      f.controller.executeAction({ action: "raise_right_arm", duration: -1 }),
      false,
    );
    f.controller.setJoint("right_shoulder", 99);
    run(f, 2);
    assert.equal(
      f.controller.snapshot().find((j) => j.name === "right_shoulder")!.target,
      2.7,
    );
    f.loop.reset();
    assert.equal(f.engine.data.time, 0);
    assert.ok([...f.engine.data.qpos].every((x) => x === 0));
    assert.ok([...f.engine.data.qvel].every((x) => x === 0));
    assert.ok([...f.engine.data.ctrl].every((x) => x === 0));
  } finally {
    f.controller.dispose();
      f.engine.dispose();
  }
});
test("rendered geometry world poses follow MuJoCo including after reset", () => {
  const f = fixture();
  const renderer = new HumanRenderer(f.engine);
  try {
    f.controller.execute({ action: "raise_right_arm" });
    run(f, 3);
    renderer.sync();
    assert.equal(renderer.bodyToMeshes.size, 51);
    for (const [g, mesh] of renderer.meshes) {
      for (let axis = 0; axis < 3; axis++)
        assert.ok(
          Math.abs(
            mesh.position.getComponent(axis) -
              f.engine.data.geom_xpos[g * 3 + axis],
          ) < 1e-10,
        );
      assert.ok(Math.abs(mesh.quaternion.length() - 1) < 1e-8);
    }
    f.loop.reset();
    renderer.sync();
    for (const [g, mesh] of renderer.meshes)
      assert.equal(mesh.position.z, f.engine.data.geom_xpos[g * 3 + 2]);
  } finally {
    renderer.dispose();
    f.controller.dispose();
      f.engine.dispose();
  }
});
test("60 simulated seconds remain finite; repeated model allocation is released", () => {
  const f = fixture();
  try {
    run(f, 60);
    for (const j of f.controller.snapshot())
      assert.ok(Number.isFinite(j.actual) && Math.abs(j.velocity) < 0.2);
  } finally {
    f.controller.dispose();
      f.engine.dispose();
  }
  const probe = fixture();
  const bytes = probe.engine.data.qpos.buffer.byteLength;
  probe.controller.dispose();
  probe.engine.dispose();
  for (let i = 0; i < 25; i++) {
    const f = fixture();
    run(f, 0.02);
    f.controller.dispose();
      f.engine.dispose();
  }
  const last = fixture();
  try {
    assert.equal(
      last.engine.data.qpos.buffer.byteLength,
      bytes,
      "WASM heap should plateau after warm-up",
    );
  } finally {
    last.controller.dispose();
    last.engine.dispose();
  }
});
