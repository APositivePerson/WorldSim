import {useState} from 'react';
import type {SimulationLoop} from '../physics/SimulationLoop';
export function SensoryPanel({loop,refresh}:{loop:SimulationLoop;refresh:()=>void}){
  const [error,setError]=useState('');const c=loop.controller,g=c.locomotion;
  if(!g||c.grasp)return null;
  const state=g.getState().sensory;
  const options=state?.options;
  const physicalEyes=c.physicalEyes.snapshot();
  const eyeYaw=physicalEyes.available?physicalEyes.eyes.reduce((sum,e)=>sum+e.angles[0],0)/2:state?.gaze.yaw??0;
  return <section aria-label="感觉与头眼稳定">
    <div className="section-heading"><h2>感觉与头眼稳定</h2><span>SENSORIMOTOR</span></div>
    <label className="speed">控制模式
      <select aria-label="感觉控制模式" disabled={g.mode==='walk'} value={state?'sensory':'oracle'} onChange={e=>{
        const accepted=c.setSensoryMode(e.target.value==='sensory');setError(accepted?'':'请先重置并站稳，结束步行、取物或侧推实验，并关闭肘部肌肉模式。');refresh();
      }}><option value="oracle">原控制器 · 精确状态对照</option><option value="sensory">感觉估计 · 站立与行走</option></select>
    </label>
    {state&&<>
      <label className="speed">感觉条件<select aria-label="感觉条件" value={!options!.vision?'closed':options!.noiseScale===4?'limited':'full'} onChange={e=>{
        c.configureSenses({vision:e.target.value!=='closed',noiseScale:e.target.value==='limited'?4:1,delayScale:e.target.value==='limited'?2:1});refresh();
      }}><option value="full">全部感觉</option><option value="closed">闭眼 · 保留前庭和身体感觉</option><option value="limited">噪声 4 倍 / 延迟 2 倍</option></select></label>
      <label><input type="checkbox" aria-label="头眼稳定" checked={options!.headEyes} onChange={e=>{c.configureSenses({headEyes:e.target.checked});refresh();}} /> 头眼稳定</label>
      <div className="actions"><button onClick={()=>{c.setJoint('neck_yaw',.35);refresh();}}>转头并保持注视</button>
        <button onClick={()=>{c.setJoint('neck_yaw',0);refresh();}}>头部回正</button></div>
      <dl data-testid="sensory-state">
        <dt>收到的感觉通路</dt><dd>{state.estimate.uncertainty.available} / 4</dd>
        <dt>位置估计误差（评估）</dt><dd>{(state.diagnostics.positionError*1000).toFixed(2)} mm</dd>
        <dt>视线误差（评估）</dt><dd>{(state.diagnostics.gazeError*180/Math.PI).toFixed(2)}°</dd>
        <dt>眼球转角</dt><dd>{(eyeYaw*180/Math.PI).toFixed(1)}°</dd>
        <dt>接触估计（左 / 右）</dt><dd>{state.estimate.contactEstimate.map(f=>({swing:'离地',heel:'后足承重',flat:'全掌',forefoot:'前足承重',uncertain:'未知'}[f.phase])).join(' / ')}</dd>
        <dt>感觉步态</dt><dd>{state.walking.active?state.walking.phase:'站立'}{state.walking.safetyStop?' · 感觉不足，已请求停步':''}</dd>
        <dt>执行步速</dt><dd>{state.walking.speed.toFixed(2)} m/s</dd>
        <dt>落脚修正（横 / 前后）</dt><dd>{(state.walking.landingCorrection.x*1000).toFixed(1)} / {(state.walking.landingCorrection.y*1000).toFixed(1)} mm</dd>
        <dt>稳定期零偏更新</dt><dd>{state.estimate.uncertainty.biasUpdates}</dd>
        <dt>校准保护计数</dt><dd>{state.estimate.uncertainty.rejected}</dd>
      </dl>
      <p className="hint">本阶段使用关节感觉和地标视觉代理、头部惯性与分区足底压力，含延迟和噪声。平衡使用估计状态，评估误差独立读取真实状态。头眼稳定接管颈部俯仰与侧倾；{physicalEyes.available?'眼球由真实六肌动力学驱动。':'眼球是有限速度的角度模型。'}平地行走使用动态支撑点、延迟接触切换和估计状态落脚修正；长期运动学习冻结。感觉行走最高 0.40 m/s，延迟增大时限速 0.25 m/s；闭眼行走超过 0.6 秒后请求停步。</p>
    </>}
    <button className="full" disabled={g.mode==='fallen'||c.balancePush.active||!!c.cerebellumExperiment?.active} onClick={()=>{setError(c.startBalancePush()?'':'请先站稳并结束其他实验。');refresh();}}>侧推对照 · 35 N / 120 ms</button>
    {error&&<p role="status">{error}</p>}
  </section>;
}
