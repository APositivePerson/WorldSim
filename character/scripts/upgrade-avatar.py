"""Reproducible v2 sculpt, deformation weights, UV atlas and embedded PBR assets.

Uses the preserved v1 runtime GLB, not accumulated edits. No physics model changes.
Run: python3 scripts/upgrade-avatar.py (numpy, scipy and Pillow).
"""
from pathlib import Path
import io, json, struct, sys
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public/models/human-skinned.glb'
BACKUP = ROOT / 'artifacts/avatar-v1/human-skinned.glb'
BASE = ROOT / 'artifacts/avatar-v2-source.glb'
BACKUP.parent.mkdir(parents=True, exist_ok=True)
if not BACKUP.exists():
    BACKUP.write_bytes(OUT.read_bytes() if OUT.exists() else BASE.read_bytes())
if '--refresh-base' in sys.argv:
    candidate=OUT.read_bytes();chunk=struct.unpack_from('<I',candidate,12)[0]
    if json.loads(candidate[20:20+chunk]).get('asset',{}).get('extras',{}).get('avatarVersion')==2:
        raise ValueError('--refresh-base requires a fresh v1 generation, not a v2 asset')
    BASE.write_bytes(candidate)
if not BASE.exists():BASE.write_bytes(BACKUP.read_bytes())
raw = BASE.read_bytes()
size = struct.unpack_from('<I', raw, 12)[0]
g = json.loads(raw[20:20+size])
binary = raw[28+size:]
DT = {5126: '<f4', 5125: '<u4', 5123: '<u2', 5121: 'u1'}
WIDTH = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
def read(index):
    a = g['accessors'][index]; shape = (a['count'], WIDTH[a['type']])
    def view(vi, dtype, count, width, offset=0):
        v = g['bufferViews'][vi]; start = v.get('byteOffset', 0)+offset
        stride = v.get('byteStride', np.dtype(dtype).itemsize*width)
        return np.ndarray((count, width), dtype=dtype, buffer=binary, offset=start,
                          strides=(stride, np.dtype(dtype).itemsize)).copy()
    result = view(a['bufferView'], DT[a['componentType']], *shape, a.get('byteOffset', 0)) if 'bufferView' in a else np.zeros(shape, dtype=DT[a['componentType']])
    if 'sparse' in a:
        s = a['sparse']; ids = s['indices']; val = s['values']
        ix = view(ids['bufferView'], DT[ids['componentType']], s['count'], 1, ids.get('byteOffset',0)).ravel()
        result[ix] = view(val['bufferView'], DT[a['componentType']], s['count'], shape[1], val.get('byteOffset',0))
    return result

primitive = g['meshes'][0]['primitives'][0]
attrs = {name: read(a) for name, a in primitive['attributes'].items()}
pos, colors, joints, weights = (attrs[n].copy() for n in ['POSITION', 'COLOR_0', 'JOINTS_0', 'WEIGHTS_0'])
faces = read(primitive['indices']).reshape(-1,3)
morphs = [read(t['POSITION']) for t in primitive['targets']]
skin = g['skins'][0]
node_by_name = {n.get('name'): i for i, n in enumerate(g['nodes'])}
surface_node = g['nodes'][node_by_name['HumanSkin']]
report = surface_node['extras']['surface']
surface_count, surface_triangles = report['vertices'], report['triangles']
world = {}
def node_matrix(node):
    if 'matrix' in node: return np.array(node['matrix']).reshape(4,4).T
    x,y,z,w = node.get('rotation',[0,0,0,1]); t=node.get('translation',[0,0,0]); s=node.get('scale',[1,1,1])
    m=np.eye(4); m[:3,:3]=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],
      [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)], [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]]) @ np.diag(s)
    m[:3,3]=t; return m
def visit(index, parent):
    world[index]=parent @ node_matrix(g['nodes'][index])
    for child in g['nodes'][index].get('children',[]): visit(child,world[index])
for index in g['scenes'][g.get('scene',0)]['nodes']: visit(index,np.eye(4))
def local(name, points):
    inv=np.linalg.inv(world[node_by_name[name]])
    return points @ inv[:3,:3].T + inv[:3,3]
def to_world(name, points):
    m=world[node_by_name[name]]; return points @ m[:3,:3].T + m[:3,3]
def smooth(a,b,x):
    q=np.clip((x-a)/(b-a),0,1); return q*q*(3-2*q)
def normals(points, tris):
    n=np.zeros_like(points); tri=points[tris]; cross=np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0])
    for k in range(3): np.add.at(n,tris[:,k],cross)
    length=np.linalg.norm(n,axis=1,keepdims=True)
    # Imported sphere poles include zero-area triangles. Give isolated pole
    # normals a finite unit fallback; continuous surface normals are unaffected.
    n[length[:,0]<1e-12]=[0,0,1]
    return n / np.maximum(np.linalg.norm(n,axis=1,keepdims=True),1e-12)

# Sculpt the continuous surface, retaining its original closed topology.
q=local('head',pos[:surface_count]); x,y,z=q.T
levels=[-.112,-.095,-.068,-.027,.018,.062,.100,.129]
width=np.interp(z,levels,[.018,.037,.054,.071,.078,.077,.060,.001])
depth=np.interp(z,levels,[.021,.039,.055,.067,.074,.075,.059,.001])
center=np.interp(z,levels,[-.027,-.020,-.008,.002,.008,.012,.013,.010])
front=1-smooth(center-.020,center+.012,y)
region=smooth(-.112,-.094,z)*(1-smooth(.062,.090,z))*front
# Soften the old cheek bosses rather than preserving intersecting sphere lobes.
q[:,0]*=1-.095*np.exp(-((z+.035)/.052)**2)*region
ratio=np.abs(q[:,0])/np.maximum(width,.001)
plane=center-depth*np.maximum(0,1-np.minimum(ratio,1)**2.7)**(1/2.7)
nose=.012*np.exp(-(q[:,0]/.010)**2-((z+.002)/.032)**2)
nose+=.011*np.exp(-(q[:,0]/.014)**2-((z+.021)/.012)**2)
lip=.003*np.exp(-(q[:,0]/.024)**2-((z+.058)/.012)**2)
cheek=sum(.0025*np.exp(-((q[:,0]-s*.040)/.024)**2-((z+.010)/.025)**2) for s in [-1,1])
orbit=sum(.0015*np.exp(-((q[:,0]-s*.034)/.016)**2-((z-.024)/.011)**2) for s in [-1,1])
blend=region*(1-smooth(.91,1.06,ratio))*.96
q[:,1]+=blend*(plane-nose-lip-cheek+orbit-q[:,1])
pos[:surface_count]=to_world('head',q)

# Move separate eyes slightly into the refined socket; preserve gaze ownership.
joint_names=[g['nodes'][i]['name'] for i in skin['joints']]
for side in ['left','right']:
    eye_index=joint_names.index(f'{side}_eye')
    selected=joints[:,0]==eye_index
    p=local('head',pos[selected]); p[:,1]+=.009
    pos[selected]=to_world('head',p)

# Refine palm volume, then smooth only wrist/elbow/knee transitions.
for side,sign in [('left',1),('right',-1)]:
    p=local(f'{side}_hand',pos[:surface_count]); px,py,pz=p.T
    area=np.exp(-(px/.042)**6-((pz+.025)/.035)**6)
    thickness=.013+.005*np.exp(-((px-sign*.022)/.020)**2-((pz+.020)/.028)**2)
    target=np.sign(py)*thickness
    p[:,1]+=.28*area*(target-py)
    pos[:surface_count]=to_world(f'{side}_hand',p)
smooth_weight=np.zeros(surface_count)
for side in ['left','right']:
    for part,radius in [('hand',.025),('forearm',.032),('shin',.043)]:
        p=local(f'{side}_{part}',pos[:surface_count])
        smooth_weight=np.maximum(smooth_weight,np.exp(-np.sum((p/radius)**2,axis=1))*.14)
edges=np.concatenate([faces[:surface_triangles][:,[0,1]],faces[:surface_triangles][:,[1,2]],faces[:surface_triangles][:,[2,0]]])
edges=np.concatenate([edges,edges[:,::-1]])
degree=np.bincount(edges[:,0],minlength=surface_count)
for _ in range(3):
    average=np.zeros((surface_count,3)); np.add.at(average,edges[:,0],pos[edges[:,1]])
    average/=np.maximum(degree[:,None],1)
    pos[:surface_count]+=(average-pos[:surface_count])*smooth_weight[:,None]

inverse=read(skin['inverseBindMatrices'])
new_helpers=[]
def add_bone(name,parent,offset,role,**settings):
    global inverse
    parent_index=node_by_name[parent]; index=len(g['nodes'])
    g['nodes'].append({'name':name,'translation':list(offset),'extras':{'humanDeform':{'role':role,**settings}}})
    g['nodes'][parent_index].setdefault('children',[]).append(index)
    node_by_name[name]=index
    w=world[parent_index].copy(); w[:3,3]+=w[:3,:3]@np.array(offset); world[index]=w
    inverse=np.vstack([inverse,np.linalg.inv(w).T.reshape(1,16)])
    skin['joints'].append(index); joint_names.append(name); new_helpers.append(name)
    return len(skin['joints'])-1
helpers={}
for side in ['left','right']:
    for k,f in enumerate([.18,.5,.82]):
        name=f'{side}_forearm_twist_{k+1}'
        helpers[name]=add_bone(name,f'{side}_forearm',[0,0,-.28*f],'forearmTwist',side=side,fraction=f)
    for k,f in enumerate([.32,.68]):
        name=f'{side}_shoulder_deform_{k+1}'
        helpers[name]=add_bone(name,f'{side}_upper_arm',[0,0,-.09*k],'shoulder',side=side,fraction=f)
for parent in ['torso','chest']:
    for k,f in enumerate([.33,.67]):
        name=f'{parent}_deform_{k+1}'
        helpers[name]=add_bone(name,parent,[0,.015,.15*f],'spine',fraction=f,parentRegion=parent)
helpers['jaw_deform']=add_bone('jaw_deform','head',[0,-.005,-.040],'jaw')
for side,sign in [('left',1),('right',-1)]:
    for half in ['upper','lower']:
        name=f'{side}_lid_{half}'
        helpers[name]=add_bone(name,'head',[sign*.035,-.067,.023],'eyelid',side=side,half=half)
    for role,offset in [('brow',[sign*.034,-.062,.043]),('cheek',[sign*.035,-.055,-.030])]:
        name=f'{side}_{role}_deform'; helpers[name]=add_bone(name,'head',offset,role,side=side)
for half,z in [('upper',-.055),('lower',-.063)]:
    name=f'lip_{half}_deform'
    parent='head' if half=='upper' else 'jaw_deform'
    offset=[0,-.070,z] if half=='upper' else [0,-.065,z+.040]
    helpers[name]=add_bone(name,parent,offset,'lip',half=half)

# Redistribute actual skin weights; four normalized influences per vertex.
influences=[dict((int(j),float(w)) for j,w in zip(js,ws) if w>1e-7) for js,ws in zip(joints,weights)]
def transfer(i,source,targets,amount):
    d=influences[i]; value=d.get(source,0)*np.clip(amount,0,1)
    if value<1e-7:return
    d[source]-=value
    for target,fraction in targets:d[target]=d.get(target,0)+value*fraction
for side in ['left','right']:
    src=joint_names.index(f'{side}_forearm'); p=local(f'{side}_forearm',pos)
    for i in np.flatnonzero(np.any(joints==src,axis=1)):
        t=np.clip(-p[i,2]/.28,0,1); anchors=np.array([.18,.5,.82])
        mix=np.maximum(0,1-np.abs(t-anchors)/.34); mix/=max(mix.sum(),1e-8)
        transfer(i,src,[(helpers[f'{side}_forearm_twist_{k+1}'],float(w)) for k,w in enumerate(mix)],1)
    src=joint_names.index(f'{side}_upper_arm'); p=local(f'{side}_upper_arm',pos)
    for i in np.flatnonzero(np.any(joints==src,axis=1)):
        t=np.clip(-p[i,2]/.16,0,1)
        transfer(i,src,[(helpers[f'{side}_shoulder_deform_1'],1-t),(helpers[f'{side}_shoulder_deform_2'],t)],(1-t)*.72)
for parent in ['torso','chest']:
    src=joint_names.index(parent); p=local(parent,pos)
    for i in np.flatnonzero(np.any(joints==src,axis=1)):
        t=np.clip(p[i,2]/.20,0,1)
        transfer(i,src,[(helpers[f'{parent}_deform_1'],1-t),(helpers[f'{parent}_deform_2'],t)],.55)
src=joint_names.index('head'); p=local('head',pos)
for i in np.flatnonzero(np.any(joints==src,axis=1)):
    x,y,z=p[i]
    front=1-smooth(-.025,.025,y)
    jaw=(1-smooth(-.085,-.035,z))*smooth(-.120,-.105,z)*front*.85
    transfer(i,src,[(helpers['jaw_deform'],1)],jaw)
    for side,sign in [('left',1),('right',-1)]:
        brow=np.exp(-((x-sign*.034)/.024)**2-((z-.043)/.012)**2)*front*.65
        cheek=np.exp(-((x-sign*.035)/.025)**2-((z+.033)/.025)**2)*front*.45
        transfer(i,src,[(helpers[f'{side}_brow_deform'],1)],brow)
        transfer(i,src,[(helpers[f'{side}_cheek_deform'],1)],cheek)
    for half,height in [('upper',-.055),('lower',-.063)]:
        lip=np.exp(-(x/.026)**2-((z-height)/.004)**2)*front*.65
        transfer(i,src,[(helpers[f'lip_{half}_deform'],1)],lip)

# Add modeled eyelid ribbons and ear helices/conchae, weighted to facial bones.
extra_pos=[]; extra_color=[]; extra_influences=[]; extra_faces=[]
def add_surface(points,tris,color,bone):
    start=len(pos)+len(extra_pos)
    extra_pos.extend(to_world('head',np.array(points)).tolist())
    extra_color.extend([color]*len(points))
    extra_influences.extend(bone if isinstance(bone,list) else [{bone:1} for _ in points])
    extra_faces.extend((np.asarray(tris)+start).tolist())
skin_color=np.array([.5841,.30499,.18782])
for side,sign in [('left',1),('right',-1)]:
    for half,direction in [('upper',1),('lower',-1)]:
        points=[]; tris=[]; segments=32; rows=5
        for row in range(rows):
            t=row/(rows-1)
            for k in range(segments+1):
                a=k/segments*np.pi
                x=sign*.035+np.cos(a)*(.0135+.0025*t)
                z=.023+direction*np.sin(a)*(.0058+t*.008)
                y=-.0725+(t*t)*.0105 + .0010*abs(np.cos(a))
                points.append([x,y,z])
        for row in range(rows-1):
            for k in range(segments):
                a=row*(segments+1)+k; b=a+segments+1
                pair=[[a,b,a+1],[a+1,b,b+1]]
                if direction<0:pair=[tri[::-1] for tri in pair]
                tris.extend(pair)
        add_surface(points,tris,skin_color.tolist(),helpers[f'{side}_lid_{half}'])
    # Ring cross-sections create a rounded helix and antihelix rather than a ball.
    for ring,scale in enumerate([1,.57]):
        points=[]; tris=[]; segments=48; radial=8
        for k in range(segments+1):
            a=k/segments*2*np.pi
            for j in range(radial):
                b=j/radial*2*np.pi; radius=.0018 if ring==0 else .0012
                points.append([sign*(.084+.004*np.sin(a)+radius*np.cos(b)),
                  .005+(.014*scale+radius*np.sin(b))*np.cos(a),
                  -.008+(.024*scale+radius*np.sin(b))*np.sin(a)])
        for k in range(segments):
            for j in range(radial):
                a=k*radial+j;b=k*radial+(j+1)%radial;c=a+radial;d=b+radial
                tris.extend([[a,b,c],[b,d,c]])
        add_surface(points,tris,(skin_color*np.array([1.04,.96,.94])).tolist(),src)

# A small oral cavity and separately weighted lip edges make jaw opening visible.
# Remove the old rigid lip capsules, retaining all continuous surface faces.
p=local('head',pos); old_lips=(p[:,2]>-.072)&(p[:,2]<-.046)&(colors[:,0]>.20)&(colors[:,0]<.36)&(colors[:,1]<.15)
keep=np.ones(len(faces),dtype=bool);keep[surface_triangles:]=~np.all(old_lips[faces[surface_triangles:]],axis=1)
faces=faces[keep]
points=[[0,-.079,-.059]]; control=[{helpers['lip_upper_deform']:.5,helpers['lip_lower_deform']:.5}]
for k in range(65):
    a=k/64*2*np.pi
    points.append([np.cos(a)*.021,-.079,.0009*np.sin(a)-.059])
    lower=max(0,float(-np.sin(a)))
    control.append({helpers['lip_upper_deform']:1-lower,helpers['lip_lower_deform']:lower})
add_surface(points,[[0,k+1,k+2] for k in range(64)]+[[0,65,1]],[.042,.009,.010],control)
for half,direction in [('upper',1),('lower',-1)]:
    points=[];tris=[];lip_weights=[];segments=48;radial=8
    for k in range(segments+1):
        t=k/segments; x=(t-.5)*.043
        z=-.059+direction*.0016*np.sin(t*np.pi)
        if half=='upper':z-=.0007*np.exp(-(x/.004)**2)
        radius=.0011+.0004*np.sin(t*np.pi)
        for j in range(radial):
            a=j/radial*2*np.pi
            points.append([x,-.080-radius*np.cos(a),z+radius*np.sin(a)])
            lower=float(np.sin(t*np.pi)) if half=='lower' else 0
            lip_weights.append({helpers['lip_upper_deform']:1-lower,helpers['lip_lower_deform']:lower})
    for k in range(segments):
        for j in range(radial):
            a=k*radial+j;b=k*radial+(j+1)%radial;c=a+radial;d=b+radial
            tris.extend([[a,b,c],[b,d,c]])
    add_surface(points,tris,[.37,.15,.12],lip_weights)
old_length=len(pos)
pos=np.vstack([pos,np.array(extra_pos)]).astype(np.float32)
colors=np.vstack([colors,np.array(extra_color)]).astype(np.float32)
influences.extend(extra_influences)
faces=np.vstack([faces,np.array(extra_faces)]).astype(np.uint32)
for k in range(len(morphs)):morphs[k]=np.vstack([morphs[k],np.zeros((len(extra_pos),3),dtype=np.float32)])
joints=np.zeros((len(pos),4),dtype=np.uint16);weights=np.zeros((len(pos),4),dtype=np.float32)
for i,d in enumerate(influences):
    top=sorted(d.items(),key=lambda p:p[1],reverse=True)[:4];total=sum(w for _,w in top)
    for k,(j,w) in enumerate(top):joints[i,k]=j;weights[i,k]=w/total

# UV charts with explicit seam vertices. All morphs and weights use the same remap.
# Six cylindrical anatomical charts plus a neutral chart for fabric/accessories.
base_normal=normals(pos,faces)
skin_mask=smooth(.035,.13,colors[:,0]-np.maximum(colors[:,1],colors[:,2]))
skin_mask[surface_count:old_length]=0
skin_mask[(colors[:,0]<.40)&(colors[:,1]<.20)]=0
regions=[]
for js in joints:
    name=joint_names[int(js[0])]
    regions.append(0 if any(s in name for s in ['head','eye','jaw','lid','lip','brow','cheek','neck']) else
      2 if name.startswith('left_') and any(s in name for s in ['arm','hand','thumb','index','middle','ring','little','shoulder','clavicle']) else
      3 if name.startswith('right_') and any(s in name for s in ['arm','hand','thumb','index','middle','ring','little','shoulder','clavicle']) else
      4 if name.startswith('left_') else 5 if name.startswith('right_') else 1)
regions=np.array(regions)
uv_by_chart={}
for chart,root,low,high in [(0,'head',-.25,.14),(1,'pelvis',-.14,.58),(2,'left_upper_arm',-.69,.08),
  (3,'right_upper_arm',-.69,.08),(4,'left_thigh',-.92,.08),(5,'right_thigh',-.92,.08)]:
    q=local(root,pos);u=(np.arctan2(q[:,0],-q[:,1])+np.pi)/(2*np.pi)
    v=np.clip((q[:,2]-low)/(high-low),.005,.995)
    uv_by_chart[chart]=np.column_stack([u,v])
uv_by_chart[6]=np.full((len(pos),2),.5)
remap=[];uv=[];source_ids=[];new_faces=[];lookup={};surface_vertices=0
for fi,tri in enumerate(faces):
    skin_tri=skin_mask[tri].max()>.05
    chart=int(np.bincount(regions[tri],weights=skin_mask[tri],minlength=6).argmax()) if skin_tri else 6
    coords=uv_by_chart[chart][tri].copy()
    if np.ptp(coords[:,0])>.5:coords[coords[:,0]<.5,0]+=1
    face=[]
    for source,coord in zip(tri,coords):
        wrap=int(coord[0]>1);key=(int(source),chart,wrap)
        if key not in lookup:
            lookup[key]=len(remap);remap.append(int(source));source_ids.append(int(source))
            # Wrap duplicated edge to chart border; pad all charts by 4 texels.
            u=np.clip(coord[0],0,1);v=coord[1]
            uv.append([(chart%3+(u*.98+.01))/3,(chart//3+(v*.98+.01))/3])
        face.append(lookup[key])
    new_faces.append(face)
    if fi==surface_triangles-1:surface_vertices=len(remap)
remap=np.array(remap);faces=np.array(new_faces,dtype=np.uint32)
pos=pos[remap];colors=colors[remap];joints=joints[remap];weights=weights[remap];skin_mask=skin_mask[remap]
# Color texture carries actual pigment; vertex color retains fabric/accessory colors.
colors=colors.copy();colors[skin_mask>.5]=1
base_normal=normals(pos,faces)
# Average seam normals through source IDs; UV cuts must not appear as hard edges.
def seam_normals(points):
    n=normals(points,faces);summed=np.zeros((int(remap.max())+1,3),dtype=np.float32)
    np.add.at(summed,remap,n)
    length=np.linalg.norm(summed,axis=1,keepdims=True);summed[length[:,0]<1e-12]=[0,0,1]
    summed/=np.maximum(np.linalg.norm(summed,axis=1,keepdims=True),1e-12)
    return summed[remap]
base_normal=seam_normals(pos)

# Reproducible skin pigment, tangent normal, metallic/roughness and thickness assets.
ASSETS=ROOT/'public/models/skin-v2';ASSETS.mkdir(exist_ok=True)
rng=np.random.default_rng(240519)
tile=512;resolution=tile*3
albedo=np.full((resolution,resolution,3),255,dtype=np.uint8)
normal=np.zeros_like(albedo);normal[:]=[128,128,255]
roughness=np.zeros_like(albedo);roughness[:]=[255,200,0]
thickness=np.full((resolution,resolution),32,dtype=np.uint8)
for chart in range(6):
    noise=rng.normal(size=(tile,tile))
    low=gaussian_filter(noise,15,mode='wrap');low/=max(low.std(),1e-5)
    fine=gaussian_filter(noise,.7,mode='wrap');fine/=fine.std()
    yy,xx=np.mgrid[0:tile,0:tile]/tile
    pigment=np.stack([.79+low*.009,.59+low*.009,.47+low*.008],axis=-1)
    # Restrained warm variation at face cheeks/nose, palms and extremities.
    warm=np.exp(-((yy-.65)/.16)**2)*(np.cos(xx*2*np.pi)**8) if chart==0 else np.exp(-((yy-.12)/.13)**2)
    pigment[:,:,0]+=warm*.018; pigment[:,:,1]-=warm*.008
    freckles=(rng.random((tile,tile))>.998).astype(float)
    freckles=gaussian_filter(freckles,.65,mode='wrap')
    pigment-=freckles[:,:,None]*.075
    pores=gaussian_filter(noise,.55,mode='wrap')*.08
    gy,gx=np.gradient(pores)
    vectors=np.stack([-gx,-gy,np.ones_like(gx)],axis=-1);vectors/=np.linalg.norm(vectors,axis=-1,keepdims=True)
    row=(chart//3)*tile;col=(chart%3)*tile;s=np.s_[row:row+tile,col:col+tile]
    albedo[s]=np.uint8(np.clip(pigment,0,1)*255)
    normal[s]=np.uint8(np.clip(vectors*.5+.5,0,1)*255)
    roughness[s]=np.stack([np.full_like(xx,255),np.clip((.52+fine*.025)*255,0,255),np.zeros_like(xx)],axis=-1).astype(np.uint8)
    thin=.12+warm*.30
    if chart==0:
        ears=(np.exp(-((xx-.25)/.045)**2)+np.exp(-((xx-.75)/.045)**2))*np.exp(-((yy-.63)/.10)**2)
        thin+=ears*.65
    elif chart in [2,3]:thin+=np.exp(-((yy-.10)/.15)**2)*.40
    thickness[s]=np.uint8(np.clip(thin*255,0,255))
images=[]
for name,pixels in [('albedo',albedo),('normal',normal),('roughness',roughness),('thickness',thickness)]:
    data=io.BytesIO();Image.fromarray(pixels).save(data,format='PNG',optimize=True)
    payload=data.getvalue();(ASSETS/f'{name}.png').write_bytes(payload);images.append(payload)

# Compact GLB: sparse morphs include recomputed normals for the refined surface.
g['accessors']=[];g['bufferViews']=[];packed=bytearray()
def add_view(data):
    while len(packed)%4:packed.append(0)
    index=len(g['bufferViews']);g['bufferViews'].append({'buffer':0,'byteOffset':len(packed),'byteLength':len(data)})
    packed.extend(data);return index
def accessor(values,kind,component=5126,sparse=False):
    values=np.asarray(values,dtype=DT[component]);values=values.reshape(-1,WIDTH[kind])
    a={'componentType':component,'count':len(values),'type':kind}
    if component==5126 and kind!='MAT4':a.update(min=values.min(axis=0).tolist(),max=values.max(axis=0).tolist())
    if sparse:
        active=np.flatnonzero(np.max(np.abs(values),axis=1)>1e-6)
        if len(active):
            dt=5123 if len(values)<65536 else 5125
            a['sparse']={'count':len(active),'indices':{'bufferView':add_view(active.astype(DT[dt]).tobytes()),'componentType':dt},'values':{'bufferView':add_view(values[active].tobytes())}}
    else:a['bufferView']=add_view(values.tobytes())
    g['accessors'].append(a);return len(g['accessors'])-1
primitive['attributes']={
  'POSITION':accessor(pos,'VEC3'),'NORMAL':accessor(base_normal,'VEC3'),
  'COLOR_0':accessor(colors,'VEC3'),'JOINTS_0':accessor(joints,'VEC4',5123),
  'WEIGHTS_0':accessor(weights,'VEC4'),'TEXCOORD_0':accessor(np.array(uv),'VEC2'),
  '_SKIN_MASK':accessor(skin_mask,'SCALAR'),'_SOURCE_INDEX':accessor(np.array(source_ids),'SCALAR',5126)}
primitive['indices']=accessor(faces.ravel(),'SCALAR',5125)
primitive['targets']=[]
for delta in morphs:
    d=delta[remap]
    primitive['targets'].append({'POSITION':accessor(d,'VEC3',sparse=True),'NORMAL':accessor(seam_normals(pos+d)-base_normal,'VEC3',sparse=True)})
skin['inverseBindMatrices']=accessor(inverse,'MAT4')
g['images']=[{'name':f'skin-v2-{name}','mimeType':'image/png','bufferView':add_view(payload)} for name,payload in zip(['albedo','normal','roughness','thickness'],images)]
g['samplers']=[{'magFilter':9729,'minFilter':9987,'wrapS':33071,'wrapT':33071}]
g['textures']=[{'sampler':0,'source':i} for i in range(4)]
g['materials']=[{'name':'Skin-v2-PBR','pbrMetallicRoughness':{'baseColorFactor':[1,1,1,1],'baseColorTexture':{'index':0},'metallicFactor':0,'roughnessFactor':1,'metallicRoughnessTexture':{'index':2}},'normalTexture':{'index':1,'scale':.65},'extras':{'skinV2':True,'thicknessTexture':3,'scatterApproximation':'thickness-aware wrapped diffuse and back scattering'}}]
primitive['material']=0
report.update(vertices=surface_vertices,sourceVertices=surface_count,uvSeams=True,version=2,
  sculpt=['face','eyelids','ears','palms','wrists','elbows','knees'],deformationBones=new_helpers,
  skinTextures=['albedo','normal','roughness','thickness'],weldAttribute='_SOURCE_INDEX')
surface_node['extras']['avatarVersion']=2
g['asset']['extras']={'avatarVersion':2,'generator':'scripts/upgrade-avatar.py','baseRigBones':67,'deformationBones':len(new_helpers)}
g['buffers']=[{'byteLength':len(packed)}]
encoded=json.dumps(g,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
packed+=b'\x00'*((-len(packed))%4)
result=struct.pack('<III',0x46546c67,2,28+len(encoded)+len(packed))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(packed),0x004e4942)+packed
OUT.with_suffix('.glb.tmp').write_bytes(result);OUT.with_suffix('.glb.tmp').replace(OUT)
(ROOT/'public/models/surface-report.json').write_text(json.dumps(report,indent=2))
print(json.dumps({'bytes':len(result),'bones':len(skin['joints']),'newHelpers':len(new_helpers),'vertices':len(pos),'surfaceVertices':surface_vertices,'triangles':len(faces)},indent=2))
