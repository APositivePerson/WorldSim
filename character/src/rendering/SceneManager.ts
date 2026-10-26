import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { HumanRenderer } from "./HumanRenderer";
import type { MuJoCoEngine } from "../physics/MuJoCoEngine";
export class SceneManager {
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera(38, 1, 0.01, 100);
  readonly renderer: T.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly human: HumanRenderer;
  readonly axes = new T.AxesHelper(0.5);
  private observer: ResizeObserver;
  private lastRoot = new T.Vector3();
  private focusBody: string | null = null;
  private tracked = new T.Vector3();
  private delta = new T.Vector3();
  private graspFitDistance = 1;
  private training = false;
  private pushArrow = new T.ArrowHelper(new T.Vector3(1, 0, 0), new T.Vector3(), .55, 0xe47d31, .12, .07);
  setTraining(active: boolean, force: number, transientForce=0) {
    if (active && !this.training) {
      this.focusBody = null;
      const x=this.engine.data.qpos[0], y=this.engine.data.qpos[1];
      this.camera.position.set(x, y-2.8, 1.25); this.controls.target.set(x, y, .95);
    }
    this.training = active;
    this.pushArrow.visible = (active && force > 0)||transientForce>0;
    this.pushArrow.position.set(this.engine.data.qpos[0]-.6, this.engine.data.qpos[1]-.12, this.engine.data.qpos[2]);
  }
  cupPlacement: { enabled: () => boolean; place: (x: number, y: number) => boolean; bounds: () => { min: number; max: number }[] } | null = null;
  private raycaster = new T.Raycaster();
  private drag: { pointer: number; plane: T.Plane; offset: T.Vector3; controlsEnabled: boolean } | null = null;
  private pointerRay(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new T.Vector2((event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1), this.camera);
    return this.raycaster.ray;
  }
  private startDrag = (event: PointerEvent) => {
    if (this.drag || event.button !== 0 || !this.cupPlacement?.enabled()) return;
    const body = this.engine.mj.mj_name2id(this.engine.model, 1, "prop_cup");
    if (body < 0) return;
    const p = new T.Vector3().fromArray(this.engine.data.xpos, body * 3), ray = this.pointerRay(event);
    const box = new T.Box3().setFromCenterAndSize(p, new T.Vector3(0.065, 0.065, 0.14));
    if (!ray.intersectBox(box, new T.Vector3())) return;
    const plane = new T.Plane(new T.Vector3(0, 0, 1), -p.z), hit = ray.intersectPlane(plane, new T.Vector3());
    if (!hit) return;
    this.drag = { pointer: event.pointerId, plane, offset: p.sub(hit), controlsEnabled: this.controls.enabled };
    this.controls.enabled = false;
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.renderer.domElement.style.cursor = "grabbing";
    event.stopImmediatePropagation();
    event.preventDefault();
  };
  private moveDrag = (event: PointerEvent) => {
    if (!this.drag || event.pointerId !== this.drag.pointer) return;
    if (!this.cupPlacement?.enabled()) { this.endDrag(event); return; }
    const hit = this.pointerRay(event).intersectPlane(this.drag.plane, new T.Vector3());
    if (hit) {
      hit.add(this.drag.offset);
      const [x, y] = this.cupPlacement.bounds();
      this.cupPlacement.place(T.MathUtils.clamp(hit.x, x.min, x.max), T.MathUtils.clamp(hit.y, y.min, y.max));
    }
    event.stopImmediatePropagation();
    event.preventDefault();
  };
  private endDrag = (event: PointerEvent) => {
    if (!this.drag || event.pointerId !== this.drag.pointer) return;
    this.controls.enabled = this.drag.controlsEnabled;
    this.drag = null;
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) this.renderer.domElement.releasePointerCapture(event.pointerId);
    this.renderer.domElement.style.cursor = "";
    event.stopImmediatePropagation();
  };
  constructor(
    readonly host: HTMLElement,
    readonly engine: MuJoCoEngine,
  ) {
    this.renderer = new T.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);
    this.camera.up.set(0, 0, 1);
    this.scene.background = new T.Color("#edf2f3");
    this.scene.add(new T.HemisphereLight(0xffffff, 0x61727a, 2.6));
    const light = new T.DirectionalLight(0xffffff, 3);
    light.position.set(2, -3, 5);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    light.shadow.camera.left = -2;
    light.shadow.camera.right = 2;
    light.shadow.camera.top = 3;
    light.shadow.camera.bottom = -2;
    this.scene.add(light);
    const floor = new T.Mesh(
      new T.PlaneGeometry(200, 200),
      new T.MeshStandardMaterial({ color: 0xe6ecee, roughness: 1 }),
    );
    floor.position.z = -0.002;
    floor.receiveShadow = true;
    this.scene.add(floor);
    const grid = new T.GridHelper(6, 30, 0xb2c5c9, 0xd1dde0);
    grid.rotation.x = Math.PI / 2;
    grid.position.z = 0.001;
    this.scene.add(grid, this.axes);
    this.pushArrow.visible = false;
    this.scene.add(this.pushArrow);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 7;
    this.controls.maxPolarAngle = Math.PI * 0.94;
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", this.startDrag, true);
    canvas.addEventListener("pointermove", this.moveDrag, true);
    canvas.addEventListener("pointerup", this.endDrag, true);
    canvas.addEventListener("pointercancel", this.endDrag, true);
    canvas.addEventListener("lostpointercapture", this.endDrag, true);
    this.lastRoot.fromArray(engine.data.xpos, 3);
    this.home();
    this.human = new HumanRenderer(engine);
    this.scene.add(this.human.group);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
  }
  home() {
    this.focusBody = null;
    this.camera.up.set(0, 0, 1);
    this.controls.minDistance = 1;
    const x = this.engine.data.xpos[3],
      y = this.engine.data.xpos[4];
    this.camera.position.set(x + 2, y - 3, 2);
    this.controls.target.set(x, y, 1);
    this.controls.update();
    this.lastRoot.fromArray(this.engine.data.xpos, 3);
  }
  private graspCenter() {
    const { mj, model, data } = this.engine;
    const cup = mj.mj_name2id(model, 1, "prop_cup"), hand = mj.mj_name2id(model, 1, "right_hand");
    const p = new T.Vector3().fromArray(data.xpos, cup * 3), h = new T.Vector3().fromArray(data.xpos, hand * 3);
    return { center: p.clone().add(h).multiplyScalar(0.5), span: p.distanceTo(h) };
  }
  focusGrasp() {
    if (this.engine.mj.mj_name2id(this.engine.model, 1, "prop_cup") < 0) return;
    this.focusBody = "grasp";
    const { center, span } = this.graspCenter();
    this.tracked.copy(center);
    this.controls.minDistance = 0.18;
    this.camera.up.set(0, 0, 1);
    this.controls.target.copy(center);
    this.graspFitDistance = this.graspDistance(span);
    this.camera.position.copy(center).add(new T.Vector3(-0.65, -1, 0.55).normalize()
      .multiplyScalar(this.graspFitDistance));
    this.controls.update();
  }
  private graspDistance(span: number) {
    const halfFov = T.MathUtils.degToRad(this.camera.fov / 2);
    return Math.max(0.42, (span / 2 + 0.095) / (Math.tan(halfFov) * Math.min(1, this.camera.aspect)));
  }
  focusHand(side: "left" | "right") {
    this.focusBody = `${side}_hand`;
    const body = this.engine.mj.mj_name2id(this.engine.model, 1, `${side}_hand`);
    const d = this.engine.data;
    this.tracked.fromArray(d.xpos, body * 3);
    const q = new T.Quaternion(d.xquat[body * 4 + 1], d.xquat[body * 4 + 2], d.xquat[body * 4 + 3], d.xquat[body * 4]);
    this.controls.minDistance = 0.12;
    this.camera.up.set(0, 0, 1);
    this.controls.target.copy(new T.Vector3(0, -0.02, -0.045).applyQuaternion(q).add(this.tracked));
    // Approach from outside the torso. A palm-relative camera can rotate into
    // the trousers when the forearm turns into its natural resting position.
    const pelvis = this.engine.mj.mj_name2id(this.engine.model, 1, "pelvis");
    const outward = this.tracked.clone().sub(new T.Vector3().fromArray(d.xpos, pelvis * 3));
    outward.z = 0;
    if (outward.lengthSq() < 1e-6) outward.set(side === "left" ? 1 : -1, 0, 0);
    outward.normalize().multiplyScalar(.34);
    this.camera.position.copy(this.tracked).add(outward).add(new T.Vector3(0, -.17, .025));
    this.controls.update();
  }
  focusFeet() {
    this.focusBody="pelvis";
    const body=this.engine.mj.mj_name2id(this.engine.model,1,"pelvis");
    this.tracked.fromArray(this.engine.data.xpos,body*3);
    this.controls.minDistance=.3;
    this.camera.up.set(0,0,1);
    this.controls.target.set(this.tracked.x,this.tracked.y-.07,.2);
    this.camera.position.copy(this.controls.target).add(new T.Vector3(.95,.22,.13));
    this.controls.update();
  }
  focusHead() {
    this.focusBody = "head";
    const body = this.engine.mj.mj_name2id(this.engine.model, 1, "head");
    this.tracked.fromArray(this.engine.data.xpos, body * 3);
    this.controls.minDistance = 0.15;
    this.camera.up.set(0, 0, 1);
    this.controls.target.copy(this.tracked).add(new T.Vector3(0, 0, -0.045));
    this.camera.position.copy(this.tracked).add(new T.Vector3(0.25, -0.70, 0.06));
    this.controls.update();
  }
  resize() {
    const { width, height } = this.host.getBoundingClientRect();
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }
  render() {
    // A fixed camera during cup dragging keeps screen-to-table mapping stable.
    if (!this.drag) {
    if (this.focusBody === "grasp") {
      const { center, span } = this.graspCenter();
      this.delta.copy(center).sub(this.tracked);
      this.camera.position.add(this.delta);
      this.controls.target.add(this.delta);
      this.tracked.copy(center);
      // Fit both the fingers and cup while preserving the user's orbit angle.
      const offset = this.camera.position.clone().sub(this.controls.target);
      const distance = this.graspDistance(span);
      this.camera.position.copy(this.controls.target).add(offset.multiplyScalar(distance / this.graspFitDistance));
      this.graspFitDistance = distance;
    } else if (this.focusBody) {
      const body = this.engine.mj.mj_name2id(this.engine.model, 1, this.focusBody);
      this.delta.fromArray(this.engine.data.xpos, body * 3).sub(this.tracked);
      this.camera.position.add(this.delta);
      this.controls.target.add(this.delta);
      this.tracked.fromArray(this.engine.data.xpos, body * 3);
    } else {
    const x = this.engine.data.xpos[3],
      y = this.engine.data.xpos[4];
    const dx = x - this.lastRoot.x,
      dy = y - this.lastRoot.y;
    if (!this.training) {
      this.camera.position.x += dx;
      this.camera.position.y += dy;
      this.controls.target.x += dx;
      this.controls.target.y += dy;
    }
    this.lastRoot.set(x, y, this.engine.data.xpos[5]);
    }
    }
    this.human.sync();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
  dispose() {
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.startDrag, true);
    canvas.removeEventListener("pointermove", this.moveDrag, true);
    canvas.removeEventListener("pointerup", this.endDrag, true);
    canvas.removeEventListener("pointercancel", this.endDrag, true);
    canvas.removeEventListener("lostpointercapture", this.endDrag, true);
    this.cupPlacement = null;
    this.observer.disconnect();
    this.controls.dispose();
    this.human.dispose();
    this.scene.traverse((o) => {
      if (o instanceof T.DirectionalLight) o.shadow.dispose();
      if (o instanceof T.Mesh || o instanceof T.Line) {
        o.geometry.dispose();
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach((m) => m.dispose());
      }
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
