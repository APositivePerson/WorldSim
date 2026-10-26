import { WalkingCerebellum } from "./WalkingCerebellum";
export type CerebellumMode = "baseline" | "learn" | "frozen";
const clamp = (x: number, limit: number) => Math.max(-limit, Math.min(limit, x));
const binWidth = .05;
const duration = 4;
const bins = Math.round(duration / binWidth);

/** Cued, trial-based adaptive feedforward control, not a neural tissue simulation.
 * Receives body observations and copies of issued commands, never perturbation forces.
 */
export class Cerebellum {
  readonly walking = new WalkingCerebellum();
  private memory = new Float64Array(bins);
  private errors = new Float64Array(bins);
  private counts = new Uint32Array(bins);
  private weights = new Float64Array(5);
  private pending: { time: number; velocity: number; features: number[]; prediction: number } | null = null;
  private start = -1;
  private origin = 0;
  private mode: CerebellumMode = "baseline";
  private correction = 0;
  private sumSquared = 0;
  private samples = 0;
  private peak = 0;
  private predictionError = 0;
  private predictionSamples = 0;
  private command = 0;
  private power = 0;
  private work = 0;
  private peakTilt = 0;
  private lastUnsettled = .9;
  private recoveryStart = .9;
  private modelUpdates = 0;
  private lastTime = 0;
  private results: { mode: CerebellumMode; rms: number; peak: number; peakTilt: number; work: number; recovery: number }[] = [];
  private reason = "";

  get active() { return this.start >= 0; }
  begin(time: number, origin: number, mode: CerebellumMode, recoveryStart = .9) {
    if (this.active || !Number.isFinite(time) || !Number.isFinite(origin)
      || !["baseline", "learn", "frozen"].includes(mode)) return false;
    this.start = time; this.origin = origin; this.mode = mode;
    this.lastTime = time;
    this.errors.fill(0); this.counts.fill(0); this.pending = null;
    this.correction = 0; this.sumSquared = 0; this.samples = 0; this.peak = 0; this.reason = "";
    this.work = 0; this.peakTilt = 0; this.recoveryStart = recoveryStart; this.lastUnsettled = recoveryStart;
    return true;
  }
  /** Called after actuator limiting. A normalized copy of lateral ankle commands. */
  recordCommand(value: number, power = 0, time?: number) {
    this.command = Number.isFinite(value) ? clamp(value, 1) : 0;
    this.power = Number.isFinite(power) ? Math.max(0, power) : 0;
    if (this.pending && this.pending.time === time) {
      this.pending.prediction += this.weights[4] * (this.command - this.pending.features[4]);
      this.pending.features[4] = this.command;
    }
  }

  update(time: number, x: number, velocity: number, safe: boolean, tilt = 0) {
    if (!this.active) return 0;
    if (!safe || ![time, x, velocity].every(Number.isFinite) || time < this.start) {
      this.cancel("接触或姿态异常，已取消本轮"); return 0;
    }
    const elapsed = time - this.start;
    if (elapsed >= duration) { this.finish(); return 0; }
    const index = Math.min(bins - 1, Math.floor(elapsed / binWidth));
    const error = x - this.origin;
    this.errors[index] += error; this.counts[index]++;
    this.sumSquared += error * error; this.samples++; this.peak = Math.max(this.peak, Math.abs(error));
    const dt = Math.max(0, time - this.lastTime);
    this.work += this.power * dt; this.peakTilt = Math.max(this.peakTilt, Math.abs(tilt));
    if (elapsed >= this.recoveryStart && (Math.abs(error) > .0005 || Math.abs(velocity) > .005)) this.lastUnsettled = elapsed;

    // Smooth interpolation and boundary taper keep each cued trial continuous.
    const phase = elapsed / binWidth - index;
    const desired = this.mode === "baseline" ? 0
      : (this.memory[index] * (1 - phase) + this.memory[Math.min(bins - 1, index + 1)] * phase)
        * Math.min(1, elapsed / .2, (duration - elapsed) / .4);
    this.correction += clamp(desired - this.correction, .025 * dt);
    this.lastTime = time;

    // A separate 20 ms forward velocity model. Targets use the actual elapsed
    // interval, and features include the command issued during that interval.
    const previous = this.pending;
    if (!previous || time - previous.time >= .02 - 1e-8) {
      if (previous) {
        const step = time - previous.time;
        if (step < .04) {
          const observed = (velocity - previous.velocity) / step;
          const residual = clamp(observed - previous.prediction, 2);
          this.predictionError += .05 * (Math.abs(residual * step) - this.predictionError);
          this.predictionSamples++;
          if (this.mode === "learn") {
            this.modelUpdates++;
            const norm = .1 + previous.features.reduce((sum, v) => sum + v * v, 0);
            this.weights.forEach((w, i) => { this.weights[i] = clamp(w + .08 * residual * previous.features[i] / norm, 5); });
          }
        }
      }
      const features = [1, error * 100, velocity * 10, this.correction * 100, this.command];
      const prediction = 30 * (this.correction - error) - 10 * velocity
        + features.reduce((sum, v, i) => sum + v * this.weights[i], 0);
      this.pending = { time, velocity, features, prediction };
    }
    return this.correction;
  }
  private finish() {
    if (this.mode === "learn") {
      const next = this.memory.slice();
      // Approximate the reference-to-body response delay with a 150 ms lead.
      // This learns a contextual feedforward policy independently of the observer.
      for (let i = 0; i < bins - 3; i++) {
        const j = i + 3;
        if (this.counts[j]) next[i] = clamp(this.memory[i] - .6 * this.errors[j] / this.counts[j], .012);
      }
      for (let i = 1; i < bins - 1; i++) this.memory[i] = .25 * next[i - 1] + .5 * next[i] + .25 * next[i + 1];
    }
    this.results.push({ mode: this.mode, rms: Math.sqrt(this.sumSquared / Math.max(1, this.samples)), peak: this.peak,
      peakTilt: this.peakTilt, work: this.work, recovery: Math.max(0, this.lastUnsettled - this.recoveryStart) });
    if (this.results.length > 64) this.results.shift();
    this.start = -1; this.correction = 0; this.pending = null;
  }
  cancel(reason = "已停止") { this.start = -1; this.correction = 0; this.pending = null; this.reason = reason; }
  reset() {
    this.walking.reset();
    this.cancel(""); this.memory.fill(0); this.weights.fill(0); this.command = 0;
    this.results = []; this.predictionError = 0; this.predictionSamples = 0; this.modelUpdates = 0; this.power = 0;
  }
  snapshot() {
    return { active: this.active, mode: this.mode, correction: this.correction, reason: this.reason,
      walking: this.walking.snapshot(),
      predictionError: this.predictionError, predictionSamples: this.predictionSamples,
      modelUpdates: this.modelUpdates,
      learnedPeak: Math.max(...Array.from(this.memory, Math.abs)),
      trials: this.results.map(result => ({ ...result })) };
  }
}
