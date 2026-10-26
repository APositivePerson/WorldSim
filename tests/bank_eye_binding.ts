import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import load from '@mujoco/mujoco';
import * as T from 'three';
import {MuJoCoEngine} from '../character/src/physics/MuJoCoEngine';
import {BankController} from '../scene/physics/BankController';
import {BankHumanRenderer} from '../scene/BankHumanRenderer';
const mj=await load({wasmBinary:await readFile(createRequire(import.meta.url).resolve('@mujoco/mujoco/mujoco.wasm'))});
const e=new MuJoCoEngine(mj,await readFile('character/public/models/human-neuromuscular.xml','utf8'));
const c=new BankController(e),renderer=new BankHumanRenderer(e);
try{
 for(const file of ['character/public/models/human-skinned.glb',process.env.SCAN_FILE].filter(Boolean) as string[]){
  const bytes=await readFile(file),json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
  await renderer.loadSkin(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer);
  const expected=['left_eye','right_eye'].map(name=>({name,position:new T.Vector3().setFromMatrixPosition(new T.Matrix4().fromArray(json.nodes.find((n:any)=>n.name===name).matrix))}));
  for(const action of ['reset_pose','turn_head_left','look_up','reset_pose']){
   if(action!=='look_up')c.executeAction({action,duration:1});
   for(let i=0;i<2/e.dt;i++){c.update(e.dt);e.step();renderer.sync();}
   for(const eye of expected){const bone=renderer.avatar!.scene.getObjectByName(eye.name)!;
    assert.ok(bone.position.distanceTo(eye.position)<1e-6,`${file}: ${eye.name} moved out of its socket: ${bone.position.toArray()} vs ${eye.position.toArray()}`);
    assert.ok(bone.quaternion.toArray().every(Number.isFinite));
   }
  }
  console.log('PASS eye sockets retained through physical eye and head motion:',file,expected.map(p=>p.position.toArray()));
 }
}finally{renderer.dispose();c.dispose();e.dispose();}
