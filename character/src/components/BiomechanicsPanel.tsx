import type { HumanController } from "../human/HumanController";
export function BiomechanicsPanel({controller,refresh}:{controller:HumanController;refresh:()=>void}) {
  const state=controller.muscles.snapshot();
  return <section>
    <div className="section-heading"><h2>肌腱与疲劳实验</h2><span>NATIVE MUSCLE</span></div>
    <label className="toggle">双肘肌肉驱动
      <input aria-label="双肘肌肉驱动" type="checkbox" checked={state.enabled} onChange={(e)=>{controller.muscles.setEnabled(e.target.checked);refresh();}} />
    </label>
    <p className="hint">启用后，双肘由肱二头肌／肱三头肌经肌腱拉动，对应位置电机关闭；其余关节继续由电机驱动。模型参数为实验近似。</p>
    {state.enabled&&<>
      <label className="toggle">疲劳与恢复<input aria-label="疲劳与恢复" type="checkbox" checked={state.fatigueEnabled} onChange={(e)=>{controller.muscles.fatigueEnabled=e.target.checked;refresh();}} /></label>
      {state.muscles.map((m)=><div className="muscle-status" key={m.name} data-testid={m.name}>
        <b>{m.side==="left"?"左":"右"}{m.kind==="biceps"?"肱二头肌":"肱三头肌"}</b>
        <div className="metrics"><span>激活 {(m.activation*100).toFixed(0)}%</span><span>拉力 {m.force.toFixed(1)} N</span>
          <span>能力 {(m.capacity*100).toFixed(0)}%</span><span>疲劳 {(m.fatigue*100).toFixed(1)}%</span></div>
      </div>)}
      <details><summary>手动肌肉激活实验</summary>
        <p className="hint">同时激活拮抗肌可观察共收缩与疲劳；动作目标在自动跟踪模式生效。</p>
        {(["left","right"] as const).map((side)=><div key={side}>
          <button className="full" onClick={()=>controller.muscles.setExcitation(side,0.55,0.55)}>{side==="left"?"左":"右"}肘共收缩</button>
          <button className="full" onClick={()=>controller.muscles.setExcitation(side,0,0)}>{side==="left"?"左":"右"}肘放松恢复</button>
          <button className="full" onClick={()=>controller.muscles.setExcitation(side,null)}>{side==="left"?"左":"右"}肘恢复自动跟踪</button>
        </div>)}
      </details>
    </>}
  </section>;
}
