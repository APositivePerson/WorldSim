import load from '@mujoco/mujoco';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {MuJoCoEngine} from '../character/src/physics/MuJoCoEngine';
import {BankController} from '../scene/physics/BankController';
import {Navigator} from '../scene/physics/Navigator';
import {bankModel,planPath,DESTINATIONS} from '../scene/BankLayout';
import {TEST_BARRIER} from '../scene/ObstacleTest';
const mj=await load({wasmBinary:await readFile(createRequire(import.meta.url).resolve('@mujoco/mujoco/mujoco.wasm'))});
const source=await readFile('character/public/models/human-neuromuscular.xml','utf8');
const variants=[{x:-.25,h:TEST_BARRIER.h,name:'test_barrier_tall',second:false},
 {x:.25,h:.2,name:'test_barrier_low',second:false},
 {x:-.25,h:.2,name:'test_barriers_left',second:true},
 {x:.25,h:.2,name:'test_barriers_right',second:true}];
const selected=process.argv.find(a=>a.startsWith('--case='))?.slice(7);
for(const variant of variants.filter(v=>!selected||v.name===selected)){
 const barrier={...TEST_BARRIER,...variant};
 const second={...TEST_BARRIER,name:'test_barrier_lower',x:variant.x-1.1,y:barrier.y+.25,w:.8,d:.5,h:.05};
 const e=new MuJoCoEngine(mj,bankModel(source,variant.second?[barrier,second]:[barrier])),c=new BankController(e),nav=new Navigator(c);
 try{
  const barrierGeom=mj.mj_name2id(e.model,5,`bank_${barrier.name}`),secondGeom=mj.mj_name2id(e.model,5,'bank_test_barrier_lower');let barrierContacts=0;
  assert(barrierGeom>=0);
  assert.equal(nav.localMap.obstacles.length,0,'no preloaded barrier coordinates');
  assert(nav.go('help_desk'));assert.equal(nav.path.length,1,'initial route does not know barrier');let maxX=0,lastPlan=0;
  for(let i=0;i<1800/e.dt&&nav.status==='running';i++){
   c.update(e.dt);e.step();nav.update(e.dt);
   const contacts=e.data.contact;
   try{for(let contact=0;contact<e.data.ncon;contact++){
    const pair=contacts.get(contact)!;
    try{if(pair.geom1===barrierGeom||pair.geom2===barrierGeom||(secondGeom>=0&&(pair.geom1===secondGeom||pair.geom2===secondGeom)))barrierContacts++;}
    finally{pair.delete();}
   }}finally{contacts.delete();}
   if(nav.replans!==lastPlan){lastPlan=nav.replans;console.log('replan',variant.name,lastPlan,Array.from(e.data.qpos.slice(0,2)),nav.path);}
   assert(e.data.qpos[2]>.85,`fell: ${JSON.stringify({time:e.data.time,navigation:nav.getState(),body:c.locomotion.getState()})}`);maxX=Math.max(maxX,Math.abs(e.data.qpos[0]));
   assert(!(Math.abs(e.data.qpos[0]-variant.x)<barrier.w/2+.2&&Math.abs(e.data.qpos[1]-barrier.y)<barrier.d/2+.2),'entered barrier');
  }
  assert.equal(nav.status,'completed',JSON.stringify(nav.getState()));
  assert(nav.replans>0);assert(maxX>.8);assert(nav.getState().distance<.08);assert.equal(barrierContacts,0,'body contacted barrier');
  console.log('PASS depth/elevation detour without removal',JSON.stringify({variant,replans:nav.replans,maxX,time:e.data.time}));
 }finally{c.dispose();e.dispose();}
}
