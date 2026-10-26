import { useState } from "react";
import type { SimulationLoop } from "../physics/SimulationLoop";
import type { CerebellumMode } from "../human/Cerebellum";
import type { CerebellumProfile } from "../physics/CerebellumExperiment";
import type { WalkingLearningMode } from "../human/WalkingCerebellum";

export function CerebellumPanel({ loop, refresh }: { loop: SimulationLoop; refresh: () => void }) {
  const [error, setError] = useState("");
  const controller = loop.controller;
  const learner = controller.locomotion?.cerebellum;
  const experiment = controller.cerebellumExperiment;
  if (!learner || !experiment) return null;
  const state = learner.snapshot();
  const walking = controller.locomotion!.mode === "walk";
  const sensory=!!controller.locomotion!.sensory;
  const timing = state.walking;
  const latest = state.trials.at(-1);
  const baseline = state.trials.filter(trial => trial.mode === "baseline");
  const baselineRms = baseline.length ? baseline.reduce((sum, trial) => sum + trial.rms, 0) / baseline.length : 0;
  function start(mode: CerebellumMode) {
    setError(controller.startCerebellumExperiment(mode) ? "" : "请先恢复初始姿态，等待站稳并完成当前动作。");
    refresh();
  }
  return <section aria-label="小脑学习实验">
    <div className="section-heading"><h2>小脑学习实验</h2><span>ADAPTATION</span></div>
    <label className="speed">行走落脚学习
      <select aria-label="行走落脚学习" value={timing.mode}
        onChange={event => { learner.walking.setMode(event.target.value as WalkingLearningMode); refresh(); }}>
        <option value="learn">学习并校正</option><option value="frozen">冻结已学模型</option><option value="off">关闭校正</option>
      </select>
    </label>
    <dl data-testid="walking-learning-state">
      <dt>行走学习</dt><dd>{timing.active ? "运行中" : "未行走"}</dd>
      <dt>已学习落脚</dt><dd>{timing.updates} 次</dd>
      <dt>本步时序修正</dt><dd>{(timing.appliedLead*1000).toFixed(1)} ms</dd>
      <dt>载荷学习更新</dt><dd>{timing.load.updates} 次</dd>
      <dt>载荷模型误差</dt><dd>{timing.load.samples?`${(timing.load.predictionError*100).toFixed(1)}% 体重力`:"—"}</dd>
      <dt>落地预测误差</dt><dd>{timing.samples ? `${(timing.predictionError*1000).toFixed(1)} ms` : "—"}</dd>
    </dl>
    <p className="hint">连续行走中根据左右脚实测接触学习落地延迟，修正下一步的时序；同时比较计划支撑力与实测足底载荷，小幅校准蹬地和重心转移。切换模式从下一步生效；此功能不等同于完整小脑或任意地形适应。</p>
    <p className="hint">每轮提示后施加一次短暂侧推，共 8 轮、32 秒仿真时间。学习提前调整身体重心，以减少重复侧推造成的偏移。</p>
    <label className="speed">侧推档位
      <select aria-label="侧推档位" disabled={experiment.active || walking} value={experiment.snapshot().profile}
        onChange={event => { experiment.setProfile(event.target.value as CerebellumProfile); setError(""); refresh(); }}>
        <option value="visible">明显侧推 · 100 N</option>
        <option value="standard">微小侧推 · 35 N</option>
      </select>
    </label>
    <p className="hint">默认使用明显侧推。开始后切换正面固定视角，观察橙色施力箭头和舞台下方曲线。切换档位会清除旧档位的学习记忆。</p>
    <div className="actions">
      <button disabled={experiment.active||sensory} onClick={() => start("baseline")}>原有控制</button>
      <button disabled={experiment.active||sensory} onClick={() => start("learn")}>持续学习</button>
      <button disabled={experiment.active||sensory} onClick={() => start("frozen")}>冻结学习</button>
      <button disabled={!experiment.active} onClick={() => { experiment.stop(); refresh(); }}>停止实验</button>
      <button disabled={experiment.active || walking} onClick={() => { experiment.clear(); setError(""); refresh(); }}>清除学习记忆</button>
    </div>
    <dl data-testid="cerebellum-state">
      <dt>实验</dt><dd>{experiment.active ? `进行中 · 剩余 ${experiment.snapshot().remaining} 轮` : "未运行"}</dd>
      <dt>当前补偿</dt><dd>{(state.correction * 1000).toFixed(2)} mm</dd>
      <dt>已记录</dt><dd>{state.trials.length} 轮</dd>
      <dt>预测参数更新</dt><dd>{state.modelUpdates} 次</dd>
      <dt>上轮均方根偏移</dt><dd>{latest ? `${(latest.rms * 1000).toFixed(2)} mm` : "—"}</dd>
      <dt>上轮最大偏移</dt><dd>{latest ? `${(latest.peak * 1000).toFixed(2)} mm` : "—"}</dd>
      <dt>基线均方根偏移</dt><dd>{baseline.length ? `${(baselineRms * 1000).toFixed(2)} mm` : "—"}</dd>
      <dt>相对基线减少</dt><dd>{latest && latest.mode !== "baseline" && baselineRms > 0 ? `${((1 - latest.rms / baselineRms) * 100).toFixed(1)}%` : "—"}</dd>
      <dt>速度预测误差</dt><dd>{state.predictionSamples ? `${(state.predictionError * 1000).toFixed(2)} mm/s` : "—"}</dd>
    </dl>
    {(error || state.reason) && <p role="status">{error || state.reason}</p>}
    <p className="hint">建议依次运行原有控制、持续学习、冻结学习。侧推补偿仅在侧推实验中启用；冻结模式保留已学补偿。此原型学习有提示的重复扰动，尚不能预测随机侧推。重置物理状态会清除记忆。</p>
  </section>;
}
