import * as T from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { readFile, writeFile } from 'node:fs/promises';
class FileTexture extends T.Loader {
  load(url) { const texture = new T.Texture(); texture.userData.sourceFile = url; return texture; }
}
globalThis.window = { URL };
export async function parseScan(path) {
  const manager = new T.LoadingManager();
  manager.addHandler(/.*/, new FileTexture(manager));
  const bytes = await readFile(path);
  const scene = new FBXLoader(manager).parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  scene.updateMatrixWorld(true);
  return scene;
}
if (process.argv[1]?.endsWith('inspect-scan.mjs')) {
  const scene = await parseScan(process.argv[2] || 'artifacts/scanned-private/rp_eric_rigged_001_yup_a.fbx');
  const bones = [], meshes = [];
  scene.traverse(o => {
    if (o instanceof T.Bone) bones.push({ name:o.name,parent:o.parent?.name,position:o.getWorldPosition(new T.Vector3()).toArray(),quaternion:o.getWorldQuaternion(new T.Quaternion()).toArray() });
    if (o instanceof T.Mesh) meshes.push({ name:o.name,vertices:o.geometry.attributes.position.count,triangles:o.geometry.index?.count/3||o.geometry.attributes.position.count/3,
      material:(Array.isArray(o.material)?o.material:[o.material]).map(m=>({name:m.name,color:m.color?.getHexString(),opacity:m.opacity,map:m.map?.userData.sourceFile,normal:m.normalMap?.userData.sourceFile,bump:m.bumpMap?.userData.sourceFile,specular:m.specularMap?.userData.sourceFile,alpha:m.alphaMap?.userData.sourceFile})),
      bones:o.skeleton?.bones.map(b=>b.name),bounds:new T.Box3().setFromObject(o).getSize(new T.Vector3()).toArray() });
  });
  const result={bones,meshes,bounds:new T.Box3().setFromObject(scene).getSize(new T.Vector3()).toArray()};
  await writeFile('artifacts/scanned-private/inspection.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
}
