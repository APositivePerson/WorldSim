import {defaultProfile} from '../src/human/calibration/Profile.ts';
const eye=defaultProfile.eyes;
import {readFile,writeFile} from 'node:fs/promises';
import load from '@mujoco/mujoco';
import {legMuscles} from '../src/human/neuromuscular/LegAnatomy.ts';
// Separate experiment asset. Existing baseline MJCFs are never changed.
const source=await readFile('public/models/human-free.xml','utf8');
const key=source.match(/<key name="stand" qpos="([^"]*)" ctrl="([^"]*)"/)!;
let xml=source.replace(/\s*<keyframe>[\s\S]*?<\/keyframe>/,'').replace('Human free base','Human neuromuscular');
xml=xml.replace(/<position\b[^>]*joint="(?:left|right)_(?:hip(?:_yaw|_abduction)?|knee|ankle(?:_roll)?|toe_flex)"[^>]*\/>/g,s=>s.replace('<position','<position group="3"'));
const tendons=legMuscles.map(f=>`<fixed name="${f.name}_tendon">${Object.entries(f.coefficients).map(([joint,coef])=>`<joint joint="${joint}" coef="${coef}"/>`).join('')}</fixed>`);
const actuators=legMuscles.map(f=>`<general name="${f.name}" group="4" tendon="${f.name}_tendon" dyntype="none" gaintype="fixed" gainprm="-1" biastype="none" ctrllimited="true" ctrlrange="0 ${f.force*defaultProfile.hill.tendonForceCap}" forcelimited="false"/>`);
let eyeBodies='',eyeSites='';
for(const [side,sign] of [['left',1],['right',-1]] as const){
  const c=eye.center.map((v,k)=>k===0?v*sign:v);
  const routes:[string,number[],number[]][]=defaultProfile.eyeRoutes.map(route=>[
    route.name,route.insertion.map((v,k)=>k===0?v*sign:v),route.pulley.map((v,k)=>k===0?v*sign:v)]);
  eyeBodies+=`<body name="${side}_eye" pos="${c.join(' ')}">
    <joint name="${side}_eye_yaw" axis="0 0 1" range="${eye.yawRange.join(' ')}" damping="${eye.damping}" stiffness="${eye.stiffness}" armature="${eye.armature}"/>
    <joint name="${side}_eye_pitch" axis="1 0 0" range="${eye.pitchRange.join(' ')}" damping="${eye.damping}" stiffness="${eye.stiffness}" armature="${eye.armature}"/>
    <joint name="${side}_eye_torsion" axis="0 1 0" range="${eye.torsionRange.join(' ')}" damping="${eye.damping}" stiffness="${eye.stiffness}" armature="${eye.armature}"/>
    <geom type="sphere" size="${eye.radius}" mass="${eye.mass}" contype="0" conaffinity="0" rgba=".9 .9 .85 1"/>
    ${routes.map(([n,p])=>`<site name="eye_${side}_${n}_insertion" pos="${p.join(' ')}" size=".001"/>`).join('')}
  </body>`;
  for(const [n,,p] of routes){
    eyeSites+=`<site name="eye_${side}_${n}_pulley" pos="${p.map((v,k)=>v+c[k]).join(' ')}" size=".001"/>`;
    tendons.push(`<spatial name="eye_${side}_${n}_tendon"><site site="eye_${side}_${n}_pulley"/><site site="eye_${side}_${n}_insertion"/></spatial>`);
    actuators.push(`<muscle name="eye_${side}_${n}" group="5" tendon="eye_${side}_${n}_tendon" lengthrange=".02 .05" range=".5 1.5" force="${eye.force}" timeconst="${eye.activationRise} ${eye.activationFall}" tausmooth=".002" ctrllimited="true" ctrlrange="0 1" forcelimited="false"/>`);
  }
}
xml=xml.replace(/(<body name="head"[^>]*>)([\s\S]*?)(<\/body>)/,(_,open,body,close)=>open+body.replace('mass="4.5"',`mass="${4.5-2*eye.mass}"`)+eyeSites+eyeBodies+close);
xml=xml.replace('</tendon>',tendons.join('\n')+'\n</tendon>').replace('</actuator>',actuators.join('\n')+'\n</actuator>');
const mj=await load(),old=mj.MjModel.from_xml_string(source),model=mj.MjModel.from_xml_string(xml);
try{
  const q=Array.from(model.qpos0) as number[],ctrl=Array(model.nu).fill(0),oldQ=key[1].split(' ').map(Number),oldCtrl=key[2].split(' ').map(Number);
  for(let j=0;j<old.njnt;j++){
    const name=mj.mj_id2name(old,3,j),id=mj.mj_name2id(model,3,name),width=old.jnt_type[j]===0?7:1;
    for(let k=0;k<width;k++)q[model.jnt_qposadr[id]+k]=oldQ[old.jnt_qposadr[j]+k];
  }
  for(let a=0;a<old.nu;a++)ctrl[mj.mj_name2id(model,19,mj.mj_id2name(old,19,a))]=oldCtrl[a];
  xml=xml.replace('</mujoco>',`<keyframe><key name="stand" qpos="${q.join(' ')}" ctrl="${ctrl.join(' ')}"/></keyframe>\n</mujoco>`);
  await writeFile('public/models/human-neuromuscular.xml',xml);
  console.log(`Generated experimental model: ${model.nq} positions, ${model.nu} actuators, ${model.ntendon} tendons`);
}finally{old.delete();model.delete();}
