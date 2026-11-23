import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode, type ComponentRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { AnatomyRig, type PartInfo, type PartMesh } from './engine/AnatomyRig'
import { DRACO_PATH, MODEL_HEIGHT_M, modelUrl, type LayerKey } from './engine/layers'
import type { LM } from '../../types'

export type LayerStatus = 'loading' | 'ready' | 'error'
type StatusFn = (layer: LayerKey, status: LayerStatus, error?: string) => void

// ------------------------------------------------------------------ carga de capas
function LayerLoader({ rig, layer, onStatus }: { rig: AnatomyRig; layer: LayerKey; onStatus: StatusFn }) {
  const t0 = useRef(performance.now())
  const cb = useRef(onStatus)
  cb.current = onStatus
  const gltf = useGLTF(modelUrl(layer), DRACO_PATH)
  useLayoutEffect(() => {
    rig.addLayer(layer, gltf.scene, performance.now() - t0.current)
    cb.current(layer, 'ready')
    return () => rig.removeLayer(layer)
  }, [rig, layer, gltf])
  return null
}

function Pending({ layer, onStatus }: { layer: LayerKey; onStatus: StatusFn }) {
  const cb = useRef(onStatus)
  cb.current = onStatus
  useEffect(() => { cb.current(layer, 'loading') }, [layer])
  return null
}

class LayerBoundary extends Component<{ layer: LayerKey; onStatus: StatusFn; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(err: Error) {
    useGLTF.clear(modelUrl(this.props.layer))
    this.props.onStatus(this.props.layer, 'error', err?.message || 'Error de carga')
  }
  render() { return this.state.failed ? null : this.props.children }
}

export function RigLayers({ rig, layers, retry, onStatus }: { rig: AnatomyRig; layers: LayerKey[]; retry: Record<string, number>; onStatus: StatusFn }) {
  return (
    <>
      {layers.map((k) => (
        <LayerBoundary key={`${k}-${retry[k] || 0}`} layer={k} onStatus={onStatus}>
          <Suspense fallback={<Pending layer={k} onStatus={onStatus} />}>
            <LayerLoader rig={rig} layer={k} onStatus={onStatus} />
          </Suspense>
        </LayerBoundary>
      ))}
    </>
  )
}

/** Monta el grupo raíz del rig y lo actualiza cada fotograma. */
export function RigRoot({ rig, position }: { rig: AnatomyRig; position?: [number, number, number] }) {
  useEffect(() => {
    if (position) rig.root.position.set(...position)
  }, [rig, position])
  useFrame((_, dt) => rig.update(Math.min(dt, 0.05)))
  return <primitive object={rig.root} />
}

// ------------------------------------------------------------------ entorno y escenario holográfico
export function Lighting() {
  const { gl, scene } = useThree()
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl)
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = env
    scene.environmentIntensity = 0.45
    return () => { scene.environment = null; env.dispose(); pm.dispose() }
  }, [gl, scene])
  return (
    <>
      <directionalLight color="#fff1e0" intensity={1.7} position={[1.5, 3, 2.5]} />
      <directionalLight color="#bfd4ff" intensity={0.6} position={[-2, 1.5, 2]} />
      <directionalLight color="#38f5e6" intensity={2.4} position={[-2.5, 2, -2.5]} />
      <directionalLight color="#b967ff" intensity={1.6} position={[2.5, 1.2, -2.5]} />
      <hemisphereLight args={['#c8dcff', '#1a1030', 0.35]} />
    </>
  )
}

export function Stage({ rig, particles = true, radius = 0.6 }: { rig: AnatomyRig; particles?: boolean; radius?: number }) {
  const floorMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { uTime: rig.U.uTime, uR: { value: radius } },
    transparent: true, depthWrite: false,
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
    fragmentShader: `uniform float uTime; uniform float uR; varying vec3 vW;
      float gridLine(vec2 p, float s, float w){ vec2 g = abs(fract(p/s - 0.5) - 0.5) / fwidth(p/s); return 1.0 - min(min(g.x,g.y)/w, 1.0); }
      void main(){
        float r = length(vW.xz);
        float fine = gridLine(vW.xz, 0.1, 1.0) * 0.35; float coarse = gridLine(vW.xz, 0.5, 1.4) * 0.7;
        float fade = smoothstep(4.0, 0.2, r);
        float ripple = smoothstep(0.03, 0.0, abs(fract(r*0.6 - uTime*0.25) - 0.5) - 0.47) * 0.6;
        float disc = smoothstep(uR+0.02, uR-0.02, r) * 0.2 + smoothstep(0.015, 0.0, abs(r - uR)) * 1.3 + smoothstep(0.01, 0.0, abs(r - uR - 0.06)) * 0.6;
        vec3 c = vec3(0.13, 0.83, 0.93) * (fine + coarse + ripple*fade + disc) + vec3(0.55,0.36,0.96) * smoothstep(0.012,0.0,abs(r-uR-0.15))*0.5;
        gl_FragColor = vec4(c, (fine*0.5 + coarse*0.55 + ripple*0.6 + disc) * fade * 0.5);
      }`,
  }), [rig, radius])
  const rings = useRef<THREE.Group>(null)
  const scanRing = useRef<THREE.Mesh>(null)
  const pts = useMemo(() => {
    const N = 420, pos = new Float32Array(N * 3), seed = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.4 + Math.random() * 2.4
      pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = Math.random() * 2.4; pos[i * 3 + 2] = Math.sin(a) * r; seed[i] = Math.random()
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1))
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: rig.U.uTime }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `uniform float uTime; attribute float seed; varying float vA;
        void main(){ vec3 p = position; p.y = mod(p.y + uTime*(0.03+seed*0.05), 2.4);
          vA = sin(uTime*(1.0+seed*2.0) + seed*40.0)*0.5+0.5; vec4 mv = modelViewMatrix*vec4(p,1.0);
          gl_PointSize = (1.5 + seed*3.0) * (3.0 / -mv.z); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord-0.5); float a = smoothstep(0.5,0.0,d)*vA*0.75;
        gl_FragColor = vec4(mix(vec3(0.13,0.83,0.93), vec3(0.55,0.36,0.96), vA), a); }`,
    })
    return { geo, mat }
  }, [rig])
  const beamMat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'varying vec2 vUv; void main(){ float a = pow(1.0 - vUv.y, 2.0) * 0.04; gl_FragColor = vec4(0.13,0.83,0.93, a); }',
  }), [])
  const ringMat = (c: string, o: number) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })
  const ringMats = useMemo(() => [ringMat('#22d3ee', 0.9), ringMat('#a78bfa', 0.9), ringMat('#22d3ee', 0.35), ringMat('#5eead4', 0.95)], [])
  useEffect(() => () => { floorMat.dispose(); pts.geo.dispose(); pts.mat.dispose(); beamMat.dispose(); ringMats.forEach((m) => m.dispose()) }, [floorMat, pts, beamMat, ringMats])

  useFrame((_, dt) => {
    rings.current?.children.forEach((r) => { r.rotation.z += ((r.userData.spin as number) || 0) * dt })
    if (scanRing.current) {
      const y = rig.U.uScanY.value
      scanRing.current.visible = y > -0.5
      scanRing.current.position.y = y
      const s = rig.heightScale
      scanRing.current.scale.set(s * 1.05, s * 0.6, s)
    }
  })
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} material={floorMat} renderOrder={-1}>
        <planeGeometry args={[10, 10]} />
      </mesh>
      <group ref={rings}>
        <mesh rotation-x={-Math.PI / 2} position-y={0.004} material={ringMats[0]} userData={{ spin: 0.4 }}><ringGeometry args={[radius - 0.1, radius - 0.088, 128, 1, 0, Math.PI * 1.4]} /></mesh>
        <mesh rotation-x={-Math.PI / 2} position-y={0.006} material={ringMats[1]} userData={{ spin: -0.7 }}><ringGeometry args={[radius - 0.06, radius - 0.054, 128, 1, 0, Math.PI * 0.8]} /></mesh>
        <mesh rotation-x={-Math.PI / 2} position-y={0.002} material={ringMats[2]} userData={{ spin: 0.1 }}><ringGeometry args={[radius + 0.1, radius + 0.12, 6]} /></mesh>
      </group>
      <mesh position-y={1.15} material={beamMat}><cylinderGeometry args={[0.42, 0.55, 2.3, 48, 1, true]} /></mesh>
      {particles ? <points geometry={pts.geo} material={pts.mat} /> : null}
      <mesh ref={scanRing} rotation-x={Math.PI / 2} material={ringMats[3]} visible={false}><torusGeometry args={[0.34, 0.003, 8, 160]} /></mesh>
    </group>
  )
}

// ------------------------------------------------------------------ cámara
export type ViewName = 'front' | 'back' | 'left' | 'right' | 'persp'
export interface CameraApi {
  view: (v: ViewName) => void
  zoom: (f: number) => void
  reset: () => void
  focus: (box: THREE.Box3) => void
}

export function CameraRig({ rig, apiRef, autoRotate, target = [0, 0, 0] }: { rig: AnatomyRig; apiRef?: React.MutableRefObject<CameraApi | null>; autoRotate: boolean; target?: [number, number, number] }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const { camera } = useThree()
  const anim = useRef<{ p0: THREE.Vector3; t0: THREE.Vector3; p1: THREE.Vector3; t1: THREE.Vector3; k: number } | null>(null)
  const ox = target[0]

  const home = () => {
    const H = rig.bodyHeight
    return { pos: new THREE.Vector3(ox, H * 0.62, H * 2.15), tgt: new THREE.Vector3(ox, H * 0.5, 0) }
  }
  const go = (pos: THREE.Vector3, tgt: THREE.Vector3) => {
    const c = controls.current
    if (!c) return
    anim.current = { p0: camera.position.clone(), t0: c.target.clone(), p1: pos, t1: tgt, k: 0 }
  }
  useLayoutEffect(() => {
    const h = home()
    camera.position.copy(h.pos)
    controls.current?.target.copy(h.tgt)
    controls.current?.update()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!apiRef) return
    apiRef.current = {
      view(v) {
        const H = rig.bodyHeight, d = H * 2.15, tgt = new THREE.Vector3(ox, H * 0.5, 0)
        const pos = {
          front: new THREE.Vector3(ox, H * 0.55, d), back: new THREE.Vector3(ox, H * 0.55, -d),
          left: new THREE.Vector3(ox + d, H * 0.55, 0), right: new THREE.Vector3(ox - d, H * 0.55, 0),
          persp: new THREE.Vector3(ox + d * 0.62, H * 0.82, d * 0.8),
        }[v]
        go(pos, tgt)
      },
      zoom(f) {
        const c = controls.current
        if (!c) return
        const off = camera.position.clone().sub(c.target)
        const len = THREE.MathUtils.clamp(off.length() * f, c.minDistance, c.maxDistance)
        go(c.target.clone().add(off.setLength(len)), c.target.clone())
      },
      reset() { const h = home(); go(h.pos, h.tgt) },
      focus(box) {
        const c = controls.current
        if (!c) return
        const ctr = box.getCenter(new THREE.Vector3())
        const size = box.getSize(new THREE.Vector3()).length()
        const dir = camera.position.clone().sub(c.target).normalize()
        go(ctr.clone().add(dir.multiplyScalar(Math.max(size * 1.9, 0.32))), ctr)
      },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiRef, rig, camera, ox])

  useFrame((_, dt) => {
    const a = anim.current, c = controls.current
    if (!a || !c) return
    a.k = Math.min(1, a.k + dt / 0.9)
    const k = a.k < 0.5 ? 4 * a.k ** 3 : 1 - (-2 * a.k + 2) ** 3 / 2
    camera.position.lerpVectors(a.p0, a.p1, k)
    c.target.lerpVectors(a.t0, a.t1, k)
    c.update()
    if (a.k >= 1) anim.current = null
  })
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      autoRotate={autoRotate}
      autoRotateSpeed={1.1}
      minDistance={0.25}
      maxDistance={MODEL_HEIGHT_M * 4.5}
      maxPolarAngle={Math.PI * 0.92}
      onStart={() => { anim.current = null }}
    />
  )
}

// ------------------------------------------------------------------ interacción (hover + clic)
export function Interaction({ rig, onHover, onSelect, enabled = true }: {
  rig: AnatomyRig
  onHover: (info: PartInfo | null, x: number, y: number) => void
  onSelect?: (info: PartInfo | null) => void
  enabled?: boolean
}) {
  const { gl, camera } = useThree()
  const ray = useMemo(() => new THREE.Raycaster(), [])
  const hoverCb = useRef(onHover)
  const selectCb = useRef(onSelect)
  hoverCb.current = onHover
  selectCb.current = onSelect
  useEffect(() => {
    if (!enabled) return
    const onHover = (i: PartInfo | null, x: number, y: number) => hoverCb.current(i, x, y)
    const onSelect = (i: PartInfo | null) => selectCb.current?.(i)
    const el = gl.domElement
    let raf = 0, lastX = 0, lastY = 0, dragging = false, downX = 0, downY = 0, inside = false
    const ndc = new THREE.Vector2()
    const pickAt = (x: number, y: number): PartMesh | null => {
      const r = el.getBoundingClientRect()
      ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      return rig.pick(ray)
    }
    const doHover = () => {
      raf = 0
      if (dragging || !inside) return
      const m = pickAt(lastX, lastY)
      rig.setHover(m)
      el.style.cursor = m ? 'pointer' : 'grab'
      onHover(rig.info(m), lastX, lastY)
    }
    const move = (e: PointerEvent) => {
      lastX = e.clientX; lastY = e.clientY; inside = true
      if (e.buttons) { dragging = true; rig.setHover(null); onHover(null, 0, 0); return }
      dragging = false
      if (!raf) raf = requestAnimationFrame(doHover)
    }
    const down = (e: PointerEvent) => { downX = e.clientX; downY = e.clientY }
    const up = (e: PointerEvent) => {
      dragging = false
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return
      const m = pickAt(e.clientX, e.clientY)
      rig.select(m)
      onSelect(rig.info(m))
      if (e.pointerType !== 'mouse') onHover(rig.info(m), e.clientX, e.clientY)
    }
    const leave = () => { inside = false; rig.setHover(null); onHover(null, 0, 0); el.style.cursor = '' }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointerleave', leave)
    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointerleave', leave)
    }
  }, [gl, camera, rig, ray, enabled])
  return null
}

// ------------------------------------------------------------------ landmarks MediaPipe en 3D
export const POSE_EDGES: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32], [15, 17], [15, 19], [15, 21], [16, 18], [16, 20], [16, 22], [0, 11], [0, 12],
]

export function Landmarks3D({ world, hipY, color = '#22d3ee', scale = 1 }: { world: LM[]; hipY: number; color?: string; scale?: number }) {
  const { points, lines } = useMemo(() => {
    const pts = world.map((p) => new THREE.Vector3(p.x * scale, hipY - p.y * scale, -p.z * scale))
    const seg: number[] = []
    for (const [a, b] of POSE_EDGES) if (pts[a] && pts[b]) seg.push(pts[a].x, pts[a].y, pts[a].z, pts[b].x, pts[b].y, pts[b].z)
    const lg = new THREE.BufferGeometry()
    lg.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3))
    return { points: pts, lines: lg }
  }, [world, hipY, scale])
  useEffect(() => () => lines.dispose(), [lines])
  return (
    <group renderOrder={20}>
      <lineSegments geometry={lines}>
        <lineBasicMaterial color={color} transparent opacity={0.95} depthTest={false} />
      </lineSegments>
      {points.map((p, i) => (i > 0 && i < 11 ? null : (
        <mesh key={i} position={p} renderOrder={21}>
          <sphereGeometry args={[i === 0 ? 0.022 : 0.016, 14, 10]} />
          <meshBasicMaterial color={i % 2 ? '#a78bfa' : color} depthTest={false} transparent opacity={0.95} />
        </mesh>
      )))}
    </group>
  )
}
