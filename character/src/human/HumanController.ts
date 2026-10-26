import {defaultProfile, type CalibrationProfile} from './calibration/Profile';
import {LegMuscleController,type LegDriveMode} from './neuromuscular/LegMuscleController';
import {PhysicalEyes} from './neuromuscular/PhysicalEyes';
import {BalancePush} from "../physics/BalancePush";
import type {SensoryOptions} from "./sensory/SensoryInterface";
import { LocomotionController } from "./LocomotionController";
import { actions, type ActionCommand } from "./ActionDefinitions";
import type { MuJoCoEngine } from "../physics/MuJoCoEngine";
import { handPose, relaxedHands, fingerNames, type Side, type FingerName } from "./Anatomy";
import { MuscleController } from "./MuscleController";
import { GraspTask } from "./GraspTask";
import { ReachTask } from "./ReachTask";
import { CerebellumExperiment } from "../physics/CerebellumExperiment";
import type { CerebellumMode } from "./Cerebellum";
export class HumanController {
  status: "idle" | "running" | "completed" | "failed" = "idle";
  action = "—";
  error = "";
  readonly locomotion: LocomotionController | null;
  readonly muscles: MuscleController;
  readonly legMuscles:LegMuscleController;
  readonly physicalEyes:PhysicalEyes;
  setLegDrive(mode:LegDriveMode){
    if(this.locomotion?.mode!=='stand'||this.balancePush.active||this.cerebellumExperiment?.active||this.reach.active)return false;
    const accepted=this.legMuscles.setMode(mode);if(accepted&&mode!=='servo')this.locomotion.setSpeed(.25);return accepted;
  }
  setEyeTarget(target:number[]){
    if(!this.physicalEyes.setTarget(target))return false;
    this.engine.gazeTarget=[target[0],target[1],target[2]];
    this.locomotion?.sensory?.input.target.fromArray(target);return true;
  }
  readonly balancePush:BalancePush;
  setSensoryMode(enabled:boolean){
    if(!this.locomotion||this.grasp||this.reach.active||this.cerebellumExperiment?.active||this.balancePush.active||this.muscles.enabled)return false;
    if(enabled&&(Math.hypot(this.engine.data.qpos[0],this.engine.data.qpos[1])>.025||Math.hypot(...Array.from(this.engine.data.qvel.slice(0,6)) as number[])>.06))return false;
    return this.locomotion.setSensoryMode(enabled);
  }
  configureSenses(patch:Partial<SensoryOptions>){return this.locomotion?.configureSenses(patch)??false;}
  startBalancePush(){return !!this.locomotion&&(this.locomotion.mode==="walk"||this.locomotion.mode==="stand"&&this.locomotion.settled)&&!this.cerebellumExperiment?.active&&!this.grasp?.active&&this.balancePush.start();}
  private get controlData(){return this.locomotion?.sensory?.data??this.engine.data;}
  readonly reach: ReachTask;
  readonly grasp: GraspTask | null;
  readonly cerebellumExperiment: CerebellumExperiment | null;
  targets: Float64Array;
  private starts: Float64Array;
  private ends: Float64Array;
  private elapsed = 0;
  private duration = 1;
  private settling = 0;
  private armOverrides = new Set<string>();
  private postureOverrides = new Set<string>();
  private handTransitions = new Map<string, "close" | "open">();
  constructor(readonly engine: MuJoCoEngine, profile:CalibrationProfile=defaultProfile) {
    if(engine.mj.mj_name2id(engine.model,1,'left_eye')>=0&&
      (JSON.stringify(profile.eyes)!==JSON.stringify(defaultProfile.eyes)||JSON.stringify(profile.eyeRoutes)!==JSON.stringify(defaultProfile.eyeRoutes)))
      throw new Error('Eye plant changes require regenerating and loading a matching MJCF; ankle calibration keeps eyes fixed');
    this.muscles = new MuscleController(engine);this.legMuscles=new LegMuscleController(engine,profile);this.physicalEyes=new PhysicalEyes(engine,profile.eyes);this.balancePush=new BalancePush(engine);
    this.reach = new ReachTask(engine);
    this.grasp = engine.mj.mj_name2id(engine.model,1,"prop_cup")>=0 ? new GraspTask(engine,this.reach):null;
    engine.mj.mj_forward(engine.model, engine.data);
    this.locomotion = engine.freeBase ? new LocomotionController(engine) : null;
    if(this.legMuscles.available)this.locomotion?.setSpeed(.25);
    this.cerebellumExperiment = this.locomotion ? new CerebellumExperiment(engine, this.locomotion) : null;
    this.targets = new Float64Array(engine.joints.length);
    const rest = relaxedHands();
    engine.joints.forEach((joint, i) => { this.targets[i] = rest[joint.name] ?? 0; });
    this.starts = this.targets.slice();
    this.ends = this.targets.slice();
  }
  execute(command: ActionCommand) {
    return this.executeAction(command);
  }
  placeCup(x: number, y: number) {
    if (!this.grasp || this.grasp.active || this.status === "running"
      || (this.locomotion && this.locomotion.mode !== "stand")) return false;
    if (!this.grasp.placeCup(x, y)) { this.error = this.grasp.error; return false; }
    this.status = "idle";
    this.action = "—";
    this.error = "";
    return true;
  }
  startCerebellumExperiment(mode: CerebellumMode, rounds = 8) {
    if (this.locomotion?.sensory || this.balancePush.active || this.grasp?.active || this.reach.active || this.status === "running") return false;
    return this.cerebellumExperiment?.begin(mode, rounds) ?? false;
  }
  executeAction(command: ActionCommand) {
    if(this.locomotion?.sensory&&["reach_right","reach_left","pick_up_cup","put_down_cup"].includes(command?.action)){
      this.error="感觉模式支持站立和行走；请切回原控制器后取物";return false;
    }
    if (this.cerebellumExperiment?.active) { this.error="请先停止小脑侧推实验"; return false; }
    if (
      !command ||
      (!Object.hasOwn(actions, command.action) &&
        !["walk_forward", "stand", "stop_walk", "pick_up_cup", "put_down_cup"].includes(command.action)) ||
      !Number.isFinite(command.duration ?? 2) ||
      (command.duration ?? 2) <= 0
    ) {
      this.status = "failed";
      this.error = "动作或时长无效";
      return false;
    }
    if(command.action==="pick_up_cup"||command.action==="put_down_cup") {
      if(!this.grasp || (this.locomotion && this.locomotion.mode!=="stand")){
        this.error="请切换取物实验场景，并先停步站稳";return false;
      }
      const accepted=command.action==="pick_up_cup"?this.grasp.begin():this.grasp.putDown();
      if(!accepted){this.error=this.grasp.error||"当前取物阶段不支持此操作";return false;}
      this.armOverrides.add("right");this.handTransitions.clear();this.status="running";this.error="";this.action=command.action;return true;
    }
    if(this.grasp?.active) {
      this.error="取物动作进行中，请先放回杯子或重置物理状态";return false;
    }
    if (
      command.action === "walk_forward" ||
      command.action === "stand" ||
      command.action === "stop_walk"
    ) {
      if (!this.locomotion || this.locomotion.mode === "fallen") {
        this.status = "failed";
        this.error = "请切换到自由基座模式；跌倒后需重置";
        return false;
      }
      if (command.action === "walk_forward") {
        this.armOverrides.clear();
        this.postureOverrides.clear();
        this.locomotion.walk();
        if(this.locomotion.mode!=="walk"){this.error="请等待足底感觉送达，并选择自然步态；感觉不足时不能起步";return false;}
      }
      else this.locomotion.stop();
      this.action = command.action;
      this.status = "running";
      this.error = "";
      return true;
    }
    if (command.action === "reach_right" || command.action === "reach_left") {
      this.reach.cancel();
      const side = command.action === "reach_left" ? "left" : "right";
      if (!this.reach.begin(side, command.duration ?? 2, command.target)) {
        this.status = "failed"; this.error = "伸手目标无效或超出当前手臂可达范围"; return false;
      }
      this.begin({ [`${side}_shoulder_flex`]: this.targets[this.engine.joints.findIndex((j) => j.name === `${side}_shoulder_flex`)] }, command.duration ?? 2);
      this.engine.gazeTarget = [...this.reach.target];
      this.action = command.action; return true;
    }
    if (this.locomotion && ["bend_right_knee", "squat_check"].includes(command.action)) {
      this.status = "failed";
      this.error = "自由模式下腿部由平衡器控制；单关节屈膝请切换固定演示模式";
      return false;
    }
    if (command.action === "reset_pose") this.locomotion?.stop();
    const pose: Record<string, number> =
      command.action === "reset_pose"
        ? Object.fromEntries(this.engine.joints.map((j) => [j.name, 0]))
        : actions[command.action];
    if (command.action === "reset_pose" || Object.keys(pose).some((name) => this.reach.owns(name))) this.reach.cancel();
    if (command.action === "look_left" || command.action === "look_right") {
      this.reach.cancel();
      const sign = command.action === "look_left" ? 1 : -1, d = this.engine.data;
      this.engine.gazeTarget = [d.xpos[3] + sign * 2, d.xpos[4] - 2, d.xpos[5] + 0.6];
    } else if (command.action === "reset_pose") this.engine.gazeTarget = null;
    this.begin(pose, command.duration ?? 2);
    if (command.action === "reset_pose" || command.action === "lower_arms") this.armOverrides.clear();
    this.action = command.action;
    return true;
  }
  setJoint(name: string, value: number) {
    if(this.locomotion?.sensory?.input.options.headEyes&&["neck_pitch","neck_roll"].includes(name)){
      this.error="请关闭头眼稳定后手动调节颈部俯仰和侧倾";return;
    }
    if (
      !Number.isFinite(value) ||
      (this.locomotion && /(hip|knee|ankle)/.test(name))
    )
      return;
    if (this.grasp?.active || this.cerebellumExperiment?.active) return;
    if (this.reach.owns(name)) this.reach.cancel();
    this.begin({ [name]: value }, 0.5);
    this.action = name;
  }
  setFinger(side: Side, finger: FingerName, curl: number) {
    if (!["left", "right"].includes(side) || !fingerNames.includes(finger)
      || !Number.isFinite(curl) || curl < 0 || curl > 1) return;
    if (this.grasp?.active || this.cerebellumExperiment?.active) return;
    this.begin(handPose(side, curl, finger), 0.35);
    this.action = `${side}_${finger}`;
  }
  private autoArm(name: string) {
    return !!this.locomotion && /_(shoulder_flex|elbow)$/.test(name)
      && !this.armOverrides.has(name.split("_")[0]);
  }
  private autoTrunk(name: string) {
    return !!this.locomotion && /^(spine|chest)_(flex|sidebend|twist)$/.test(name)
      && !this.postureOverrides.has(name);
  }
  private begin(pose: Record<string, number>, duration: number) {
    for (const name of Object.keys(pose)) if (/^(spine|chest)_/.test(name)) {
      const index=this.engine.joints.findIndex(j=>j.name===name);
      if(index>=0 && this.autoTrunk(name)) this.targets[index]=this.locomotion?.bodyTargets[name]??this.targets[index];
      this.postureOverrides.add(name);
    }
    this.handTransitions.clear();
    for (const side of ["left", "right"]) {
      if (pose[`${side}_thumb_opposition`] !== undefined && pose[`${side}_index_1_flex`] !== undefined)
        this.handTransitions.set(side, pose[`${side}_thumb_opposition`] > 0 ? "close" : "open");
    }
    const sides = new Set(Object.keys(pose).filter((name) => /_(shoulder|shoulder_flex|elbow)$/.test(name))
      .map((name) => name.split("_")[0]));
    // Transfer from the live gait reference when a user takes control of an arm.
    this.engine.joints.forEach((j, i) => {
      if (sides.has(j.name.split("_")[0]) && this.autoArm(j.name)) {
        this.targets[i] = this.locomotion?.armTargets[j.name] ?? this.targets[i];
        this.ends[i] = this.targets[i];
      }
    });
    for (const name of Object.keys(pose)) {
      if (/_(shoulder|shoulder_flex|elbow)$/.test(name)) this.armOverrides.add(name.split("_")[0]);
    }
    this.starts = this.targets.slice();
    this.ends = this.ends.slice();
    this.engine.joints.forEach((j, i) => {
      if (pose[j.name] !== undefined)
        this.ends[i] = Math.max(j.min, Math.min(j.max, pose[j.name]));
    });
    this.duration = duration;
    this.elapsed = 0;
    this.settling = 0;
    this.status = "running";
    this.error = "";
  }
  update(dt: number) {
    this.balancePush.update();
    this.cerebellumExperiment?.update();
    if(this.locomotion?.sensory&&this.muscles.enabled)this.muscles.setEnabled(false);
    if (this.status === "running" && !this.grasp?.active) {
      this.elapsed += dt;
      const t = Math.min(1, this.elapsed / this.duration),
        s = t * t * (3 - 2 * t);
      this.targets.forEach((_, i) => {
        const name = this.engine.joints[i].name;
        const mode = this.handTransitions.get(name.split("_")[0]);
        let phase = t;
        if (this.action === "look_left" || this.action === "look_right") {
          if (name === "neck_yaw") phase = (t - 0.1) / 0.65;
          else if (name === "chest_twist") phase = (t - 0.3) / 0.7;
          else if (name === "spine_twist") phase = (t - 0.45) / 0.55;
        }
        if (mode && /_(thumb|index|middle|ring|little)_/.test(name)) {
          const thumb = name.includes("_thumb_");
          // Close four fingers first, then place the thumb over the curled fingers.
          // On opening, release the thumb before extending the four fingers.
          phase = mode === "close" ? (thumb ? (t - 0.35) / 0.65 : t / 0.7)
            : (thumb ? t / 0.55 : (t - 0.2) / 0.8);
        }
        phase = Math.max(0, Math.min(1, phase));
        const eased = phase * phase * (3 - 2 * phase);
        this.targets[i] = this.starts[i] + (this.ends[i] - this.starts[i]) * eased;
      });
      if (t === 1) {
        this.settling += dt;
        const settled = this.engine.joints.every(
          (j, i) =>
            (this.locomotion && /(hip|knee|ankle)/.test(j.name)) ||
            this.autoArm(j.name) ||
            this.autoTrunk(j.name) ||
            this.muscles.isManual(j.name) ||
            (Math.abs(this.controlData.qpos[j.q] - this.ends[i]) < 0.14 &&
              Math.abs(this.controlData.qvel[j.v]) < 0.12),
        );
        if (settled && (!this.reach.active || this.reach.error < 0.025)) this.status = "completed";
        else if (this.settling > 6) {
          this.status = "failed";
          this.error = "目标未在容差内稳定（可能受碰撞或负载影响）";
        }
      }
    }
    const locomotionTargets = this.locomotion?.update(dt);
    const graspTargets = this.grasp?.update(dt) ?? {};
    const taskTargets = { ...this.reach.update(dt), ...graspTargets };
    if(this.grasp?.active) this.status=this.grasp.stage==="holding"?"completed":"running";
    else if(this.grasp?.stage==="failed" && ["pick_up_cup","put_down_cup"].includes(this.action)){this.status="failed";this.error=this.grasp.error;}
    else if(this.grasp?.stage==="done" && this.action==="put_down_cup")this.status="completed";
    if (this.reach.active) this.engine.gazeTarget = [...this.reach.target];
    if (this.locomotion?.mode === "fallen") {
      this.status = "failed";
      this.error = "人体跌倒，请重置物理状态";
    }
    if (
      ["walk_forward", "stand", "stop_walk"].includes(this.action) &&
      this.locomotion?.mode === "stand"
    )
      this.status = this.locomotion.settled ? "completed" : "running";
    if (this.action === "walk_forward" && this.locomotion?.mode === "walk")
      this.status = "running";
    const references: Record<string, number> = {};
    this.engine.joints.forEach((j, i) => {
      const reference = locomotionTargets?.[j.name] ?? taskTargets[j.name]
        ?? (this.autoArm(j.name) ? this.locomotion?.armTargets[j.name] : undefined)
        ?? (this.autoTrunk(j.name) ? this.locomotion?.bodyTargets[j.name] : undefined)
        ?? this.targets[i];
      if (taskTargets[j.name] !== undefined) { this.targets[i] = reference; this.ends[i] = reference; }
      references[j.name] = reference;
      if (this.muscles.owns(j.name)) { this.engine.data.ctrl[j.actuator] = 0; return; }
      const legManaged = !!this.locomotion && /(hip|knee|ankle)/.test(j.name);
      const kp = this.engine.model.actuator_gainprm[j.actuator * 10];
      const ctrl = reference + (legManaged ? 0 : this.controlData.qfrc_bias[j.v] / kp);
      this.engine.data.ctrl[j.actuator] = Math.max(
        j.min,
        Math.min(j.max, ctrl),
      );
    });
    this.muscles.update(dt, references);
    this.legMuscles.update(dt,references,this.controlData);
    const senses=this.locomotion?.sensory;
    if(this.locomotion?.mode==='walk')this.physicalEyes.distantFixation();
    this.physicalEyes.update(dt,senses?.lastFrame,senses?.estimate.bias,senses?.input.options.headEyes);
    if (this.locomotion?.cerebellum.active) {
      let command = 0, power = 0;
      for (const j of this.engine.joints) {
        if (j.name.endsWith("ankle_roll")) command += this.engine.data.ctrl[j.actuator] - this.engine.data.qpos[j.q];
        power += Math.abs(this.engine.data.qfrc_actuator[j.v] * this.engine.data.qvel[j.v]);
      }
      this.locomotion.cerebellum.recordCommand(command,power,this.engine.data.time);
    }
  }
  reset() {
    this.balancePush.reset();
    this.cerebellumExperiment?.stop();
    this.cerebellumExperiment?.clear();
    this.grasp?.reset();
    this.reach.cancel(); this.engine.gazeTarget = null;
    this.handTransitions.clear();
    this.armOverrides.clear();
    this.postureOverrides.clear();
    this.targets.fill(0);
    this.starts.fill(0);
    this.ends.fill(0);
    const rest = relaxedHands();
    this.engine.joints.forEach((joint, i) => {
      this.targets[i] = this.starts[i] = this.ends[i] = rest[joint.name] ?? 0;
    });
    this.status = "idle";
    this.action = "—";
    this.error = "";
    this.engine.reset();
    this.muscles.reset();this.legMuscles.reset();this.physicalEyes.reset();
    this.engine.mj.mj_forward(this.engine.model, this.engine.data);
    this.locomotion?.reset();
  }
  dispose() {
    this.balancePush.stop();this.legMuscles.dispose();this.physicalEyes.dispose();
    this.cerebellumExperiment?.stop();
    this.grasp?.dispose();
    this.reach.dispose();
    this.locomotion?.dispose();
  }
  snapshot() {
    return this.engine.joints.map((j, i) => ({
      ...j,
      managed: !!this.locomotion && /(hip|knee|ankle)/.test(j.name),
      target:
        this.locomotion && /(hip|knee|ankle)/.test(j.name)
          ? (this.locomotion.getReference(j.name) ??
            this.engine.data.ctrl[j.actuator])
          : this.autoArm(j.name) ? (this.locomotion?.armTargets[j.name] ?? 0) : this.autoTrunk(j.name) ? (this.locomotion?.bodyTargets[j.name] ?? 0) : this.ends[i],
      trajectory:
        this.locomotion && /(hip|knee|ankle)/.test(j.name)
          ? (this.locomotion.getReference(j.name) ?? this.targets[i])
          : this.autoArm(j.name) ? (this.locomotion?.armTargets[j.name] ?? 0) : this.autoTrunk(j.name) ? (this.locomotion?.bodyTargets[j.name] ?? 0) : this.targets[i],
      actual: this.engine.data.qpos[j.q],
      velocity: this.engine.data.qvel[j.v],
      control: this.engine.data.ctrl[j.actuator],
      force: this.engine.data.qfrc_actuator[j.v],
    }));
  }
}
