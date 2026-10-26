"""Pack the locally licensed fitted scan and photographic textures for local use.

Supplier files and derived runtime assets stay outside public/ and dist/.
"""
from pathlib import Path
import io,json,struct
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
ROOT=Path(__file__).resolve().parent.parent
PRIVATE=ROOT/'artifacts/scanned-private'
OUT=PRIVATE/'runtime';OUT.mkdir(exist_ok=True)
raw=(PRIVATE/'eric-fitted-untextured.glb').read_bytes();length=struct.unpack_from('<I',raw,12)[0]
g=json.loads(raw[20:20+length]);binary=bytearray(raw[28+length:])
resolution=4096
def source(name):
    return Image.open(PRIVATE/f'tex/rp_eric_rigged_001_{name}.jpg').convert('RGB').resize((resolution,resolution),Image.Resampling.LANCZOS)
albedo=source('dif');normal=source('norm');gloss=np.asarray(source('gloss').convert('L'),dtype=np.float32)/255
rough=np.clip(np.sqrt(1-gloss)*.68+.18,.28,.88)
roughness=np.zeros((resolution,resolution,3),dtype=np.uint8);roughness[:,:,0]=255;roughness[:,:,1]=np.uint8(rough*255)
rgb=np.asarray(albedo,dtype=np.float32)/255
skin=np.clip((rgb[:,:,0]-rgb[:,:,2]-.04)/.10,0,1)*np.clip((rgb[:,:,0]-.14)/.15,0,1)
skin*=np.clip((rgb[:,:,1]/np.maximum(rgb[:,:,0],.01)-.38)/.22,0,1)
skin=gaussian_filter(skin,1.4)
thickness=Image.fromarray(np.uint8((.12+skin*.42)*255))
images=[]
for name,image,format in [('albedo',albedo,'JPEG'),('normal',normal,'JPEG'),('roughness',Image.fromarray(roughness),'PNG'),('thickness',thickness,'PNG')]:
    b=io.BytesIO();image.save(b,format=format,**({'quality':95,'subsampling':0} if format=='JPEG' else {'optimize':True}))
    data=b.getvalue();suffix='jpg' if format=='JPEG' else 'png';(OUT/f'{name}.{suffix}').write_bytes(data)
    images.append((name,data,'image/jpeg' if format=='JPEG' else 'image/png'))
def view(data):
    while len(binary)%4:binary.append(0)
    index=len(g['bufferViews']);g['bufferViews'].append({'buffer':0,'byteOffset':len(binary),'byteLength':len(data)})
    binary.extend(data);return index
# Exclude photographic hair, eyes and shirt cuffs from the skin-scattering mask.
primitive=g['meshes'][0]['primitives'][0]
if '__SKIN_MASK' in primitive['attributes']:
    primitive['attributes']['_SKIN_MASK']=primitive['attributes'].pop('__SKIN_MASK')
def read(attribute,width):
    a=g['accessors'][primitive['attributes'][attribute]];v=g['bufferViews'][a['bufferView']]
    return np.frombuffer(binary,dtype='<f4',count=a['count']*width,offset=v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,width).copy()
uv=read('TEXCOORD_0',2);mask=read('_SKIN_MASK',1)
xy=np.clip(uv*(resolution-1),0,resolution-1).astype(int)
mask[:,0]*=skin[xy[:,1],xy[:,0]]
a=g['accessors'][primitive['attributes']['_SKIN_MASK']];a['bufferView']=view(mask.astype('<f4').tobytes());a['min']=[float(mask.min())];a['max']=[float(mask.max())]
g['images']=[{'name':name,'mimeType':mime,'bufferView':view(data)} for name,data,mime in images]
g['samplers']=[{'magFilter':9729,'minFilter':9987,'wrapS':10497,'wrapT':10497}]
g['textures']=[{'sampler':0,'source':i} for i in range(4)]
g['materials']=[{'name':'Eric photographic PBR','pbrMetallicRoughness':{'baseColorFactor':[1,1,1,1],'baseColorTexture':{'index':0},'roughnessFactor':1,'metallicFactor':0,'metallicRoughnessTexture':{'index':2}},'normalTexture':{'index':1,'scale':.55},'extras':{'scannedPbr':True,'thicknessTexture':3}}]
primitive['material']=0
g['asset']['copyright']='Renderpeople GmbH. Eric Rigged 001. Supplier license applies; NOT CC0.'
g['asset']['extras']={'source':'https://renderpeople.com/free-3d-people/','license':'https://renderpeople.com/general-terms-and-conditions/','localOnly':True,'textureResolution':resolution,'originalTextureResolution':8192,'fittedToSimplifiedRig':True,'measurementAccuracy':'Not calibrated; scan-derived visual rendering only.'}
g['buffers']=[{'byteLength':len(binary)}]
encoded=json.dumps(g,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4);binary+=b'\x00'*((-len(binary))%4)
result=struct.pack('<III',0x46546c67,2,28+len(encoded)+len(binary))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(binary),0x004e4942)+binary
(OUT/'eric.glb.tmp').write_bytes(result);(OUT/'eric.glb.tmp').replace(OUT/'eric.glb')
(OUT/'PROVENANCE.json').write_text(json.dumps(g['asset'],indent=2))
print(json.dumps({'bytes':len(result),'bones':len(g['skins'][0]['joints']),'textures':resolution,'path':str(OUT/'eric.glb')},indent=2))
