import { Matrix4, Quaternion, Vector3 } from "three";
// Use Z-up throughout Three.js, matching MuJoCo's right-handed X/Y/Z frame.
// Geom world rotations are row-major 3x3; Three.js Matrix4.set takes row-major values.
export function worldPose(
  position: ArrayLike<number>,
  matrix: ArrayLike<number>,
  id: number,
  p: Vector3,
  q: Quaternion,
) {
  const i = id * 3,
    k = id * 9;
  p.set(position[i], position[i + 1], position[i + 2]);
  rotation.set(
    matrix[k],
    matrix[k + 1],
    matrix[k + 2],
    0,
    matrix[k + 3],
    matrix[k + 4],
    matrix[k + 5],
    0,
    matrix[k + 6],
    matrix[k + 7],
    matrix[k + 8],
    0,
    0,
    0,
    0,
    1,
  );
  q.setFromRotationMatrix(rotation);
}
const rotation = new Matrix4();
