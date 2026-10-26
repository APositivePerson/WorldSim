"""Inspect genuine non-adjacent triangle intersections in the five runtime poses.

BVH produces candidates; vectorized segment/triangle tests reject bounding-box
false positives. Coplanar overlaps are excluded; this is not a collision solver.
"""
import json
import sys
from pathlib import Path
from collections import Counter
import numpy as np
import bpy
from mathutils.bvhtree import BVHTree
root=Path(__file__).resolve().parent.parent
suffix='-before' if '--before' in sys.argv else ''
folder=root/('artifacts/pose-review-data'+suffix)
report_path=root/('artifacts/pose-review'+suffix+'.json')
faces=np.fromfile(folder/'triangles.bin',dtype='<u4').reshape(-1,3)
owners=np.fromfile(folder/'owners.bin',dtype='<u2')
bones=json.loads((folder/'bones.json').read_text())
report=json.loads(report_path.read_text())
def crossing(a,b):
    result=np.zeros(len(a),dtype=bool)
    e1=b[:,1]-b[:,0];e2=b[:,2]-b[:,0]
    for i in range(3):
        origin=a[:,i];direction=a[:,(i+1)%3]-origin
        p=np.cross(direction,e2);det=np.einsum('ij,ij->i',e1,p)
        good=np.abs(det)>1e-12;inverse=np.divide(1,det,out=np.zeros_like(det),where=good)
        offset=origin-b[:,0];u=np.einsum('ij,ij->i',offset,p)*inverse
        q=np.cross(offset,e1);v=np.einsum('ij,ij->i',direction,q)*inverse
        t=np.einsum('ij,ij->i',e2,q)*inverse
        result|=good&(u>1e-6)&(v>1e-6)&(u+v<1-1e-6)&(t>1e-6)&(t<1-1e-6)
    return result
for pose in report['poses']:
    vertices=np.fromfile(folder/(pose['pose']+'.bin'),dtype='<f4').reshape(-1,3)
    tree=BVHTree.FromPolygons(vertices.tolist(),faces.tolist(),all_triangles=True)
    pairs=np.asarray(tree.overlap(tree),dtype=np.int32).reshape(-1,2)
    pairs=pairs[pairs[:,0]<pairs[:,1]]
    a=faces[pairs[:,0]];b=faces[pairs[:,1]]
    keep=~np.any(a[:,:,None]==b[:,None,:],axis=(1,2));pairs=pairs[keep]
    triangles=vertices[faces]
    hit=crossing(triangles[pairs[:,0]],triangles[pairs[:,1]])|crossing(triangles[pairs[:,1]],triangles[pairs[:,0]])
    intersections=pairs[hit]
    groups=Counter()
    for a,b in intersections:
        names=sorted({bones[int(owners[faces[a,0]])],bones[int(owners[faces[b,0]])]})
        groups[' / '.join(names)]+=1
    pose['nonCoplanarIntersectionPairs']=len(intersections)
    pose['intersectionRegions']=dict(groups.most_common(12))
    print(pose['pose'],len(intersections),dict(groups.most_common(5)))
report['intersectionMethod']='BVH candidates plus bidirectional edge/triangle tests; shared-vertex neighbors, boundary-only touches and coplanar overlaps excluded. Counts describe visual skin only, not physical contact penetration depth.'
report_path.write_text(json.dumps(report,indent=2,ensure_ascii=False))
