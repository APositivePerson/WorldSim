import type { HumanController } from "../human/HumanController";
import { useState } from "react";
const deg = (x: number) => (x * 180) / Math.PI;
const labels: Record<string, string> = {
  spine: "腰部侧弯", spine_flex: "腰部前后屈", spine_twist: "腰部扭转",
  chest_flex: "胸部前后屈", chest_sidebend: "胸部侧弯", chest_twist: "胸部扭转",
  neck_yaw: "转头", neck_pitch: "低头 / 抬头", neck_roll: "头部侧倾",
  scapula_elevation: "肩带升降", scapula_protraction: "肩带前后转",
  shoulder: "肩外展", shoulder_flex: "肩屈伸", shoulder_rotation: "肩内外旋",
  elbow: "肘屈伸", forearm_rotation: "前臂旋前 / 旋后", wrist: "腕屈伸", wrist_deviation: "腕部侧偏",
  thumb_opposition: "拇指对掌", toe_flex: "前脚掌屈曲",
};
function label(name: string) {
  if (labels[name]) return labels[name];
  const side = name.startsWith("left_") ? "左 · " : name.startsWith("right_") ? "右 · " : "";
  const base = name.replace(/^(left|right)_/, "");
  return side + (labels[base] ?? base);
}
export function JointPanel({ controller }: { controller: HumanController }) {
  const [region, setRegion] = useState("all");
  const match = (name: string) => region === "all"
    || (region === "trunk" && /^(spine|chest|neck)/.test(name))
    || (region.endsWith("_arm") && name.startsWith(region.split("_")[0]) && /shoulder|scapula|elbow|forearm/.test(name))
    || (region.endsWith("_hand") && name.startsWith(region.split("_")[0]) && /wrist|thumb|index|middle|ring|little/.test(name))
    || (region === "legs" && /hip|knee|ankle|toe_flex/.test(name));
  return (
    <section>
      <div className="section-heading">
        <h2>关节遥测</h2>
        <span>DEG / DEG·S⁻¹</span>
      </div>
      <p className="hint">目标 → 平滑轨迹 → 位置驱动器 → 实际响应</p>
      <label className="speed">关节区域
        <select aria-label="关节区域" value={region} onChange={(e) => setRegion(e.target.value)}>
          {[["all", "全部关节"], ["trunk", "头颈与腰胸"], ["left_arm", "左肩与手臂"],
            ["right_arm", "右肩与手臂"], ["left_hand", "左腕与手指"], ["right_hand", "右腕与手指"], ["legs", "下肢与足部"]]
            .map(([value, title]) => <option key={value} value={value}>{title}</option>)}
        </select>
      </label>
      <div className="joint-list">
        {controller.snapshot().filter((j) => match(j.name)).map((j) => (
          <div className="joint" key={j.name} data-joint={j.name}>
            <div className="joint-title">
              <label htmlFor={j.name}>{label(j.name)}<small className="joint-code">{j.name}</small></label>
              <b>{deg(j.actual).toFixed(1)}°</b>
            </div>
            <input
              id={j.name}
              aria-label={j.name}
              type="range"
              disabled={j.managed || !!controller.grasp?.active}
              title={j.managed ? "由自由站立 / 步行控制器管理" : undefined}
              min={deg(j.min)}
              max={deg(j.max)}
              step="1"
              value={deg(j.target)}
              onChange={(e) =>
                controller.setJoint(
                  j.name,
                  (Number(e.target.value) / 180) * Math.PI,
                )
              }
            />
            <div className="metrics">
              <span>
                目标 <b>{deg(j.target).toFixed(0)}°</b>
              </span>
              <span>
                速度 <b>{deg(j.velocity).toFixed(1)}</b>
              </span>
              <span>
                ctrl <b>{j.control.toFixed(2)} rad</b>
              </span>
              <span>
                力矩 <b>{j.force.toFixed(1)} N·m</b>
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
