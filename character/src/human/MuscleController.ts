import type { MuJoCoEngine, Joint } from "../physics/MuJoCoEngine";
import type { Side } from "./Anatomy";
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
interface Fiber {
  name: string; side: Side; kind: "biceps" | "triceps"; actuator: number; tendon: number; act: number;
  force: number; fatigue: number; capacity: number; gain: number[]; bias: number[]; range: number[];
}
export class MuscleController {
  enabled = false;
  fatigueEnabled = true;
  private fibers: Fiber[] = [];
  private motors: { joint: Joint; gain: number; bias1: number; bias2: number }[] = [];
  private integral = [0, 0];
  private manual = new Map<Side, [number, number]>();
  constructor(readonly engine: MuJoCoEngine) {
    const { model: m, mj } = engine;
    for (const side of ["left", "right"] as Side[]) {
      const joint = engine.joints.find((j) => j.name === `${side}_elbow`);
      if (!joint) continue;
      this.motors.push({ joint, gain: m.actuator_gainprm[joint.actuator * 10],
        bias1: m.actuator_biasprm[joint.actuator * 10 + 1], bias2: m.actuator_biasprm[joint.actuator * 10 + 2] });
      for (const kind of ["biceps", "triceps"] as const) {
        const name = `bio_${side}_${kind}`, a = mj.mj_name2id(m, 19, name);
        if (a < 0) continue;
        this.fibers.push({ name, side, kind, actuator: a, tendon: m.actuator_trnid[a * 2], act: m.actuator_actadr[a],
          force: m.actuator_gainprm[a * 10 + 2], fatigue: 0, capacity: 1,
          gain: Array.from(m.actuator_gainprm.slice(a * 10, a * 10 + 10)) as number[],
          bias: Array.from(m.actuator_biasprm.slice(a * 10, a * 10 + 10)) as number[],
          range: Array.from(m.actuator_lengthrange.slice(a * 2, a * 2 + 2)) as number[] });
      }
    }
    this.setEnabled(false);
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled && this.fibers.length === 4;
    this.integral.fill(0); this.manual.clear();
    const { model: m, data: d } = this.engine;
    for (const motor of this.motors) {
      const a = motor.joint.actuator;
      m.actuator_gainprm[a * 10] = this.enabled ? 0 : motor.gain;
      m.actuator_biasprm[a * 10 + 1] = this.enabled ? 0 : motor.bias1;
      m.actuator_biasprm[a * 10 + 2] = this.enabled ? 0 : motor.bias2;
    }
    for (const f of this.fibers) {
      m.actuator_gainprm[f.actuator * 10 + 2] = this.enabled ? f.force * f.capacity : 0;
      m.actuator_biasprm[f.actuator * 10 + 2] = this.enabled ? f.force : 0;
      m.tendon_stiffness[f.tendon] = this.enabled ? 70 : 0;
      m.tendon_damping[f.tendon] = this.enabled ? 1.5 : 0;
      d.ctrl[f.actuator] = 0;
      if (f.act >= 0) d.act[f.act] = 0;
    }
    this.engine.mj.mj_forward(m, d);
  }
  owns(name: string) { return this.enabled && /^(left|right)_elbow$/.test(name); }
  isManual(name: string) { return this.enabled && this.manual.has(name.split("_")[0] as Side) && name.endsWith("_elbow"); }
  setExcitation(side: Side, flex: number | null, extend = 0) {
    if (flex === null) { this.manual.delete(side); return; }
    if (this.enabled && Number.isFinite(flex) && Number.isFinite(extend))
      this.manual.set(side, [clamp(flex, 0, 1), clamp(extend, 0, 1)]);
  }
  update(dt: number, references: Record<string, number>) {
    if (!this.enabled) return;
    const { model: m, data: d, mj } = this.engine;
    const capacities = new Map<number, number>();
    for (const f of this.fibers) {
      const activation = clamp(d.act[f.act], 0, 1);
      if (this.fatigueEnabled)
        f.fatigue = clamp(f.fatigue + dt * (0.12 * activation * (1 - f.fatigue) - 0.035 * (1 - activation) * f.fatigue), 0, 1);
      else f.fatigue = 0;
      f.capacity = 1 - 0.7 * f.fatigue;
      f.gain[2] = f.force * f.capacity;
      m.actuator_gainprm[f.actuator * 10 + 2] = f.gain[2];
      const gain = mj.mju_muscleGain(d.actuator_length[f.actuator], d.actuator_velocity[f.actuator], f.range, m.actuator_acc0[f.actuator], f.gain);
      capacities.set(f.actuator, gain * (f.kind === "biceps" ? -0.03 : 0.03));
    }
    this.motors.forEach(({ joint: j }, sideIndex) => {
      const side = j.name.split("_")[0] as Side;
      const pair = this.fibers.filter((f) => f.side === side);
      const flex = pair.find((f) => f.kind === "biceps")!, ext = pair.find((f) => f.kind === "triceps")!;
      const q = d.qpos[j.q], velocity = d.qvel[j.v];
      const error = (references[j.name] ?? q) - q;
      this.integral[sideIndex] = clamp(this.integral[sideIndex] + error * dt, -0.5, 0.5);
      // Tendon passive forces are real MuJoCo forces; subtract them in the servo.
      let passive = 0;
      for (const f of pair) {
        const moment = f.kind === "biceps" ? -0.03 : 0.03;
        passive += moment * mj.mju_muscleBias(d.actuator_length[f.actuator], f.range, m.actuator_acc0[f.actuator], f.bias);
        passive += -moment * (70 * (d.ten_length[f.tendon] - (f.kind === "biceps" ? -0.036 : 0.036)) + 1.5 * d.ten_velocity[f.tendon]);
      }
      const tau = 35 * error - 4.5 * velocity + 6 * this.integral[sideIndex] + d.qfrc_bias[j.v] - passive;
      const cf = Math.max(0.05, capacities.get(flex.actuator)!), ce = Math.max(0.05, -capacities.get(ext.actuator)!);
      const base = 0.015, residual = tau - base * (cf - ce);
      const excitation = this.manual.get(side) ?? [clamp(base + Math.max(0, residual) / cf, 0, 1), clamp(base + Math.max(0, -residual) / ce, 0, 1)];
      d.ctrl[flex.actuator] = excitation[0]; d.ctrl[ext.actuator] = excitation[1]; d.ctrl[j.actuator] = 0;
    });
  }
  reset() {
    for (const f of this.fibers) { f.fatigue = 0; f.capacity = 1; }
    this.setEnabled(this.enabled);
  }
  snapshot() {
    const { model: m, data: d } = this.engine;
    return { enabled: this.enabled, fatigueEnabled: this.fatigueEnabled, muscles: this.fibers.map((f) => ({
      name: f.name, side: f.side, kind: f.kind, excitation: d.ctrl[f.actuator], activation: d.act[f.act],
      force: -d.actuator_force[f.actuator], fatigue: f.fatigue, capacity: f.capacity,
      tendonLength: d.ten_length[f.tendon], tendonVelocity: d.ten_velocity[f.tendon],
      motorForce: d.actuator_force[this.motors.find((motor) => motor.joint.name.startsWith(f.side))!.joint.actuator],
    })) };
  }
}
