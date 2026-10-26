import type { MuJoCoEngine } from "./MuJoCoEngine";
import type { LocomotionController } from "../human/LocomotionController";
import type { CerebellumMode } from "../human/Cerebellum";
export type CerebellumProfile = "standard" | "visible";
const profiles = { standard: { force: 35, end: .9 }, visible: { force: 100, end: 1.05 } };
type TracePoint = { time: number; displacement: number; correction: number };

/** Explicitly requested experimental disturbance; never used as balance support. */
export class CerebellumExperiment {
  private remaining = 0;
  private start = 0;
  private mode: CerebellumMode = "baseline";
  private applied = 0;
  private profile: CerebellumProfile = "visible";
  private total = 0;
  private origin = 0;
  private trace: TracePoint[] = [];
  private baselineTrace: TracePoint[] = [];
  private lastSample = -1;
  private completed = false;
  private readonly forceIndex: number;
  constructor(private engine: MuJoCoEngine, private locomotion: LocomotionController) {
    this.forceIndex = engine.mj.mj_name2id(engine.model, 1, "pelvis") * 6;
  }
  get active() { return this.remaining > 0; }
  get appliedForce() { return this.applied; }
  setProfile(profile: CerebellumProfile) {
    if (this.active || !Object.hasOwn(profiles, profile)) return false;
    if (this.profile !== profile) { this.profile = profile; this.clear(); }
    return true;
  }
  clear() {
    if (this.active) return false;
    this.locomotion.cerebellum.reset(); this.trace = []; this.baselineTrace = []; this.total = 0; this.completed = false;
    return true;
  }
  begin(mode: CerebellumMode, rounds = 8) {
    if (this.active || this.locomotion.cerebellum.active || !this.locomotion.settled || !this.locomotion.cerebellumSafe
      || !["baseline", "learn", "frozen"].includes(mode)
      || !Number.isInteger(rounds) || rounds < 1 || rounds > 16) return false;
    this.mode = mode; this.remaining = rounds; this.total = rounds; this.completed = false;
    this.beginRound(); return true;
  }
  private beginRound() {
    this.start = this.engine.data.time;
    const feet = this.locomotion.sensors.feet;
    this.origin = (feet[0].x + feet[1].x) / 2;
    this.trace = []; this.lastSample = -1;
    this.locomotion.cerebellum.begin(this.start, this.origin, this.mode, profiles[this.profile].end);
  }
  update() {
    this.removeForce();
    if (!this.active) return;
    if (this.locomotion.mode !== "stand" || !this.locomotion.cerebellum.active) {
      this.stop(this.locomotion.cerebellum.snapshot().reason || "实验已取消"); return;
    }
    const elapsed = this.engine.data.time - this.start;
    if (elapsed >= 4) {
      // Complete the learner before starting another explicitly cued repetition.
      const d = this.engine.data;
      this.locomotion.cerebellum.update(d.time, d.qpos[0], d.qvel[0], this.locomotion.cerebellumSafe);
      if (this.locomotion.cerebellum.snapshot().reason) { this.stop("接触或姿态异常，已取消本轮"); return; }
      if (this.mode === "baseline") this.baselineTrace = this.trace.slice();
      this.remaining--;
      if (!this.active) { this.completed = true; return; }
      this.beginRound();
    }
    const t = this.engine.data.time - this.start;
    if (t - this.lastSample >= .02 - 1e-8) {
      this.trace.push({ time: t, displacement: this.engine.data.qpos[0] - this.origin,
        correction: this.locomotion.cerebellum.snapshot().correction });
      this.lastSample = t;
    }
    // The learner receives the trial cue, not this schedule or force magnitude.
    if (t >= .8 - 1e-8 && t < profiles[this.profile].end - 1e-8) {
      this.applied = profiles[this.profile].force;
      this.engine.data.xfrc_applied[this.forceIndex] += this.applied;
    }
  }
  private removeForce() {
    if (this.applied) this.engine.data.xfrc_applied[this.forceIndex] -= this.applied;
    this.applied = 0;
  }
  stop(reason = "已停止") { this.removeForce(); this.remaining = 0; this.completed = false; this.locomotion.cerebellum.cancel(reason); }
  snapshot() {
    const elapsed = this.active ? Math.max(0, this.engine.data.time - this.start) : this.trace.at(-1)?.time ?? 0;
    const stage = !this.active ? this.completed ? "本组已完成" : this.total ? "已停止" : "未运行" : elapsed < .8 ? "准备侧推"
      : elapsed < profiles[this.profile].end ? "正在向右侧推" : elapsed < 3.8 ? "恢复平衡" : this.mode === "learn" ? "本轮结束后更新补偿" : "记录本轮结果";
    return { active: this.active, completed: this.completed, remaining: this.remaining, mode: this.mode, profile: this.profile,
      round: Math.min(this.total, this.total - this.remaining + 1), total: this.total,
      elapsed: Math.min(4, elapsed), stage, force: this.applied,
      displacement: this.total ? this.engine.data.qpos[0] - this.origin : 0,
      trace: this.trace.map(point => ({ ...point })), baselineTrace: this.baselineTrace.map(point => ({ ...point })) };
  }
}
