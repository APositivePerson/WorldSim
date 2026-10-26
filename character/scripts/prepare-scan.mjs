// Fit a locally licensed Renderpeople Eric scan to the project's physical bind rig.
// Source and output stay in ignored private folders; no supplier asset is vendored.
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseScan } from './inspect-scan.mjs';
class NodeFileReader {
  result=null; onloadend=null;
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(b=>{this.result=b;this.onloadend?.();}); }
  readAsDataURL(blob) { blob.arrayBuffer().then(b=>{this.result=`data:${blob.type};base64,${Buffer.from(b).toString('base64')}`;this.onloadend?.();}); }
}
globalThis.FileReader=NodeFileReader;
const directory='artifacts/scanned-private';
const scan=await parseScan(`${directory}/rp_eric_rigged_001_yup_a.fbx`);
const loader=new GLTFLoader();
loader.register(()=>({name:'CPU_TEXTURES',loadTexture:async()=>new T.Texture()}));
const canonicalBytes=await readFile('public/models/human-skinned.glb');
const canonical=(await loader.parseAsync(canonicalBytes.buffer.slice(canonicalBytes.byteOffset,canonicalBytes.byteOffset+canonicalBytes.byteLength),'')).scene;
canonical.updateMatrixWorld(true);
let template,source;
canonical.traverse(o=>{if(o instanceof T.SkinnedMesh)template=o;});
scan.traverse(o=>{if(o instanceof T.SkinnedMesh)source=o;});
if(!template||!source)throw new Error('Both scan and template must contain a skinned mesh');
const bones=template.skeleton.bones.slice(), targetByName=new Map(bones.map(b=>[b.name,b]));
const sourceByName=new Map(source.skeleton.bones.map(b=>[b.name,b]));
const targetPosition=name=>targetByName.get(name).getWorldPosition(new T.Vector3());
const sourcePosition=name=>sourceByName.get(name).getWorldPosition(new T.Vector3()).multiplyScalar(.01);
const C=new T.Matrix4().makeRotationX(-Math.PI/2);
const sourceHead=sourcePosition('head').add(new T.Vector3(0,.09,0));
const fits=new Map(), assignments=new Map(), audits=[];
function fit(name,targetName,sourceEnd,targetEnd,options={}) {
  const origin=options.origin??sourcePosition(name);
  const target=targetByName.get(targetName),targetOrigin=targetPosition(targetName);
  let basis=C.clone(),targetFrame=target.matrixWorld.clone(),scale=1,end,desiredEnd;
  if(sourceEnd&&targetEnd) {
    end=typeof sourceEnd==='string'?sourcePosition(sourceEnd):sourceEnd;
    desiredEnd=typeof targetEnd==='string'?targetPosition(targetEnd):targetEnd;
    const z=origin.clone().sub(end).normalize();
    let y=options.y?.clone()??new T.Vector3(0,0,-1);
    y.addScaledVector(z,-y.dot(z)).normalize();
    if(y.lengthSq()<.5)throw new Error(`Invalid anatomical frame: ${name}`);
    const x=new T.Vector3().crossVectors(y,z).normalize(); y.crossVectors(z,x).normalize();
    basis.makeBasis(x,y,z);
    const targetZ=targetOrigin.clone().sub(desiredEnd).normalize();
    const targetY=new T.Vector3().setFromMatrixColumn(target.matrixWorld,1).normalize();
    targetY.addScaledVector(targetZ,-targetY.dot(targetZ)).normalize();
    const targetX=new T.Vector3().crossVectors(targetY,targetZ).normalize();
    targetY.crossVectors(targetZ,targetX).normalize();
    targetFrame.makeBasis(targetX,targetY,targetZ).setPosition(targetOrigin);
    scale=desiredEnd.distanceTo(targetOrigin)/end.distanceTo(origin);
  }
  basis.setPosition(origin);
  const radial=options.radialScale??1;
  const axial=new T.Matrix4().makeScale(radial,radial,options.foot ? .80 : scale);
  const matrix=targetFrame.multiply(axial).multiply(basis.invert());
  const endpointError=end?end.clone().applyMatrix4(matrix).distanceTo(desiredEnd):0;
  if(endpointError>1e-6)throw new Error(`Bind endpoint mismatch: ${name}: ${endpointError}`);
  fits.set(name,matrix);assignments.set(name,targetName);
  audits.push({source:name,target:targetName,axialScale:options.foot ? .80 : scale,endpointError});
  return matrix;
}
fit('hip','pelvis'); fits.set('root',fits.get('hip'));assignments.set('root','pelvis');
fit('spine_01','torso','spine_02','torso_deform_2');
fit('spine_02','torso_deform_2','spine_03','chest');
fit('spine_03','chest','neck','neck');
fit('neck','neck',sourceHead,'head');
fit('head','head',null,null,{origin:sourceHead});
for(const [suffix,side,sign] of [['l','left',1],['r','right',-1]]) {
  const hand=sourcePosition(`hand_${suffix}`), middle=sourcePosition(`middle_01_${suffix}`);
  const z=hand.clone().sub(middle).normalize();
  const x=sourcePosition(`index_01_${suffix}`).sub(sourcePosition(`pinky_01_${suffix}`)).multiplyScalar(sign);
  x.addScaledVector(z,-x.dot(z)).normalize();
  const palmY=new T.Vector3().crossVectors(z,x).normalize();
  // The physical palm is smaller than the scan. Scale its cross-section too;
  // shortening only the long axis produced broad, flattened fingers and webs.
  const palmScale=targetPosition(`${side}_index_1`).distanceTo(targetPosition(`${side}_little_1`))
    /sourcePosition(`index_01_${suffix}`).distanceTo(sourcePosition(`pinky_01_${suffix}`));
  fit(`shoulder_${suffix}`,`${side}_clavicle`,`upperarm_${suffix}`,`${side}_upper_arm`);
  fit(`upperarm_${suffix}`,`${side}_upper_arm`,`lowerarm_${suffix}`,`${side}_forearm`);
  fit(`lowerarm_${suffix}`,`${side}_forearm`,`hand_${suffix}`,`${side}_hand`,{y:palmY});
  fit(`hand_${suffix}`,`${side}_hand`,`middle_01_${suffix}`,`${side}_middle_1`,{y:palmY,radialScale:palmScale});
  for(const [finger,index] of [['thumb',4],['index',0],['middle',1],['ring',2],['pinky',3]]) {
    const targetFinger=finger==='pinky'?'little':finger;
    for(let segment=1;segment<=3;segment++) {
      const src=`${finger}_0${segment}_${suffix}`, dest=`${side}_${targetFinger}_${segment}`;
      const sourceEnd=segment===3?`${finger}_end_${suffix}`:`${finger}_0${segment+1}_${suffix}`;
      let targetEnd;
      if(segment<3)targetEnd=`${side}_${targetFinger}_${segment+1}`;
      else {
        const length=finger==='thumb'?.020:.018*[.94,1,.93,.76][index];
        targetEnd=new T.Vector3(0,0,-length).applyMatrix4(targetByName.get(dest).matrixWorld);
      }
      fit(src,dest,sourceEnd,targetEnd,{y:palmY,radialScale:palmScale});
    }
    fits.set(`${finger}_end_${suffix}`,fits.get(`${finger}_03_${suffix}`));
    assignments.set(`${finger}_end_${suffix}`,`${side}_${targetFinger}_3`);
  }
  fit(`upperleg_${suffix}`,`${side}_thigh`,`lowerleg_${suffix}`,`${side}_shin`);
  fit(`lowerleg_${suffix}`,`${side}_shin`,`foot_${suffix}`,`${side}_foot`);
  fit(`foot_${suffix}`,`${side}_foot`,null,null,{foot:true});
  fit(`ball_${suffix}`,`${side}_toes`,null,null,{foot:true});
  for(const [src,owner,dest] of [
    [`upperarm_twist_${suffix}`,`upperarm_${suffix}`,`${side}_shoulder_deform_2`],
    [`lowerarm_twist_${suffix}`,`lowerarm_${suffix}`,`${side}_forearm_twist_2`],
    [`upperleg_twist_${suffix}`,`upperleg_${suffix}`,`${side}_thigh`],
    [`lowerleg_twist_${suffix}`,`lowerleg_${suffix}`,`${side}_shin`],
    [`foot_end_${suffix}`,`ball_${suffix}`,`${side}_toes`],
  ]) { fits.set(src,fits.get(owner));assignments.set(src,dest); }
}
// Preserve the scan's original face pivots and original facial skin weights.
function faceBone(sourceName,role,settings={}) {
  if(!sourceByName.has(sourceName))return;
  const name=`scan_${sourceName}`, bone=new T.Bone();bone.name=name;
  const head=targetByName.get('head');
  const position=sourcePosition(sourceName).applyMatrix4(fits.get('head'));
  bone.position.copy(head.worldToLocal(position));
  bone.userData.humanDeform={role,...settings};head.add(bone);
  bones.push(bone);targetByName.set(name,bone);
  assignments.set(sourceName,name);fits.set(sourceName,fits.get('head'));
  return name;
}
faceBone('jaw','jaw');
assignments.set('jaw_end','scan_jaw');fits.set('jaw_end',fits.get('head'));
for(const [suffix,side] of [['l','left'],['r','right']]) {
  const eye=targetByName.get(`${side}_eye`),head=targetByName.get('head');
  eye.position.copy(head.worldToLocal(sourcePosition(`eye_${suffix}`).applyMatrix4(fits.get('head'))));
  for(const src of [`eye_${suffix}`,`eye_end_${suffix}`]) { assignments.set(src,`${side}_eye`);fits.set(src,fits.get('head')); }
  const lid=faceBone(`eyelid_${suffix}`,'eyelid',{side,half:'upper'});
  assignments.set(`eyelid_end_${suffix}`,lid);fits.set(`eyelid_end_${suffix}`,fits.get('head'));
  faceBone(`eyebrow_${suffix}`,'brow',{side});
  faceBone(`mouth_${suffix}`,'cheek',{side});
}
assignments.set('head_end','head');fits.set('head_end',fits.get('head'));
canonical.updateMatrixWorld(true);
const targetIndices=new Map(bones.map((b,i)=>[b.name,i]));
const geometry=source.geometry.clone(),position=geometry.attributes.position,normal=geometry.attributes.normal;
const sourceIndices=geometry.attributes.skinIndex,sourceWeights=geometry.attributes.skinWeight;
const fitted=new Float32Array(position.count*3),fittedNormals=new Float32Array(position.count*3);
const jointArray=new Uint16Array(position.count*4),weightArray=new Float32Array(position.count*4);
const sourceToWorld=source.matrixWorld.clone().premultiply(new T.Matrix4().makeScale(.01,.01,.01));
const sourceNormal=new T.Matrix3().getNormalMatrix(sourceToWorld);
const point=new T.Vector3(),n=new T.Vector3(),out=new T.Vector3(),outNormal=new T.Vector3();
const normalFits=new Map([...fits].map(([name,m])=>[name,new T.Matrix3().getNormalMatrix(m)]));
const skinMask=new Float32Array(position.count);
const missing=new Set();
for(let i=0;i<position.count;i++) {
  point.fromBufferAttribute(position,i).applyMatrix4(sourceToWorld);
  n.fromBufferAttribute(normal,i).applyMatrix3(sourceNormal).normalize();
  out.set(0,0,0);outNormal.set(0,0,0);const targets=new Map();let sum=0,skinWeight=0;
  for(let k=0;k<4;k++) {
    const w=sourceWeights.getComponent(i,k);if(w<=0)continue;
    const name=source.skeleton.bones[sourceIndices.getComponent(i,k)].name;
    const matrix=fits.get(name),destination=assignments.get(name);
    if(!matrix||!destination) {missing.add(name);continue;}
    out.addScaledVector(point.clone().applyMatrix4(matrix),w);
    outNormal.addScaledVector(n.clone().applyMatrix3(normalFits.get(name)).normalize(),w);
    const index=targetIndices.get(destination);targets.set(index,(targets.get(index)||0)+w);sum+=w;
    if(/^(head|jaw|eye|mouth|neck|hand|thumb|index|middle|ring|pinky)/.test(name))skinWeight+=w;
  }
  if(sum<.9)throw new Error(`Incomplete scan mapping at vertex ${i}: ${[...missing]}`);
  out.multiplyScalar(1/sum);outNormal.normalize();
  fitted.set(out.toArray(),i*3);fittedNormals.set(outNormal.toArray(),i*3);
  const sorted=[...targets].sort((a,b)=>b[1]-a[1]);
  for(let k=0;k<sorted.length;k++){jointArray[i*4+k]=sorted[k][0];weightArray[i*4+k]=sorted[k][1]/sum;}
  skinMask[i]=skinWeight/sum;
}
geometry.setAttribute('position',new T.Float32BufferAttribute(fitted,3));
geometry.setAttribute('normal',new T.Float32BufferAttribute(fittedNormals,3));
geometry.setAttribute('skinIndex',new T.Uint16BufferAttribute(jointArray,4));
geometry.setAttribute('skinWeight',new T.Float32BufferAttribute(weightArray,4));
geometry.setAttribute('_skin_mask',new T.Float32BufferAttribute(skinMask,1));
// FBX UVs use the bottom-left convention; glTF images use top-left.
const uv=geometry.getAttribute('uv');for(let i=0;i<uv.count;i++)uv.setY(i,1-uv.getY(i));
geometry.deleteAttribute('color');geometry.morphAttributes={};
const remove=[];canonical.traverse(o=>{if(o instanceof T.Mesh)remove.push(o);});remove.forEach(o=>o.removeFromParent());
canonical.updateMatrixWorld(true);
const skeleton=new T.Skeleton(bones);skeleton.calculateInverses();
const material=new T.MeshStandardMaterial({color:0xffffff,roughness:.7,metalness:0});material.name='Renderpeople Eric / photographic PBR';
const mesh=new T.SkinnedMesh(geometry,material);mesh.name='ScannedHumanEric';
mesh.userData.scanAsset={source:'Renderpeople Eric Rigged 001',url:'https://renderpeople.com/free-3d-people/',
  license:'Renderpeople General Terms and Conditions; not CC0',retargeted:true,
  note:'Scan-derived visual asset fitted to a simplified physical rig; no measurement accuracy claim.'};
canonical.add(mesh);mesh.bind(skeleton,new T.Matrix4());canonical.updateMatrixWorld(true);
const bytes=await new GLTFExporter().parseAsync(canonical,{binary:true,onlyVisible:false});
await mkdir(directory,{recursive:true});await writeFile(`${directory}/eric-fitted-untextured.glb`,Buffer.from(bytes));
await writeFile(`${directory}/fitting-report.json`,JSON.stringify({source:'Renderpeople Eric Rigged 001',bones:bones.length,vertices:position.count,triangles:position.count/3,missing:[...missing],fits:audits},null,2));
console.log(JSON.stringify({bones:bones.length,vertices:position.count,triangles:position.count/3,missing:[...missing],bytes:bytes.byteLength}));
