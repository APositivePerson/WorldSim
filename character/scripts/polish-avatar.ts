import { execFileSync } from "node:child_process";
const script = "scripts/refine-avatar-blender.py";
const options = { stdio: "inherit" as const, env: { ...process.env, HUMAN_AVATAR_OUTPUT: "artifacts/avatar-v2-source.glb" } };
if (process.env.BLENDER) execFileSync(process.env.BLENDER, ["--background", "--python", script], options);
else execFileSync(process.env.PYTHON || "python3", [script], options);
