/** Local Z-up anatomy shared by the MJCF generator, skin and overlay. */
export interface DetailBone {
  name: string;
  parent: string;
  position: [number, number, number];
  tip: [number, number, number];
  radius: number;
  rotationX?: number;
  rotationY?: number;
}
const anatomyBones: DetailBone[] = [];
for (let i = 0; i < 4; i++) {
  anatomyBones.push({
    name: `spine_${i + 1}`,
    parent: i === 2 ? "chest" : i ? `spine_${i}` : "torso",
    position: [0, i === 0 || i === 2 ? 0.025 : 0, i === 2 ? -0.02 : i ? 0.095 : 0.01],
    tip: [0, 0, 0.09], radius: 0.013,
  });
}
for (const [side, sign] of [["left", 1], ["right", -1]] as const) {
  anatomyBones.push({ name: `${side}_eye`, parent: "head", position: [sign * 0.035, -0.075, 0.023], tip: [0, -0.02, 0], radius: 0.004 });
  const fingers = ["index", "middle", "ring", "little", "thumb"];
  fingers.forEach((finger, f) => {
    const lengths = f === 4 ? [0.028, 0.024, 0.020]
      : [0.03, 0.024, 0.018].map((l) => l * [0.94, 1, 0.93, 0.76][f]);
    lengths.forEach((length, segment) => {
      anatomyBones.push({
        name: `${side}_${finger}_${segment + 1}`,
        parent: segment ? `${side}_${finger}_${segment}` : `${side}_hand`,
        position: segment ? [0, 0, -lengths[segment - 1]]
          : f === 4 ? [sign * 0.04, -0.018, -0.005]
            : [sign * [0.027, 0.009, -0.01, -0.027][f], 0, [-0.056, -0.06, -0.058, -0.052][f]],
        tip: [0, 0, -length], radius: f === 4 ? [0.010, 0.009, 0.008][segment] : [0.008, 0.0072, 0.0062][segment],
        rotationY: f === 4 && segment === 0 ? -sign * 0.8 : undefined,
      });
    });
  });
  for (let toe = 0; toe < 5; toe++) {
    anatomyBones.push({
      name: `${side}_toe_${toe + 1}`, parent: `${side}_toes`,
      position: [sign * (-0.043 + toe * 0.022), 0, 0],
      tip: [0, -(0.055 - toe * 0.006), 0], radius: 0.009,
    });
  }
}

export const fingerNames = ["thumb", "index", "middle", "ring", "little"] as const;
export type FingerName = typeof fingerNames[number];
export type Side = "left" | "right";
export const fingerBones = anatomyBones.filter((b) => /_(thumb|index|middle|ring|little)_/.test(b.name));
export const detailBones = anatomyBones.filter((b) => !fingerBones.includes(b));
export const fingerJoint = (side: Side, finger: FingerName, segment: number) => `${side}_${finger}_${segment}_flex`;
export function fingerFlexLimit(finger: FingerName, segment: number) {
  return (finger === "thumb" ? [0.6, 1.2, 1.4] : [1.5, 1.7, 1.4])[segment - 1];
}
export function fingerCurlAngle(finger: FingerName, segment: number, curl: number) {
  // CMC + MCP + IP for the thumb; MCP + PIP + DIP for the other fingers.
  return curl * (finger === "thumb" ? [0.15, 0.45, 0.55][segment - 1]
    : [1.1, 1.45, 1.05][segment - 1]);
}
export function handPose(side: Side, curl: number, only?: FingerName) {
  const pose = Object.fromEntries(fingerNames.filter((f) => !only || f === only).flatMap((finger) =>
    [1, 2, 3].map((segment) => [fingerJoint(side, finger, segment), fingerCurlAngle(finger, segment, curl)]),
  ));
  if (!only || only === "thumb") pose[`${side}_thumb_opposition`] = curl * 1.8;
  if (!only) for (const finger of fingerNames.filter((f) => f !== "thumb")) pose[`${side}_${finger}_spread`] = 0;
  return pose;
}

/** Resting hands are slightly curled, with the palms facing the thighs. */
export function relaxedHands(): Record<string, number> {
  const pose: Record<string, number> = {};
  for (const side of ["left", "right"] as const) {
    pose[`${side}_forearm_rotation`] = side === "left" ? -1.15 : 1.15;
    for (const [i, finger] of fingerNames.entries()) {
      const curl = finger === "thumb" ? .25 : .10 + i * .025;
      Object.assign(pose, handPose(side, curl, finger));
    }
  }
  return pose;
}
