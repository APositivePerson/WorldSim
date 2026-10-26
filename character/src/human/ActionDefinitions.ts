import { handPose } from "./Anatomy";
export const actions = {
  reach_right: {},
  reach_left: {},
  look_left: { neck_yaw: 0.5, chest_twist: 0.18, spine_twist: 0.1 },
  look_right: { neck_yaw: -0.5, chest_twist: -0.18, spine_twist: -0.1 },
  nod_head: { neck_pitch: 0.35 },
  twist_torso: { spine_twist: 0.22, chest_twist: 0.12 },
  lean_forward: { spine_flex: 0.1, chest_flex: 0.06 },
  shrug_shoulders: { left_scapula_elevation: -0.15, right_scapula_elevation: 0.15 },
  rotate_palms: { left_forearm_rotation: 1.1, right_forearm_rotation: -1.1 },
  spread_fingers: {
    ...handPose("left", 0), ...handPose("right", 0),
    left_index_spread: -0.16, left_middle_spread: -0.035, left_ring_spread: 0.045, left_little_spread: 0.16,
    right_index_spread: 0.16, right_middle_spread: 0.035, right_ring_spread: -0.045, right_little_spread: -0.16,
  },
  close_left_hand: handPose("left", 1),
  close_right_hand: handPose("right", 1),
  open_hands: { ...handPose("left", 0), ...handPose("right", 0) },
  raise_left_arm: { left_shoulder: -1.9 },
  raise_right_arm: { right_shoulder: 1.9 },
  lower_arms: {
    left_shoulder: 0,
    right_shoulder: 0,
    left_shoulder_flex: 0,
    right_shoulder_flex: 0,
    left_elbow: 0,
    right_elbow: 0,
  },
  turn_head_left: { neck_yaw: 0.7 },
  turn_head_right: { neck_yaw: -0.7 },
  bend_left_elbow: { left_elbow: 1.7 },
  bend_right_knee: { right_knee: 1.3 },
  squat_check: {
    left_hip: -0.65, right_hip: -0.65, left_knee: 1.3, right_knee: 1.3,
    left_ankle: -0.5, right_ankle: -0.5, spine_flex: 0.12, chest_flex: 0.05,
    left_shoulder_flex: 0.35, right_shoulder_flex: 0.35,
  },
  reset_pose: {},
} satisfies Record<string, Record<string, number>>;
export type PoseActionName = keyof typeof actions;
export type ActionName =
  PoseActionName | "walk_forward" | "stand" | "stop_walk" | "pick_up_cup" | "put_down_cup";
export interface ActionCommand {
  action: ActionName;
  duration?: number;
  source?: string;
  target?: [number, number, number];
}
export const labels: Record<PoseActionName, string> = {
  reach_right: "右手向前伸",
  reach_left: "左手向前伸",
  look_left: "协调向左看",
  look_right: "协调向右看",
  nod_head: "低头",
  twist_torso: "转动腰胸",
  lean_forward: "身体前倾",
  shrug_shoulders: "耸肩",
  rotate_palms: "旋转前臂",
  spread_fingers: "五指展开",
  close_left_hand: "左手握拳",
  close_right_hand: "右手握拳",
  open_hands: "张开双手",
  raise_left_arm: "抬左手",
  raise_right_arm: "抬右手",
  lower_arms: "放下双臂",
  turn_head_left: "向左转头",
  turn_head_right: "向右转头",
  bend_left_elbow: "弯曲左肘",
  bend_right_knee: "弯曲右膝",
  squat_check: "下蹲姿态检查",
  reset_pose: "恢复初始姿态",
};
