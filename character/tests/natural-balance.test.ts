import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import load from "@mujoco/mujoco";
import {MuJoCoEngine} from "../src/physics/MuJoCoEngine.ts";
import {HumanController} from "../src/human/HumanController.ts";
const mj=await load(),xml=await readFile(new URL('../public/models/human-free.xml',import.meta.url),'utf8');
test('natural gait allocates feasible ankle wrenches and freezes real contact learning',()=>{
  const e=new MuJoCoEngine(mj,xml),c=new HumanController(e),g=c.locomotion!;
  const feet=['left','right'].map(side=>mj.mj_name2id(e.model,1,side+'_foot'));
  function run(seconds:number,check=false){for(let i=0;i<seconds/e.dt;i++){
    c.update(e.dt);
    if(check&&i%25===0){
      const state=g.getState();
      state.balance.wrenches.forEach((w,j)=>{
        const [fx,fy,fz,mx,my,mz]=w,h=e.data.xpos[feet[j]*3+2],eps=1e-6;
        assert.ok(fz>=0);assert.ok(Math.abs(fx)<=.7*fz+eps);assert.ok(Math.abs(fy)<=.7*fz+eps);
        assert.ok(mx-h*fy>=-.195*fz-eps&&mx-h*fy<=.09*fz+eps);
        assert.ok(Math.abs(my+h*fx)<=.065*fz+eps);assert.ok(Math.abs(mz)<=.08*fz+eps);
      });
      assert.ok(e.data.qpos[2]>.88);
    }
    e.step();
  }}
  try{
    run(2);c.execute({action:'walk_forward'});run(14,true);
    const before=g.cerebellum.walking.snapshot();
    assert.ok(before.updates>15&&before.counts.every(row=>row.some(v=>v>3)));
    assert.ok(before.load.updates>500);
    assert.ok(g.getState().mechanics.corrections!.some(v=>Math.abs(v.push)+Math.abs(v.transfer)>1e-7));
    g.cerebellum.walking.setMode('frozen');run(4,true);
    const frozen=g.cerebellum.walking.snapshot();
    assert.equal(frozen.load.updates,before.load.updates);
    assert.deepEqual(frozen.load.pattern,before.load.pattern);
    assert.equal(frozen.updates,before.updates);assert.deepEqual(frozen.delays,before.delays);
    assert.ok(frozen.samples>before.samples);
    g.cerebellum.walking.setMode('off');run(4,true);
    assert.equal(g.cerebellum.walking.snapshot().appliedLead,0);
    assert.deepEqual(g.getState().mechanics.corrections,[{push:0,transfer:0},{push:0,transfer:0}]);
    assert.equal(g.mode,'walk');
    assert.ok(Array.from(e.data.xfrc_applied as Float64Array).every(v=>v===0));
    assert.ok(Array.from(e.data.qfrc_applied as Float64Array).every(v=>v===0));
  }finally{c.dispose();e.dispose();}
});

test('braking from different swing phases settles across the supported mass range',()=>{
  for(const kg of [45,65.41,100])for(const stopTime of [3,3.2,3.4,3.6]){
    const e=new MuJoCoEngine(mj,xml),c=new HumanController(e);
    function run(seconds:number){for(let i=0;i<seconds/e.dt;i++){c.update(e.dt);e.step();}}
    try{
      e.setTotalMass(kg);c.reset();run(2);
      c.execute({action:'walk_forward'});run(stopTime);
      c.execute({action:'stop_walk'});run(6);
      assert.equal(c.locomotion!.mode,'stand',`${kg} kg, stop at ${stopTime}s`);
      assert.ok(c.locomotion!.settled);
      assert.ok(e.data.qpos[2]>.89);
    }finally{c.dispose();e.dispose();}
  }
});
