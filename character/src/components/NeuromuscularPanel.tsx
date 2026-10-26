import {useState} from 'react';
import type {HumanController} from '../human/HumanController';
import type {LegDriveMode} from '../human/neuromuscular/LegMuscleController';
export function NeuromuscularPanel({controller:c,refresh}:{controller:HumanController;refresh:()=>void}){
 const [error,setError]=useState(''),legs=c.legMuscles.snapshot(),eyes=c.physicalEyes.snapshot();
 if(!legs.available)return null;
 const active=legs.muscles.filter(f=>f.active);
 return <section aria-label="神经肌肉与物理眼球">
  <div className="section-heading"><h2>神经肌肉与物理眼球</h2><span>NEUROMUSCULAR</span></div>
  <label className="speed">腿部驱动<select aria-label="腿部驱动" disabled={c.locomotion?.mode!=='stand'} value={legs.mode} onChange={e=>{setError(c.setLegDrive(e.target.value as LegDriveMode)?'':'请先停步并结束侧推实验。');refresh();}}>
   <option value="servo">原关节执行器对照</option><option value="ankle">踝部肌肉与肌梭</option><option value="full">全腿肌肉与肌梭</option>
  </select></label>
  <label><input aria-label="肌梭反射" type="checkbox" checked={legs.reflexes} onChange={e=>{c.legMuscles.configure({reflexes:e.target.checked});refresh();}}/> 肌梭反射与拮抗抑制</label>
  {(['gammaStatic','gammaDynamic'] as const).map(k=><label className="speed" key={k}>{k==='gammaStatic'?'静态 γ 驱动':'动态 γ 驱动'}<input aria-label={k==='gammaStatic'?'静态伽马驱动':'动态伽马驱动'} type="range" min="0" max="100" value={legs[k]*100} onChange={e=>{c.legMuscles.configure({[k]:Number(e.target.value)/100});refresh();}}/><output>{legs[k].toFixed(2)}</output></label>)}
  <dl data-testid="leg-muscle-state"><dt>参数配置</dt><dd>{legs.profile}（尚未通过人体标定）</dd><dt>参与肌肉单元</dt><dd>{active.length} / {legs.muscles.length}</dd>
   <dt>原腿部电机最大出力</dt><dd>{Math.max(0,...legs.motors.map(m=>Math.abs(m.force))).toFixed(3)} Nm</dd>
   <dt>肌腱最大伸长</dt><dd>{(Math.max(0,...active.map(m=>m.tendonStrain))*100).toFixed(2)}%</dd>
   <dt>延迟 Ia / II</dt><dd>{(active[0]?.afferent?.ia??0).toFixed(0)} / {(active[0]?.afferent?.ii??0).toFixed(0)} Hz（左比目鱼肌）</dd>
   <dt>力矩分配残差</dt><dd>{legs.residual.toFixed(2)} Nm</dd></dl>
  <details><summary>肌肉、肌腱及肌梭信号</summary>{active.map(f=><div className="muscle-status" key={f.name}>
   <b>{f.name.includes('_left_')?'左':'右'}{f.label}</b><div className="metrics"><span>激活 {(f.activation*100).toFixed(0)}%</span><span>拉力 {f.force.toFixed(0)} N</span><span>纤维 {(f.fiberLength*1000).toFixed(1)} mm</span><span>Ia {f.spindle.ia.toFixed(0)} Hz</span><span>反射 {f.reflex.toFixed(3)}</span></div>
  </div>)}</details>
  <label><input aria-label="物理眼球控制" type="checkbox" checked={eyes.enabled} onChange={e=>{c.physicalEyes.enabled=e.target.checked;refresh();}}/> 六肌物理眼球控制</label>
  <div className="actions"><button onClick={()=>{c.setJoint('neck_yaw',.35);refresh();}}>物理转头并注视</button><button onClick={()=>{c.setEyeTarget([.2,-.5,1.65]);refresh();}}>近处目标与集合</button></div>
  <button className="full" onClick={()=>{c.setEyeTarget([0,-100,1.65]);c.setJoint('neck_yaw',0);refresh();}}>远处目标与头部回正</button>
  <dl data-testid="physical-eye-state">{eyes.eyes.map(eye=><div key={eye.side}><dt>{eye.side==='left'?'左':'右'}眼 yaw / pitch / torsion</dt><dd>{eye.angles.map(a=>(a*180/Math.PI).toFixed(1)).join(' / ')}°</dd></div>)}</dl>
  <p className="hint">腿部为 34 个功能肌群的 Hill 肌肉与串联弹性肌腱；三纤维肌梭是简化生理模型，传入延迟由配置指定。低层仍保留理想局部肌长伺服，不等于完整脊髓神经回路。全腿模式关闭 14 个原位置电机；肌肉模式当前限速 0.25 m/s。眼球由真实刚体、眼眶弹性和每眼六条肌肉驱动。参数尚未做人体个体标定，上层步态仍沿用工程控制器。</p>
  {error&&<p role="status">{error}</p>}
 </section>;
}
