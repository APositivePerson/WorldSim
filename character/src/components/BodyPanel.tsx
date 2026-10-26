import { useState } from "react";
import type { SimulationLoop } from "../physics/SimulationLoop";
export function BodyPanel({ loop, refresh }: { loop: SimulationLoop; refresh: () => void }) {
  const body = loop.engine.bodyState();
  const [weight, setWeight] = useState(body.mass.toFixed(1));
  const [error, setError] = useState("");
  return <section>
    <div className="section-heading"><h2>质量与重心</h2><span>KG / N</span></div>
    <dl>
      <dt>总质量</dt><dd data-testid="body-mass">{body.mass.toFixed(2)} kg</dd>
      <dt>重力载荷</dt><dd>{body.weight.toFixed(1)} N</dd>
      <dt>重心高度</dt><dd>{body.centerOfMass[2].toFixed(3)} m</dd>
    </dl>
    <label className="speed">体重 (kg)
      <input className="mass-input" aria-label="体重 (kg)" type="number" min="45" max="100" step="1"
        value={weight} onChange={(e) => setWeight(e.target.value)} />
    </label>
    <button className="full" onClick={() => {
      try {
        loop.engine.setTotalMass(Number(weight));
        loop.reset();
        setError(""); refresh();
      } catch (e) { setError(String(e)); }
    }}>应用体重并重置</button>
    {error && <p role="alert">{error}</p>}
    <p className="hint">按比例缩放各段质量与惯量。肌肉、脂肪和骨骼的质量合并在刚体内，肌肉示意不会重复增加重量。</p>
    <details><summary>分段质量 · {body.segments.length} 个刚体</summary>
      <dl>{body.segments.map((s) => <div className="mass-row" key={s.name}>
        <dt>{s.name}</dt><dd>{s.mass.toFixed(3)} kg</dd>
      </div>)}</dl>
    </details>
  </section>;
}
