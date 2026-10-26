import type { MuJoCoEngine, Joint } from "../physics/MuJoCoEngine";
// Scratch MjData is only a kinematic solver. It never replaces the live physics state.
export class LegIK {
  private data;
  private legs: { body: number; joints: Joint[] }[];
  constructor(readonly engine: MuJoCoEngine) {
    this.data = new engine.mj.MjData(engine.model);
    this.legs = ["left", "right"].map((side) => ({
      body: engine.mj.mj_name2id(engine.model, 1, side + "_foot"),
      joints: [
        "hip_yaw",
        "hip",
        "hip_abduction",
        "knee",
        "ankle",
        "ankle_roll",
      ].map((n) => engine.joints.find((j) => j.name === side + "_" + n)!),
    }));
  }
  solve(
    root: { x: number; y: number; z?: number },
    feet: { x: number; y: number; z: number; pitch?: number }[],
    seed: Record<string, number>,
  ) {
    const { model, mj } = this.engine,
      d = this.data;
    d.qpos.set(model.qpos0);
    d.qpos[0] = root.x;
    d.qpos[1] = root.y;
    d.qpos[2] = root.z ?? 0.925;
    const result = { ...seed };
    const read = (body: number) => {
      mj.mj_kinematics(model, d);
      const m = d.xmat,
        k = body * 9,
        p = d.xpos,
        b = body * 3;
      return [
        p[b],
        p[b + 1],
        p[b + 2],
        0.5 * (m[k + 7] - m[k + 5]),
        0.5 * (m[k + 2] - m[k + 6]),
        0.5 * (m[k + 3] - m[k + 1]),
      ];
    };
    this.legs.forEach(({ body, joints }, leg) => {
      joints.forEach(
        (j) =>
          (d.qpos[j.q] =
            seed[j.name] ??
            (j.name.endsWith("_knee")
              ? 0.6
              : j.name.endsWith("_hip") || j.name.endsWith("_ankle")
                ? -0.3
                : 0)),
      );
      const target = [feet[leg].x, feet[leg].y, feet[leg].z, Math.sin(feet[leg].pitch ?? 0), 0, 0];
      for (let iter = 0; iter < 7; iter++) {
        const base = read(body),
          error = target.map((v, i) => v - base[i]);
        if (Math.hypot(...error) < 1e-6) break;
        const J = Array.from({ length: 6 }, () => Array(6).fill(0));
        joints.forEach((j, c) => {
          d.qpos[j.q] += 1e-5;
          const v = read(body);
          d.qpos[j.q] -= 1e-5;
          for (let r = 0; r < 6; r++) J[r][c] = (v[r] - base[r]) / 1e-5;
        });
        // Damped normal equations, avoiding singular straight-leg configurations.
        const A = Array.from({ length: 6 }, (_, r) =>
          Array.from({ length: 6 }, (_, c) =>
            J.reduce((s, row) => s + row[r] * row[c], r === c ? 1e-5 : 0),
          ),
        );
        const b = Array.from({ length: 6 }, (_, c) =>
          J.reduce((s, row, r) => s + row[c] * error[r], 0),
        );
        const delta = solve(A, b);
        joints.forEach(
          (j, i) =>
            (d.qpos[j.q] = Math.max(
              j.min,
              Math.min(
                j.max,
                d.qpos[j.q] + Math.max(-0.15, Math.min(0.15, delta[i])),
              ),
            )),
        );
      }
      joints.forEach((j) => (result[j.name] = d.qpos[j.q]));
    });
    return result;
  }
  dispose() {
    this.data.delete();
  }
}
function solve(a: number[][], b: number[]) {
  for (let c = 0; c < b.length; c++) {
    let p = c;
    for (let r = c + 1; r < b.length; r++)
      if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    [b[c], b[p]] = [b[p], b[c]];
    const v = a[c][c];
    if (Math.abs(v) < 1e-12) return b.map(() => 0);
    for (let k = c; k < b.length; k++) a[c][k] /= v;
    b[c] /= v;
    for (let r = 0; r < b.length; r++)
      if (r !== c) {
        const f = a[r][c];
        for (let k = c; k < b.length; k++) a[r][k] -= f * a[c][k];
        b[r] -= f * b[c];
      }
  }
  return b;
}
