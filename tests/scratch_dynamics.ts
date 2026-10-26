import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import load from '@mujoco/mujoco';
import {MuJoCoEngine} from '../character/src/physics/MuJoCoEngine';
import {HumanController} from '../character/src/human/HumanController';
const mj=await load({wasmBinary:await readFile(createRequire(import.meta.url).resolve('@mujoco/mujoco/mujoco.wasm'))});
const e=new MuJoCoEngine(mj,await readFile('character/public/models/human-neuromuscular.xml','utf8')),c=new HumanController(e);
const full=new mj.MjData(e.model),minimal=new mj.MjData(e.model),bias=new mj.DoubleBuffer(e.model.nv);
try{
 c.locomotion!.setSpeed(.5);c.executeAction({action:'walk_forward'});
 let maximum=0;
 for(let step=0;step<2500;step++){
  c.update(e.dt);e.step();if(step%25)continue;
  for(const d of [full,minimal]){d.qpos.set(e.data.qpos);d.qvel.set(e.data.qvel);}
  mj.mj_fwdPosition(e.model,full);mj.mj_fwdVelocity(e.model,full);
  mj.mj_kinematics(e.model,minimal);mj.mj_comPos(e.model,minimal);mj.mj_crb(e.model,minimal);mj.mj_comVel(e.model,minimal);
  mj.mj_rne(e.model,minimal,0,bias);minimal.qfrc_bias.set(bias.GetView());
  for(const key of ['xpos','xmat','xquat','subtree_com','cdof','qfrc_bias','M'] as const){
   const a=full[key],b=minimal[key];assert.equal(a.length,b.length);
   for(let i=0;i<a.length;i++){const error=Math.abs(a[i]-b[i]);maximum=Math.max(maximum,error);assert.ok(error<1e-10,`${key}[${i}]: ${a[i]} != ${b[i]}`);}
  }
 }
 console.log('PASS scratch kinematics, inertia and gravity/Coriolis parity; max error:',maximum);
}finally{bias.delete();full.delete();minimal.delete();c.dispose();e.dispose();}
