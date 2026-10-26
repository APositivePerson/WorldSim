import load from '@mujoco/mujoco';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {MuJoCoEngine} from '../character/src/physics/MuJoCoEngine';
import {BankController} from '../scene/physics/BankController';
const mj=await load({wasmBinary:await readFile(createRequire(import.meta.url).resolve('@mujoco/mujoco/mujoco.wasm'))});
const e=new MuJoCoEngine(mj,await readFile('character/public/models/human-free.xml','utf8'));
const c=new BankController(e);
function run(seconds:number){let min=10;for(let i=0;i<seconds/e.dt;i++){c.update(e.dt);e.step();min=Math.min(min,e.data.qpos[2]);if(c.locomotion.mode==='fallen')break;}return min;}
console.log('stand',run(3),c.locomotion.getState());
for(const goal of [{x:0,y:-.4,yaw:0},{x:0,y:-.4,yaw:Math.PI/2},{x:.4,y:-.4,yaw:Math.PI/2}]){
 c.locomotion.go(goal);
 for(let i=0;i<50;i++){const min=run(8);console.log(JSON.stringify({goal,min,...c.locomotion.getState()}));if(c.locomotion.mode!=='walk')break;}
 if(c.locomotion.mode==='fallen')break;
}
c.dispose();e.dispose();
