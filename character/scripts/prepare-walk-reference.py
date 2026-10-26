"""Retarget one CMU 07_01 recorded stride; no generated/synthetic mocap data.
ASF rotations use C R C^-1 with the declared axis and channel orders.
"""
from pathlib import Path
import json,hashlib
import numpy as np
from scipy.spatial.transform import Rotation
from scipy.ndimage import gaussian_filter1d
ROOT=Path(__file__).resolve().parent.parent
DIR=ROOT/'assets/motions/cmu'
bones={};parents={};bone=None;section=''
for line in (DIR/'07.asf').read_text().splitlines():
 p=line.split()
 if not p:continue
 if p[0].startswith(':'):section=p[0];continue
 if section==':bonedata':
  if p[0]=='begin':bone={}
  elif p[0]=='end':bones[bone['name']]=bone
  elif p[0]=='name':bone['name']=p[1]
  elif p[0] in ['direction','axis']:bone[p[0]]=np.array(list(map(float,p[1:4])))
  elif p[0]=='length':bone['length']=float(p[1])
  elif p[0]=='dof':bone['dof']=p[1:]
 elif section==':hierarchy' and p[0] not in ['begin','end']:
  for name in p[1:]:parents[name]=p[0]
frames=[]
for line in (DIR/'07_01.amc').read_text().splitlines():
 p=line.split()
 if not p or p[0].startswith(('#',':')):continue
 if p[0].isdigit():frames.append({})
 else:frames[-1][p[0]]=np.array(list(map(float,p[1:])))

def fk(frame):
 root=frame['root'];pos={'root':root[:3]*.0254/.45};rot={'root':Rotation.from_euler('xyz',root[3:],degrees=True).as_matrix()};start={}
 def visit(name):
  if name in pos:return
  b=bones[name];parent=parents[name];visit(parent)
  axis=Rotation.from_euler('xyz',b['axis'],degrees=True).as_matrix()
  channels=dict(zip(b.get('dof',[]),frame.get(name,[])))
  motion=Rotation.from_euler('xyz',[channels.get('r'+a,0) for a in 'xyz'],degrees=True).as_matrix()
  rot[name]=rot[parent]@axis@motion@axis.T;start[name]=pos[parent]
  pos[name]=pos[parent]+rot[name]@b['direction']*b['length']*.0254/.45
 for name in bones:visit(name)
 return pos,rot,start
# Consecutive left knee flexion peaks enclose a complete captured stride.
first,last=25,156
count=128
indices=np.arange(first,last)
features={};raw={};positions=[]
for idx in indices:
 f=frames[idx];p,r,s=fk(f);positions.append(p)
 for prefix,side in [('l','left'),('r','right')]:
  upper=r['thorax'].T@(p[prefix+'humerus']-s[prefix+'humerus'])
  raw.setdefault(side+'_shoulder_flex',[]).append(np.arctan2(-upper[2],-upper[1]))
  raw.setdefault(side+'_shoulder',[]).append(-np.arctan2(upper[0],-upper[1]))
  raw.setdefault(side+'_elbow',[]).append(np.deg2rad(f[prefix+'radius'][0]))
  for suffix,bone,axis,sign in [('hip','femur',0,1),('knee','tibia',0,1),('ankle','foot',0,1)]:
   raw.setdefault(side+'_'+suffix,[]).append(np.deg2rad(f[prefix+bone][axis])*sign)
  raw.setdefault(side+'_foot_height',[]).append(p[prefix+'foot'][1])
  raw.setdefault(side+'_foot_forward',[]).append(p[prefix+'foot'][2]-p['root'][2])
 for target,bone,axis,sign in [('spine_flex','lowerback',0,1),('spine_sidebend','lowerback',2,-1),('spine_twist','lowerback',1,1),('chest_flex','thorax',0,1),('chest_sidebend','thorax',2,-1),('chest_twist','thorax',1,1),('neck_pitch','head',0,1)]:
  raw.setdefault(target,[]).append(np.deg2rad(f[bone][axis])*sign)
 raw.setdefault('pelvis_height',[]).append(p['root'][1])
 raw.setdefault('pelvis_roll',[]).append(np.deg2rad(f['root'][5]))
# Remove capture drift at the loop seam, then filter periodically (not across
# arbitrary clip ends). Preserve the recorded asymmetry and timing.
for key,values in raw.items():
 a=np.array(values);a-=np.linspace(0,a[-1]-a[0],len(a))
 a=gaussian_filter1d(a,2,mode='wrap')
 if key.endswith('_foot_height'):
  a=np.maximum(0,a-np.percentile(a,8));a/=max(a.max(),1e-8)
 elif key.endswith('_foot_forward'):a=(a-a.mean())/(np.ptp(a) or 1)
 elif key=='pelvis_height':a-=a.mean()
 elif key.endswith('_elbow'):a=np.clip(a,.08,1.2)
 elif key.endswith(('_hip','_knee','_ankle')):pass
 else:a-=a.mean()
 t=np.linspace(0,len(a),count,endpoint=False)
 features[key]=np.round(np.interp(t,np.arange(len(a)+1),np.r_[a,a[0]]),7).tolist()
# Report the FK foot trajectory for traceability and contact-phase extraction.
meta={'source':'CMU Graphics Lab Motion Capture Database','subject':'07','trial':'01','description':'walk','url':'https://mocap.cs.cmu.edu/subjects/07/', 'sourceFps':120,'sourceFrames':[first+1,last+1],'duration':(last-first)/120,'samples':count,'sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in [DIR/'07.asf',DIR/'07_01.amc']},'processing':'ASF forward kinematics, anatomical retarget, seam detrend, periodic lowpass, 128 phase samples; finger/thumb capture channels ignored','licenseUrl':'https://mocap.cs.cmu.edu/'}
out=ROOT/'src/human/motion/cmu-walk.json';out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps({'meta':meta,'channels':features},separators=(',',':'))+'\n')
print(json.dumps(meta,indent=2))
for side in ['left','right']:
 h=np.array(features[side+'_foot_height']);print(side,'foot height peak phase',h.argmax()/count,'range raw',np.ptp(raw[side+'_foot_height']))
