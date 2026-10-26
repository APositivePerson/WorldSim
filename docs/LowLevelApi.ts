/**
 * 人物控制接口 v1 实现规范。规范已制定，运行时代码待实现和验收。
 * 说明见 docs/小脑接口.md；第一版全身串行，通道仅标记主要部位。
 *
 * 约定：长度米、角度弧度、z 轴朝上；yaw = 0 面朝 −Y，从上往下看逆时针为正；时间一律为仿真时间（秒）。
 * 底层实现 LowLevelApi，小脑只通过它控制人物，不直接读写 qpos / ctrl。
 */

export const LOW_LEVEL_API_VERSION = '1.0';

export type Vec3 = [x: number, y: number, z: number];
export type Hand = 'left' | 'right';
export type Channel = 'legs' | 'arms' | 'head';

// ---------------- 技能 ----------------

/** 走到一个位姿。路径由小脑拆成多段，每段一个 step_to。 */
export interface StepTo {
  skill: 'step_to';
  x: number;
  y: number;
  yaw: number;
  /** 容差，不传用 capabilities 里的默认值 */
  tolerance?: {position?: number; yaw?: number};
  timeout?: number;
}

/** 原地转身。 */
export interface TurnTo {
  skill: 'turn_to';
  yaw: number;
  tolerance?: {yaw?: number};
  timeout?: number;
}

/** 停下并站稳（完成当前这一步后双脚支撑）。 */
export interface StandStill {
  skill: 'stand_still';
  timeout?: number;
}

export type GestureName = 'wave' | 'nod' | 'shake_head' | 'raise_hand';

/** 固定动作。wave / raise_hand 占用 arms，nod / shake_head 占用 head。 */
export interface Gesture {
  skill: 'gesture';
  name: GestureName;
  /** 用哪只手，只对 wave / raise_hand 有效，默认 right */
  hand?: Hand;
  /** 做完后保持多少秒再回到起始姿态，默认 0 */
  hold?: number;
  timeout?: number;
}

/** 头（和眼睛）朝向一个三维点。 */
export interface LookAt {
  skill: 'look_at';
  point: Vec3;
  timeout?: number;
}

/** 上身回到自然站姿。 */
export interface RestPose {
  skill: 'rest_pose';
  timeout?: number;
}

/** 必须：手掌伸到某点并停住；完成不代表物体已抓取或交付。 */
export interface Reach {
  skill: 'reach';
  hand: Hand;
  point: Vec3;
  /** 到达后保持多少秒，默认 1 */
  hold?: number;
  timeout?: number;
}

/** P2：坐下 / 站起。 */
export interface Sit {
  skill: 'sit';
  seat: {x: number; y: number; yaw: number; height: number};
  timeout?: number;
}
export interface StandUp {
  skill: 'stand_up';
  timeout?: number;
}

export type Skill = StepTo | TurnTo | StandStill | Gesture | LookAt | RestPose | Reach | Sit | StandUp;
export type SkillName = Skill['skill'];

// ---------------- 状态与结果 ----------------

export type SkillState = 'running' | 'completed' | 'failed' | 'interrupted';

export type FailReason =
  | 'unsupported'   // 不支持这个技能或参数
  | 'invalid_argument'
  | 'duplicate_id'
  | 'busy'          // 当前状态不能执行
  | 'fallen'        // 人物摔倒
  | 'unreachable'   // 目标太远、被挡住、手够不到
  | 'timeout'       // 超时
  | 'unstable'      // 做完但没站稳 / 关节没稳定
  | 'joint_limit';  // 超出关节范围

/** true 只表示接受；拒绝必须说明原因，且不能影响当前任务。 */
export type StartResult =
  | {accepted: true; channel: Channel}
  | {accepted: false; reason: FailReason; message: string};

export interface SkillStatus {
  id: string;
  skill: SkillName;
  channel: Channel;
  state: SkillState;
  startedAt: number;
  endedAt?: number;
  /** failed 必填 FailReason；interrupted 必填 cancelled/replaced。 */
  reason?: FailReason | 'cancelled' | 'replaced';
  /** failed/interrupted 必填。中文说明，供上层反馈。 */
  message?: string;
}

export interface BodyState {
  time: number;
  x: number;
  y: number;
  yaw: number;
  settled: boolean;
  fallen: boolean;
  posture: 'standing' | 'sitting';
  /** 左右脚受力 [左, 右]，单位 N，调试用 */
  footSupport: [left: number, right: number];
  /** 最多一个非 null，仅标识当前技能主要部位，不支持通道并发。 */
  channels: Record<Channel, string | null>;
}

export interface Capabilities {
  version: string;
  skills: SkillName[];
  gestures: GestureName[];
  hands: Hand[];
  defaults: {
    positionTolerance: number;   // 当前 0.08 m
    yawTolerance: number;        // 当前 0.12 rad
    poseTolerance: number;       // 当前 0.14 rad
    timeout: number;             // 上身默认 35 秒；腿部规则见规范
  };
  /** 大致步行速度（米/仿真秒），小脑用来估计超时 */
  walkSpeed: number;
  /** 手能够到的大致距离（米，从肩部算） */
  reachRadius?: number;
}

// ---------------- 接口 ----------------

export interface LowLevelApi {
  /** 先验证再替换：全身串行，已接受的新技能替换旧任务；拒绝不影响旧任务。 */
  start(id: string, skill: Skill): StartResult;
  /** 取消技能，之后 status 为 interrupted。id 不存在或已结束时什么都不做。 */
  cancel(id: string): void;
  /** 查询快照。终态至少保留 60 仿真秒；查不到返回 null，旧 id 仍不可复用。 */
  status(id: string): SkillStatus | null;
  /** 每次变化同步通知，包括 running；监听者异常不得影响控制循环。返回取消订阅函数。 */
  onStatus(listener: (status: SkillStatus) => void): () => void;
  /** 当前身体状态快照。 */
  body(): BodyState;
  /** 当前支持的技能。 */
  capabilities(): Capabilities;
  /** 由页面主循环在每个物理步调用，底层在这里写 ctrl。不能自己读真实时间。 */
  update(dt: number): void;
}
