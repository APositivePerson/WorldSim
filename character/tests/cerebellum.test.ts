import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdirSync, writeFileSync } from "node:fs";
import load from "@mujoco/mujoco";
import { MuJoCoEngine } from "../src/physics/MuJoCoEngine.ts";
import { HumanController } from "../src/human/HumanController.ts";

const mj = await load();
const xml = await readFile(new URL("../public/models/human-free.xml", import.meta.url), "utf8");
test("cued physical pushes: learning improves standing, frozen memory retains benefit, baseline stays unmodified", () => {
  const e = new MuJoCoEngine(mj, xml), c = new HumanController(e);
  const learner = c.locomotion!.cerebellum, experiment = c.cerebellumExperiment!;
  experiment.setProfile("standard");
  function run(seconds: number) {
    for (let i = 0; i < Math.round(seconds / e.dt); i++) {
      c.update(e.dt); e.step();
      assert.ok(e.data.qpos[2] > .88, "must remain standing");
      assert.ok(Math.abs(learner.snapshot().correction) <= .012);
    }
  }
  try {
    assert.equal(c.startCerebellumExperiment("learn"), false, "requires settled standing");
    run(2);
    assert.equal(c.startCerebellumExperiment("baseline", 2), true);
    assert.equal(c.executeAction({ action: "walk_forward" }), false);
    run(8.02);
    const baseline = learner.snapshot().trials;
    assert.equal(baseline.length, 2);
    assert.equal(learner.snapshot().learnedPeak, 0);
    assert.equal(experiment.active, false);
    assert.equal(c.startCerebellumExperiment("learn", 8), true);
    run(32.04);
    const trained = learner.snapshot();
    assert.equal(trained.trials.length, 10);
    assert.ok(trained.learnedPeak > 0);
    assert.ok(trained.predictionSamples > 100);
    assert.ok(trained.modelUpdates > 100);
    assert.equal(c.startCerebellumExperiment("frozen", 2), true);
    run(8.02);
    const frozen = learner.snapshot();
    assert.equal(frozen.learnedPeak, trained.learnedPeak);
    assert.equal(frozen.modelUpdates, trained.modelUpdates, "forward model also freezes");
    const baselineRms = baseline.reduce((s, t) => s + t.rms, 0) / baseline.length;
    const frozenRms = frozen.trials.slice(-2).reduce((s, t) => s + t.rms, 0) / 2;
    assert.ok(frozenRms < baselineRms * .9, `frozen RMS ${frozenRms} vs baseline ${baselineRms}`);
    const baselinePeak = baseline.reduce((s, t) => s + t.peak, 0) / baseline.length;
    const frozenPeak = frozen.trials.slice(-2).reduce((s, t) => s + t.peak, 0) / 2;
    assert.ok(frozenPeak < baselinePeak * .9);
    mkdirSync("artifacts/cerebellum", { recursive: true });
    writeFileSync("artifacts/cerebellum/measurements.json", JSON.stringify({
      protocol: "35 N pelvis +X for 0.1 s at 0.8 s in each 4 s cued trial; default model mass",
      baselineRms, frozenRms, baselinePeak, frozenPeak, trials: frozen.trials,
    }, null, 2));
    console.log(`cerebellum: RMS ${(baselineRms*1000).toFixed(3)} → ${(frozenRms*1000).toFixed(3)} mm; peak ${(baselinePeak*1000).toFixed(3)} → ${(frozenPeak*1000).toFixed(3)} mm`);
    assert.ok(Array.from(e.data.xfrc_applied).every(v => v === 0));
    assert.ok(Array.from(e.data.qfrc_applied).every(v => v === 0));
    // Repeating the cue without the disturbance must wash out the old policy.
    for (let trial = 0; trial < 8; trial++) {
      const feet = c.locomotion!.sensors.feet;
      assert.equal(learner.begin(e.data.time, (feet[0].x + feet[1].x) / 2, "learn"), true);
      run(4.02);
    }
    console.log("washout learned peak", frozen.learnedPeak, learner.snapshot().learnedPeak);
    assert.ok(learner.snapshot().learnedPeak < frozen.learnedPeak * .8);
    c.reset();
    assert.equal(learner.snapshot().trials.length, 0);
    assert.equal(learner.snapshot().learnedPeak, 0);
    run(2);
    assert.equal(c.startCerebellumExperiment("learn", 1), true);
    run(.85); // Stop while the physical pulse is active.
    assert.ok(Array.from(e.data.xfrc_applied).some(v => v !== 0));
    experiment.stop();
    assert.ok(Array.from(e.data.xfrc_applied).every(v => v === 0));
    assert.equal(learner.snapshot().trials.length, 0, "cancelled trial cannot train");
    assert.equal(c.startCerebellumExperiment("learn", 0), false);
    assert.equal(c.startCerebellumExperiment("learn", NaN), false);
    run(2);
    assert.equal(c.startCerebellumExperiment("learn", 1), true);
    run(.85);
    const index = mj.mj_name2id(e.model, 1, "pelvis") * 6;
    e.data.xfrc_applied[index] += 2;
    experiment.stop();
    assert.equal(e.data.xfrc_applied[index], 2, "stop preserves another owner's external force");
    e.data.xfrc_applied[index] = 0;
    run(2);
    assert.equal(c.startCerebellumExperiment("learn", 1), true);
    run(.85);
    c.reset();
    assert.ok(Array.from(e.data.xfrc_applied).every(v => v === 0), "reset during pulse removes the force");
  } finally { c.dispose(); e.dispose(); }
});

test("visible training produces measurable physical sway and progress without cancelling or amplifying poses", () => {
  const e = new MuJoCoEngine(mj, xml), c = new HumanController(e);
  const experiment = c.cerebellumExperiment!, learner = c.locomotion!.cerebellum;
  let maxForce = 0, maxDisplacement = 0;
  function run(seconds: number) {
    for (let i=0; i<Math.round(seconds/e.dt); i++) {
      c.update(e.dt); e.step();
      assert.ok(e.data.qpos[2] > .88);
      if (i % 10 === 0) {
        const s=experiment.snapshot();
        maxForce=Math.max(maxForce,s.force); maxDisplacement=Math.max(maxDisplacement,Math.abs(s.displacement));
      }
    }
  }
  try {
    run(2);
    assert.equal(experiment.snapshot().profile,"visible");
    assert.equal(c.startCerebellumExperiment("baseline",1),true);
    run(4.02);
    assert.equal(learner.snapshot().trials.length,1);
    assert.ok(experiment.snapshot().baselineTrace.length>100);
    assert.equal(c.startCerebellumExperiment("learn",8),true);
    assert.equal(experiment.setProfile("standard"),false);
    run(32.04);
    const results=learner.snapshot().trials;
    assert.equal(results.length,9, "all rounds finish without a contact cancellation");
    assert.equal(maxForce,100);
    assert.ok(maxDisplacement>.015, "centimetre-scale physical displacement");
    assert.ok(results.at(-1)!.rms < results[0].rms, "learning still reduces sway");
    assert.equal(experiment.snapshot().round,8);
    assert.equal(experiment.active,false);
    assert.ok(experiment.snapshot().trace.length>100);
    assert.ok(Array.from(e.data.xfrc_applied).every(v=>v===0));
    console.log(`visible training: peak ${(maxDisplacement*1000).toFixed(1)} mm; RMS ${(results[0].rms*1000).toFixed(2)} → ${(results.at(-1)!.rms*1000).toFixed(2)} mm`);
    assert.equal(experiment.setProfile("standard"),true);
    assert.equal(learner.snapshot().trials.length,0);
    assert.equal(experiment.snapshot().trace.length,0);
    c.reset();
    assert.equal(experiment.snapshot().total,0);
  } finally {c.dispose();e.dispose();}
});
