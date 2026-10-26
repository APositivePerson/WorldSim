import { neutralFace, type FaceControls } from "../rendering/DeformationRig";
export function FacePanel({ face, setFace, deformation, setDeformation }: {
  face: FaceControls; setFace: (face: FaceControls) => void;
  deformation: boolean; setDeformation: (value: boolean) => void;
}) {
  return <section>
    <div className="section-heading"><h2>面部与辅助变形</h2><span>DEFORMATION</span></div>
    <label className="toggle">辅助骨骼变形<input type="checkbox" checked={deformation} onChange={e => setDeformation(e.target.checked)} /></label>
    <label className="toggle">自然眨眼<input type="checkbox" disabled={!deformation} checked={face.autoBlink} onChange={e => setFace({ ...face, autoBlink: e.target.checked })} /></label>
    {([["jawOpen", "张嘴"], ["smile", "微笑"], ["browRaise", "抬眉"], ["blink", "闭眼"]] as const).map(([key, label]) =>
      <label className="speed" key={key}>{label}<input aria-label={label} type="range" min="0" max="100" disabled={!deformation}
        value={Math.round(face[key] * 100)} onChange={e => setFace({ ...face, [key]: Number(e.target.value) / 100 })} /><output>{Math.round(face[key] * 100)}%</output></label>)}
    <button className="full" onClick={() => setFace({ ...neutralFace })}>恢复自然表情</button>
    <p className="hint">前臂、肩部和脊柱辅助骨随实际关节角度变形。面部可单独调整；自然眨眼随仿真暂停。</p>
  </section>;
}
