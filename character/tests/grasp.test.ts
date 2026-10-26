import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import load from "@mujoco/mujoco";
import {MuJoCoEngine} from "../src/physics/MuJoCoEngine.ts";
import {HumanController} from "../src/human/HumanController.ts";
import {withCupScene} from "../src/physics/CupScene.ts";
import {HumanRenderer} from "../src/rendering/HumanRenderer.ts";
const mj=await load(),xml=await readFile(new URL('../public/models/human-free.xml',import.meta.url),'utf8');
function fixture(position?: [number, number, number]){
  const e=new MuJoCoEngine(mj,withCupScene(xml,{position})),c=new HumanController(e);
  return {e,c,run(seconds:number){for(let i=0;i<seconds/e.dt;i++){c.update(e.dt);e.step();}},
    until(stage:string,seconds:number){for(let i=0;i<seconds/e.dt;i++){c.update(e.dt);e.step();if(c.grasp?.stage===stage)return;}assert.fail(`${stage}: ${JSON.stringify(c.grasp?.snapshot())}`);},
    dispose(){c.dispose();e.dispose();}};
}
test('cup has independent gravity and mass; environment stays visible with the human skin',async()=>{
  const f=fixture();const renderer=new HumanRenderer(f.e);
  try{
    assert.equal(f.e.humanBodies.length,51);assert.equal(f.e.joints.length,81);assert.equal(f.e.model.nq,95);
    assert.equal(f.e.model.neq,0);assert.equal(f.e.model.nmocap,0);
    const cup=mj.mj_name2id(f.e.model,1,'prop_cup');
    assert.ok(Math.abs(f.e.model.body_mass[cup]-.12)<1e-9);
    f.e.setTotalMass(80);f.c.reset();assert.ok(Math.abs(f.e.totalMass-80)<1e-8);
    assert.ok(Math.abs(f.e.model.body_mass[cup]-.12)<1e-9,'body weight must not scale the cup');
    assert.equal(f.e.bodyState().segments.length,51);
    const file=await readFile(new URL('../public/models/human-skinned.glb',import.meta.url));
    const bytes=file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength) as ArrayBuffer;
    await renderer.loadSkin(bytes);assert.equal(renderer.avatar!.bindings.length,51);
    const geom=mj.mj_name2id(f.e.model,5,'cup_bottom');
    assert.equal(renderer.meshes.get(geom)!.visible,true);
    const bodyGeom=Array.from(renderer.meshes.keys()).find(g=>f.e.isHumanBody(f.e.model.geom_bodyid[g]))!;
    assert.equal(renderer.meshes.get(bodyGeom)!.visible,false);
    assert.equal(f.c.grasp!.snapshot().liftHeight,0);
    f.run(1);assert.ok(f.c.grasp!.snapshot().supportForce>.8);
    assert.throws(()=>withCupScene(xml,{mass:NaN}));
  }finally{renderer.dispose();f.dispose();}
});
test('relocated cups are physically lifted and returned to their new positions',()=>{
  for (const [dx,dy] of [[-.03,-.015],[.03,.015],[-.03,.015],[.03,-.015]]) {
    const f=fixture();
    try {
      const initial=f.c.grasp!.snapshot().cupPosition;
      const x=initial[0]+dx,y=initial[1]+dy;
      const human=f.e.data.qpos.slice(0,88);
      assert.equal(f.c.placeCup(x,y),true);
      assert.deepEqual(f.e.data.qpos.slice(0,88),human,'scene edits must leave the human unchanged');
      f.run(.4);
      const home=f.c.grasp!.snapshot().cupPosition;
      assert.equal(f.c.execute({action:'pick_up_cup'}),true,`${dx},${dy}`);
      const before=f.e.data.qpos.slice();
      assert.equal(f.c.placeCup(initial[0],initial[1]),false,'scene editing is locked throughout the grasp');
      assert.deepEqual(f.e.data.qpos,before);
      f.until('holding',20);
      assert.ok(f.c.grasp!.snapshot().liftHeight>.06);
      assert.ok(Math.abs(f.c.grasp!.snapshot().cupPosition[0]-home[0])<.02);
      assert.equal(f.c.execute({action:'put_down_cup'}),true);
      f.until('done',12);f.run(.5);
      const placed=f.c.grasp!.snapshot();
      assert.ok(Math.hypot(...placed.cupPosition.map((v,i)=>v-home[i]))<.015,`placement ${dx},${dy}`);
      assert.ok(placed.supportForce>.8);
      f.c.reset();
      assert.deepEqual(f.c.grasp!.snapshot().cupPosition,initial);
    } finally {f.dispose();}
  }
});
test('all four placement boundaries can be picked up after physical settling',()=>{
  for (const [a,b] of [['min','min'],['max','max'],['min','max'],['max','min']] as const) {
    const f=fixture();
    try {
      const [x,y]=f.c.grasp!.placementBounds();
      assert.equal(f.c.placeCup(x[a],y[b]),true);
      f.run(.5);
      assert.equal(f.c.execute({action:'pick_up_cup'}),true,`${a},${b}: ${f.c.error}`);
      f.until('holding',20);
      assert.ok(f.c.grasp!.snapshot().liftHeight>.06);
      assert.equal(f.c.execute({action:'put_down_cup'}),true);
      f.until('done',12);
      assert.ok(f.c.grasp!.snapshot().supportForce>.8);
    } finally {f.dispose();}
  }
});
test('invalid scene edits and unreachable pickup fail before moving the human or cup',()=>{
  const f=fixture();
  try {
    const before=f.e.data.qpos.slice();
    assert.equal(f.c.placeCup(NaN,-.3),false);
    assert.equal(f.c.placeCup(2,-.3),false);
    assert.deepEqual(f.e.data.qpos,before);
    f.c.execute({action:'walk_forward'});
    assert.equal(f.c.placeCup(-.23,-.3),false);
  } finally {f.dispose();}
  const far=fixture([-1,-.3,1.16]);
  try {
    const before=far.e.data.qpos.slice();
    assert.match(far.c.grasp!.snapshot().unavailable,/可达范围/);
    assert.equal(far.c.execute({action:'pick_up_cup'}),false);
    assert.match(far.c.error,/可达范围/);
    assert.deepEqual(far.e.data.qpos,before);
    assert.equal(far.c.reach.active,false);
    assert.equal(far.c.grasp!.stage,'idle');
  } finally {far.dispose();}
});
test('contact-driven fingers physically lift, hold and place the cup; contact handles do not leak',()=>{
  const f=fixture();
  try{
    const before=f.e.data.qpos.slice();assert.equal(f.c.execute({action:'pick_up_cup'}),true);
    assert.deepEqual(f.e.data.qpos,before,'commands must not teleport any body');
    f.c.update(f.e.dt);assert.deepEqual(f.e.data.qpos,before,'IK writes only scratch data');f.e.step();
    f.until('holding',18);
    let s=f.c.grasp!.snapshot();assert.equal(f.c.status,'completed');assert.ok(s.liftHeight>.07);assert.ok(s.supportForce<.05);
    assert.ok(s.fingers.find(f=>f.name==='thumb')!.contactForce>1);
    assert.ok(s.fingers.filter(f=>f.name!=='thumb'&&f.contactForce>1).length>=2);
    assert.ok(s.fingers.some(f=>f.stopped&&f.curl<.6),'contact stops fingers before a complete fist');
    assert.ok(s.maxPenetration<.004);assert.ok(f.e.data.qpos[2]>.88);
    const height=s.cupPosition[2],heap=f.e.data.qpos.buffer.byteLength;
    f.run(8);s=f.c.grasp!.snapshot();assert.equal(s.stage,'holding');assert.ok(Math.abs(s.cupPosition[2]-height)<.02);
    assert.equal(f.e.data.qpos.buffer.byteLength,heap,'contact vector and element handles must be released');
    assert.ok(f.e.data.xfrc_applied.every(v=>v===0));assert.ok(f.e.data.qfrc_applied.every(v=>v===0));
    assert.equal(f.c.execute({action:'walk_forward'}),false,'grasp owns the movement until placement');
    assert.equal(f.c.execute({action:'put_down_cup'}),true);f.until('done',12);f.run(1);
    s=f.c.grasp!.snapshot();assert.ok(Math.abs(s.liftHeight)<.003);assert.ok(s.supportForce>.8);
    assert.ok(s.fingers.every(f=>f.contactForce<.01&&!f.stopped));
    assert.equal(f.c.status,'completed');f.c.reset();assert.equal(f.c.grasp!.stage,'idle');assert.equal(f.c.grasp!.snapshot().liftHeight,0);
  }finally{f.dispose();}
});
test('held cup falls if its physical collisions are removed; there is no hidden attachment',()=>{
  const f=fixture();
  try{
    f.c.execute({action:'pick_up_cup'});f.until('holding',18);
    const s=f.c.grasp!.snapshot(),cup=mj.mj_name2id(f.e.model,1,'prop_cup');
    for(let g=0;g<f.e.model.ngeom;g++)if(f.e.model.geom_bodyid[g]===cup){f.e.model.geom_contype[g]=0;f.e.model.geom_conaffinity[g]=0;}
    f.run(.4);assert.ok(f.c.grasp!.snapshot().cupPosition[2]<s.cupPosition[2]-.2);
    assert.equal(f.c.grasp!.stage,'failed');assert.equal(f.c.status,'failed');
    assert.ok(f.e.data.xfrc_applied.every(v=>v===0));assert.ok(f.e.data.qfrc_applied.every(v=>v===0));
  }finally{f.dispose();}
});
