import * as T from "three";
import type { MuJoCoEngine } from "../physics/MuJoCoEngine";
import { worldPose } from "./CoordinateMapper";
/** Smooth display shell follows the free body; physics retains its hollow walls. */
export class CupRenderer {
    readonly group = new T.Group();
    constructor(readonly engine: MuJoCoEngine, readonly body: number) {
        const m = engine.model, mj = engine.mj;
        const wall = mj.mj_name2id(m, 5, "cup_wall_0"), bottom = mj.mj_name2id(m, 5, "cup_bottom");
        const radius = m.geom_size[bottom * 3], thickness = m.geom_size[wall * 3] * 2, height = m.geom_size[wall * 3 + 1];
        const inner = radius - thickness;
        const points = [[inner, -height], [radius, -height], [radius, height],
            [radius - .001, height + .002], [radius - thickness / 2, height + .003], [inner + .001, height + .002], [inner, height], [inner, -height]];
        const geometry = new T.LatheGeometry(points.map(([r, z]) => new T.Vector2(r, z)), 64);
        geometry.rotateX(Math.PI / 2);
        const shell = new T.Mesh(geometry, new T.MeshStandardMaterial({ color: 0x409eac, roughness: .32, metalness: .03 }));
        shell.castShadow = true;
        shell.receiveShadow = true;
        this.group.name = "CupDisplay";
        this.group.add(shell);
        this.sync();
    }
    sync() { worldPose(this.engine.data.xpos, this.engine.data.xmat, this.body, this.group.position, this.group.quaternion); }
}
