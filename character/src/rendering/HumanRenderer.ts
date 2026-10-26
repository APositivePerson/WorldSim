import { CupRenderer } from "./CupRenderer";
import { SkinnedHuman } from "./SkinnedHuman";
import * as T from "three";
import type { MuJoCoEngine } from "../physics/MuJoCoEngine";
import { worldPose } from "./CoordinateMapper";
import { AnatomicalSkeleton } from "./AnatomicalSkeleton";
import { MuscleLayer } from "./MuscleLayer";
import { BoneLayer } from "./BoneLayer";
import { neutralFace, type FaceControls } from "./DeformationRig";
export class HumanRenderer {
  avatar: SkinnedHuman | null = null;
  private skinVisible = true;
  private disposed = false;
  private loadId = 0;
  readonly group = new T.Group();
  readonly joints = new T.Group();
  readonly skeleton = new T.Group();
  readonly bodyToMeshes = new Map<number, T.Mesh[]>();
  readonly meshes = new Map<number, T.Mesh>();
  private markers: T.Mesh[] = [];
  private bones: { body: number; parent: number; line: T.Line }[] = [];
  private anatomy: AnatomicalSkeleton;
  readonly muscles: MuscleLayer;
  private cup: CupRenderer | null = null;
  readonly boneLayer: BoneLayer;
  private skinDetail = true;
  private surfaceOpacity = 1;
  private face = { ...neutralFace };
  private deformationEnabled = true;
  constructor(readonly engine: MuJoCoEngine) {
    const m = engine.model;
    for (let g = 0; g < m.ngeom; g++) {
      const type = m.geom_type[g],
        i = g * 3,
        a = m.geom_size[i],
        b = m.geom_size[i + 1],
        c = m.geom_size[i + 2];
      if (type === 0) continue; // infinite collision plane is represented by the scene floor
      let geometry: T.BufferGeometry;
      if (type === 2) geometry = new T.SphereGeometry(a, 24, 16);
      else if (type === 3) {
        geometry = new T.CapsuleGeometry(a, b * 2, 8, 16);
        geometry.rotateX(Math.PI / 2);
      } else if (type === 4) {
        geometry = new T.SphereGeometry(1, 24, 16);
        geometry.scale(a, b, c);
      } else if (type === 5) {
        geometry = new T.CylinderGeometry(a,a,b*2,32); geometry.rotateX(Math.PI/2);
      }
      else if (type === 6) geometry = new T.BoxGeometry(a * 2, b * 2, c * 2);
      else throw new Error(`Unsupported geom type ${type}`);
      const rgba = m.geom_rgba,
        k = g * 4;
      const material = new T.MeshStandardMaterial({
        color: new T.Color(rgba[k], rgba[k + 1], rgba[k + 2]),
        roughness: 0.55,
        metalness: 0.12,
      });
      const mesh = new T.Mesh(geometry, material);
      mesh.userData.cupWall=(engine.mj.mj_id2name(m,5,g)??"").startsWith("cup_wall_");
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.meshes.set(g, mesh);
      this.group.add(mesh);
      const body = m.geom_bodyid[g];
      const list = this.bodyToMeshes.get(body) ?? [];
      list.push(mesh);
      this.bodyToMeshes.set(body, list);
    }
    for (let j = 0; j < m.njnt; j++) {
      const mesh = new T.Mesh(
        new T.SphereGeometry(0.022, 12, 8),
        new T.MeshBasicMaterial({ color: 0xf4aa48, depthTest: false }),
      );
      mesh.renderOrder = 2;
      this.markers.push(mesh);
      this.joints.add(mesh);
    }
    for (let b = 1; b < m.nbody; b++) {
      const parent = m.body_parentid[b];
      if (parent === 0) continue;
      const line = new T.Line(
        new T.BufferGeometry().setFromPoints([
          new T.Vector3(),
          new T.Vector3(),
        ]),
        new T.LineBasicMaterial({ color: 0xf4aa48, depthTest: false }),
      );
      line.renderOrder = 2;
      this.skeleton.add(line);
      this.bones.push({ body: b, parent, line });
    }
    this.anatomy = new AnatomicalSkeleton(engine);
    this.muscles = new MuscleLayer(engine);
    this.boneLayer = new BoneLayer(engine);
    this.skeleton.add(this.anatomy.group);
    this.group.add(this.joints, this.skeleton, this.muscles.group, this.boneLayer.group);
    const cupBody=engine.mj.mj_name2id(m,1,"prop_cup");
    if(cupBody>=0){this.cup=new CupRenderer(engine,cupBody);this.group.add(this.cup.group);}
    this.updateRepresentation();
    this.sync();
  }
  setSkinVisible(visible: boolean) {
    this.skinVisible = visible;
    this.updateRepresentation();
  }
  setBoneVisible(visible: boolean) {
    this.boneLayer.group.visible = visible;
    this.updateRepresentation();
  }
  setSkinDetail(enabled: boolean) {
    this.skinDetail = enabled;
    if (this.avatar) this.avatar.surface.enabled = enabled;
  }
  setSurfaceOpacity(opacity: number) {
    this.surfaceOpacity = opacity;
    this.avatar?.surface.setOpacity(opacity);
  }
  setFace(face: FaceControls, deformationEnabled: boolean) {
    this.face = { ...face };
    this.deformationEnabled = deformationEnabled;
    if (this.avatar) {
      this.avatar.deformation.setFace(face);
      this.avatar.deformation.enabled = deformationEnabled;
    }
  }
  private updateRepresentation() {
    for (const [g,mesh] of this.meshes)
      mesh.visible = !mesh.userData.cupWall && (!this.engine.isHumanBody(this.engine.model.geom_bodyid[g]) || !(this.skinVisible && this.avatar || this.boneLayer.group.visible));
    if (this.avatar) this.avatar.group.visible = this.skinVisible;
  }
  async loadSkin(source: string | ArrayBuffer) {
    const request = ++this.loadId;
    const avatar = await SkinnedHuman.load(
      this.engine,
      source,
      () => this.disposed || request !== this.loadId,
    );
    if (!avatar) return;
    if (this.disposed || request !== this.loadId) {
      avatar.dispose();
      return;
    }
    this.avatar?.dispose();
    this.avatar = avatar;
    avatar.surface.enabled = this.skinDetail;
    avatar.surface.setOpacity(this.surfaceOpacity);
    avatar.deformation.setFace(this.face);
    avatar.deformation.enabled = this.deformationEnabled;
    this.group.add(avatar.group);
    this.updateRepresentation();
  }
  sync() {
    const d = this.engine.data;
    this.avatar?.sync();
    this.cup?.sync();
    this.anatomy.sync();
    if (this.boneLayer.group.visible) this.boneLayer.sync();
    this.muscles.sync();
    for (const [g, mesh] of this.meshes)
      worldPose(d.geom_xpos, d.geom_xmat, g, mesh.position, mesh.quaternion);
    this.markers.forEach((mesh, j) =>
      mesh.position.fromArray(d.xanchor, j * 3),
    );
    for (const b of this.bones) {
      const p = b.line.geometry.attributes.position;
      for (let axis = 0; axis < 3; axis++) {
        p.array[axis] = d.xpos[b.parent * 3 + axis];
        p.array[3 + axis] = d.xpos[b.body * 3 + axis];
      }
      p.needsUpdate = true;
      b.line.geometry.computeBoundingSphere();
    }
  }
  dispose() {
    this.disposed = true;
    this.loadId++;
    this.avatar?.dispose();
    this.avatar = null;
    this.group.traverse((o) => {
      if (o instanceof T.Mesh || o instanceof T.Line) {
        o.geometry.dispose();
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        materials.forEach((m) => m.dispose());
      }
    });
    this.group.removeFromParent();
  }
}
