"""Download/normalize two CC BY 4.0 datasets. No generated human measurements.
Dependencies: numpy scipy h5py. Raw archives stay outside the browser bundle.
"""
import argparse, hashlib, io, json, pathlib, urllib.request, zipfile, csv
import numpy as np
from scipy.signal import butter, sosfiltfilt
import h5py
from remote_zip import RemoteZip
ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT/'assets/calibration'

def digest(data): return hashlib.sha256(data).hexdigest()
def fetch(url, path):
    if not path.exists():
        tmp=path.with_suffix(path.suffix+'.part')
        urllib.request.urlretrieve(url,tmp);tmp.replace(path)
    return path.read_bytes()
def write(path, data): path.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n')
def channel(file, name, emg=False):
    group=file[name]
    unit=''.join(chr(int(c)) for c in group['units'][()].ravel())
    time=group['times'][()].ravel(); value=group['values'][()].ravel()
    if not np.all(np.isfinite(value)) or not np.all(np.diff(time)>0): raise ValueError('Invalid source channel')
    fs=1/float(np.median(np.diff(time)))
    if emg:
        if unit!='V':raise ValueError('Expected EMG volts')
        value=np.abs(sosfiltfilt(butter(2,[30,500],btype='bandpass',fs=fs,output='sos'),value))
    value=sosfiltfilt(butter(2,10,fs=fs,output='sos'),value)
    return time,value,unit

def prepare(cache):
    OUT.mkdir(parents=True,exist_ok=True);cache.mkdir(parents=True,exist_ok=True)
    ankle_meta=json.loads(fetch('https://api.figshare.com/v2/articles/26502868',cache/'ankle-meta.json'))
    gait_meta=json.loads(fetch('https://api.figshare.com/v2/articles/5722711',cache/'gait-meta.json'))
    af=next(f for f in ankle_meta['files'] if f['name']=='dynamometry.zip')
    archive=fetch(af['download_url'],cache/'dynamometry.zip')
    if hashlib.md5(archive).hexdigest()!=af['computed_md5']:raise ValueError('Ankle archive checksum mismatch')
    z=zipfile.ZipFile(io.BytesIO(archive));names=z.namelist();prefix='dynamometry/p1/MAT data/'
    # Calibration signal normalization is derived solely from dedicated MVC trials.
    mvc_names=sorted(n for n in names if n.startswith(prefix) and pathlib.Path(n).stem in ['MVC_01','MVC_02','MVCdf_01'])
    mvc={k:0. for k in ['MG','LG','SOL','TA']};mvc_hash={}
    for name in mvc_names:
        raw=z.read(name);mvc_hash[name]=digest(raw)
        with h5py.File(io.BytesIO(raw)) as f:
            for k in mvc:mvc[k]=max(mvc[k],float(channel(f,k,True)[1].max()))
    trials=[]
    conditions=[('pas_005','passive','train',80),('pas_30','passive','holdout',80),('pas_120','passive','holdout',80),
                ('slow_low','active','train',16),('medium_low','active','train',16),('fast_low','active','holdout',16),
                ('asym_low','active','holdout',16),('sine_020','active','holdout',16)]
    for condition,kind,split,duration in conditions:
        choices=sorted(n for n in names if n.startswith(prefix+condition+'_') and n.endswith('.mat'))
        name=choices[-1];raw=z.read(name)
        with h5py.File(io.BytesIO(raw)) as f:
            channels={k:channel(f,k,k not in ['Angle','Torque']) for k in ['Angle','Torque','MG','LG','SOL','TA']}
        # Shared source clock, no cross-correlation time shift or endpoint extrapolation.
        start=max(t[0] for t,v,u in channels.values());stop=min(duration,*[t[-1] for t,v,u in channels.values()])
        t=np.arange(np.ceil(start*100)/100,stop, .01)
        x={k:np.interp(t,tt,v) for k,(tt,v,u) in channels.items()}
        if channels['Angle'][2]!='Deg' or channels['Torque'][2]!='Nm':raise ValueError('Unexpected dynamometer units')
        cols=['time_s','ankle_df_rad','knee_flex_rad','ankle_df_Nm','soleus_emg','gastrocnemius_emg','tibialis_anterior_emg']
        values=np.column_stack([t,-np.deg2rad(x['Angle']),np.zeros(len(t)),-x['Torque'],
          np.maximum(0,x['SOL']/mvc['SOL']),np.maximum(0,(x['MG']/mvc['MG']+x['LG']/mvc['LG'])/2),np.maximum(0,x['TA']/mvc['TA'])])
        trials.append({'id':'rub-p1-'+condition,'subject':'RUB-p1','kind':kind,'split':split,'clock':'seconds','columns':cols,
          'sourceFile':name,'sourceSha256':digest(raw),'processing':{'filter':'zero-phase 2nd-order Butterworth; torque/angle 10 Hz; EMG 30-500 Hz, rectified, 10 Hz','sampleRateHz':100,'knee':'extended per methods','angleSign':-1,'torqueSign':-1,'emgNormalization':'dedicated MVC per-channel max; MG/LG average for aggregate gastrocnemius','windowSeconds':[float(t[0]),float(t[-1])],'purpose':'pilot effective ankle fit; not subject-specific anatomy'},
          'samples':np.round(values,7).tolist()})
    write(OUT/'ankle-p1.json',{'schemaVersion':1,'source':'https://doi.org/10.6084/m9.figshare.26502868','license':ankle_meta['license'],'mvcSha256':mvc_hash,'mvcEnvelopeVolts':mvc,'trials':trials})
    gf=next(f for f in gait_meta['files'] if f['name']=='WBDSascii.zip')
    remote=None
    inf=next(f for f in gait_meta['files'] if f['name']=='WBDSinfo.csv')
    metadata=fetch(inf['download_url'],cache/'WBDSinfo.csv').decode('utf-8-sig')
    info=list(csv.DictReader(io.StringIO(metadata)));gaits=[]
    for condition in ['T01','T08']:
        arrays={};hashes={}
        for suffix in ['ang','knt']:
            name='WBDS01walk'+condition+suffix+'.txt';path=cache/name
            if not path.exists():
                if remote is None:remote=zipfile.ZipFile(RemoteZip(gf['download_url'],gf['size']))
                path.write_bytes(remote.read('51subjs/'+name))
            raw=path.read_bytes();hashes[name]=digest(raw)
            arrays[suffix]=np.genfromtxt(io.BytesIO(raw),names=True,delimiter='\t')
        row=next(r for r in info if r['FileName']=='WBDS01walk'+condition+'.c3d')
        a,k=arrays['ang'],arrays['knt'];mass=float(row['Mass'])
        # Processed Time is percent gait cycle, NOT seconds. Never invent cycle duration.
        if not np.array_equal(a['Time'],k['Time']):raise ValueError('Unaligned gait phases')
        vals=np.column_stack([a['Time']/100,np.deg2rad(a['LAnkleAngleZ']),np.deg2rad(a['LKneeAngleZ']),-k['LAnkleMomentZ']*mass,k['LGRFY']*mass,np.deg2rad(a['LHipAngleZ']),k['LHipMomentZ']*mass,-k['LKneeMomentZ']*mass])
        gaits.append({'id':'wbds-01-'+condition,'subject':'WBDS-01','kind':'gait','split':'holdout','clock':'gait_phase','bodyMassKg':mass,'speedMps':float(row['GaitSpeed(m/s)']),'sourceSha256':hashes,'columns':['phase','ankle_df_rad','knee_flex_rad','ankle_df_Nm','vertical_grf_N','hip_flex_rad','hip_flex_Nm','knee_flex_Nm'],'samples':np.round(vals,7).tolist(),
          'processing':{'angle':'left Z sagittal dorsiflexion, knee/hip flexion deg -> rad','moment':'left Z: ankle PF and knee extension positive -> negative DF/flexion; hip flexion positive unchanged; Nm/kg -> Nm','grf':'laboratory Y vertical N/kg -> N','time':'ensemble 101-point gait phase; duration unavailable; not used for reflex/force-velocity fitting'}})
    write(OUT/'gait-wbds01.json',{'schemaVersion':1,'source':'https://doi.org/10.6084/m9.figshare.5722711','license':gait_meta['license'],'metadataSha256':digest(metadata.encode()),'trials':gaits})
    write(OUT/'provenance.json',{'ankle':{'title':ankle_meta['title'],'authors':ankle_meta['authors'],'license':ankle_meta['license'],'file':af,'sha256':digest(archive),'methods':'https://doi.org/10.7717/peerj-cs.2636','codeCommit':'e0b3b7fe5a636c0ce7b78c0b20db33ba026c68eb'},'gait':{'title':gait_meta['title'],'authors':gait_meta['authors'],'license':gait_meta['license'],'file':gf,'methods':'https://doi.org/10.7717/peerj.4640','coordinateReference':'official wbdsExploratoryDA.m (figshare file 10167060)'}})
    print('Prepared',len(trials),'ankle trials and',len(gaits),'external gait holdouts')
if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--cache',type=pathlib.Path,default=OUT/'raw');prepare(ap.parse_args().cache)
