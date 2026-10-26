"""Topology-preserving Blender polish + sparse morph normals + editable .blend.

Run with Blender --background --python this_file, or Python with bpy installed.
Input: artifacts/human-authoring.glb. Output: public/models/human-skinned.glb.
No downloaded meshes, changed joint hierarchy, or applied armature modifiers.
"""
import json
import struct
from pathlib import Path
import numpy as np
import os
import tempfile
os.environ.setdefault("BLENDER_USER_CONFIG", str(Path(tempfile.gettempdir())/"human-blender-config"))
import bpy
import bmesh

ROOT = Path(__file__).resolve().parent.parent
source = ROOT / 'artifacts/human-authoring.glb'
output = ROOT / os.environ.get('HUMAN_AVATAR_OUTPUT', 'public/models/human-skinned.glb')
raw = source.read_bytes()
json_size = struct.unpack_from('<I', raw, 12)[0]
gltf = json.loads(raw[20:20+json_size])
binary = bytearray(raw[28+json_size:])
dtypes = {5126: '<f4', 5125: '<u4', 5123: '<u2', 5121: 'u1'}
widths = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
def read(index):
    a = gltf['accessors'][index]; v = gltf['bufferViews'][a['bufferView']]
    if v.get('byteStride',np.dtype(dtypes[a['componentType']]).itemsize*widths[a['type']]) != np.dtype(dtypes[a['componentType']]).itemsize*widths[a['type']]: raise ValueError('Expected packed authoring attributes')
    return np.frombuffer(binary, dtype=dtypes[a['componentType']], count=a['count']*widths[a['type']], offset=v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(a['count'],-1).copy()
def replace(index, values):
    a = gltf['accessors'][index]; v = gltf['bufferViews'][a['bufferView']]
    offset = v.get('byteOffset',0)+a.get('byteOffset',0)
    packed = values.astype(dtypes[a['componentType']]).tobytes()
    binary[offset:offset+len(packed)] = packed
    if 'min' in a: a['min'] = values.min(axis=0).tolist(); a['max'] = values.max(axis=0).tolist()

primitive = gltf['meshes'][0]['primitives'][0]
positions = read(primitive['attributes']['POSITION'])
faces = read(primitive['indices']).reshape(-1,3)
report = next(n['extras']['surface'] for n in gltf['nodes'] if n.get('name')=='HumanSkin')
count = report['vertices']
# Matrix transforms from original glTF preserve exact vertex and rig indices.
from mathutils import Matrix, Quaternion, Euler
frames = {}
def visit(index, parent):
    node = gltf['nodes'][index]
    local = Matrix.LocRotScale(node.get('translation',(0,0,0)), Quaternion((node.get('rotation',[0,0,0,1])[3],*node.get('rotation',[0,0,0,1])[:3])), node.get('scale',(1,1,1)))
    if 'matrix' in node: local = Matrix(np.array(node['matrix']).reshape(4,4).T.tolist())
    world = parent @ local
    if node.get('name'): frames[node['name']] = np.array(world)
    for child in node.get('children',[]): visit(child,world)
for root in gltf['scenes'][gltf.get('scene',0)]['nodes']: visit(root,Matrix.Identity(4))
def local_points(name, points):
    inverse = np.linalg.inv(frames[name])
    return points @ inverse[:3,:3].T + inverse[:3,3]

# Use Blender's actual editable mesh and adjacency smoothing, restricted to the
# skin so nails/eyes/hair retain their rigid attachment and shape.
mesh = bpy.data.meshes.new('PolishSurface')
mesh.from_pydata(positions[:count].tolist(), [], faces[:report['triangles']].tolist())
mesh.update()
bm = bmesh.new(); bm.from_mesh(mesh); bm.verts.ensure_lookup_table()
region = np.zeros(count,dtype=bool)
for side in ('left','right'):
    for part,extent in [('hand',0.025),('forearm',0.035),('upper_arm',0.065)]:
        q = local_points(f'{side}_{part}',positions[:count])
        region |= (np.abs(q[:,2])<extent)&(np.linalg.norm(q[:,:2],axis=1)<0.09)
selected = [bm.verts[int(i)] for i in np.flatnonzero(region)]
for _ in range(3): bmesh.ops.smooth_vert(bm, verts=selected, factor=0.12, use_axis_x=True, use_axis_y=True, use_axis_z=True)
bm.to_mesh(mesh); bm.free(); mesh.update()
polished = np.empty((count,3),dtype=np.float32); mesh.vertices.foreach_get('co',polished.ravel())
# Shallow palmar creases and dorsal metacarpal relief, in anatomical coordinates.
for side,sign in [('left',1),('right',-1)]:
    q=local_points(f'{side}_hand',polished)
    palm=np.exp(-((q[:,0]/0.036)**6)-((q[:,2]+0.025)/0.05)**6)
    front=np.clip((-q[:,1]-0.007)/0.009,0,1)
    fold=(np.exp(-((q[:,2]+0.004)/0.0018)**2)+0.6*np.exp(-((q[:,2]+0.035-sign*q[:,0]*0.25)/0.002)**2))
    displacement=np.zeros_like(q); displacement[:,1]=0.0008*palm*front*fold
    # Subtle extensor tendon ridges on the back of the palm.
    back=np.clip((q[:,1]-0.008)/0.008,0,1)
    for x in (0.027,0.009,-0.010,-0.027):
        displacement[:,1]+=0.00065*np.exp(-((q[:,0]-sign*x)/0.003)**2-((q[:,2]+0.028)/0.030)**2)*back
    polished+=displacement@frames[f'{side}_hand'][:3,:3].T
positions[:count]=polished
replace(primitive['attributes']['POSITION'],positions)
bpy.data.meshes.remove(mesh)
# Match the hair cap to the refined cranium. Keep the original rigid ownership
# and move the hairline above the brows rather than hiding hair inside the head.
colors=read(primitive['attributes']['COLOR_0'])
joints=read(primitive['attributes']['JOINTS_0'])
head_joint=next(i for i,node in enumerate(gltf['skins'][0]['joints']) if gltf['nodes'][node].get('name')=='head')
head_local=local_points('head',positions)
hair=(joints[:,0]==head_joint)&(colors[:,0]<0.05)&(head_local[:,2]>0.03)
head_local[hair,0]*=1.12
head_local[hair,1]=0.012+(head_local[hair,1]-0.012)*1.12
head_local[hair,2]+=0.017*np.clip((0.10-head_local[hair,2])/0.06,0,1)
positions[hair]=head_local[hair]@frames['head'][:3,:3].T+frames['head'][:3,3]
# Sculpt a continuous facial plane: fill excessive hollows below the eyes and
# soften the separate cheek bosses while retaining a restrained nose and chin.
q=local_points('head',positions)
z=q[:,2]
levels=np.array([-0.112,-0.095,-0.068,-0.027,0.018,0.062,0.100,0.123,0.129])
width=np.interp(z,levels,[0.018,0.039,0.059,0.075,0.081,0.080,0.061,0.025,0.001])
depth=np.interp(z,levels,[0.021,0.041,0.057,0.068,0.076,0.076,0.060,0.026,0.001])
offset=np.interp(z,levels,[-0.027,-0.019,-0.008,0.001,0.007,0.012,0.013,0.011,0.010])
xratio=np.abs(q[:,0])/np.maximum(width,0.001)
plane=offset-depth*np.maximum(0,1-np.minimum(xratio,1)**4)**0.25
nose=0.017*np.exp(-(q[:,0]/0.013)**2-((z+0.002)/0.028)**2)
nose+=0.009*np.exp(-(q[:,0]/0.015)**2-((z+0.017)/0.012)**2)
mouth=0.004*np.exp(-(q[:,0]/0.026)**2-((z+0.058)/0.018)**2)
orbit=sum(0.004*np.exp(-((q[:,0]-sign*0.035)/0.018)**2-((z-0.023)/0.015)**2) for sign in (-1,1))
weight=0.85*np.clip((-q[:,1]-0.025)/0.02,0,1)*np.clip((0.98-xratio)/0.16,0,1)*np.clip((z+0.105)/0.012,0,1)*np.clip((0.072-z)/0.02,0,1)
weight[np.arange(len(q))>=count]=0
q[:,1]+=weight*(plane-nose-mouth-orbit-q[:,1])
positions[:count]=(q@frames['head'][:3,:3].T+frames['head'][:3,3])[:count]
replace(primitive['attributes']['POSITION'],positions)
# Recompute base and per-shape normals in Blender. This avoids static highlights
# across corrective creases and lets Three.js shade actual deformed surfaces.
mesh=bpy.data.meshes.new('MorphNormalBake')
mesh.from_pydata(positions.tolist(),[],faces.tolist()); mesh.update()
for polygon in mesh.polygons: polygon.use_smooth=True
def normals(points):
    mesh.vertices.foreach_set('co',np.asarray(points,dtype=np.float32).ravel()); mesh.update()
    result=np.empty_like(positions); mesh.vertices.foreach_get('normal',result.ravel()); return result
base_normals=normals(positions)
replace(primitive['attributes']['NORMAL'],base_normals)

def add_view(data):
    while len(binary)%4: binary.append(0)
    offset=len(binary); binary.extend(data)
    gltf['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(data)})
    return len(gltf['bufferViews'])-1
def sparse_accessor(values):
    # Values below a micrometer (or the same normal tolerance) are discarded.
    active=np.flatnonzero(np.max(np.abs(values),axis=1)>1e-6)
    a={'componentType':5126,'count':len(values),'type':'VEC3','min':np.minimum(values.min(axis=0),0).tolist(),'max':np.maximum(values.max(axis=0),0).tolist()}
    if len(active):
        a['sparse']={'count':len(active),'indices':{'bufferView':add_view(active.astype('<u2' if len(values)<65536 else '<u4').tobytes()),'componentType':5123 if len(values)<65536 else 5125},'values':{'bufferView':add_view(values[active].astype('<f4').tobytes())}}
    # An omitted bufferView initializes a glTF accessor to zeros.
    gltf['accessors'].append(a); return len(gltf['accessors'])-1
for target in primitive['targets']:
    delta=read(target['POSITION'])
    normal_delta=normals(positions+delta)-base_normals
    old=target['POSITION']; target['POSITION']=sparse_accessor(delta)
    target['NORMAL']=sparse_accessor(normal_delta)
    # Unreferenced dense authoring accessor no longer keeps its buffer alive.
    gltf['accessors'][old].pop('bufferView',None)
    gltf['accessors'][old].pop('min',None); gltf['accessors'][old].pop('max',None)
bpy.data.meshes.remove(mesh)
# Repack only referenced views; retain every non-morph attribute and bind matrix.
used=set()
for a in gltf['accessors']:
    if 'bufferView' in a: used.add(a['bufferView'])
    if 'sparse' in a: used.update((a['sparse']['indices']['bufferView'],a['sparse']['values']['bufferView']))
for image in gltf.get('images',[]):
    if 'bufferView' in image: used.add(image['bufferView'])
packed=bytearray(); views=[]; remap={}
for old in sorted(used):
    v=gltf['bufferViews'][old].copy()
    while len(packed)%4: packed.append(0)
    offset=v.get('byteOffset',0); data=binary[offset:offset+v['byteLength']]
    v['byteOffset']=len(packed); packed.extend(data); remap[old]=len(views); views.append(v)
for a in gltf['accessors']:
    if 'bufferView' in a: a['bufferView']=remap[a['bufferView']]
    if 'sparse' in a:
        for field in ('indices','values'): a['sparse'][field]['bufferView']=remap[a['sparse'][field]['bufferView']]
for image in gltf.get('images',[]):
    if 'bufferView' in image: image['bufferView']=remap[image['bufferView']]
gltf['bufferViews']=views; gltf['buffers']=[{'byteLength':len(packed)}]
report['blenderPolish']=bpy.app.version_string
report['morphNormalBake']=True; report['sparseMorphTargets']=True
encoded=json.dumps(gltf,separators=(',',':')).encode()
encoded+=b' ' * ((-len(encoded))%4); packed+=b'\x00'*((-len(packed))%4)
result=struct.pack('<III',0x46546c67,2,28+len(encoded)+len(packed))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(packed),0x004e4942)+packed
temporary=output.with_suffix(".glb.tmp")
temporary.write_bytes(result)
temporary.replace(output)
with (ROOT/'artifacts/human-continuous.obj').open('w') as obj:
    obj.write('# Blender polished surface; meters, Y-up. Rig/shape keys in GLB and .blend.\n')
    for p in positions[:count]: obj.write('v %.7f %.7f %.7f\n'%tuple(p))
    for tri in faces[:report['triangles']]: obj.write('f %d %d %d\n'%tuple(tri+1))
(ROOT/'public/models/surface-report.json').write_text(json.dumps(report,indent=2))
# Re-import the exact runtime asset; the .blend retains rig, weights, colors,
# corrective shape keys and their baked normals in the glTF source.
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(output),import_shading='NORMALS',bone_heuristic='BLENDER')
for obj in bpy.context.scene.objects:
    if obj.type=='ARMATURE': obj.show_in_front=True
    if obj.type=='MESH':
        for polygon in obj.data.polygons: polygon.use_smooth=True
notes=bpy.data.texts.new('人体精修说明')
notes.write('Runtime source: public/models/human-skinned.glb\nUnits: meters. Preserve physical bone names, hierarchy and bind pose.\n29 corrective shape keys; wrist creases, dorsal palm relief and smoother joint transitions.\nPose review: use the application physics or scripts/review-poses.ts; no animation is played by the runtime.\n')
bpy.context.scene.unit_settings.system='METRIC'
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.shading.color_type='VERTEX'
            area.spaces.active.region_3d.view_location=(0,0,1)
            area.spaces.active.region_3d.view_distance=3
            area.spaces.active.region_3d.view_rotation=Euler((1.35,0,0.3)).to_quaternion()
bpy.context.preferences.filepaths.save_version=0
bpy.context.preferences.filepaths.file_preview_type="NONE"
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'artifacts/human-refined.blend'),compress=True)
print(json.dumps({'blender':bpy.app.version_string,'vertices':len(positions),'shapeKeys':len(primitive['targets']),'runtimeBytes':len(result),'blend':'artifacts/human-refined.blend'}))
