import * as T from "three";

/** Rest-space microdetail stays attached to the skin through skeletal deformation. */
export class SkinSurface {
  private intensity = { value: 1 };
  private meshes: T.Mesh[] = [];
  private materials: T.Material[] = [];
  private authored = new Map<T.Material, { opacity: number; transparent: boolean; depthWrite: boolean }>();
  private shadows = new Map<T.Mesh, boolean>();
  constructor(scene: T.Object3D) {
    scene.traverse(o => {
      if (!(o instanceof T.Mesh)) return;
      this.meshes.push(o);
      const scanned = !!o.userData.scanAsset;
      const count = scanned ? o.geometry.getAttribute("position").count : o.userData.surface?.vertices;
      const color = o.geometry.getAttribute("color");
      // The built-in asset explicitly identifies its continuous surface. Imported
      // materials without this metadata retain their own authoring/shading.
      const authoredMask = o.geometry.getAttribute("_skin_mask");
      if (!Number.isInteger(count) || (!color && !authoredMask)) return;
      const vertexCount = o.geometry.getAttribute("position").count;
      const mask = new Float32Array(vertexCount);
      for (let i = 0; i < Math.min(count, vertexCount); i++) {
        const r = color?.getX(i) ?? 0, g = color?.getY(i) ?? 0, b = color?.getZ(i) ?? 0;
        mask[i] = authoredMask ? authoredMask.getX(i) : T.MathUtils.smoothstep(r - Math.max(g, b), 0.035, 0.13);
      }
      if (authoredMask) for (let i = count; i < vertexCount; i++) mask[i] = authoredMask.getX(i);
      o.geometry.setAttribute("skinSurface", new T.Float32BufferAttribute(mask, 1));
      const original = Array.isArray(o.material) ? o.material : [o.material];
      const updated = original.map(source => {
        if (!(source instanceof T.MeshStandardMaterial)) return source;
        const material = source.clone();
        if (source.userData.skinThicknessMap) material.userData.skinThicknessMap = source.userData.skinThicknessMap;
        this.materials.push(source);
        material.onBeforeCompile = shader => {
          shader.uniforms.skinDetailStrength = this.intensity;
          shader.vertexShader = shader.vertexShader.replace("#include <common>", `#include <common>
attribute float skinSurface;
varying float vSkinSurface;
varying vec3 vSkinRest;`).replace("#include <begin_vertex>", `#include <begin_vertex>
vSkinSurface = skinSurface;
vSkinRest = position;`);
          if (source.userData.skinV2 || source.userData.scannedPbr) {
            shader.uniforms.skinThicknessMap = { value: source.userData.skinThicknessMap };
            shader.fragmentShader = shader.fragmentShader
              .replace("#include <common>", `#include <common>
uniform float skinDetailStrength;
uniform sampler2D skinThicknessMap;
varying float vSkinSurface;`)
              .replace("#include <map_fragment>", source.userData.scannedPbr ? "#include <map_fragment>" : `
#ifdef USE_MAP
vec4 sampledDiffuseColor = texture2D(map, vMapUv);
diffuseColor *= mix(vec4(1.0), sampledDiffuseColor, vSkinSurface);
#endif`)
              .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
roughnessFactor = mix(0.78, roughnessFactor, skinDetailStrength * ${scanned ? "1.0" : "vSkinSurface"});`)
              .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
normal = normalize(mix(nonPerturbedNormal, normal, skinDetailStrength * ${scanned ? "1.0" : "vSkinSurface"}));`)
              .replace("#include <lights_physical_pars_fragment>", `#include <lights_physical_pars_fragment>
// Light-dependent, thickness-aware skin scattering approximation. Unlike
// transmission this does not make the skin transparent or reveal bones.
void RE_Direct_Skin(const in IncidentLight directLight, const in vec3 geometryPosition,
  const in vec3 geometryNormal, const in vec3 geometryViewDir,
  const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material,
  inout ReflectedLight reflectedLight) {
  RE_Direct_Physical(directLight, geometryPosition, geometryNormal, geometryViewDir,
    geometryClearcoatNormal, material, reflectedLight);
  #ifdef USE_MAP
  float thickness = texture2D(skinThicknessMap, vMapUv).r;
  float nDotL = dot(geometryNormal, directLight.direction);
  float wrap = max(0.0, (nDotL + 0.35) / 1.35) - max(0.0, nDotL);
  float back = max(0.0, -nDotL) * pow(max(0.0, dot(geometryViewDir, -directLight.direction)), 3.0);
  vec3 pigment = vec3(1.0, 0.38, 0.20);
  reflectedLight.directDiffuse += directLight.color * material.diffuseColor * pigment
    * (wrap * 0.18 + back * thickness * 0.28) * vSkinSurface * skinDetailStrength;
  #endif
}
#undef RE_Direct
#define RE_Direct RE_Direct_Skin`);
            return;
          }
          shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>
uniform float skinDetailStrength;
varying float vSkinSurface;
varying vec3 vSkinRest;
float skinHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float skinNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(skinHash(i), skinHash(i + vec3(1,0,0)), f.x),
                 mix(skinHash(i + vec3(0,1,0)), skinHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(skinHash(i + vec3(0,0,1)), skinHash(i + vec3(1,0,1)), f.x),
                 mix(skinHash(i + vec3(0,1,1)), skinHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}`)
            .replace("#include <color_fragment>", `#include <color_fragment>
float skinMask = vSkinSurface * skinDetailStrength;
float skinTone = skinNoise(vSkinRest * 38.0) - 0.5;
diffuseColor.rgb *= 1.0 + skinMask * skinTone * vec3(0.055, 0.035, 0.025);`)
            .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.52 + skinTone * 0.08, skinMask);`)
            .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
// Fade subpixel detail to avoid shimmering at the default full-body distance.
float skinFootprint = max(length(dFdx(vSkinRest)), length(dFdy(vSkinRest)));
float poreFade = 1.0 - smoothstep(0.0005, 0.0025, skinFootprint);
float skinHeight = skinNoise(vSkinRest * 1150.0) * 0.000016 * poreFade * skinMask;
vec3 skinDx = dFdx(-vViewPosition), skinDy = dFdy(-vViewPosition);
vec3 skinR1 = cross(skinDy, normal), skinR2 = cross(normal, skinDx);
float skinDet = dot(skinDx, skinR1);
vec3 skinGradient = dFdx(skinHeight) * skinR1 + dFdy(skinHeight) * skinR2;
normal = normalize(normal - skinGradient / (abs(skinDet) + 1e-10) * sign(skinDet));`);
        };
        material.customProgramCacheKey = () => source.userData.scannedPbr ? "scanned-human-pbr-v1" : source.userData.skinV2 ? "human-skin-pbr-v2" : "human-skin-surface-v1";
        material.needsUpdate = true;
        return material;
      });
      o.material = Array.isArray(o.material) ? updated : updated[0];
    });
    for (const mesh of this.meshes) {
      this.shadows.set(mesh, mesh.castShadow);
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        this.authored.set(m, { opacity: m.opacity, transparent: m.transparent, depthWrite: m.depthWrite });
    }
  }
  set enabled(value: boolean) { this.intensity.value = value ? 1 : 0; }
  setOpacity(opacity: number) {
    const value = T.MathUtils.clamp(opacity, 0.08, 1);
    for (const mesh of this.meshes) {
      mesh.castShadow = value === 1 && this.shadows.get(mesh)!;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const authored = this.authored.get(m)!;
        const transparent = value < 1 || authored.transparent;
        if (m.transparent !== transparent) { m.transparent = transparent; m.needsUpdate = true; }
        m.opacity = value * authored.opacity;
        m.depthWrite = value < 1 ? false : authored.depthWrite;
      }
    }
  }
  dispose() { new Set(this.materials).forEach(m => m.dispose()); }
}
