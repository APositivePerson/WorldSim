import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectPoses } from "../scripts/review-poses.ts";
test("five actual physical poses retain finite skin, usable area and bounded edge stretch",async()=>{
  const poses=await inspectPoses();
  assert.equal(poses.length,5);
  for(const p of poses){
    assert.equal(p.status,"completed",`${p.pose}: ${p.error}`);
    assert.equal(p.nonfiniteTriangles,0,p.pose);
    assert.equal(p.degenerateTriangles,0,p.pose);
    assert.ok(p.areaRatioP01>0.3,`${p.pose}: substantial surface collapse`);
    assert.ok(p.edgeRatioP99<1.8,`${p.pose}: extreme edge stretching`);
    assert.ok(p.maxJointError<0.14,p.pose);
  }
  assert.ok(poses.find((p)=>p.pose==="fists")!.activeCorrectives.includes("left_index_knuckle"));
  assert.ok(poses.find((p)=>p.pose==="squat")!.activeCorrectives.includes("left_hip_flex"));
});
