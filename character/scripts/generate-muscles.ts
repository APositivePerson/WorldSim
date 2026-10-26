// Antagonistic elbow muscle-tendon pairs. Fixed tendons model constant moment arms;
// MuJoCo supplies activation dynamics and active/passive force-length-velocity.
import { readFile, writeFile } from "node:fs/promises";
for (const path of ["public/models/human.xml", "public/models/human-free.xml"]) {
  let xml = await readFile(path, "utf8");
  xml = xml.replace(/\s*<muscle name="bio_[^"]*"[^>]*\/>/g, "")
    .replace(/\s*<tendon>[\s\S]*?<\/tendon>/, "");
  const tendons: string[] = [], muscles: string[] = [];
  for (const side of ["left", "right"]) for (const [name, coef, lengths, spring] of [
    ["biceps", -0.03, "-0.072 0", -0.036], ["triceps", 0.03, "0 0.072", 0.036],
  ] as const) {
    tendons.push(`<fixed name="bio_${side}_${name}_tendon" stiffness="70" damping="1.5" springlength="${spring}"><joint joint="${side}_elbow" coef="${coef}" /></fixed>`);
    muscles.push(`<muscle name="bio_${side}_${name}" tendon="bio_${side}_${name}_tendon" lengthrange="${lengths}" force="900" range="0.85 1.1" timeconst="0.025 0.06" tausmooth="0.02" ctrllimited="true" ctrlrange="0 1" forcelimited="false" />`);
  }
  xml = xml.replace("</actuator>", muscles.join("\n    ") + "\n  </actuator>")
    .replace("</mujoco>", `  <tendon>\n    ${tendons.join("\n    ")}\n  </tendon>\n</mujoco>`);
  await writeFile(path, xml);
}
console.log("Added four native muscle actuators and four antagonistic elbow tendons.");
