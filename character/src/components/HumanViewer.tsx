import { useEffect, useRef } from "react";
import { SceneManager } from "../rendering/SceneManager";
import type { SimulationLoop } from "../physics/SimulationLoop";
import type { FaceControls } from "../rendering/DeformationRig";
import type { AvatarStyle } from "../rendering/AvatarProfiles";
export function HumanViewer({
  loop,
  skin,
  muscles,
  correctives, softTissue,
  bones, skinDetail, surfaceOpacity,
  face, deformation,
  avatar,
  avatarStyle,
  onSkinStatus,
  joints,
  axes,
  skeleton,
  home,
  focus,
  onTick,
  onError,
}: {
  loop: SimulationLoop;
  skin: boolean;
  muscles: boolean;
  correctives: boolean; softTissue: boolean;
  bones: boolean; skinDetail: boolean; surfaceOpacity: number;
  face: FaceControls; deformation: boolean;
  avatar: File | null;
  avatarStyle: AvatarStyle;
  onSkinStatus: (s: string) => void;
  joints: boolean;
  axes: boolean;
  skeleton: boolean;
  home: number;
  focus: "full" | "left" | "right" | "head" | "grasp" | "feet";
  onTick: () => void;
  onError: (e: unknown) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    scene = useRef<SceneManager | null>(null),
    tick = useRef(onTick);
  tick.current = onTick;
  const appearance = useRef({ correctives, softTissue });
  appearance.current = { correctives, softTissue };
  useEffect(() => {
    let frame = 0;
    let previous = performance.now(),
      lastUI = 0;
    let manager: SceneManager;
    try {
      manager = new SceneManager(host.current!, loop.engine);
      scene.current = manager;
      if (loop.controller.grasp) manager.cupPlacement = {
        enabled: () => !loop.controller.grasp!.active && loop.controller.status !== "running"
          && loop.controller.locomotion?.mode === "stand",
        bounds: () => loop.controller.grasp!.placementBounds(),
        place: (x, y) => { const placed = loop.controller.placeCup(x, y); tick.current(); return placed; },
      };
    } catch (e) {
      onError(e);
      return;
    }
    function animate(now: number) {
      try {
        loop.advance((now - previous) / 1000);
        previous = now;
        manager.setTraining(loop.controller.cerebellumExperiment?.active ?? false,
          loop.controller.cerebellumExperiment?.appliedForce ?? 0,loop.controller.balancePush.snapshot().force);
        manager.render();
        if (now - lastUI > 100) {
          tick.current();
          lastUI = now;
        }
        frame = requestAnimationFrame(animate);
      } catch (e) {
        onError(e);
      }
    }
    frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame);
      manager.dispose();
      scene.current = null;
    };
  }, [loop, onError]);
  useEffect(() => {
    if (scene.current) {
      scene.current.human.joints.visible = joints;
      scene.current.axes.visible = axes;
      scene.current.human.skeleton.visible = skeleton;
    }
  }, [joints, axes, skeleton, loop]);
  useEffect(() => {
    scene.current?.human.setSkinVisible(skin);
  }, [skin, loop]);
  useEffect(() => {
    const human = scene.current?.human;
    human?.setBoneVisible(bones);
    human?.setSkinDetail(skinDetail);
    human?.setSurfaceOpacity(surfaceOpacity);
  }, [bones, skinDetail, surfaceOpacity, loop]);
  useEffect(() => {
    scene.current?.human.setFace(face, deformation);
  }, [face, deformation, loop]);
  useEffect(() => {
    if (scene.current) scene.current.human.muscles.group.visible = muscles;
  }, [muscles, loop]);
  useEffect(() => {
    let cancelled = false;
    const current = scene.current;
    if (!current) return;
    onSkinStatus("GLB 加载中…");
    (async () => {
      if (avatar && avatar.size > 20 * 1024 * 1024)
        throw new Error("GLB 超过 20 MB 限制");
      const source = avatar
        ? await avatar.arrayBuffer()
        : `${import.meta.env.BASE_URL}${avatarStyle === "scan" ? "local-scans/eric.glb" : "models/human-skinned.glb"}`;
      if (cancelled) return;
      await current.human.loadSkin(source);
      const corrections = current.human.avatar?.corrections;
      if (corrections) { corrections.enabled = appearance.current.correctives; corrections.softTissue = appearance.current.softTissue; }
      if (!cancelled)
        onSkinStatus(
          `GLB 已绑定 · ${current.human.avatar?.boneCount ?? 0} 骨骼${!avatar && avatarStyle === "scan" ? " · 真人扫描 Eric · 4K 摄影贴图" : ""}${current.human.avatar?.deformation.count ? ` · ${current.human.avatar.deformation.count} 辅助变形骨` : ""}${avatar ? " · " + avatar.name : ""}`,
        );
    })().catch((e) => {
      if (!cancelled) onSkinStatus(`GLB 加载失败：${String(e)}`);
    });
    return () => {
      cancelled = true;
    };
  }, [avatar, avatarStyle, loop, onSkinStatus]);
  useEffect(() => {
    const corrections = scene.current?.human.avatar?.corrections;
    if (corrections) { corrections.enabled = correctives; corrections.softTissue = softTissue; }
  }, [correctives, softTissue]);
  useEffect(() => {
    scene.current?.home();
  }, [home]);
  useEffect(() => {
    if (focus === "full") scene.current?.home();
    else if (focus === "feet") scene.current?.focusFeet();
    else if (focus === "head") scene.current?.focusHead();
    else if (focus === "grasp") scene.current?.focusGrasp();
    else scene.current?.focusHand(focus);
  }, [focus, loop]);
  const training = loop.controller.cerebellumExperiment?.snapshot();
  const push=loop.controller.balancePush.snapshot();
  return (
    <div className="viewport" ref={host} aria-label="三维人体动力学视图">
      {!training?.active&&push.count>0&&<div className="training-hud" data-testid="balance-push-state">
        <strong>{loop.paused?"已暂停":push.force>0?"侧推施力中":"侧推恢复观察"}</strong>
        <span>实际施力 {push.force} N · 120 ms 脉冲</span>
        <span>2 秒观察窗最大横移 {(push.peak*1000).toFixed(1)} mm</span>
      </div>}
      {training?.active && <div className="training-hud" data-testid="training-hud">
        <strong>{loop.paused ? "已暂停" : training.stage}</strong>
        <span>第 {training.round} / {training.total} 轮 · {training.elapsed.toFixed(1)} s</span>
        <span>侧推 {training.force} N → · 横移 {(training.displacement * 1000).toFixed(1)} mm</span>
      </div>}
    </div>
  );
}
