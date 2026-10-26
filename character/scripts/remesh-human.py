"""Smooth-union anatomical solids into one indexed, closed skin surface.

Uses existing numpy/scipy/scikit-image. Input and output coordinates are glTF Y-up.
The surface is independent of collision geometry; skin weights retain the MJCF rig.
"""
import json
import sys
from pathlib import Path
import numpy as np
from scipy import ndimage, sparse
from scipy.interpolate import PchipInterpolator
from scipy.sparse.csgraph import connected_components
from skimage.measure import marching_cubes
import fast_simplification

spec = json.loads(Path(sys.argv[1]).read_text())
out = Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
step = 0.003
shapes = spec['shapes']
rig = spec['rig']
bones = {b['name']: i for i, b in enumerate(rig)}

def prepare(s):
    matrix = np.array(s['matrix'], dtype=np.float64).reshape(4, 4).T
    s['R'] = matrix[:3, :3]; s['origin'] = matrix[:3, 3]
    if s['kind'] == 'ellipsoid':
        c, r = np.array(s['center']), np.array(s['size'])
        lo, hi = c-r, c+r
    elif s['kind'] == 'capsule':
        a, b, r = np.array(s['start']), np.array(s['end']), s['radius']
        lo, hi = np.minimum(a,b)-r, np.maximum(a,b)+r
    else:
        rings = np.array(s['rings']); rings = rings[np.argsort(rings[:,0])]
        # Width/depth interpolate monotonically, without overshooting at the caps.
        s['profile'] = [PchipInterpolator(rings[:,0], rings[:,k]) for k in (1,2,3)]
        lo = [-rings[:,1].max(), (rings[:,3]-rings[:,2]).min(), rings[0,0]]
        hi = [rings[:,1].max(), (rings[:,3]+rings[:,2]).max(), rings[-1,0]]
        s['zrange'] = (rings[0,0], rings[-1,0])
    corners = np.array([[x,y,z] for x in [lo[0],hi[0]] for y in [lo[1],hi[1]] for z in [lo[2],hi[2]]])
    corners = corners @ s['R'].T + s['origin']
    s['lo'], s['hi'] = corners.min(0), corners.max(0)
    s['finger'] = any('_'+f+'_' in s['owner'] for f in ['thumb','index','middle','ring','little'])
    s['smooth'] = 0.0012 if s['finger'] else 0.004 if s['owner'].endswith('_hand') else 0.012
    h = s['color'].lstrip('#'); rgb = np.array([int(h[i:i+2],16)/255 for i in (0,2,4)])
    s['rgb'] = np.where(rgb<=0.04045, rgb/12.92, ((rgb+0.055)/1.055)**2.4)

for shape in shapes: prepare(shape)
lo = np.min([s['lo'] for s in shapes], axis=0)-0.018
hi = np.max([s['hi'] for s in shapes], axis=0)+0.018
axes = [np.arange(lo[i], hi[i]+step, step, dtype=np.float32) for i in range(3)]
field = np.full(tuple(map(len,axes)), 1.0, dtype=np.float32)

def distance(s, xyz):
    q = [(xyz[0]-s['origin'][0])*s['R'][0,k] + (xyz[1]-s['origin'][1])*s['R'][1,k] + (xyz[2]-s['origin'][2])*s['R'][2,k] for k in range(3)]
    if s['kind']=='ellipsoid':
        q = [q[k]-s['center'][k] for k in range(3)]; r = s['size']
        k0 = np.sqrt(sum((q[k]/r[k])**2 for k in range(3)))
        k1 = np.sqrt(sum((q[k]/(r[k]*r[k]))**2 for k in range(3)))
        return k0*(k0-1)/np.maximum(k1,1e-8)
    if s['kind']=='capsule':
        a,b=np.array(s['start']),np.array(s['end']); ab=b-a
        q=[q[k]-a[k] for k in range(3)]
        t=np.clip(sum(q[k]*ab[k] for k in range(3))/np.dot(ab,ab),0,1)
        return np.sqrt(sum((q[k]-t*ab[k])**2 for k in range(3)))-s['radius']
    z=np.clip(q[2],*s['zrange'])
    w,d,offset=[p(z) for p in s['profile']]
    w=np.maximum(w,0.0003); d=np.maximum(d,0.0003)
    radial=(np.sqrt((q[0]/w)**2+((q[1]-offset)/d)**2)-1)*np.minimum(w,d)
    cap=np.maximum(s['zrange'][0]-q[2],q[2]-s['zrange'][1])
    return np.maximum(radial,cap)

for s in shapes:
    pad=s['smooth']+step*3
    slices=tuple(slice(max(0,int((s['lo'][i]-pad-lo[i])/step)), min(len(axes[i]),int((s['hi'][i]+pad-lo[i])/step)+2)) for i in range(3))
    xyz=np.meshgrid(*[axes[i][slices[i]] for i in range(3)], indexing='ij', sparse=True)
    d=distance(s,xyz).astype(np.float32)
    old=field[slices]; k=s['smooth']; h=np.maximum(k-np.abs(old-d),0)/k
    field[slices]=np.minimum(old,d)-h*h*k*0.25

vertices,faces,_,_=marching_cubes(field,0,spacing=(step,step,step),gradient_direction='ascent',allow_degenerate=False)
vertices+=lo
# Taubin smoothing removes voxel ripples without systematic volume shrinkage.
n=len(vertices)
edges=np.concatenate([faces[:,[0,1]],faces[:,[1,2]],faces[:,[2,0]]])
A=sparse.coo_matrix((np.ones(len(edges)*2), (np.r_[edges[:,0],edges[:,1]],np.r_[edges[:,1],edges[:,0]])),shape=(n,n)).tocsr()
A.data[:]=1; degree=np.asarray(A.sum(axis=1)).ravel()
for _ in range(3):
    for amount in (0.32,-0.33):
        vertices+=amount*(A@vertices/degree[:,None]-vertices)
# Keep the main connected skin only. Eyes, nails and hair are separate accessories.
count,labels=connected_components(A)
if count!=1:
    sizes=np.bincount(labels); largest=np.argmax(sizes)
    if sizes[largest]<n*0.995:
        raise RuntimeError(f'Skin is disconnected: {sorted(sizes.tolist(),reverse=True)[:10]}')
    keep=labels==largest; remap=np.cumsum(keep)-1
    faces=remap[faces[np.all(keep[faces],axis=1)]]; vertices=vertices[keep]; n=len(vertices)
# Quadric-error simplification retains small curved fingers while reducing broad
# nearly planar torso/limb patches. Topology is checked again after decimation.
source_triangles=len(faces)
# Increase the error metric near the hands, keeping more of the triangle budget
# on fingers. The monotone coordinate warp is inverted after simplification.
def hand_scale(x):
    t=np.clip((x-0.26)/0.10,0,1)
    return 1+3*t*t*(3-2*t)
original_extent=np.abs(vertices[:,0]).max()
metric=vertices.copy(); x=np.abs(vertices[:,0]); scale=hand_scale(x)
metric[:,0]=np.sign(vertices[:,0])*np.where(x>0.26,0.26+(x-0.26)*scale,x)
metric[:,1]=0.95+(vertices[:,1]-0.95)*scale; metric[:,2]*=scale
source_faces=faces
for target,aggressiveness in [(90000,5),(90000,3),(110000,3),(130000,2)]:
    candidate_vertices,candidate_faces=fast_simplification.simplify(metric.astype(np.float64),source_faces.astype(np.int32),target_count=min(target,len(source_faces)),agg=aggressiveness)
    candidate_edges=np.sort(np.concatenate([candidate_faces[:,[0,1]],candidate_faces[:,[1,2]],candidate_faces[:,[2,0]]]),axis=1)
    _,candidate_uses=np.unique(candidate_edges,axis=0,return_counts=True)
    if np.all(candidate_uses==2):
        vertices,faces=candidate_vertices,candidate_faces
        break
else:
    raise RuntimeError('Unable to simplify without non-manifold edges')
warped=np.abs(vertices[:,0]); lower=np.full(len(vertices),0.26); upper=np.full(len(vertices),original_extent+0.01)
for _ in range(35):
    middle=(lower+upper)/2
    below=0.26+(middle-0.26)*hand_scale(middle)<warped
    lower=np.where(below,middle,lower); upper=np.where(below,upper,middle)
restored=np.where(warped>0.26,(lower+upper)/2,warped); scale=hand_scale(restored)
vertices[:,0]=np.sign(vertices[:,0])*restored
vertices[:,1]=0.95+(vertices[:,1]-0.95)/scale; vertices[:,2]/=scale
n=len(vertices)
# Outward orientation from signed field gradient, then area-weighted smooth normals.
normal=np.cross(vertices[faces[:,1]]-vertices[faces[:,0]], vertices[faces[:,2]]-vertices[faces[:,0]])
centers=vertices[faces].mean(axis=1)
grad=[ndimage.map_coordinates(np.gradient(field,step,axis=i), ((centers-lo)/step).T,order=1) for i in range(3)]
if np.mean(np.sum(normal*np.array(grad).T,axis=1))<0:
    faces=faces[:,[0,2,1]]; normal=-normal
normals=np.zeros_like(vertices)
for k in range(3): np.add.at(normals,faces[:,k],normal)
normals/=np.maximum(np.linalg.norm(normals,axis=1,keepdims=True),1e-12)

# Closest anatomical surface establishes ownership, then blend at real joints.
best=np.full(n,1e6); owner=np.zeros(n,dtype=np.int32); colors=np.zeros((n,3))
for i,s in enumerate(shapes):
    selected=np.all(vertices>=s['lo']-0.025,axis=1)&np.all(vertices<=s['hi']+0.025,axis=1)
    ids=np.flatnonzero(selected)
    if not len(ids): continue
    dist=distance(s,vertices[ids].T)
    better=dist<best[ids]; ids=ids[better]
    best[ids]=dist[better];owner[ids]=i; colors[ids]=s['rgb']
indices=np.zeros((n,4),dtype=np.uint16);weights=np.zeros((n,4),dtype=np.float32)
for i,s in enumerate(shapes):
    ids=np.flatnonzero(owner==i)
    if not len(ids):continue
    name=s['owner']; primary=bones[name]; secondary=None
    local=(vertices[ids]-s['origin'])@s['R']
    blend=np.zeros(len(ids))
    if name=='torso':
        secondary='chest'; blend=np.clip((local[:,2]-0.14)/0.18,0,1)
    elif name.endswith('_foot'):
        secondary=name.replace('_foot','_toes');blend=np.clip((-local[:,1]-0.1)/0.08,0,1)
    elif rig[primary]['parent']:
        secondary=rig[primary]['parent']
        if s['finger']: blend=0.5*np.exp(-(local[:,2]/0.010)**2)
        elif name.endswith('_hand'):blend=0.75*np.clip((local[:,2]+0.015)/0.04,0,1)
        elif name.endswith('_upper_arm'):blend=0.65*np.exp(-(local[:,2]/0.065)**2)
        elif name.endswith('_forearm'):blend=0.5*np.exp(-(local[:,2]/0.06)**2)
        elif name.endswith('_shin'):blend=0.5*np.exp(-(local[:,2]/0.055)**2)
        elif name.endswith('_thigh'):blend=0.55*np.exp(-(local[:,2]/0.085)**2)
        elif name=='neck':blend=0.6*np.exp(-(local[:,2]/0.045)**2)
    indices[ids,0]=primary; weights[ids,0]=1-blend
    if secondary: indices[ids,1]=bones[secondary];weights[ids,1]=blend
    child=None; width=0.04
    if s['finger']:
        prefix,segment=name.rsplit('_',1)
        child=f'{prefix}_{int(segment)+1}' if int(segment)<3 else None
        width=0.009
    else:
        for suffix,next_suffix,extent in [('_upper_arm','_forearm',0.055),('_forearm','_hand',0.035),('_thigh','_shin',0.065),('_shin','_foot',0.035)]:
            if name.endswith(suffix): child=name[:-len(suffix)]+next_suffix; width=extent
    if child in bones:
        length=-rig[bones[child]]['position'][2]
        distal=0.5*np.exp(-((local[:,2]+length)/width)**2)
        distal=np.minimum(distal,1-blend)
        weights[ids,0]-=distal; indices[ids,2]=bones[child]; weights[ids,2]=distal
# Diffuse on surface adjacency, so the two sides of each joint agree without
# blurring weights across the air gaps between adjacent fingers.
edges=np.concatenate([faces[:,[0,1]],faces[:,[1,2]],faces[:,[2,0]]])
A=sparse.coo_matrix((np.ones(len(edges)*2,dtype=np.float32),(np.r_[edges[:,0],edges[:,1]],np.r_[edges[:,1],edges[:,0]])),shape=(n,n)).tocsr()
A.data[:]=1; degree=np.asarray(A.sum(axis=1)).ravel()
W=np.zeros((n,len(rig)),dtype=np.float32)
for k in range(4): np.add.at(W,(np.arange(n),indices[:,k]),weights[:,k])
for _ in range(7): W=0.6*W+0.4*(A@W/degree[:,None])
indices=np.argsort(W,axis=1)[:,-4:][:,::-1].astype(np.uint16)
weights=np.take_along_axis(W,indices,axis=1)
weights/=weights.sum(axis=1,keepdims=True)
# Exact edge topology, not merely merged buffer geometry.
unique,uses=np.unique(np.sort(np.concatenate([faces[:,[0,1]],faces[:,[1,2]],faces[:,[2,0]]]),axis=1),axis=0,return_counts=True)
if np.any(uses!=2): raise RuntimeError(f'Non-manifold skin edges: {np.count_nonzero(uses!=2)}')
for name,data in [('position',vertices.astype('<f4')),('normal',normals.astype('<f4')),('color',colors.astype('<f4')),('skinIndex',indices.astype('<u2')),('skinWeight',weights.astype('<f4')),('index',faces.astype('<u4'))]:
    data.tofile(out/(name+'.bin'))
report={'vertices':n,'triangles':len(faces),'connectedComponents':1,'boundaryEdges':0,'nonManifoldEdges':0,'gridSpacing':step,'smoothUnion':True,'sourceTriangles':source_triangles,'decimator':'quadric-error','bindPose':'A-pose'}
(out/'report.json').write_text(json.dumps(report,indent=2))
obj=Path('artifacts/human-continuous.obj')
obj.parent.mkdir(parents=True,exist_ok=True)
with obj.open('w') as f:
    f.write('# Project-owned continuous skin, meters, Y-up; rigged GLB carries weights and correctives.\n')
    for p in vertices:f.write('v %.6f %.6f %.6f\n'%tuple(p))
    for tri in faces:f.write('f %d %d %d\n'%tuple(tri+1))
print(json.dumps(report))
