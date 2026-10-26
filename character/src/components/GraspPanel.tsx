import type { HumanController } from "../human/HumanController";
const stages: Record<string, string> = { idle: "等待取物", prepare: "舒展手指与手腕", approach: "抬手接近", align: "调整掌心朝向", close: "接触停止收指", lift: "提起杯子", holding: "稳定持杯", lower: "放回支撑台", open: "松开手指", retreat: "移开手掌", done: "已放回", failed: "取物失败" };
export function GraspPanel({ controller, refresh, onCloseup }: {
    controller: HumanController;
    refresh: () => void;
    onCloseup: () => void;
}) {
    const task = controller.grasp;
    if (!task)
        return null;
    const state = task.snapshot();
    const editable = !task.active && controller.status !== "running" && controller.locomotion?.mode === "stand";
    return <section>
    <div className="section-heading"><h2>接触取物实验</h2><span>CONTACT GRASP</span></div>
    <p className="hint">杯子约 120 g。手指接触后停止快速收拢，再以柔顺加压维持握力。杯子通过接触与摩擦受力。</p>
    <p className="hint">取物前可拖动台面上的杯子，或用滑块调整位置。手臂将根据实际位置伸手；放回时返回本次拿起的位置。</p>
    {(["X", "Y"] as const).map((axis, i) => <label className="speed" key={axis}>
      杯子 {axis}（米）
      <input aria-label={`杯子 ${axis} 位置`} type="range" min={state.placementBounds[i].min} max={state.placementBounds[i].max} step="0.001"
        disabled={!editable} value={Math.max(state.placementBounds[i].min, Math.min(state.placementBounds[i].max, state.cupPosition[i]))}
        onChange={e => {
          const p = state.cupPosition.slice(0, 2).map((v, j) => Math.max(state.placementBounds[j].min, Math.min(state.placementBounds[j].max, v)));
          p[i] = Number(e.target.value);
          controller.placeCup(p[0], p[1]); refresh();
        }} />
      <output>{state.cupPosition[i].toFixed(3)}</output>
    </label>)}
    {!task.active && state.unavailable && <p role="status" className="hint">{state.unavailable}</p>}
    <button className="full" onClick={onCloseup}>查看手与杯子近景</button>
    <button className="primary full" disabled={task.active || !!state.unavailable} onClick={() => { controller.execute({ action: "pick_up_cup" }); refresh(); }}>拿起杯子</button>
    <button className="full" disabled={state.stage !== "holding"} onClick={() => { controller.execute({ action: "put_down_cup" }); refresh(); }}>放回杯子</button>
    <dl><dt>阶段</dt><dd data-testid="grasp-stage">{state.stage}</dd><dt>当前动作</dt><dd>{stages[state.stage]}</dd>
    <dt>杯子提升</dt><dd data-testid="cup-lift">{(state.liftHeight * 100).toFixed(1)} cm</dd><dt>台面支撑力</dt><dd>{state.supportForce.toFixed(2)} N</dd></dl>
    {state.fingers.map(f => <div className="muscle-status" key={f.name}><b>{{ thumb: "拇指", index: "食指", middle: "中指", ring: "无名指", little: "小指" }[f.name]}</b><span>{f.contactForce.toFixed(2)} N · {f.stopped ? "接触停指" : f.contactForce > 0.08 ? "接触调力" : "接近中"}</span></div>)}
    {state.error && <p role="alert">{state.error}</p>}
  </section>;
}
