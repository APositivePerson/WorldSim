import { fingerNames, fingerCurlAngle, type Side } from "../human/Anatomy";
import type { HumanController } from "../human/HumanController";
const names = { thumb: "拇指", index: "食指", middle: "中指", ring: "无名指", little: "小指" };
export function HandPanel({ controller }: { controller: HumanController }) {
  const joints = controller.snapshot();
  return <section>
    <div className="section-heading"><h2>手指控制</h2><span>40 DOF</span></div>
    <p className="hint">拇指有独立对掌关节，握拳时覆盖在四指外侧。点击“手部细节”可近看；逐节弯曲、分指和腕部控制在下方关节面板。</p>
    {(["left", "right"] as Side[]).map((side) => <details key={side} open={side === "right"}>
      <summary>{side === "left" ? "左手" : "右手"}</summary>
      {fingerNames.map((finger) => {
        const joint = joints.find((j) => j.name === `${side}_${finger}_1_flex`)!;
        return <label className="finger-control" key={finger}>
          <span>{names[finger]}</span>
          <input aria-label={`${side === "left" ? "左手" : "右手"}${names[finger]}弯曲`}
            disabled={!!controller.grasp?.active} type="range" min="0" max="100" step="1" value={Math.max(0, Math.min(100, Math.round(joint.target / fingerCurlAngle(finger, 1, 1) * 100)))}
            onChange={(e) => controller.setFinger(side, finger, Number(e.target.value) / 100)} />
          <output>{Math.round(joint.actual * 180 / Math.PI)}°</output>
        </label>;
      })}
    </details>)}
  </section>;
}
