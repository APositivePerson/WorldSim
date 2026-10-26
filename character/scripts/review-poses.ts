// Offline deformation audit. All poses are reached through real MuJoCo actuators.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import load from "@mujoco/mujoco";
import * as T from "three";
import { MuJoCoEngine } from "../src/physics/MuJoCoEngine.ts";
import { HumanController } from "../src/human/HumanController.ts";
import { SkinnedHuman } from "../src/rendering/SkinnedHuman.ts";
import type { ActionName } from "../src/human/ActionDefinitions.ts";
export const reviewPoses: {name:string;label:string;actions:ActionName[]}[] = [
  {name:"standing",label:"站立",actions:["reset_pose"]},
  {name:"raised-arms",label:"抬臂",actions:["raise_left_arm","raise_right_arm"]},
  {name:"bent-elbow",label:"屈肘",actions:["bend_left_elbow"]},
  {name:"fists",label:"双手握拳",actions:["close_left_hand","close_right_hand"]},
  {name:"squat",label:"下蹲姿态（固定骨盆）",actions:["squat_check"]},
];
export async function inspectPoses(before=false) {
  const models=before?"artifacts/refinement-before/":"public/models/";
  const dataFolder=`artifacts/pose-review-data${before?"-before":""}`;
  const mj=await load();
  const e=new MuJoCoEngine(mj,await readFile(models+"human.xml","utf8"));
  const c=new HumanController(e), file=await readFile(models+"human-skinned.glb");
  const skin=await SkinnedHuman.load(e,file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength) as ArrayBuffer);
  if(!skin)throw new Error("Missing skin");
  let mesh!:T.SkinnedMesh; skin.scene.traverse((o)=>{if(o instanceof T.SkinnedMesh)mesh=o;});
  const position=mesh.geometry.attributes.position, index=mesh.geometry.index!, count=mesh.userData.surface.triangles;
  const reference=new Float64Array(count), edges=new Float64Array(count*3);
  const a=new T.Vector3(),b=new T.Vector3(),d=new T.Vector3(),cross=new T.Vector3();
  const read=(i:number,p:T.Vector3)=>p.fromBufferAttribute(position,index.getX(i));
  for(let t=0;t<count;t++) {
    read(t*3,a);read(t*3+1,b);read(t*3+2,d);
    reference[t]=cross.subVectors(b,a).cross(d.clone().sub(a)).length();
    edges[t*3]=a.distanceTo(b);edges[t*3+1]=b.distanceTo(d);edges[t*3+2]=d.distanceTo(a);
  }
  const run=(seconds:number)=>{for(let i=0;i<seconds/e.dt;i++){c.update(e.dt);e.step();}};
  const output=[];
  await mkdir(dataFolder,{recursive:true});
  const triangles=new Uint32Array(count*3);
  for(let i=0;i<triangles.length;i++)triangles[i]=index.getX(i);
  await writeFile(`${dataFolder}/triangles.bin`,new Uint8Array(triangles.buffer));
  const owners=new Uint16Array(mesh.userData.surface.vertices);
  for(let i=0;i<owners.length;i++)owners[i]=mesh.geometry.attributes.skinIndex.getX(i);
  await writeFile(`${dataFolder}/owners.bin`,new Uint8Array(owners.buffer));
  await writeFile(`${dataFolder}/bones.json`,JSON.stringify(mesh.skeleton.bones.map((b)=>b.name)));
  try {
    for(const pose of reviewPoses) {
      c.reset();for(const action of pose.actions)c.execute({action,duration:1.5});run(7);skin.sync();
      const vertices=Array.from({length:mesh.userData.surface.vertices},(_,i)=>mesh.getVertexPosition(i,new T.Vector3()));
      const packed=new Float32Array(vertices.length*3);
      vertices.forEach((p,i)=>packed.set(p.toArray(),i*3));
      await writeFile(`${dataFolder}/${pose.name}.bin`,new Uint8Array(packed.buffer));
      const ratios:number[]=[],stretch:number[]=[];let degenerate=0,nonfinite=0;
      for(let t=0;t<count;t++) {
        const p=vertices[index.getX(t*3)],q=vertices[index.getX(t*3+1)],r=vertices[index.getX(t*3+2)];
        const area=cross.subVectors(q,p).cross(d.subVectors(r,p)).length();
        if(!Number.isFinite(area))nonfinite++;
        if(area<1e-12)degenerate++;
        ratios.push(area/reference[t]);
        stretch.push(p.distanceTo(q)/edges[t*3],q.distanceTo(r)/edges[t*3+1],r.distanceTo(p)/edges[t*3+2]);
      }
      ratios.sort((a,b)=>a-b);stretch.sort((a,b)=>a-b);
      output.push({pose:pose.name,label:pose.label,status:c.status,error:c.error,
        nonfiniteTriangles:nonfinite,degenerateTriangles:degenerate,
        areaRatioP01:ratios[Math.floor(count*0.01)],areaRatioP99:ratios[Math.floor(count*0.99)],
        edgeRatioP01:stretch[Math.floor(stretch.length*0.01)],edgeRatioP99:stretch[Math.floor(stretch.length*0.99)],
        activeCorrectives:Object.entries(mesh.morphTargetDictionary!).filter(([,i])=>mesh.morphTargetInfluences![i]>0.05).map(([name])=>name),
        maxJointError:Math.max(...c.snapshot().map((j)=>Math.abs(j.actual-j.target))),
      });
    }
  } finally {skin.dispose();c.dispose();e.dispose();}
  await mkdir("artifacts",{recursive:true});
  await writeFile(`artifacts/pose-review${before?"-before":""}.json`,JSON.stringify({
    method:"Actual MuJoCo fixed-base actuator motion, followed by runtime morphing and linear skinning",
    limitations:"Area/edge metrics detect gross collapse/stretch, not all triangle intersections. Fixed-base squat inspects flexed hips/knees without lowering the pelvis; no claim of free-base squat balance.",
    poses:output},null,2));
  return output;
}
if(process.argv[1]?.endsWith("review-poses.ts")) console.log(JSON.stringify(await inspectPoses(process.argv.includes("--before")),null,2));
