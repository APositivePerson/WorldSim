import {
  actions,
  labels,
  type PoseActionName,
} from "../human/ActionDefinitions";
export function ActionPanel({
  execute,
  free,
  busy,
}: {
  free?: boolean;
  busy?: boolean;
  execute: (action: PoseActionName) => void;
}) {
  return (
    <section>
      <div className="section-heading">
        <h2>动作指令</h2>
        <span>02 SEC</span>
      </div>
      <div className="actions">
        {Object.keys(actions).map((a) => (
          <button
            key={a}
            disabled={busy || (free && ["bend_right_knee", "squat_check"].includes(a))}
            title={
              busy ? "取物动作进行中，请先放回杯子" : free && ["bend_right_knee", "squat_check"].includes(a)
                ? "腿部由平衡器管理；切换固定模式可检查下肢变形"
                : undefined
            }
            onClick={() => execute(a as PoseActionName)}
          >
            {labels[a as PoseActionName]}
            <span>↗</span>
          </button>
        ))}
      </div>
    </section>
  );
}
