export interface CupSceneOptions {
    position?: [number, number, number];
    radius?: number;
    mass?: number;
    height?: number;
}
/** A free rigid cup with actual hollow walls. No weld, mocap or cup actuator. */
export function withCupScene(xml: string, options: CupSceneOptions = {}) {
    const p = options.position ?? [-0.23, -0.30, 1.16], radius = options.radius ?? 0.022, mass = options.mass ?? 0.12, height = options.height ?? 0.12;
    if (p.length !== 3 || p.some((x) => !Number.isFinite(x)) || !Number.isFinite(radius) || radius < 0.015 || radius > 0.04 || !Number.isFinite(mass) || mass <= 0 || mass > 1 || !Number.isFinite(height) || height < 0.07 || height > 0.16 || p[2] <= height / 2 + 0.027)
        throw new Error("Invalid cup parameters");
    const walls = Array.from({ length: 24 }, (_, i) => {
        const a = i / 24 * Math.PI * 2, x = radius * Math.cos(a), y = radius * Math.sin(a);
        return `<geom name="cup_wall_${i}" type="capsule" fromto="${x} ${y} ${-height / 2} ${x} ${y} ${height / 2}" size="0.003" mass="${mass * 0.7 / 24}" rgba="0.22 0.62 0.70 1" contype="8" conaffinity="15" friction="1.5 0.02 0.002" condim="4" solref="0.006 1"/>`;
    }).join("\n");
    const scene = `<geom name="cup_table" type="box" pos="${p[0]} ${p[1]} ${p[2] - height / 2 - 0.015}" size="0.075 0.055 0.012" rgba="0.55 0.39 0.25 1" contype="8" conaffinity="15" friction="1 0.02 0.002"/>
  <geom name="cup_stand" type="box" pos="${p[0]} ${p[1]} ${(p[2] - height / 2 - 0.027) / 2}" size="0.018 0.018 ${(p[2] - height / 2 - 0.027) / 2}" rgba="0.35 0.29 0.25 1" contype="8" conaffinity="15"/>
  <body name="prop_cup" pos="${p.join(" ")}"><freejoint name="cup_free"/>
  <geom name="cup_bottom" type="cylinder" pos="0 0 ${-height / 2}" size="${radius + 0.003} 0.003" mass="${mass * 0.3}" rgba="0.22 0.62 0.70 1" contype="8" conaffinity="15" friction="1.5 0.02 0.002" condim="4" solref="0.006 1"/>
  ${walls}</body>`;
    xml = xml.replace("</worldbody>", scene + "\n</worldbody>");
    // The object's free joint is appended after the original human coordinates.
    xml = xml.replace(/(<key\b[^>]*\bqpos=")([^"]*)(")/g, (_, a, b, c) => a + b + " " + p.join(" ") + " 1 0 0 0" + c);
    return xml;
}
