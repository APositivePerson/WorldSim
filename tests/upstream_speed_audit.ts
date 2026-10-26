import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import load from '@mujoco/mujoco';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {MuJoCoEngine} from '../character/src/physics/MuJoCoEngine';
import {HumanController} from '../character/src/human/HumanController';
import {BankController} from '../scene/physics/BankController';
const mj=await load({wasmBinary:await readFile(createRequire(import.meta.url).resolve('@mujoco/mujoco/mujoco.wasm'))});
const rows=[];
const source=process.env.HUMAN_SOURCE;
const otherDifferences:string[]=[];
if(source){
 const manifest=JSON.parse(await readFile('character/upstream-integration.json','utf8'));
 let checked=0;
 for(const [file,hash] of Object.entries(manifest.files)){
  const actual=createHash('sha256').update(await readFile(path.join(source,file))).digest('hex');
  if(file.startsWith('src/')||file.startsWith('public/models/')){assert.equal(actual,hash,`integrated upstream differs from ${path.join(source,file)}`);checked++;}
  else if(actual!==hash)otherDifferences.push(file);
 }
 console.log('Verified upstream control source and models:',source,checked,'files; other differences:',otherDifferences);
}
for(const file of ['human-free.xml','human-neuromuscular.xml'])for(const kind of ['upstream','bank']){
 const e=new MuJoCoEngine(mj,await readFile('character/public/models/'+file,'utf8'));
 const c=kind==='upstream'?new HumanController(e):new BankController(e);
 let minHeight=Infinity,fallen=false,start=0;const samples=[];
 try{
  for(let i=0;i<2/e.dt;i++){c.update(e.dt);e.step();}
  start=e.data.qpos[1];
  if(c instanceof HumanController){c.locomotion!.setSpeed(.5);c.executeAction({action:'walk_forward'});}
  else c.locomotion.go({x:e.data.qpos[0],y:start-10,yaw:0});
  for(let i=0;i<14/e.dt;i++){
   c.update(e.dt);e.step();minHeight=Math.min(minHeight,e.data.qpos[2]);
   if(i%500===0)samples.push({time:e.data.time,y:e.data.qpos[1],height:e.data.qpos[2],speed:-e.data.qvel[1]});
   if(e.data.qpos[2]<.8){fallen=true;break;}
  }
  const row={file,kind,fallen,minHeight,distance:start-e.data.qpos[1],samples};rows.push(row);console.log(JSON.stringify(row));
 }finally{c.dispose();e.dispose();}
}
for(const file of ['human-free.xml','human-neuromuscular.xml']){
 const native=rows.find(r=>r.file===file&&r.kind==='upstream')!,bank=rows.find(r=>r.file===file&&r.kind==='bank')!;
 assert.ok(!native.fallen&&!bank.fallen);assert.ok(native.distance>6.5&&bank.distance>6.5);
 assert.ok(Math.abs(native.distance-bank.distance)<.05,`14-second displacement mismatch: ${file}`);
}
await writeFile('logs/upstream-speed-audit.json',JSON.stringify({source,otherDifferences,rows},null,2));
