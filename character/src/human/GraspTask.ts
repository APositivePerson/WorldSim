import type { MuJoCoEngine } from "../physics/MuJoCoEngine";
import { fingerNames, handPose, type FingerName } from "./Anatomy";
import type { ReachTask } from "./ReachTask";
type Stage = "idle" | "prepare" | "approach" | "align" | "close" | "lift" | "holding" | "lower" | "open" | "retreat" | "done" | "failed";
const frame = { normal: [1, 0, 0] as [number, number, number], direction: [0, -1, 0] as [number, number, number] };
/** Contact-driven grasp. Active manipulation writes only human actuator references. */
export class GraspTask {
    stage: Stage = "idle";
    error = "";
    private time = 0;
    private stable = 0;
    private preparationRotation = 0;
    private startHeight = 0;
    private cup: number;
    private table: number;
    private force;
    private readonly originalNoSlip: number;
    private grip: [number, number, number] = [0, 0, 0];
    private palmOffset = 0.020;
    private forwardOffset = 0.035;
    private home: [number, number, number] = [0, 0, 0];
    private curls = Object.fromEntries(fingerNames.map(f => [f, 0])) as Record<FingerName, number>;
    private stopped = new Set<FingerName>();
    private lost = Object.fromEntries(fingerNames.map(f => [f, 0])) as Record<FingerName, number>;
    private forces = Object.fromEntries(fingerNames.map(f => [f, 0])) as Record<FingerName, number>;
    private support = 0;
    private maxPenetration = 0;
    constructor(readonly engine: MuJoCoEngine, readonly reach: ReachTask) {
        this.originalNoSlip = engine.model.opt.noslip_iterations;
        this.cup = engine.mj.mj_name2id(engine.model, 1, "prop_cup");
        this.table = engine.mj.mj_name2id(engine.model, 5, "cup_table");
        this.force = new engine.mj.DoubleBuffer(6);
    }
    get active() { return !["idle", "done", "failed"].includes(this.stage); }
    owns(name: string) { return this.active && (/^(right_)/.test(name) || ["spine_flex", "chest_flex", "neck_pitch"].includes(name)); }
    private position() { return Array.from(this.engine.data.xpos.slice(this.cup * 3, this.cup * 3 + 3)) as [number, number, number]; }
    private enter(stage: Stage) {
        this.stage = stage;
        this.time = 0;
        this.stable = 0;
        if (stage === "holding") {
            this.engine.model.opt.noslip_iterations = Math.max(3, this.originalNoSlip);
        }
        if (stage === "done" || stage === "failed") {
            this.engine.model.opt.noslip_iterations = this.originalNoSlip;
        }
        if (stage === "open" || stage === "done") this.stopped.clear();
    }
    private move(target: [number, number, number], duration: number) {
        if (!this.reach.begin("right", duration, target, frame)) {
            this.fail("杯子超出当前手臂可达范围");
            return false;
        }
        return true;
    }
    placementBounds() {
        const { model: m, data: d } = this.engine;
        // Leave room for the complete cup footprint and a small edge margin.
        const wall = this.engine.mj.mj_name2id(m, 5, "cup_bottom");
        const margin = m.geom_size[wall * 3] + 0.005;
        return [0, 1].map(i => ({
            min: d.geom_xpos[this.table * 3 + i] - m.geom_size[this.table * 3 + i] + margin,
            max: d.geom_xpos[this.table * 3 + i] + m.geom_size[this.table * 3 + i] - margin,
        }));
    }
    /** Scene editing only. The running grasp never writes the cup's coordinates. */
    placeCup(x: number, y: number) {
        if (this.active) return false;
        const bounds = this.placementBounds();
        if (![x, y].every((v, i) => Number.isFinite(v) && v >= bounds[i].min && v <= bounds[i].max)) {
            this.error = "请将杯子放在台面范围内";
            return false;
        }
        const { model: m, data: d, mj } = this.engine;
        const joint = m.body_jntadr[this.cup], q = m.jnt_qposadr[joint], v = m.jnt_dofadr[joint];
        const bottom = mj.mj_name2id(m, 5, "cup_bottom");
        const z = d.geom_xpos[this.table * 3 + 2] + m.geom_size[this.table * 3 + 2]
            - m.geom_pos[bottom * 3 + 2] + m.geom_size[bottom * 3 + 1];
        d.qpos.set([x, y, z, 1, 0, 0, 0], q);
        d.qvel.fill(0, v, v + 6);
        mj.mj_forward(m, d);
        this.reset();
        this.contacts();
        return true;
    }
    private approach(p: number[]): [number, number, number] {
        return [p[0] - 0.08, p[1] + 0.14, p[2] + 0.13];
    }
    private gripAt(p: number[]): [number, number, number] {
        return [p[0] - this.palmOffset, p[1] + this.forwardOffset, p[2]];
    }
    availability() {
        const p = this.position(), grip = this.gripAt(p);
        if (![this.approach(p), grip, [grip[0], grip[1], grip[2] + 0.10]]
            .every(target => this.reach.canReach("right", target))) return "杯子超出当前手臂可达范围，请移近一些";
        const zAxis = this.engine.data.xmat[this.cup * 9 + 8];
        if (zAxis < 0.96) return "请先重置或重新摆放杯子，使杯子直立";
        const { model: m, data: d } = this.engine;
        const bottom = this.engine.mj.mj_name2id(m, 5, "cup_bottom");
        const expected = d.geom_xpos[this.table * 3 + 2] + m.geom_size[this.table * 3 + 2]
            - m.geom_pos[bottom * 3 + 2] + m.geom_size[bottom * 3 + 1];
        const bounds = this.placementBounds();
        if (Math.abs(p[2] - expected) > 0.015 || bounds.some((b, i) => p[i] < b.min - 0.002 || p[i] > b.max + 0.002))
            return "请先将杯子摆放到台面上";
        return "";
    }
    begin() {
        if (this.active)
            return false;
        const unavailable = this.availability();
        if (unavailable) { this.error = unavailable; return false; }
        this.error = "";
        this.engine.model.opt.noslip_iterations = this.originalNoSlip;
        this.stopped.clear();
        for (const f of fingerNames) {
            this.curls[f] = 0;
            this.lost[f] = 0;
        }
        const p = this.position();
        this.home = [...p];
        this.startHeight = p[2];
        this.grip = this.gripAt(p);
        // Unwind the resting forearm before solving the complete grip frame.
        // A twisted starting wrist can select an unsuitable IK branch.
        const joint = this.engine.joints.find(j => j.name === "right_forearm_rotation")!;
        this.preparationRotation = this.engine.data.qpos[joint.q];
        this.reach.cancel();
        this.enter("prepare");
        return true;
    }
    putDown() {
        if (this.stage !== "holding")
            return false;
        const palm = this.reach.palmPosition(), cup = this.position();
        this.enter("lower");
        return this.move(palm.map((v, i) => v + this.home[i] - cup[i]) as [number, number, number], 2.5);
    }
    private fail(message: string) { this.error = message; this.enter("failed"); this.reach.cancel(); }
    private contacts() {
        const { data: d, model: m, mj } = this.engine;
        this.support = 0;
        this.maxPenetration = 0;
        for (const f of fingerNames)
            this.forces[f] = 0;
        // Both the vector and its elements are owned WASM copies.
        const contacts = d.contact;
        try {
            for (let i = 0; i < d.ncon; i++) {
                const ct = contacts.get(i)!;
                try {
                    const a = m.geom_bodyid[ct.geom1], b = m.geom_bodyid[ct.geom2];
                    if (a !== this.cup && b !== this.cup)
                        continue;
                    mj.mj_contactForce(m, d, i, this.force);
                    const normal = Math.max(0, this.force.GetView()[0]);
                    if (ct.geom1 === this.table || ct.geom2 === this.table)
                        this.support += normal;
                    const name = mj.mj_id2name(m, 1, a === this.cup ? b : a);
                    const finger = fingerNames.find(f => name.startsWith(`right_${f}_`));
                    if (finger) {
                        this.forces[finger] += normal;
                        this.maxPenetration = Math.max(this.maxPenetration, -ct.dist);
                    }
                }
                finally {
                    ct.delete();
                }
            }
        }
        finally {
            contacts.delete();
        }
    }
    update(dt: number): Record<string, number> {
        this.contacts();
        if (!this.active)
            return {};
        this.time += dt;
        if (this.stage === "prepare") {
            const t = Math.min(1, this.time / .8), s = t * t * (3 - 2 * t);
            const joint = this.engine.joints.find(j => j.name === "right_forearm_rotation")!;
            if (this.time >= 1 && Math.abs(this.engine.data.qpos[joint.q]) < .08) {
                this.enter("approach");
                this.move(this.approach(this.position()), 2.5);
            } else if (this.time > 3) this.fail("手腕准备姿态未能稳定，请重置后重试");
            return { ...handPose("right", 0), right_forearm_rotation: this.preparationRotation * (1 - s) };
        }
        if (["close", "lift"].includes(this.stage)) {
            for (const f of fingerNames) {
                if (this.forces[f] > 2.5) {
                    this.stopped.add(f);
                    this.lost[f] = 0;
                }
                else {
                    this.lost[f] += dt;
                    if (this.lost[f] > 0.12)
                        this.stopped.delete(f);
                }
                if (!this.stopped.has(f))
                    this.curls[f] = Math.min(1, this.curls[f] + dt * (this.forces[f] > 0.08 ? 0.06 : (f === "thumb" ? 0.45 : 0.28)));
            }
        }
        const touch = fingerNames.filter(f => this.forces[f] > 1.0);
        const grasped = touch.includes("thumb") && touch.filter(f => f !== "thumb").length >= 2;
        if (this.stage === "approach" && this.time > 2.5 && this.reach.error < 0.025) {
            // Re-sample after approach: gravity/contact may have settled the cup.
            const p = this.position();
            this.home = [...p];
            this.startHeight = p[2];
            this.grip = this.gripAt(p);
            this.enter("align");
            this.move(this.grip, 2.5);
        }
        else if (this.stage === "align" && this.time > 2.5 && this.reach.error < 0.012) {
            this.enter("close");
        }
        else if (this.stage === "close") {
            this.stable = grasped ? this.stable + dt : 0;
            if (this.stable > 0.3) {
                this.enter("lift");
                this.move([this.grip[0], this.grip[1], this.grip[2] + 0.10], 3);
            }
            else if (this.time > 7)
                this.fail("未形成拇指与至少两指的稳定接触，请重置后重试");
        }
        else if (this.stage === "lift") {
            const lifted = this.position()[2] - this.startHeight;
            this.stable = lifted > 0.06 && this.support < 0.05 && grasped ? this.stable + dt : 0;
            if (this.time > 3 && this.stable > 0.8) {
                this.enter("holding");
                for (const f of touch)
                    this.stopped.add(f);
            }
            else if (this.time > 6)
                this.fail("杯子未稳定离台，可能发生滑落");
        }
        else if (this.stage === "holding") {
            if (this.position()[2] < this.startHeight + 0.025)
                this.fail("杯子滑落，请重置后重试");
        }
        else if (this.stage === "lower") {
            this.stable = this.support > 0.2 ? this.stable + dt : 0;
            if (this.time > 2.5 && this.stable > 0.4) {
                this.enter("open");
                const p = this.reach.palmPosition();
                this.move([p[0] - 0.045, p[1] + 0.02, p[2] + 0.015], 1.5);
            }
            else if (this.time > 6)
                this.fail("杯子未落到支撑台，停止松手");
        }
        else if (this.stage === "open") {
            for (const f of fingerNames)
                if (f === "thumb" || this.time > 0.25)
                    this.curls[f] = Math.max(0, this.curls[f] - dt * (f === "thumb" ? 0.9 : 0.7));
            if (this.time > 1.8) {
                this.enter("retreat");
                this.move(this.approach(this.home), 2);
            }
        }
        else if (this.stage === "retreat" && this.time > 2.5) {
            if (this.support > 0.5 && Math.abs(this.position()[2] - this.home[2]) < 0.01)
                this.enter("done");
            else
                this.fail("松手后杯子未稳定留在台面，请重置后重试");
        }
        if ((this.stage === "approach" || this.stage === "align") && this.time > 7)
            this.fail("接近杯子超时，手臂受到碰撞或关节限位阻挡");
        return Object.assign({}, ...fingerNames.map(f => handPose("right", this.curls[f], f)));
    }
    snapshot() {
        const p = this.position();
        return { stage: this.stage, error: this.error, cupPosition: p, placementBounds: this.placementBounds(), unavailable: this.active ? "" : this.availability(), liftHeight: this.stage === "idle" ? 0 : p[2] - this.startHeight, supportForce: this.support, maxPenetration: this.maxPenetration,
            fingers: fingerNames.map(name => ({ name, curl: this.curls[name], contactForce: this.forces[name], stopped: this.stopped.has(name) })) };
    }
    reset() {
        this.engine.model.opt.noslip_iterations = this.originalNoSlip;
        this.stage = "idle";
        this.error = "";
        this.stopped.clear();
        this.support = 0;
        this.maxPenetration = 0;
        for (const f of fingerNames) {
            this.curls[f] = 0;
            this.lost[f] = 0;
            this.forces[f] = 0;
        }
        this.reach.cancel();
    }
    dispose() { this.force.delete(); }
}
