import * as T from 'three';
import type {MuJoCoEngine} from '../../physics/MuJoCoEngine';
import type {SensoryBalance} from './SensoryBalance';
/** Ground-truth evaluation for UI/tests only; never imported by an estimator. */
export function evaluateSenses(engine:MuJoCoEngine,system:SensoryBalance){
  const d=engine.data,b=engine.mj.mj_name2id(engine.model,1,'head');
  const head=new T.Quaternion(d.xquat[b*4+1],d.xquat[b*4+2],d.xquat[b*4+3],d.xquat[b*4]);
  const eyes=system.gaze.eyes;
  const ray=new T.Vector3(0,-1,0).applyEuler(new T.Euler(eyes.pitch,0,eyes.yaw,'ZXY')).applyQuaternion(head);
  if(engine.physicalEyes){
    ray.set(0,0,0);
    for(const side of ['left','right']){
      const id=engine.mj.mj_name2id(engine.model,1,side+'_eye');
      ray.add(new T.Vector3(0,-1,0).applyQuaternion(new T.Quaternion(d.xquat[id*4+1],d.xquat[id*4+2],d.xquat[id*4+3],d.xquat[id*4])));
    }
    ray.normalize();
  }
  const target=system.input.target.clone().sub(new T.Vector3().fromArray(d.xpos,b*3));
  return {positionError:Math.hypot(...[0,1,2].map(i=>d.qpos[i]-system.data.qpos[i])),
    gazeError:ray.angleTo(target),headTilt:new T.Vector3(0,0,1).angleTo(new T.Vector3(0,0,1).applyQuaternion(head))};
}
