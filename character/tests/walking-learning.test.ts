import { test } from "node:test";
import assert from "node:assert/strict";
import { WalkingCerebellum } from "../src/human/WalkingCerebellum.ts";

test("landing learner reduces a measured contact lag without relearning its own correction", () => {
  const learner = new WalkingCerebellum();
  learner.start();
  let first = 0, last = 0;
  for (let i = 0; i < 40; i++) {
    const lead = learner.predict(0, .5);
    const actual = .51 + .035 - lead;
    learner.observe(0, .5, .51, actual, lead);
    if (!i) first = Math.abs(actual - .51);
    last = Math.abs(actual - .51);
  }
  assert.ok(last < first * .55);
  assert.ok(Math.abs(learner.snapshot().delays[0][1] - .035) < .0001);
  assert.equal(learner.predict(1, .5), 0, "other leg has its own context");
  assert.equal(learner.predict(0, .3), 0, "other speed has its own context");
  learner.setMode("frozen");
  const before = learner.snapshot();
  const lead = learner.predict(0, .5);
  learner.observe(0, .5, .51, .58, lead);
  assert.deepEqual(learner.snapshot().delays, before.delays);
  assert.equal(learner.snapshot().updates, before.updates);
  assert.ok(lead > 0);
  learner.setMode("off");
  assert.equal(learner.predict(0, .5), 0);
  learner.observe(0, .5, .51, NaN, 0);
  assert.equal(learner.snapshot().samples, before.samples + 1);
  learner.reset();
  assert.equal(learner.snapshot().samples, 0);
  assert.equal(learner.snapshot().active, false);
});

test("late and early contacts keep timing corrections bounded", () => {
  const learner = new WalkingCerebellum();
  for (let i = 0; i < 100; i++) {
    learner.observe(0, .5, .5, .8, learner.predict(0, .5));
    learner.observe(1, .5, .5, .25, learner.predict(1, .5));
  }
  assert.ok(learner.predict(0, .5) <= .02);
  assert.ok(learner.predict(1, .5) >= -.02);
  const snapshot = learner.snapshot();
  snapshot.delays[0][1] = 100;
  assert.ok(learner.predict(0, .5) <= .02, "snapshots cannot modify learned memory");
});

test("load residual learning calibrates push and transfer; freezing retains both models", async () => {
  const {WalkingLoadLearning}=await import('../src/human/WalkingLoadLearning.ts');
  const load=new WalkingLoadLearning();
  let first=0,last=0;
  for(let i=0;i<240;i++){
    const action=load.corrections(0,.5);
    // A repeatable load deficit responds to a stronger push.
    const actual=1-.2+20*action.push;
    load.observe(0,.5,2,1,actual);
    load.observe(0,.5,0,.5,.4);
    if(!i)first=1-actual;last=1-actual;
  }
  assert.ok(last<first*.9);
  const action=load.corrections(0,.5),learned=load.snapshot();
  assert.ok(action.push>0&&action.push<=.004);
  assert.ok(action.transfer>0&&action.transfer<=.0015);
  assert.ok(learned.predictionError<learned.uncorrectedError*.1);
  assert.deepEqual(load.corrections(1,.5),{push:0,transfer:0});
  assert.deepEqual(load.corrections(0,.3),{push:0,transfer:0});
  load.setMode('frozen');load.observe(0,.5,2,1,1.5);
  assert.equal(load.snapshot().updates,learned.updates);
  assert.deepEqual(load.snapshot().pattern,learned.pattern);
  assert.deepEqual(load.corrections(0,.5),action);
  load.setMode('off');assert.deepEqual(load.corrections(0,.5),{push:0,transfer:0});
  load.reset();assert.equal(load.snapshot().updates,0);
});
