/** Surface landmarks, not additional mass or physiological muscle actuators. */
export interface MuscleRegion {
  name: string; body: string; joint: string; sign: number;
  center: [number, number, number]; size: [number, number, number];
}
export const muscles: MuscleRegion[] = [];
for (const side of ["left", "right"]) {
  muscles.push(
    { name: `${side}_biceps`, body: `${side}_upper_arm`, joint: `${side}_elbow`, sign: 1,
      center: [0, -0.018, -0.16], size: [0.039, 0.032, 0.088] },
    { name: `${side}_triceps`, body: `${side}_upper_arm`, joint: `${side}_elbow`, sign: -1,
      center: [0, 0.014, -0.14], size: [0.04, 0.033, 0.095] },
    { name: `${side}_deltoid`, body: `${side}_upper_arm`, joint: `${side}_shoulder`, sign: side === "left" ? -1 : 1,
      center: [0, 0, -0.028], size: [0.058, 0.057, 0.069] },
    { name: `${side}_quadriceps`, body: `${side}_thigh`, joint: `${side}_knee`, sign: -1,
      center: [0, -0.027, -0.18], size: [0.062, 0.05, 0.16] },
    { name: `${side}_hamstrings`, body: `${side}_thigh`, joint: `${side}_knee`, sign: 1,
      center: [0, 0.026, -0.18], size: [0.059, 0.052, 0.15] },
    { name: `${side}_calf`, body: `${side}_shin`, joint: `${side}_ankle`, sign: -1,
      center: [0, 0.028, -0.135], size: [0.048, 0.043, 0.11] },
    { name: `${side}_forearm_flexors`, body: `${side}_forearm`, joint: `${side}_wrist`, sign: 1,
      center: [0, -0.012, -0.085], size: [0.033, 0.03, 0.095] },
  );
}
