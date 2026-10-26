import {NeuromuscularPanel} from './NeuromuscularPanel';
import {SensoryPanel} from "./SensoryPanel";
import type { SimulationLoop } from "../physics/SimulationLoop";
import type { AvatarStyle } from "../rendering/AvatarProfiles";
import { CerebellumPanel } from "./CerebellumPanel";
export function SimulationPanel({
  loop,
  mode,
  setMode,
  skin,
  setSkin,
  bones, setBones, skinDetail, setSkinDetail, surfaceOpacity, setSurfaceOpacity,
  muscles,
  setMuscles,
  correctives, setCorrectives, softTissue, setSoftTissue,
  avatar,
  setAvatar,
  avatarStyle, setAvatarStyle, scanAvailable,
  skinStatus,
  refresh,
  joints,
  axes,
  skeleton,
  setJoints,
  setAxes,
  setSkeleton,
}: {
  skin: boolean;
  setSkin: (v: boolean) => void;
  bones: boolean; setBones: (v: boolean) => void;
  skinDetail: boolean; setSkinDetail: (v: boolean) => void;
  surfaceOpacity: number; setSurfaceOpacity: (v: number) => void;
  muscles: boolean;
  setMuscles: (v: boolean) => void;
  correctives: boolean; setCorrectives: (v:boolean)=>void;
  softTissue: boolean; setSoftTissue: (v:boolean)=>void;
  avatar: File | null;
  setAvatar: (f: File | null) => void;
  avatarStyle: AvatarStyle; setAvatarStyle: (style: AvatarStyle) => void;
  scanAvailable: boolean;
  skinStatus: string;
  loop: SimulationLoop;
  mode: "free" | "fixed" | "grasp" | "neuro";
  setMode: (m: "free" | "fixed" | "grasp" | "neuro") => void;
  refresh: () => void;
  joints: boolean;
  axes: boolean;
  skeleton: boolean;
  setJoints: (v: boolean) => void;
  setAxes: (v: boolean) => void;
  setSkeleton: (v: boolean) => void;
}) {
  const m = loop.engine.model;
  const locomotion = loop.controller.locomotion?.getState();
  return (
    <>
      <section>
        <div className="section-heading">
          <h2>人体模型</h2>
          <span>01</span>
        </div>
        <div className="model-icon">◎</div>
        <h3>Human / Anatomy</h3>
        <label className="speed">
          基座模式
          <select
            aria-label="基座模式"
            value={mode}
            onChange={(e) => setMode(e.target.value as "free" | "fixed" | "grasp" | "neuro")}
          >
            <option value="free">自由站立 / 行走</option>
            <option value="neuro">神经肌肉实验 / 自由站立</option>
            <option value="fixed">固定动作演示</option>
            <option value="grasp">取物实验 / 自由站立</option>
          </select>
        </label>
        <p className="hint">
          {mode !== "fixed"
            ? "6 自由度骨盆 · 足底接触支撑"
            : "固定骨盆 · 单关节动作演示"}
        </p>
        <dl>
          <dt>人体刚体</dt>
          <dd>{loop.engine.humanBodies.length}</dd>
          <dt>总质量</dt>
          <dd>{loop.engine.totalMass.toFixed(2)} kg</dd>
          <dt>驱动关节</dt>
          <dd>
            {loop.engine.joints.length} {mode !== "fixed" ? "+ 自由根关节" : ""}
          </dd>
          <dt>驱动器</dt>
          <dd>{m.nu}</dd>
          <dt>重力</dt>
          <dd>−9.81 m/s²</dd>
          <dt>固定步长</dt>
          <dd>{loop.engine.dt * 1000} ms</dd>
          <dt>引擎版本</dt>
          <dd>{loop.engine.mj.mj_versionString()}</dd>
        </dl>
      </section>
      {muscles && <p className="hint">肌肉颜色与形变按关节电机力矩负载示意。颜色不是生理激活值；神经肌肉场景的真实肌力与激活见下方实验面板。</p>}
      <section>
        <div className="section-heading">
          <h2>仿真控制</h2>
          <span>02</span>
        </div>
        <button
          className="primary full"
          onClick={() => {
            loop.paused = !loop.paused;
            refresh();
          }}
        >
          {loop.paused ? "▶ 继续仿真" : "Ⅱ 暂停仿真"}
        </button>
        <button
          className="full"
          onClick={() => {
            loop.reset();
            refresh();
          }}
        >
          ↺ 重置物理状态
        </button>
        <label className="speed">
          仿真速度
          <select
            value={loop.speed}
            onChange={(e) => {
              loop.speed = Number(e.target.value);
              refresh();
            }}
          >
            {[0.25, 0.5, 1, 2].map((v) => (
              <option key={v} value={v}>
                {v}×
              </option>
            ))}
          </select>
        </label>
      </section>
      <NeuromuscularPanel controller={loop.controller} refresh={refresh} />
      <SensoryPanel loop={loop} refresh={refresh} />
      {loop.controller.locomotion && (
        <section>
          <div className="section-heading">
            <h2>平衡与步行</h2>
            <span>MOTION CONTROL</span>
          </div>
          <button
            className="primary full" disabled={!!loop.controller.grasp?.active}
            onClick={() => {
              loop.controller.executeAction({ action: "walk_forward" });
              refresh();
            }}
          >
            ▶ 向前行走
          </button>
          <label className="speed">步态
            <select aria-label="步态" disabled={locomotion!.mode==="walk"}
              value={locomotion!.motion.gait}
              onChange={e=>{loop.controller.locomotion!.setSpeed(e.target.value==="natural"?locomotion!.motion.maxSpeed:.03);refresh();}}>
              <option value="natural">连续行走</option><option value="careful" disabled={!!locomotion!.sensory}>慢速平衡实验</option>
            </select>
          </label>
          <label className="speed">参考前进速度
            <input aria-label="参考前进速度" type="range" min={locomotion!.motion.gait==="natural"?"0.25":"0.015"} max={locomotion!.motion.gait==="natural"?String(locomotion!.motion.maxSpeed):"0.045"} step={locomotion!.motion.gait==="natural"?"0.05":"0.005"}
              value={locomotion!.motion.speed}
              onChange={e=>{loop.controller.locomotion!.setSpeed(Number(e.target.value));refresh();}} />
            <output>{locomotion!.motion.speed.toFixed(3)} m/s</output>
          </label>
          <label><input aria-label="足底滚动与蹬地" type="checkbox" disabled={locomotion!.mode==="walk"}
            checked={locomotion!.mechanics.rolling} onChange={e=>{loop.controller.locomotion!.setWalkingMechanics({rolling:e.target.checked});refresh();}} /> 足底滚动与蹬地</label>
          <label><input aria-label="受扰落点调整" type="checkbox" disabled={locomotion!.mode==="walk"}
            checked={locomotion!.mechanics.reactiveStepping} onChange={e=>{loop.controller.locomotion!.setWalkingMechanics({reactiveStepping:e.target.checked});refresh();}} /> 受扰落点调整</label>
          <label className="speed">真人动作参考强度
            <input aria-label="真人动作参考强度" type="range" min="0" max="100" step="5"
              value={Math.round(locomotion!.motion.strength*100)}
              onChange={e=>{loop.controller.locomotion!.setReferenceStrength(Number(e.target.value)/100);refresh();}} />
            <output>{Math.round(locomotion!.motion.strength*100)}%</output>
          </label>
          <button
            className="full" disabled={!!loop.controller.grasp?.active}
            onClick={() => {
              loop.controller.executeAction({ action: "stop_walk" });
              refresh();
            }}
          >
            ■ 停步并站稳
          </button>
          <dl>
            <dt>步态</dt>
            <dd data-testid="gait-mode">{loop.controller.locomotion.mode}</dd>
            <dt>实际前进速度</dt><dd data-testid="walking-speed">{locomotion!.motion.actualSpeed.toFixed(2)} m/s</dd>
            <dt>阶段</dt>
            <dd>{loop.controller.locomotion.phase}</dd>
            {locomotion!.mechanics.feet?.map((foot,i)=><div className="foot-phase" key={i}>
              <dt>{i===0?"左":"右"}足参考</dt><dd>{foot.phase}</dd>
            </div>)}
            <dt>落点修正</dt><dd data-testid="landing-correction">横 {(locomotion!.balance.landingCorrection.x*1000).toFixed(1)} / 前后 {(locomotion!.balance.landingCorrection.y*1000).toFixed(1)} mm</dd>
            <dt>已落脚</dt>
            <dd>{loop.controller.locomotion.steps}</dd>
            <dt>骨盆高度</dt>
            <dd>{loop.engine.data.qpos[2].toFixed(3)} m</dd>
            <dt>接触点</dt>
            <dd>{loop.engine.data.ncon}</dd>
            <dt>动作来源</dt>
            <dd>CMU 07_01 · 真人行走</dd>
            <dt>脚底支撑力</dt>
            <dd data-testid="foot-loads">{locomotion!.balance.feet.map((f,i)=>`${i===0?"左":"右"} ${f.force.toFixed(0)} N`).join(" / ")}</dd>
            <dt>平衡反馈</dt>
            <dd data-testid="balance-feedback">{locomotion!.balance.waitingForSupport?"等待支撑稳定":"重心与落脚协调"}</dd>
            <dt>前进距离</dt>
            <dd data-testid="distance">
              {(-loop.engine.data.qpos[1]).toFixed(3)} m
            </dd>
          </dl>
          <p className="hint">
            连续行走默认 0.5 m/s，通过连续重心运动、抬脚和交替摆臂前进。停止时先减速、落脚再站稳；慢速平衡实验保留原有小步控制。当前仅适用于平地，尚未达到常见成人正常步速。
            {locomotion!.motion.maxSpeed<.5&&" 当前体重使用 0.25 m/s 的保守连续行走档位。"}
          </p>
        </section>
      )}
      <CerebellumPanel loop={loop} refresh={refresh} />
      <section>
        <div className="section-heading">
          <h2>显示设置</h2>
          <span>03</span>
        </div>
        {[
          ["GLB 蒙皮外观", skin, setSkin],
          ["皮肤细节与柔和高光", skinDetail, setSkinDetail],
          ["实体骨骼", bones, (value: boolean) => { setBones(value); setSurfaceOpacity(value ? 0.18 : 1); }],
          ["关节标记", joints, setJoints],
          ["世界坐标轴", axes, setAxes],
          ["骨骼连线", skeleton, setSkeleton],
          ["肌肉负载示意", muscles, setMuscles],
          ["关节体积修正", correctives, setCorrectives],
          ["呼吸与软组织动态", softTissue, setSoftTissue],
        ].map(([label, value, set]) => (
          <label className="toggle" key={String(label)}>
            {String(label)}
            <input
              type="checkbox"
              checked={value as boolean}
              onChange={(e) => (set as (v: boolean) => void)(e.target.checked)}
            />
          </label>
        ))}
        <label className="speed">
          表皮不透明度
          <input aria-label="表皮不透明度" type="range" min="8" max="100" step="1" disabled={!skin}
            value={Math.round(surfaceOpacity * 100)} onChange={e => setSurfaceOpacity(Number(e.target.value) / 100)} />
          <output>{Math.round(surfaceOpacity * 100)}%</output>
        </label>
        {bones && <p className="hint">实体骨架随关节运动。降低表皮不透明度可观察内部，关闭「GLB 蒙皮外观」可单独看骨架。</p>}
      </section>
      <section>
        <div className="section-heading">
          <h2>蒙皮模型</h2>
          <span>GLB</span>
        </div>
        <p className="hint" data-testid="skin-status">
          {skinStatus}
        </p>
        <label className="speed">内置人物
          <select aria-label="内置人物" value={avatarStyle} onChange={e => { setAvatar(null); setAvatarStyle(e.target.value as AvatarStyle); }}>
            <option value="scan" disabled={!scanAvailable}>真人扫描 / Eric</option>
            <option value="procedural">程序模型 / V2</option>
          </select>
        </label>
        {avatarStyle === "scan" && <p className="hint">真实人物扫描外观，使用原始摄影颜色与法线贴图，已适配物理骨架。模型经过比例拟合，展示写实外观，不代表人体测量精度。</p>}
        <label className="file-input">
          载入兼容 GLB
          <input
            aria-label="载入兼容 GLB"
            type="file"
            accept=".glb"
            onChange={(e) => {
              setAvatar(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
        </label>
        {avatar && (
          <button className="full" onClick={() => setAvatar(null)}>
            恢复内置蒙皮
          </button>
        )}
        {avatarStyle === "procedural" && <p className="hint">
          V2 模型包含 92 根蒙皮骨骼：51 个物理刚体对应骨、16 根原有细节骨、25 根新增变形辅助骨。
          已精修面部、眼睑、耳廓、掌部和关节过渡，嵌入皮肤颜色、法线、粗糙度与厚度贴图。
          导入模型需匹配物理骨骼名称、层级、米单位及绑定姿态。
        </p>}
      </section>
      <div className="note">
        <i /> 真实动力学
        <br />
        <span>
          {mode !== "fixed"
            ? "骨盆可自由移动；关节电机与真实足底接触共同支撑身体。"
            : "重力、惯性、关节限位及碰撞由 MuJoCo 计算；骨盆固定。"}
        </span>
      </div>
    </>
  );
}
