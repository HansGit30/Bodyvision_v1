/**
 * Materiales procedurales de tejido (MeshPhysicalMaterial + GLSL inyectado) y materiales holográficos.
 * Basado en el motor del repositorio 3d-human-body-anatomy; adaptado a uniforms por instancia,
 * prenda deportiva femenina, mapa térmico y planos de recorte para la animación de escaneo.
 */
import * as THREE from 'three'

export interface RigUniforms {
  uTime: { value: number }
  uScanY: { value: number }
  uScanColor: { value: THREE.Color }
  uDetail: { value: number }
  uLive: { value: number }
  uHeartPos: { value: THREE.Vector3 }
  uBrainPos: { value: THREE.Vector3 }
  uFemale: { value: number }
  uHeatMin: { value: number }
  uHeatMax: { value: number }
  uPalette: { value: number }
  uBands: { value: number }
  [k: string]: { value: unknown }
}

export function makeUniforms(): RigUniforms {
  return {
    uTime: { value: 0 },
    uScanY: { value: -10 },
    uScanColor: { value: new THREE.Color('#38f5e6') },
    uDetail: { value: 1 },
    uLive: { value: 0 },
    uHeartPos: { value: new THREE.Vector3(0, 1.25, 0.05) },
    uBrainPos: { value: new THREE.Vector3(0, 1.5, 0) },
    uFemale: { value: 0 },
    uHeatMin: { value: 0 },
    uHeatMax: { value: 0.08 },
    uPalette: { value: 0 },
    uBands: { value: 0 },
  }
}

export const BEAT = 0.85

interface Flow { origin: string; dir: number; speed: number; period: number; width: number; color: string; gain: number }
const FLOW: Record<string, Flow> = {
  artery: { origin: 'uHeartPos', dir: 1, speed: 0.55, period: BEAT, width: 0.13, color: '#ff6a5a', gain: 2.6 },
  pulmonaryArtery: { origin: 'uHeartPos', dir: 1, speed: 0.55, period: BEAT, width: 0.13, color: '#7d9bff', gain: 2.6 },
  vein: { origin: 'uHeartPos', dir: -1, speed: 0.35, period: BEAT, width: 0.15, color: '#6aa8ff', gain: 2.1 },
  pulmonaryVein: { origin: 'uHeartPos', dir: -1, speed: 0.35, period: BEAT, width: 0.15, color: '#ff7a6a', gain: 2.1 },
  nerve: { origin: 'uBrainPos', dir: 1, speed: 1.6, period: 0.33, width: 0.09, color: '#fff3a0', gain: 2.6 },
}
const f3 = (c: string) => new THREE.Color(c).toArray().map((v) => v.toFixed(3)).join(',')
const flowGLSL = (f: Flow, pos = 'vWPos', out = 'totalEmissiveRadiance') => `
  {
    float zd = length(${pos} - ${f.origin});
    float zph = fract(zd / ${(f.speed * f.period).toFixed(4)} - ${f.dir.toFixed(1)} * uTime / ${f.period.toFixed(4)});
    float zp = smoothstep(${f.width.toFixed(3)}, 0.0, zph) + smoothstep(1.0 - ${(f.width * 0.35).toFixed(3)}, 1.0, zph);
    ${out} += vec3(${f3(f.color)}) * zp * ${f.gain.toFixed(2)} * uLive;
  }`

const NOISE = `
vec3 z_mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 z_mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 z_perm(vec4 x){return z_mod289(((x*34.0)+10.0)*x);}
vec4 z_tis(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=z_mod289(i);
  vec4 p=z_perm(z_perm(z_perm(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=z_tis(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 105.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm3(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<3;i++){ s+=a*snoise(p); p*=2.03; a*=0.5; } return s; }
float zfp;
float N(vec3 q, float fr){ return snoise(q*fr) * smoothstep(0.9, 0.2, zfp*fr); }
float F(vec3 q, float fr){ return fbm3(q*fr) * smoothstep(0.9, 0.2, zfp*fr); }
vec3 zPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir){
  vec3 vSigmaX=normalize(dFdx(surf_pos)); vec3 vSigmaY=normalize(dFdy(surf_pos)); vec3 vN=surf_norm;
  vec3 R1=cross(vSigmaY,vN); vec3 R2=cross(vN,vSigmaX); float fDet=dot(vSigmaX,R1)*faceDir;
  vec3 vGrad=sign(fDet)*(dHdxy.x*R1+dHdxy.y*R2); return normalize(abs(fDet)*surf_norm-vGrad);
}
`

export type Tissue = 'bone' | 'cartilage' | 'teeth' | 'muscle' | 'tendon' | 'nerve' | 'vessel' | 'organ' | 'lung' | 'brain' | 'gut' | 'skin' | 'hair' | 'fabric' | 'plain'

const TISSUE: Record<Tissue, string> = {
  bone: `float big = F(p, 9.0); float pores = N(p, 420.0); float h = pores*0.55 + big*0.25 + N(p, 110.0)*0.2;
    float cvar = big*0.10 + pores*0.03; float rvar = pores*0.12; float bump = 0.14;`,
  cartilage: `float h = N(p, 160.0)*0.5; float cvar = F(p, 20.0)*0.05; float rvar = 0.0; float bump = 0.05;`,
  teeth: `float h = N(p, 300.0)*0.3; float cvar = F(p, 60.0)*0.05; float rvar = 0.0; float bump = 0.04;`,
  muscle: `vec3 fa = normalize(f + vec3(1e-4)); float along = dot(p, fa); vec3 perp = p - fa*along;
    float fib = N(perp + fa*along*(25.0/900.0), 900.0); float bundle = N(perp + fa*along*(6.0/160.0), 160.0);
    float h = fib*0.45 + bundle*0.55; float cvar = bundle*0.12 + fib*0.05 + F(p, 8.0)*0.06; float rvar = -bundle*0.12; float bump = 0.16;`,
  tendon: `vec3 fa = normalize(f + vec3(1e-4)); float along = dot(p, fa); vec3 perp = p - fa*along;
    float h = N(perp + fa*along*(20.0/1200.0), 1200.0)*0.6; float cvar = h*0.05; float rvar = 0.0; float bump = 0.07;`,
  nerve: `vec3 fa = normalize(f + vec3(1e-4)); float along = dot(p, fa); vec3 perp = p - fa*along;
    float h = N(perp + fa*along*(40.0/1400.0), 1400.0)*0.6; float cvar = h*0.08; float rvar = 0.0; float bump = 0.07;`,
  vessel: `float h = N(p, 220.0)*0.35; float cvar = F(p, 30.0)*0.10; float rvar = 0.0; float bump = 0.05;`,
  organ: `float big = F(p, 18.0); float h = N(p, 180.0)*0.4 + big*0.3; float cvar = big*0.12; float rvar = N(p, 90.0)*0.15; float bump = 0.09;`,
  lung: `float h = N(p, 350.0)*0.5 + N(p, 90.0)*0.3; float cvar = F(p, 25.0)*0.16; float rvar = 0.1; float bump = 0.12;`,
  brain: `float h = N(p, 260.0)*0.3; float cvar = F(p, 40.0)*0.08; float rvar = 0.0; float bump = 0.07;`,
  gut: `float h = N(p, 140.0)*0.5 + N(p, 400.0)*0.2; float cvar = F(p, 22.0)*0.12; float rvar = N(p, 60.0)*0.12; float bump = 0.10;`,
  skin: `float pores = N(p, 900.0); float mottle = F(p, 14.0); float h = pores*0.5 + N(p, 260.0)*0.3;
    float cvar = mottle*0.05 + pores*0.015; float rvar = pores*0.08 + mottle*0.05; float bump = 0.05;`,
  hair: `float h = N(p*vec3(1.0,0.1,1.0), 600.0)*0.7; float cvar = h*0.12; float rvar = 0.1; float bump = 0.09;`,
  fabric: `float h = N(p, 1600.0)*0.35 + N(p*vec3(1.0,3.0,1.0), 700.0)*0.25; float cvar = F(p, 30.0)*0.05; float rvar = 0.0; float bump = 0.06;`,
  plain: `float h = 0.0; float cvar = 0.0; float rvar = 0.0; float bump = 0.0;`,
}

const PHYS: Record<Tissue, Partial<THREE.MeshPhysicalMaterialParameters> & { sheenColorHex?: string }> = {
  bone: { roughness: 0.62, clearcoat: 0.05 },
  cartilage: { roughness: 0.28, clearcoat: 0.6, clearcoatRoughness: 0.25 },
  teeth: { roughness: 0.2, clearcoat: 0.8, clearcoatRoughness: 0.1 },
  muscle: { roughness: 0.48, clearcoat: 0.35, clearcoatRoughness: 0.35, sheen: 0.5, sheenRoughness: 0.4, sheenColorHex: '#ff9a8a' },
  tendon: { roughness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.25, sheen: 0.6, sheenColorHex: '#ffffff' },
  nerve: { roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.3, sheen: 0.3, sheenColorHex: '#fff4c0' },
  vessel: { roughness: 0.28, clearcoat: 0.85, clearcoatRoughness: 0.15 },
  organ: { roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.2 },
  lung: { roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.4, sheen: 0.5, sheenColorHex: '#ffd0d0' },
  brain: { roughness: 0.4, clearcoat: 0.55, clearcoatRoughness: 0.3 },
  gut: { roughness: 0.3, clearcoat: 0.9, clearcoatRoughness: 0.15 },
  skin: { roughness: 0.5, clearcoat: 0.08, clearcoatRoughness: 0.5, sheen: 0.55, sheenRoughness: 0.55, sheenColorHex: '#ffb49a' },
  hair: { roughness: 0.45, sheen: 0.8, sheenColorHex: '#8a6a50' },
  fabric: { roughness: 0.85, sheen: 0.7, sheenRoughness: 0.5, sheenColorHex: '#8fa4d8' },
  plain: { roughness: 0.4 },
}

export const USES_FIBRE = new Set<Tissue>(['muscle', 'tendon', 'nerve'])

/** Material de tejido. opts.flow añade pulsos "vivos"; opts.garment activa la prenda superior femenina (piel). */
export function makeTissueMaterial(U: RigUniforms, color: string, tissue: Tissue, opts: { flow?: string; garment?: boolean; emissive?: string } = {}) {
  const { sheenColorHex, ...phys } = PHYS[tissue]
  const m = new THREE.MeshPhysicalMaterial({ color, metalness: 0, side: THREE.DoubleSide, ...phys })
  if (sheenColorHex) m.sheenColor = new THREE.Color(sheenColorHex)
  if (opts.emissive) { m.emissive = new THREE.Color(opts.emissive); m.emissiveIntensity = 0.55 }
  m.userData.tissue = tissue
  const recipe = TISSUE[tissue]
  const fibre = USES_FIBRE.has(tissue)
  const flow = opts.flow ? FLOW[opts.flow] : undefined
  const garment = !!opts.garment
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vObjPos; varying vec3 vWPos; ${fibre ? 'attribute vec3 aFiber; varying vec3 vFiber;' : ''}
        ${garment ? 'attribute float aGarment; varying float vGarment;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vObjPos = position; vWPos = (modelMatrix * vec4(position,1.0)).xyz; ${fibre ? 'vFiber = aFiber;' : ''} ${garment ? 'vGarment = aGarment;' : ''}`)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform float uScanY; uniform vec3 uScanColor; uniform float uDetail;
        uniform float uLive; uniform vec3 uHeartPos; uniform vec3 uBrainPos; uniform float uFemale;
        varying vec3 vObjPos; varying vec3 vWPos; ${fibre ? 'varying vec3 vFiber;' : ''} ${garment ? 'varying float vGarment;' : ''}
        ${NOISE}
        float zH; float zC; float zR; float zB;
        void zTissue(){ vec3 p = vObjPos; zfp = length(fwidth(vObjPos)); vec3 f = ${fibre ? 'vFiber' : 'vec3(0.0,1.0,0.0)'}; ${recipe} zH=h; zC=cvar; zR=rvar; zB=bump; }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        zTissue();
        diffuseColor.rgb *= clamp(1.0 + zC*uDetail*2.0 - max(0.0,-zH)*0.06*uDetail, 0.0, 2.0);
        ${garment ? `
        float zTop = uFemale * step(0.5, vGarment) * smoothstep(1.163, 1.171, vObjPos.y) * (1.0 - smoothstep(1.347, 1.355, vObjPos.y));
        float zTrim = zTop * (smoothstep(1.171, 1.176, vObjPos.y) * (1.0 - smoothstep(1.176, 1.181, vObjPos.y)));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.07, 0.11, 0.22), zTop);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.83, 0.93), zTrim);` : ''}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + zR*uDetail, 0.04, 1.0);
        ${garment ? 'roughnessFactor = mix(roughnessFactor, 0.85, zTop);' : ''}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (uDetail > 0.0 && zB > 0.0) {
          normal = zPerturb(-vViewPosition, normal, vec2(dFdx(zH), dFdy(zH)) * zB * uDetail, faceDirection);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float zd = abs(vWPos.y - uScanY);
        totalEmissiveRadiance += uScanColor * (smoothstep(0.012, 0.0, zd) * 1.6 + smoothstep(0.12, 0.0, zd) * 0.12);
        ${flow ? `if (uLive > 0.001) ${flowGLSL(flow)}` : ''}`)
  }
  m.customProgramCacheKey = () => `tissue-${tissue}-${opts.flow || ''}-${garment ? 'g' : ''}-${opts.emissive ? 'e' : ''}`
  return m
}

const CLIP_V = ['#include <clipping_planes_pars_vertex>', '#include <clipping_planes_vertex>']
const CLIP_F = ['#include <clipping_planes_pars_fragment>', '#include <clipping_planes_fragment>']

/** Holograma: rim fresnel + líneas de escaneo, aditivo. */
export function makeHoloMaterial(U: RigUniforms, color: string, opts: { flow?: string; intensity?: number } = {}) {
  const flow = opts.flow ? FLOW[opts.flow] : undefined
  const m = new THREE.ShaderMaterial({
    uniforms: { ...U, uColor: { value: new THREE.Color(color) }, uOpacity: { value: 1 }, uGain: { value: opts.intensity ?? 1 } },
    vertexShader: `
      ${CLIP_V[0]}
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){ vec4 wp = modelMatrix*vec4(position,1.0); vW = wp.xyz;
        vN = normalize(normalMatrix*normal); vec4 mvPosition = viewMatrix*wp; vV = -mvPosition.xyz; gl_Position = projectionMatrix*mvPosition;
        ${CLIP_V[1]}
      }`,
    fragmentShader: `
      ${CLIP_F[0]}
      uniform vec3 uColor; uniform float uTime; uniform float uScanY; uniform vec3 uScanColor; uniform float uOpacity; uniform float uGain;
      uniform float uLive; uniform vec3 uHeartPos; uniform vec3 uBrainPos;
      varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){
        ${CLIP_F[1]}
        float fr = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        float lines = 0.75 + 0.25*sin(vW.y*900.0 - uTime*4.0);
        float scan = smoothstep(0.02, 0.0, abs(vW.y - uScanY));
        vec3 c = (mix(uColor*0.25, uColor*1.6 + 0.2, fr) * lines + uScanColor*scan*1.5) * uGain;
        ${flow ? `if (uLive > 0.001) ${flowGLSL(flow, 'vW', 'c')}` : ''}
        gl_FragColor = vec4(c, (0.12 + fr*0.85) * uOpacity);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  })
  m.clipping = true
  return m
}

/** Mapa térmico del grosor estimado de tejido subcutáneo (atributo aHeat, 0..1). */
export function makeHeatMaterial(U: RigUniforms) {
  const m = new THREE.ShaderMaterial({
    uniforms: { ...U },
    vertexShader: `
      ${CLIP_V[0]}
      attribute float aHeat; varying float vHeat; varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){ vHeat = aHeat; vec4 wp = modelMatrix*vec4(position,1.0); vW = wp.xyz;
        vN = normalize(normalMatrix*normal); vec4 mvPosition = viewMatrix*wp; vV = -mvPosition.xyz; gl_Position = projectionMatrix*mvPosition;
        ${CLIP_V[1]}
      }`,
    fragmentShader: `
      ${CLIP_F[0]}
      uniform float uScanY; uniform vec3 uScanColor; uniform float uHeatMin; uniform float uHeatMax; uniform float uPalette; uniform float uBands;
      varying float vHeat; varying vec3 vN; varying vec3 vV; varying vec3 vW;
      vec3 ramp(float t){
        t = clamp(t, 0.0, 1.0);
        vec3 c0 = vec3(0.12,0.23,0.54), c1 = vec3(0.02,0.71,0.83), c2 = vec3(0.13,0.77,0.37), c3 = vec3(0.98,0.8,0.08), c4 = vec3(0.98,0.45,0.09), c5 = vec3(0.86,0.15,0.15);
        if (t < 0.2) return mix(c0, c1, t/0.2);
        if (t < 0.4) return mix(c1, c2, (t-0.2)/0.2);
        if (t < 0.6) return mix(c2, c3, (t-0.4)/0.2);
        if (t < 0.8) return mix(c3, c4, (t-0.6)/0.2);
        return mix(c4, c5, (t-0.8)/0.2);
      }
      vec3 diverge(float t){
        t = clamp(t, 0.0, 1.0);
        vec3 a = vec3(0.13,0.4,0.95), m = vec3(0.92,0.95,1.0), b = vec3(0.9,0.15,0.2);
        return t < 0.5 ? mix(a, m, t*2.0) : mix(m, b, (t-0.5)*2.0);
      }
      void main(){
        ${CLIP_F[1]}
        vec3 n = normalize(vN); vec3 v = normalize(vV);
        float diff = 0.55 + 0.45*abs(dot(n, normalize(vec3(0.3,0.6,0.8))));
        float fr = pow(1.0 - abs(dot(n, v)), 2.5);
        float t = (vHeat - uHeatMin) / max(1e-5, uHeatMax - uHeatMin);
        vec3 base = uPalette > 0.5 ? diverge(t) : ramp(t);
        if (uBands > 0.5) { float q = fract(clamp(t,0.0,1.0) * 10.0); base *= 0.78 + 0.22 * smoothstep(0.0, 0.08, q) * smoothstep(1.0, 0.92, q); }
        vec3 c = base * diff + fr*0.25 + uScanColor * smoothstep(0.015, 0.0, abs(vW.y - uScanY)) * 1.2;
        gl_FragColor = vec4(c, 1.0);
      }`,
    side: THREE.DoubleSide,
  })
  m.clipping = true
  return m
}

/** Eje principal (PCA) por malla para la dirección de las fibras. */
export function addFiberAttribute(geometry: THREE.BufferGeometry) {
  const pos = geometry.attributes.position as THREE.BufferAttribute
  const n = pos.count
  let cx = 0, cy = 0, cz = 0
  for (let i = 0; i < n; i++) { cx += pos.getX(i); cy += pos.getY(i); cz += pos.getZ(i) }
  cx /= n; cy /= n; cz /= n
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0
  const step = Math.max(1, Math.floor(n / 4000))
  for (let i = 0; i < n; i += step) {
    const x = pos.getX(i) - cx, y = pos.getY(i) - cy, z = pos.getZ(i) - cz
    xx += x * x; xy += x * y; xz += x * z; yy += y * y; yz += y * z; zz += z * z
  }
  let v = new THREE.Vector3(0.3, 1, 0.2).normalize()
  for (let k = 0; k < 24; k++) {
    v = new THREE.Vector3(xx * v.x + xy * v.y + xz * v.z, xy * v.x + yy * v.y + yz * v.z, xz * v.x + yz * v.y + zz * v.z).normalize()
  }
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { arr[i * 3] = v.x; arr[i * 3 + 1] = v.y; arr[i * 3 + 2] = v.z }
  geometry.setAttribute('aFiber', new THREE.BufferAttribute(arr, 3))
}

// ---------------------------------------------------------------- colores y tipos de tejido
const ORGAN_RULES: [RegExp, string][] = [
  [/liver|segment of liver|caudate lobe|quadrate lobe/i, '#7b2d24'], [/gallbladder/i, '#4f7d3a'], [/kidney|renal/i, '#8a3530'],
  [/spleen/i, '#6d2a3c'], [/leaflet|cusp/i, '#e8d9c8'], [/ventricle|atrium|auricle|heart|myocard|septum/i, '#a8303a'],
  [/lung/i, '#e39a9a'], [/stomach|duodenum|jejunum|ileum|intestin|colon|caecum|cecum|appendix|rectum|anal canal|oesophag|esophag/i, '#e09a86'],
  [/pancrea/i, '#e8c07a'], [/thyroid|parathyroid|suprarenal|adrenal|hypophysis|pituitary|pineal|thymus/i, '#d9a55e'],
  [/bladder/i, '#d9b38c'], [/tongue/i, '#d0666e'],
]
const MAT_COLORS: Record<string, Record<string, string>> = {
  organs: {
    Lung: '#e39a9a', Organ: '#8e3b30', Intestine: '#e09a86', Gland: '#e0b36a', Mucosa: '#d9848c', Ductus: '#c8c86a', Bronchi: '#e3e8ea',
    Gallbladder: '#4f7d3a', Eye: '#e6e0d8', Cornea: '#cfe8ff', Iris: '#4f7aa6', Nucleus: '#c7a0d9', Cartilage: '#cfe3e8', Trapezius: '#a8303a',
    'Frontal lobe': '#e8b8b0', 'Parietal lobe': '#e3b3b8', 'Temporal lobe': '#e6bca6', 'Occipital lobe': '#dcb0c0', 'Limbic lobe': '#e0a8a0',
    Insula: '#e0b8a0', Cerebellum: '#d99a9a', Brain: '#e2b6ae', 'Interlobar sulci': '#c99a94', 'White matter': '#f0e6dc', Lymph: '#8fc97a',
  },
  skeleton: { Bone: '#e8e0cc', Cartilage: '#bcdde3', Teeth: '#f7f2e4' },
  skin: { Skin: '#d6a07e', Nail: '#efc6b8', Black: '#2b1d18', Eye: '#e6e0d8', Cornea: '#cfe8ff', Iris: '#5b4030', Garment: '#1c2b4c' },
}
const BRAIN_MATS = new Set(['Frontal lobe', 'Parietal lobe', 'Temporal lobe', 'Occipital lobe', 'Limbic lobe', 'Insula', 'Cerebellum', 'Brain', 'Interlobar sulci', 'White matter', 'Nucleus'])

export function colorFor(layer: string, mat: string, name: string) {
  if (layer === 'arteries') return mat === 'Pulmonary artery' ? '#6f7fd8' : '#c8323c'
  if (layer === 'veins') return mat === 'Pulmonary vein' ? '#c84a5a' : '#3f5fbf'
  if (layer === 'nerves') return '#f0d264'
  if (layer === 'muscles') return mat === 'Tendon' ? '#eadfc8' : '#b8433c'
  if (layer === 'organs') for (const [re, c] of ORGAN_RULES) if (re.test(name)) return c
  return MAT_COLORS[layer]?.[mat] || '#cccccc'
}

export function tissueFor(layer: string, mat: string, name: string): Tissue {
  switch (layer) {
    case 'skeleton': return mat === 'Teeth' ? 'teeth' : mat === 'Cartilage' ? 'cartilage' : 'bone'
    case 'muscles': return mat === 'Tendon' ? 'tendon' : 'muscle'
    case 'arteries': case 'veins': return 'vessel'
    case 'nerves': return 'nerve'
    case 'skin':
      if (mat === 'Black') return 'hair'
      if (mat === 'Nail') return 'teeth'
      if (mat === 'Skin') return 'skin'
      if (mat === 'Garment') return 'fabric'
      return 'plain'
    case 'organs':
      if (mat === 'Lung') return 'lung'
      if (BRAIN_MATS.has(mat)) return 'brain'
      if (mat === 'Bronchi' || mat === 'Cartilage') return 'cartilage'
      if (mat === 'Eye' || mat === 'Cornea' || mat === 'Iris') return 'plain'
      if (mat === 'Intestine' || mat === 'Mucosa' || /stomach|oesophag|colon|rectum|duoden|jejun|ile/i.test(name)) return 'gut'
      return 'organ'
  }
  return 'plain'
}

export function flowFor(layer: string, mat: string) {
  if (layer === 'arteries') return mat === 'Pulmonary artery' ? 'pulmonaryArtery' : 'artery'
  if (layer === 'veins') return mat === 'Pulmonary vein' ? 'pulmonaryVein' : 'vein'
  if (layer === 'nerves') return 'nerve'
  return undefined
}
