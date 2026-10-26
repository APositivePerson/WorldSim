import loadMujoco from "@mujoco/mujoco";
import wasmUrl from "@mujoco/mujoco/mujoco.wasm?url";
import { MuJoCoEngine } from "./MuJoCoEngine";
import { withCupScene } from "./CupScene";
export type SimulationMode = "free" | "fixed" | "grasp" | "neuro";
let modulePromise: ReturnType<typeof loadMujoco> | undefined;
export async function loadHuman(mode: SimulationMode = "free") {
  modulePromise ??= loadMujoco({
    locateFile: (path: string) => (path.endsWith(".wasm") ? wasmUrl : path),
  });
  const [mj, response] = await Promise.all([
    modulePromise,
    fetch(
      `${import.meta.env.BASE_URL}models/${mode === "neuro" ? "human-neuromuscular.xml" : mode !== "fixed" ? "human-free.xml" : "human.xml"}`,
    ),
  ]);
  if (!response.ok) throw new Error(`MJCF HTTP ${response.status}`);
  const xml=await response.text();
  return new MuJoCoEngine(mj,mode==="grasp"?withCupScene(xml):xml);
}
