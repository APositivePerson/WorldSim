import type { SimulationLoop } from "../physics/SimulationLoop";

/** Plots physical measurements; never alters rendered or simulated body poses. */
export function CerebellumMonitor({ loop }: { loop: SimulationLoop }) {
  const experiment = loop.controller.cerebellumExperiment?.snapshot();
  const learner = loop.controller.locomotion?.cerebellum.snapshot();
  if (!experiment?.total || !learner) return null;
  const scale = experiment.profile === "visible" ? 35 : 15;
  const y = (value: number) => 66 - Math.max(-scale, Math.min(scale, value * 1000)) / scale * 42;
  const path = (trace: typeof experiment.trace, field: "displacement" | "correction") => trace
    .map((p, i) => `${i ? "L" : "M"}${(30 + p.time / 4 * 340).toFixed(1)},${y(p[field]).toFixed(1)}`).join(" ");
  const maxRms = Math.max(.001, ...learner.trials.map(t => t.rms));
  const progress = learner.trials.map((trial, i) => `${learner.trials.length === 1 ? 30 : 30 + i / (learner.trials.length - 1) * 340},${105 - trial.rms / maxRms * 78}`);
  const stage = loop.paused && experiment.active ? "已暂停 · 训练时间冻结" : experiment.stage;
  return <div className="training-monitor" aria-label="训练过程监视器">
    <div className={`training-banner ${experiment.force ? "pushing" : ""}`}>
      <strong data-testid="training-stage">{stage}</strong>
      <span>第 {experiment.round} / {experiment.total} 轮 · {experiment.elapsed.toFixed(1)} / 4.0 s</span>
      <b data-testid="training-force">侧推 {experiment.force.toFixed(0)} N →</b>
      <b>实际横移 {(experiment.displacement * 1000).toFixed(2)} mm</b>
    </div>
    <progress aria-label="本轮训练进度" max={4} value={experiment.elapsed} />
    <div className="training-charts">
      <figure>
        <figcaption>本轮真实位移 <span>青：身体　橙：补偿　灰虚线：基线</span></figcaption>
        <svg viewBox="0 0 390 130" role="img" aria-label="本轮横向位移与提前补偿曲线">
          <rect x="98" y="15" width={experiment.profile === "visible" ? 21.25 : 8.5} height="94" fill="#fff0df" />
          <path d="M30 22H370M30 66H370M30 110H370" stroke="#dce5e8" fill="none" />
          <text x="0" y="24">+{scale}</text><text x="12" y="69">0</text><text x="0" y="112">−{scale}</text>
          <path d={path(experiment.baselineTrace, "displacement")} stroke="#8799a1" strokeDasharray="4 3" fill="none" />
          <path data-testid="cerebellum-live-trace" d={path(experiment.trace, "displacement")} stroke="#147d79" strokeWidth="2" fill="none" />
          <path d={path(experiment.trace, "correction")} stroke="#d78028" strokeWidth="2" fill="none" />
          <text x="30" y="128">0 s</text><text x="340" y="128">4 s</text><text x="330" y="12">mm</text>
        </svg>
      </figure>
      <figure>
        <figcaption>逐轮均方根偏移 <span>越低表示横向偏移越小</span></figcaption>
        <svg viewBox="0 0 390 130" role="img" aria-label="每轮训练偏移变化">
          <path d="M30 25V105H370" stroke="#dce5e8" fill="none" />
          <text x="0" y="24">{(maxRms*1000).toFixed(1)}</text><text x="12" y="108">0</text>
          <polyline points={progress.join(" ")} stroke="#147d79" strokeWidth="2" fill="none" />
          {progress.map((point, i) => { const [cx, cy] = point.split(","); return <circle key={i} cx={cx} cy={cy} r="3" fill={learner.trials[i].mode === "baseline" ? "#8799a1" : "#147d79"} />; })}
          <text x="30" y="128">第 1 轮</text><text x="305" y="128">共 {learner.trials.length} 轮</text><text x="330" y="12">mm</text>
        </svg>
      </figure>
    </div>
    <p className="hint">图中记录真实物理位移；人物没有放大动作。学习模式会在每轮结束后更新下一轮补偿。</p>
  </div>;
}
