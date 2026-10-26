import type { MuJoCoEngine } from "./MuJoCoEngine";
import type { HumanController } from "../human/HumanController";
export class SimulationLoop {
  paused = false;
  speed = 1;
  dropped = 0;
  private accumulator = 0;
  constructor(
    readonly engine: MuJoCoEngine,
    readonly controller: HumanController,
  ) {}
  advance(realSeconds: number) {
    if (this.paused) {
      this.accumulator = 0;
      return;
    }
    const incoming = Math.max(0, realSeconds) * this.speed;
    this.dropped += Math.max(0, incoming - 0.1);
    this.accumulator += Math.min(incoming, 0.1);
    while (this.accumulator >= this.engine.dt) {
      this.controller.update(this.engine.dt);
      this.engine.step();
      this.accumulator -= this.engine.dt;
    }
  }
  reset() {
    this.accumulator = 0;
    this.dropped = 0;
    this.controller.reset();
  }
}
