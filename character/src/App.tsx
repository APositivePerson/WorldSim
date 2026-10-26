import type {SensoryOptions} from "./human/sensory/SensoryInterface";
import { useCallback, useEffect, useRef, useState } from "react";
import { FacePanel } from "./components/FacePanel";
import { neutralFace, validFace, type FaceControls } from "./rendering/DeformationRig";
import { preferScannedAvatar, type AvatarStyle } from "./rendering/AvatarProfiles";
import { GraspPanel } from "./components/GraspPanel";
import type { GraspTask } from "./human/GraspTask";
import { loadHuman } from "./physics/ModelLoader";
import type { LocomotionController } from "./human/LocomotionController";
import { HumanController } from "./human/HumanController";
import { SimulationLoop } from "./physics/SimulationLoop";
import { HumanViewer } from "./components/HumanViewer";
import { SimulationPanel } from "./components/SimulationPanel";
import { ActionPanel } from "./components/ActionPanel";
import { JointPanel } from "./components/JointPanel";
import { HandPanel } from "./components/HandPanel";
import { BodyPanel } from "./components/BodyPanel";
import { BiomechanicsPanel } from "./components/BiomechanicsPanel";
import type { Side, FingerName } from "./human/Anatomy";
import type { ActionCommand } from "./human/ActionDefinitions";
import type { CerebellumMode } from "./human/Cerebellum";
import type { CerebellumProfile } from "./physics/CerebellumExperiment";
import { CerebellumMonitor } from "./components/CerebellumMonitor";
import type { WalkingLearningMode } from "./human/WalkingCerebellum";
declare global {
  interface Window {
    human?: {
      executeAction: (c: ActionCommand) => boolean;
      setFinger: (side: Side, finger: FingerName, curl: number) => void;
      placeCup: (x: number, y: number) => boolean;
      setFace: (face: Partial<FaceControls>) => boolean;
      setLegDrive: (mode:import('./human/neuromuscular/LegMuscleController').LegDriveMode)=>boolean;
      configureSpindles: (options:{reflexes?:boolean;gammaStatic?:number;gammaDynamic?:number})=>boolean;
      setEyeTarget: (target:number[])=>boolean;
      setEyeMuscleStrength: (name:string,strength:number)=>boolean;
      setPhysicalEyeControl: (enabled:boolean)=>boolean;
      setSensoryMode: (enabled:boolean) => boolean;
      configureSenses: (options:Partial<SensoryOptions>) => boolean;
      startBalancePush: () => boolean;
      setWalkingSpeed: (speed: number) => boolean;
      setMotionReference: (strength: number) => boolean;
      setWalkingMechanics: (options:{rolling?:boolean;reactiveStepping?:boolean}) => boolean;
      setWalkingLearning: (mode: WalkingLearningMode) => boolean;
      startCerebellumExperiment: (mode: CerebellumMode, rounds?: number) => boolean;
      setCerebellumProfile: (profile: CerebellumProfile) => boolean;
      stopCerebellumExperiment: () => void;
      clearCerebellum: () => boolean;
      getState: () => {
        status: string;
        balancePush:ReturnType<HumanController["balancePush"]["snapshot"]>;
        time: number;
        locomotion: ReturnType<LocomotionController["getState"]> | null;
        cerebellumExperiment: ReturnType<NonNullable<HumanController["cerebellumExperiment"]>["snapshot"]> | null;
        joints: ReturnType<HumanController["snapshot"]>;
        body: ReturnType<SimulationLoop["engine"]["bodyState"]>;
        muscles: ReturnType<HumanController["muscles"]["snapshot"]>;
        legMuscles:ReturnType<HumanController['legMuscles']['snapshot']>;
        physicalEyes:ReturnType<HumanController['physicalEyes']['snapshot']>;
        reach: ReturnType<HumanController["reach"]["snapshot"]>;
        grasp: ReturnType<GraspTask["snapshot"]> | null;
        face: FaceControls;
      };
    };
  }
}
export default function App() {
  const [mode, setMode] = useState<"free" | "fixed" | "grasp" | "neuro">("free");
  return <SimulationApp key={mode} mode={mode} setMode={setMode} />;
}
function SimulationApp({
  mode,
  setMode,
}: {
  mode: "free" | "fixed" | "grasp" | "neuro";
  setMode: (m: "free" | "fixed" | "grasp" | "neuro") => void;
}) {
  const [loop, setLoop] = useState<SimulationLoop | null>(null),
    [error, setError] = useState(""),
    [, rerender] = useState(0);
  const [skin, setSkin] = useState(true),
    [bones, setBones] = useState(false),
    [skinDetail, setSkinDetail] = useState(true),
    [surfaceOpacity, setSurfaceOpacity] = useState(1),
    [muscles, setMuscles] = useState(false),
    [correctives, setCorrectives] = useState(true),
    [softTissue, setSoftTissue] = useState(true),
    [avatar, setAvatar] = useState<File | null>(null),
    [skinStatus, setSkinStatus] = useState("GLB 加载中…");
  const [joints, setJoints] = useState(false),
    [axes, setAxes] = useState(true),
    [skeleton, setSkeleton] = useState(false),
    [home, setHome] = useState(0);
  const [focus, setFocus] = useState<"full" | "left" | "right" | "head" | "grasp" | "feet">("full");
  const [face, setFace] = useState<FaceControls>({ ...neutralFace });
  const [avatarStyle, setAvatarStyle] = useState<AvatarStyle>("procedural");
  const [scanAvailable, setScanAvailable] = useState(false);
  useEffect(() => {
    let active = true;
    fetch(`${import.meta.env.BASE_URL}models/local-scan-status.json`)
      .then(response => response.json())
      .then(status => {
        if (!active) return;
        setScanAvailable(status.available === true);
        if (status.available === true && preferScannedAvatar()) setAvatarStyle("scan");
      }).catch(() => {});
    return () => { active = false; };
  }, []);
  const [deformation, setDeformation] = useState(true);
  const faceRef = useRef(face);
  faceRef.current = face;
  const refresh = useCallback(() => rerender((n) => n + 1), []);
  const onError = useCallback((e: unknown) => setError(String(e)), []);
  useEffect(() => {
    let cancelled = false;
    let cleanup: undefined | (() => void);
    loadHuman(mode)
      .then((engine) => {
        if (cancelled) {
          engine.dispose();
          return;
        }
        const controller = new HumanController(engine);
        const simulation = new SimulationLoop(engine, controller);
        setLoop(simulation);
        window.human = {
          executeAction: (c) => controller.executeAction(c),
          setFinger: (side, finger, curl) => controller.setFinger(side, finger, curl),
          placeCup: (x, y) => controller.placeCup(x, y),
          setFace: patch => { if (!patch || !validFace(patch)) return false; setFace(current => ({ ...current, ...patch })); return true; },
          setLegDrive: mode=>controller.setLegDrive(mode),
          configureSpindles: options=>controller.legMuscles.configure(options),
          setEyeTarget: target=>controller.setEyeTarget(target),
          setEyeMuscleStrength: (name,strength)=>controller.physicalEyes.setStrength(name,strength),
          setPhysicalEyeControl: enabled=>{if(typeof enabled!=='boolean'||!controller.physicalEyes.available)return false;controller.physicalEyes.enabled=enabled;return true;},
          setSensoryMode: enabled => controller.setSensoryMode(enabled),
          configureSenses: options => controller.configureSenses(options),
          startBalancePush: () => controller.startBalancePush(),
          setWalkingSpeed: value => controller.locomotion?.setSpeed(value) ?? false,
          setMotionReference: value => controller.locomotion?.setReferenceStrength(value) ?? false,
          setWalkingMechanics: options => controller.locomotion?.setWalkingMechanics(options) ?? false,
          setWalkingLearning: mode => controller.locomotion?.cerebellum.walking.setMode(mode) ?? false,
          startCerebellumExperiment: (mode, rounds) => controller.startCerebellumExperiment(mode, rounds),
          setCerebellumProfile: profile => controller.locomotion?.mode === "walk" ? false : controller.cerebellumExperiment?.setProfile(profile) ?? false,
          stopCerebellumExperiment: () => controller.cerebellumExperiment?.stop(),
          clearCerebellum: () => {
            if (!controller.locomotion || controller.locomotion.mode === "walk" || controller.cerebellumExperiment?.active) return false;
            return controller.cerebellumExperiment?.clear() ?? false;
          },
          getState: () => ({
            status: controller.status,
            balancePush:controller.balancePush.snapshot(),
            time: engine.data.time,
            joints: controller.snapshot(),
            locomotion: controller.locomotion?.getState() ?? null,
            cerebellumExperiment: controller.cerebellumExperiment?.snapshot() ?? null,
            body: engine.bodyState(),
            muscles: controller.muscles.snapshot(),legMuscles:controller.legMuscles.snapshot(),physicalEyes:controller.physicalEyes.snapshot(),
            reach: controller.reach.snapshot(),
            grasp: controller.grasp?.snapshot() ?? null,
            face: { ...faceRef.current },
          }),
        };
        cleanup = () => {
          delete window.human;
          controller.dispose();
          engine.dispose();
        };
      })
      .catch(onError);
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [onError]);
  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="brand-mark">H</span>
          <div>
            HUMAN DYNAMICS <small>交互式人体动力学实验室</small>
          </div>
        </div>
        <div className="header-meta">
          MUJOCO × THREE.JS{" "}
          <span className={error ? "badge error" : "badge"}>
            {error ? "初始化 / 运行错误" : loop ? "● 引擎在线" : "加载 WASM…"}
          </span>
        </div>
      </header>
      {error ? (
        <div role="alert" className="error-box">
          {error}
          <p>请查看浏览器控制台，确认 WASM 与 models/human.xml 可访问。</p>
        </div>
      ) : !loop ? (
        <div className="loading">正在初始化 MuJoCo WebAssembly 与人体模型…</div>
      ) : (
        <main>
          <aside className="left">
            <SimulationPanel
              {...{
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
              }}
            />
            <BodyPanel loop={loop} refresh={refresh} />
            <BiomechanicsPanel controller={loop.controller} refresh={refresh} />
          </aside>
          <article className="stage">
            <div className="stage-title">
              <div>
                <span className="eyebrow">LIVE SIMULATION</span>
                <h1>人体动力学</h1>
              </div>
              <div className="view-presets">
                {mode === "grasp" && <button aria-pressed={focus === "grasp"} onClick={() => setFocus("grasp")}>抓取近景</button>}
                <button onClick={() => setFocus("feet")}>步足近景</button>
                <button onClick={() => setFocus("head")}>头肩细节</button>
                <button onClick={() => setFocus("left")}>左手细节</button>
                <button onClick={() => setFocus("right")}>右手细节</button>
                <button onClick={() => { setFocus("full"); setHome((n) => n + 1); }}>⌖ 默认视角</button>
              </div>
            </div>
            <HumanViewer
              {...{
                loop,
                skin,
                muscles,
                avatar,
                avatarStyle,
                onSkinStatus: setSkinStatus,
                correctives, softTissue,
                bones, skinDetail, surfaceOpacity,
                face, deformation,
                joints,
                axes,
                skeleton,
                home,
                focus,
                onTick: refresh,
                onError,
              }}
            />
            <div className="view-caption">
              <span>{mode === "grasp" ? "拖动杯子调整位置 · 拖拽空白旋转 · 滚轮缩放" : "拖拽旋转 · 滚轮缩放 · 右键平移"}</span>
              <span>Z ↑ · 米 / 弧度 / 秒</span>
            </div>
            <CerebellumMonitor loop={loop} />
            <div className="telemetry">
              <div>
                <span>仿真时间</span>
                <b data-testid="sim-time">
                  {loop.engine.data.time.toFixed(2)} <small>s</small>
                </b>
              </div>
              <div>
                <span>运行状态</span>
                <b>{loop.paused ? "已暂停" : "运行中"}</b>
              </div>
              <div>
                <span>动作状态</span>
                <b data-testid="action-status">{loop.controller.cerebellumExperiment?.active ? "小脑实验中" : loop.controller.status}</b>
              </div>
              <div>
                <span>当前指令</span>
                <b className="command">{loop.controller.action}</b>
              </div>
            </div>
            {loop.controller.error && (
              <p role="alert">{loop.controller.error}</p>
            )}
            <p className="stage-foot">
              {mode !== "fixed" ? "自由基座 · 反馈平衡" : "固定基座"} · 500 Hz
              物理步进 · 丢弃延迟 {loop.dropped.toFixed(2)} s
            </p>
          </article>
          <aside className="right">
            <FacePanel {...{ face, setFace, deformation, setDeformation }} />
            <ActionPanel
              busy={!!loop.controller.grasp?.active}
              free={mode !== "fixed"}
              execute={(action) => {
                loop.controller.executeAction({
                  action,
                  duration: 2,
                  source: "ui",
                });
                refresh();
              }}
            />
            <GraspPanel controller={loop.controller} refresh={refresh} onCloseup={() => setFocus("grasp")} />
            <HandPanel controller={loop.controller} />
            <JointPanel controller={loop.controller} />
          </aside>
        </main>
      )}
      <footer>
        <span>HUMAN SIMULATION / MVP 01</span>
        <span>物理驱动 · 浏览器原生 · 单线程 WASM</span>
      </footer>
    </div>
  );
}
