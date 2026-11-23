import * as THREE from 'three'
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh'
import { LAYERS, LAYER_BY_KEY, MODEL_HEIGHT_M, type LayerKey } from './layers'
import {
  BEAT, addFiberAttribute, colorFor, flowFor, makeHeatMaterial, makeHoloMaterial, makeTissueMaterial, makeUniforms,
  tissueFor, USES_FIBRE, type RigUniforms, type Tissue,
} from './materials'
import { applyMorph, prepareMorph, type HeatOpts, type MorphData, type MorphParams } from './morph'
import { describePart, nameEs } from './names'
import { stateAt, type DiseaseDef, type DTarget } from './diseases'

// Raycast acelerado con BVH para miles de mallas.
type BVHGeometry = THREE.BufferGeometry & {
  computeBoundsTree: (o?: { targetLeafSize?: number }) => unknown
  disposeBoundsTree: () => void
  boundsTree?: { refit: () => void }
}
const proto = THREE.BufferGeometry.prototype as unknown as BVHGeometry
proto.computeBoundsTree = computeBoundsTree as unknown as BVHGeometry['computeBoundsTree']
proto.disposeBoundsTree = disposeBoundsTree as unknown as BVHGeometry['disposeBoundsTree']
THREE.Mesh.prototype.raycast = acceleratedRaycast
const bvh = (g: THREE.BufferGeometry) => g as unknown as BVHGeometry

export type RenderMode = 'real' | 'holo' | 'xray' | 'heat'
export type MeshMode = 'off' | 'overlay' | 'only'

interface MeshUD {
  zname: string
  zmat: string
  zgroup: string
  layer: LayerKey
  tissue: Tissue
  color: string
  flow?: string
  base: THREE.Material
  hl?: THREE.Material
  dz?: THREE.MeshPhysicalMaterial
  dzGlow?: number
  dzLabel?: string
  dzOn?: boolean
  morph: MorphData
  eyeDup?: boolean
}
type PartMesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material> & { userData: MeshUD }

interface LayerRT {
  key: LayerKey
  group: THREE.Group
  meshes: PartMesh[]
  materials: THREE.Material[]
  holo: THREE.ShaderMaterial
  scanHolo: THREE.ShaderMaterial
  heat?: THREE.ShaderMaterial
  morphKey: string
  wireMat: THREE.MeshBasicMaterial
  wires: THREE.Mesh[] | null
  bvhDirty: boolean
  verts: number
  tris: number
  loadMs: number
}

export interface PartInfo {
  zname: string
  layer: LayerKey
  name: string
  original: string
  side: string | null
  sideLabel: string | null
  group: string
  system: string
  color: string
  triangles: number
  meshes: number
  affected?: string
}

const GARMENT_RE = /Mammary|Inframammary|Pectoral region|Presternal|region of thorax|Scapular region|Infrascapular|Interscapular|Epigastric|Hypochondriac|Deltopectoral|Axillary/i
const HEART_RE = /atri|ventric|valve|leaflet|papillary|^heart/i
const CORONARY_RE = /coronar|cardiac vein|arteries of heart|circumflex artery of heart|interventricular artery|vein of left ventricle/i
const LUNG_RE = /lobe of (right|left) lung|bronch/i
const BRAINSTEM_RE = /medulla oblongata|^pons|midbrain/i
const SCAN_DOWN = 2.6
const SCAN_HOLD = 0.35
const SCAN_UP = 2.2

function weldNormals(meshes: PartMesh[], q = 650) {
  const buckets = new Map<string, [THREE.BufferGeometry, number][]>()
  for (const m of meshes) {
    const pos = m.geometry.attributes.position, nor = m.geometry.attributes.normal
    if (!nor) continue
    for (let i = 0; i < pos.count; i++) {
      const k = `${Math.round(pos.getX(i) * q)},${Math.round(pos.getY(i) * q)},${Math.round(pos.getZ(i) * q)}`
      let b = buckets.get(k)
      if (!b) buckets.set(k, (b = []))
      b.push([m.geometry, i])
    }
  }
  const n = new THREE.Vector3(), o = new THREE.Vector3(), sum = new THREE.Vector3()
  const writes: [THREE.BufferGeometry, number, number, number, number][] = []
  for (const b of buckets.values()) {
    if (b.length < 2) continue
    for (const [ga, ia] of b) {
      n.fromBufferAttribute(ga.attributes.normal as THREE.BufferAttribute, ia)
      sum.set(0, 0, 0)
      for (const [gb, ib] of b) {
        o.fromBufferAttribute(gb.attributes.normal as THREE.BufferAttribute, ib)
        if (o.dot(n) > 0.2) sum.add(o)
      }
      sum.normalize()
      writes.push([ga, ia, sum.x, sum.y, sum.z])
    }
  }
  for (const [geo, i, x, y, z] of writes) geo.attributes.normal.setXYZ(i, x, y, z)
  for (const m of meshes) if (m.geometry.attributes.normal) m.geometry.attributes.normal.needsUpdate = true
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

export class AnatomyRig extends EventTarget {
  readonly U: RigUniforms = makeUniforms()
  readonly root = new THREE.Group()
  readonly layers: Partial<Record<LayerKey, LayerRT>> = {}
  readonly clipBelow = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e4)
  readonly clipAbove = new THREE.Plane(new THREE.Vector3(0, 1, 0), 1e4)
  private xray = makeHoloMaterial(this.U, '#bfe3ff')
  private hlHolo = makeHoloMaterial(this.U, '#7ffcff', { intensity: 2.2 })
  private dimHolo = makeHoloMaterial(this.U, '#5ab8ff', { intensity: 0.5 })

  renderMode: RenderMode = 'real'
  wireframe = false
  meshMode: MeshMode = 'off'
  meshOpacity = 0.35
  heat: HeatOpts = { metric: 'thickness', baseFat: 0 }
  private depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide })
  visible = new Set<LayerKey>(['skin'])
  opacity: Record<LayerKey, number> = { skin: 1, muscles: 1, organs: 1, arteries: 1, veins: 1, nerves: 1, skeleton: 1 }
  hovered: PartMesh | null = null
  selected: { zname: string; layer: LayerKey; meshes: PartMesh[] } | null = null
  isolated = false
  live = false

  /** Parámetros de morfología aplicados y objetivo (con interpolación suave). */
  params: MorphParams = { female: 0, fat: 0, muscle: 0 }
  private from: MorphParams = { ...this.params }
  private to: MorphParams = { ...this.params }
  private tween = 1
  private heightFrom = 1
  private heightTo = 1
  heightScale = 1

  private scanT = -1
  private scanReveal = new Set<LayerKey>()
  onScanProgress?: (p: number, y01: number) => void
  private liveParts: { heart: PartMesh[]; lungs: [PartMesh, 'right' | 'left'][]; heartCenter: THREE.Vector3 | null; lungCenters: Partial<Record<'right' | 'left', THREE.Vector3>>; brainstem: THREE.Vector3 | null } = {
    heart: [], lungs: [], heartCenter: null, lungCenters: {}, brainstem: null,
  }
  private disposed = false
  private disease: { def: DiseaseDef; p: number; hits: { m: PartMesh; targets: DTarget[]; center: THREE.Vector3 }[] } | null = null
  private ca = new THREE.Color()
  private cb = new THREE.Color()

  constructor() {
    super()
    this.root.name = 'anatomy-root'
    for (const m of [this.xray, this.hlHolo, this.dimHolo, this.depthOnly]) m.clippingPlanes = [this.clipBelow]
  }

  get bodyHeight() { return MODEL_HEIGHT_M * this.heightScale }
  get loadedKeys() { return Object.keys(this.layers) as LayerKey[] }
  get scanning() { return this.scanT >= 0 }

  // ------------------------------------------------------------------ carga de capas
  addLayer(key: LayerKey, source: THREE.Object3D, loadMs = 0) {
    if (this.layers[key] || this.disposed) return
    const t0 = performance.now()
    source.updateMatrixWorld(true)
    const group = new THREE.Group()
    group.name = `layer-${key}`
    const def = LAYER_BY_KEY[key]
    const L: LayerRT = {
      key, group, meshes: [], materials: [], holo: makeHoloMaterial(this.U, def.holo, { flow: { arteries: 'artery', veins: 'vein', nerves: 'nerve' }[key as string] }),
      scanHolo: makeHoloMaterial(this.U, def.holo, { intensity: 1.15 }), morphKey: '', wires: null,
      wireMat: new THREE.MeshBasicMaterial({ color: def.key === 'skin' ? '#5ff6ff' : def.holo, wireframe: true, transparent: true, opacity: 0.35, depthWrite: false, clippingPlanes: [this.clipBelow] }), bvhDirty: false, verts: 0, tris: 0, loadMs,
    }
    L.holo.clippingPlanes = [this.clipBelow]
    L.scanHolo.clippingPlanes = [this.clipAbove]
    if (key === 'skin') { L.heat = makeHeatMaterial(this.U); L.heat.clippingPlanes = [this.clipBelow] }
    const matCache = new Map<string, THREE.Material>()
    source.traverse((o) => {
      const src = o as THREE.Mesh
      if (!src.isMesh) return
      const ud = (Object.keys(src.userData || {}).length ? src.userData : src.parent?.userData || {}) as Record<string, string>
      const name = ud.zname || src.name
      const mat = ud.zmat || ''
      const color = colorFor(key, mat, name)
      const tissue = tissueFor(key, mat, name)
      const flow = flowFor(key, mat)
      const geometry = (src.geometry as THREE.BufferGeometry).clone()
      if (!src.matrixWorld.equals(new THREE.Matrix4())) geometry.applyMatrix4(src.matrixWorld)
      if (!geometry.attributes.normal) geometry.computeVertexNormals()
      const garment = key === 'skin' && tissue === 'skin' && GARMENT_RE.test(name)
      const mkey = `${color}|${tissue}|${mat}|${flow}|${garment}`
      let base = matCache.get(mkey)
      if (!base) {
        const m = makeTissueMaterial(this.U, color, tissue, { flow, garment })
        if (tissue === 'fabric') { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2 }
        if (mat === 'Cornea') { m.transparent = true; m.opacity = 0.06; m.depthWrite = false; m.userData.fixedOpacity = true; m.roughness = 0.02; m.clearcoat = 1 }
        m.clippingPlanes = [this.clipBelow]
        matCache.set(mkey, m)
        L.materials.push(m)
        base = m
      }
      if (USES_FIBRE.has(tissue)) addFiberAttribute(geometry)
      if (key === 'skin') {
        const n = geometry.attributes.position.count
        geometry.setAttribute('aHeat', new THREE.BufferAttribute(new Float32Array(n), 1))
        if (garment) geometry.setAttribute('aGarment', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1))
      }
      const mesh = new THREE.Mesh(geometry, base) as unknown as PartMesh
      mesh.name = name
      mesh.userData = { zname: name, zmat: mat, zgroup: ud.zgroup || '', layer: key, tissue, color, flow, base, morph: undefined as unknown as MorphData }
      L.verts += geometry.attributes.position.count
      L.tris += (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3
      group.add(mesh)
      L.meshes.push(mesh)
    })
    if (key === 'skin') weldNormals(L.meshes.filter((m) => m.userData.tissue === 'skin'))
    for (const m of L.meshes) {
      const geo = m.geometry
      m.userData.morph = prepareMorph(geo.attributes.position.array as Float32Array, geo.attributes.normal.array as Float32Array, key, key === 'skin' && /Hairs of head/i.test(m.userData.zname))
      bvh(geo).computeBoundsTree({ targetLeafSize: 24 })
    }
    this.collectLiveParts(L)
    this.layers[key] = L
    this.root.add(group)
    L.loadMs = Math.round(loadMs + performance.now() - t0)
    // Ojos duplicados en piel y órganos: se dibuja solo la copia de órganos cuando ambas capas están activas.
    this.markEyeDuplicates()
    this.applyMorphTo(L, true)
    this.applyMaterials(key)
    this.applyOpacity(key)
    this.applyMesh(key)
    this.applyVisibility()
    if (this.disease) this.setDisease(this.disease.def, this.disease.p)
    this.dispatchEvent(new CustomEvent('layerloaded', { detail: { key, meshes: L.meshes.length } }))
  }

  removeLayer(key: LayerKey) {
    const L = this.layers[key]
    if (!L) return
    if (this.selected?.layer === key) this.selected = null
    if (this.hovered?.userData.layer === key) this.hovered = null
    this.root.remove(L.group)
    for (const m of L.meshes) {
      bvh(m.geometry).disposeBoundsTree?.()
      m.geometry.dispose()
      m.userData.hl?.dispose()
      m.userData.dz?.dispose()
    }
    for (const m of L.materials) m.dispose()
    L.holo.dispose(); L.scanHolo.dispose(); L.heat?.dispose(); L.wireMat.dispose()
    delete this.layers[key]
    if (this.disease) this.disease.hits = this.disease.hits.filter((h) => h.m.userData.layer !== key)
    this.markEyeDuplicates()
  }

  dispose() {
    this.disposed = true
    for (const k of this.loadedKeys) this.removeLayer(k)
    this.xray.dispose(); this.hlHolo.dispose(); this.dimHolo.dispose(); this.depthOnly.dispose()
  }

  private markEyeDuplicates() {
    const organs = this.layers.organs
    const skin = this.layers.skin
    if (!skin) return
    const organNames = new Set(organs?.meshes.map((m) => m.userData.zname) || [])
    for (const m of skin.meshes) m.userData.eyeDup = organNames.has(m.userData.zname)
  }

  private collectLiveParts(L: LayerRT) {
    const live = this.liveParts
    const test = (m: PartMesh, re: RegExp) => re.test(m.userData.zname) || re.test(m.userData.zgroup)
    const centerOf = (ms: PartMesh[]) => {
      const b = new THREE.Box3()
      for (const m of ms) { m.geometry.computeBoundingBox(); b.union(m.geometry.boundingBox!) }
      return b.getCenter(new THREE.Vector3())
    }
    if (L.key === 'organs') {
      const heart = L.meshes.filter((m) => test(m, HEART_RE))
      if (heart.length) live.heartCenter = centerOf(heart)
      live.heart.push(...heart)
      for (const side of ['right', 'left'] as const) {
        const lung = L.meshes.filter((m) => test(m, LUNG_RE) && new RegExp(side, 'i').test(m.userData.zname + m.userData.zgroup))
        if (lung.length) { live.lungCenters[side] = centerOf(lung); live.lungs.push(...lung.map((m) => [m, side] as [PartMesh, 'right' | 'left'])) }
      }
      const bs = L.meshes.filter((m) => test(m, BRAINSTEM_RE))
      if (bs.length) live.brainstem = centerOf(bs)
    }
    if (L.key === 'arteries' || L.key === 'veins') live.heart.push(...L.meshes.filter((m) => test(m, CORONARY_RE)))
  }

  // ------------------------------------------------------------------ visibilidad, opacidad y modos
  setVisibleLayers(keys: LayerKey[]) {
    this.visible = new Set(keys)
    for (const k of keys) { const L = this.layers[k]; if (L) this.applyMorphTo(L) }
    this.applyVisibility()
  }

  setOpacity(key: LayerKey, a: number) {
    this.opacity[key] = a
    this.applyOpacity(key)
  }

  setRenderMode(mode: RenderMode) {
    this.renderMode = mode
    for (const k of this.loadedKeys) { this.applyMaterials(k); this.applyOpacity(k) }
  }

  setWireframe(on: boolean) {
    this.wireframe = on
    for (const k of this.loadedKeys) this.applyMaterials(k)
  }

  /** Malla poligonal real: superpuesta a la superficie u oculta la superficie (solo malla, con líneas ocultas). */
  setMesh(mode: MeshMode, opacity = this.meshOpacity) {
    this.meshMode = mode
    this.meshOpacity = opacity
    for (const k of this.loadedKeys) { this.applyMesh(k); this.applyMaterials(k) }
  }

  private applyMesh(key: LayerKey) {
    const L = this.layers[key]
    if (!L) return
    const on = this.meshMode !== 'off'
    if (on && !L.wires) {
      L.wires = L.meshes.map((m) => {
        const w = new THREE.Mesh(m.geometry, L.wireMat)
        w.raycast = () => undefined
        w.renderOrder = 30
        m.add(w)
        return w
      })
    }
    L.wireMat.opacity = this.meshMode === 'only' ? Math.min(1, this.meshOpacity + 0.25) : this.meshOpacity
    for (const w of L.wires || []) w.visible = on
  }

  /** Métrica del mapa térmico y su referencia (índice de grasa del expediente para la métrica "delta"). */
  setHeat(h: Partial<HeatOpts>) {
    this.heat = { ...this.heat, ...h }
    const L = this.layers.skin
    if (L) this.applyMorphTo(L, true)
  }

  setHeatScale(min: number, max: number, palette: 0 | 1, bands: boolean) {
    this.U.uHeatMin.value = min
    this.U.uHeatMax.value = Math.max(min + 1e-4, max)
    this.U.uPalette.value = palette
    this.U.uBands.value = bands ? 1 : 0
  }

  /** Rango (percentiles 2–98) de la métrica térmica en la piel visible, para la escala automática. */
  heatRange(): [number, number] | null {
    const L = this.layers.skin
    if (!L) return null
    const vals: number[] = []
    for (const m of L.meshes) {
      if (m.userData.tissue !== 'skin') continue
      const a = m.geometry.attributes.aHeat?.array as Float32Array | undefined
      if (a) for (let i = 0; i < a.length; i += 7) vals.push(a[i])
    }
    if (!vals.length) return null
    vals.sort((x, y) => x - y)
    return [vals[Math.floor(vals.length * 0.02)], vals[Math.floor(vals.length * 0.98)]]
  }

  setLive(on: boolean) { this.live = on }
  setDetail(high: boolean) { this.U.uDetail.value = high ? 1 : 0 }

  private materialFor(m: PartMesh): THREE.Material {
    const L = this.layers[m.userData.layer]!
    const sel = this.selected?.meshes.includes(m)
    const hov = this.hovered === m
    if (this.scanning && this.scanReveal.has(m.userData.layer)) return L.scanHolo
    if (sel || hov) {
      if (this.renderMode === 'real') return this.highlightOf(m, !!sel)
      return this.hlHolo
    }
    if (m.userData.dzOn && m.userData.dz) return m.userData.dz
    if (this.meshMode === 'only' && !(this.scanning && this.scanReveal.has(m.userData.layer))) return this.depthOnly
    switch (this.renderMode) {
      case 'holo': return L.holo
      case 'xray': return this.xray
      case 'heat': return L.key === 'skin' && L.heat && m.userData.tissue !== 'plain' ? L.heat : this.dimHolo
      default: return m.userData.base
    }
  }

  private highlightOf(m: PartMesh, strong: boolean) {
    const ud = m.userData
    if (!ud.hl) {
      const h = makeTissueMaterial(this.U, ud.color, ud.tissue, { flow: ud.flow, garment: !!m.geometry.attributes.aGarment, emissive: '#22d3ee' })
      h.clippingPlanes = [this.clipBelow]
      ud.hl = h
    }
    const h = ud.hl as THREE.MeshPhysicalMaterial
    h.emissiveIntensity = strong ? 0.6 : 0.35
    const base = ud.base as THREE.MeshPhysicalMaterial
    h.opacity = base.opacity
    h.transparent = base.transparent
    h.depthWrite = base.depthWrite
    h.wireframe = this.wireframe
    return h
  }

  private applyMaterials(key: LayerKey) {
    const L = this.layers[key]
    if (!L) return
    for (const mat of [...L.materials, L.holo, L.scanHolo, L.heat, this.xray, this.hlHolo, this.dimHolo]) {
      if (mat && (mat as THREE.MeshBasicMaterial).wireframe !== this.wireframe) { (mat as THREE.MeshBasicMaterial).wireframe = this.wireframe }
    }
    for (const m of L.meshes) m.material = this.materialFor(m)
  }

  private refreshMesh(m: PartMesh | null) { if (m && this.layers[m.userData.layer]) m.material = this.materialFor(m) }

  private applyOpacity(key: LayerKey) {
    const L = this.layers[key]
    if (!L) return
    const a = this.opacity[key]
    for (const mat of L.materials) {
      if (mat.userData.fixedOpacity) continue
      mat.opacity = a
      mat.transparent = a < 0.999
      mat.depthWrite = a > 0.6
    }
    L.holo.uniforms.uOpacity.value = Math.max(0.15, a)
    for (const m of L.meshes) m.renderOrder = a < 0.999 ? (key === 'skin' ? 10 : 5) : 0
    if (this.selected || this.hovered) for (const m of L.meshes) if (m.material !== m.userData.base) this.refreshMesh(m)
  }

  private applyVisibility() {
    const organsOn = this.visible.has('organs') && !!this.layers.organs
    const sel = new Set(this.selected?.meshes || [])
    const scanning = this.scanning
    for (const L of Object.values(this.layers)) {
      if (!L) continue
      const layerOn = this.visible.has(L.key) || (scanning && this.scanReveal.has(L.key))
      L.group.visible = layerOn
      for (const m of L.meshes) {
        const dup = organsOn && L.key === 'skin' && !!m.userData.eyeDup
        m.visible = !dup && (!this.isolated || !sel.size || sel.has(m))
      }
    }
  }

  // ------------------------------------------------------------------ morfología
  /** Cambia sexo / grasa / músculo / estatura. Con `immediate` no hay interpolación. */
  setMorph(target: Partial<MorphParams> & { heightCm?: number | null }, immediate = false) {
    const { heightCm, ...rest } = target
    this.from = { ...this.params }
    this.to = { ...this.params, ...rest }
    this.heightFrom = this.heightScale
    if (heightCm && heightCm > 50) this.heightTo = heightCm / (MODEL_HEIGHT_M * 100)
    this.tween = immediate ? 1 : 0
    if (immediate) {
      this.params = { ...this.to }
      this.heightScale = this.heightTo
      this.root.scale.setScalar(this.heightScale)
      for (const L of Object.values(this.layers)) if (L) this.applyMorphTo(L, true)
    }
  }

  private morphKeyOf() { const p = this.params; return `${p.female.toFixed(3)}|${p.fat.toFixed(3)}|${p.muscle.toFixed(3)}|${this.heat.metric}|${this.heat.baseFat.toFixed(3)}` }

  private applyMorphTo(L: LayerRT, force = false) {
    this.U.uFemale.value = this.params.female
    const key = this.morphKeyOf()
    if (!force && L.morphKey === key) return
    L.morphKey = key
    for (const m of L.meshes) {
      const pos = m.geometry.attributes.position as THREE.BufferAttribute
      const heatAttr = m.geometry.attributes.aHeat as THREE.BufferAttribute | undefined
      applyMorph(m.userData.morph, pos.array as Float32Array, L.key, this.params, heatAttr?.array as Float32Array | undefined, this.heat)
      pos.needsUpdate = true
      if (heatAttr) heatAttr.needsUpdate = true
      m.geometry.computeBoundingSphere()
      m.geometry.computeBoundingBox()
    }
    L.bvhDirty = true
  }

  // ------------------------------------------------------------------ interacción
  pickTargets() {
    const out: THREE.Object3D[] = []
    for (const L of Object.values(this.layers)) {
      if (!L || !this.visible.has(L.key) || this.opacity[L.key] < 0.25 || !L.group.visible) continue
      if (L.bvhDirty) {
        for (const m of L.meshes) bvh(m.geometry).boundsTree?.refit()
        L.bvhDirty = false
      }
      for (const m of L.meshes) if (m.visible) out.push(m)
    }
    return out
  }

  pick(raycaster: THREE.Raycaster): PartMesh | null {
    ;(raycaster as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true
    const hits = raycaster.intersectObjects(this.pickTargets(), false)
    return (hits[0]?.object as PartMesh) || null
  }

  info(m: PartMesh | null): PartInfo | null {
    if (!m) return null
    const ud = m.userData
    const d = describePart(ud.zname, ud.zgroup, ud.layer)
    const same = this.layers[ud.layer]?.meshes.filter((x) => x.userData.zname === ud.zname) || [m]
    const tris = same.reduce((s, x) => s + (x.geometry.index ? x.geometry.index.count : x.geometry.attributes.position.count) / 3, 0)
    const affected = ud.dzOn && this.disease ? `${this.disease.def.name}${ud.dzLabel ? ` · ${ud.dzLabel}` : ''}` : undefined
    return { zname: ud.zname, layer: ud.layer, ...d, triangles: Math.round(tris), meshes: same.length, affected }
  }

  setHover(m: PartMesh | null) {
    if (this.hovered === m) return
    const prev = this.hovered
    this.hovered = m
    this.refreshMesh(prev)
    this.refreshMesh(m)
  }

  select(m: PartMesh | null) {
    const prev = this.selected?.meshes || []
    if (!m) {
      this.selected = null
      this.isolated = false
    } else {
      const L = this.layers[m.userData.layer]!
      this.selected = { zname: m.userData.zname, layer: L.key, meshes: L.meshes.filter((x) => x.userData.zname === m.userData.zname) }
    }
    for (const p of prev) this.refreshMesh(p)
    for (const p of this.selected?.meshes || []) this.refreshMesh(p)
    this.applyVisibility()
  }

  setIsolated(on: boolean) { this.isolated = on && !!this.selected; this.applyVisibility() }

  selectedBox() {
    if (!this.selected) return null
    const box = new THREE.Box3()
    for (const m of this.selected.meshes) box.expandByObject(m)
    return box
  }

  // ------------------------------------------------------------------ escaneo
  startScan() {
    const internal: LayerKey[] = ['skeleton', 'organs']
    let reveal = internal.filter((k) => !this.visible.has(k) && this.layers[k])
    if (!reveal.length) reveal = (['arteries', 'veins', 'nerves'] as LayerKey[]).filter((k) => !this.visible.has(k) && this.layers[k])
    this.scanReveal = new Set(reveal)
    this.scanT = 0
    for (const k of this.loadedKeys) this.applyMaterials(k)
    this.applyVisibility()
    this.dispatchEvent(new CustomEvent('scanstart'))
  }

  stopScan() {
    if (this.scanT < 0) return
    this.scanT = -1
    this.clipBelow.constant = 1e4
    this.clipAbove.constant = 1e4
    this.U.uScanY.value = -10
    const reveal = [...this.scanReveal]
    this.scanReveal.clear()
    for (const k of reveal) this.applyMaterials(k)
    this.applyVisibility()
    this.dispatchEvent(new CustomEvent('scanend'))
  }

  get scanRevealLayers() { return [...this.scanReveal] }

  // ------------------------------------------------------------------ bucle por fotograma
  update(dt: number) {
    const t = (this.U.uTime.value += dt)
    // morfología interpolada
    if (this.tween < 1) {
      this.tween = Math.min(1, this.tween + dt / 0.7)
      const k = easeInOut(this.tween)
      this.params = {
        female: this.from.female + (this.to.female - this.from.female) * k,
        fat: this.from.fat + (this.to.fat - this.from.fat) * k,
        muscle: this.from.muscle + (this.to.muscle - this.from.muscle) * k,
      }
      this.heightScale = this.heightFrom + (this.heightTo - this.heightFrom) * k
      this.root.scale.setScalar(this.heightScale)
      for (const L of Object.values(this.layers)) if (L && (L.group.visible || this.tween >= 1)) this.applyMorphTo(L)
      if (this.tween >= 1) this.dispatchEvent(new CustomEvent('morphend'))
    }
    // escaneo: baja de la cabeza a los pies revelando el interior y vuelve a subir restaurando la piel
    if (this.scanT >= 0) {
      this.scanT += dt
      const H = this.bodyHeight
      const top = H * 1.03, bottom = -0.02
      let y: number, prog: number
      if (this.scanT < SCAN_DOWN) { const k = easeInOut(this.scanT / SCAN_DOWN); y = top + (bottom - top) * k; prog = (this.scanT / SCAN_DOWN) * 0.55 }
      else if (this.scanT < SCAN_DOWN + SCAN_HOLD) { y = bottom; prog = 0.55 }
      else if (this.scanT < SCAN_DOWN + SCAN_HOLD + SCAN_UP) {
        const k = easeInOut((this.scanT - SCAN_DOWN - SCAN_HOLD) / SCAN_UP); y = bottom + (top - bottom) * k; prog = 0.55 + k * 0.45
      } else { this.stopScan(); this.onScanProgress?.(1, 1); return }
      this.U.uScanY.value = y
      this.clipBelow.constant = y // visible: y <= scan
      this.clipAbove.constant = -y // visible: y >= scan
      this.onScanProgress?.(prog, Math.max(0, Math.min(1, y / H)))
    }
    if (this.disease) {
      const pulse = 0.65 + 0.35 * Math.sin(t * 3.2)
      for (const h of this.disease.hits) { const ud = h.m.userData; if (ud.dzOn && ud.dz) ud.dz.emissiveIntensity = (ud.dzGlow || 0) * 0.55 * pulse }
    }
    this.updateLive(dt, t)
  }

  private updateLive(dt: number, t: number) {
    const u = this.U.uLive
    u.value += ((this.live ? 1 : 0) - u.value) * Math.min(1, dt * 4)
    const live = this.liveParts
    const s0 = this.heightScale
    if (live.heartCenter) this.U.uHeartPos.value.copy(live.heartCenter).multiplyScalar(s0)
    if (live.brainstem) this.U.uBrainPos.value.copy(live.brainstem).multiplyScalar(s0)
    if (this.disease) return
    const k = u.value
    const ph = (t % BEAT) / BEAT
    const bump = (c: number, w: number) => Math.exp(-(((ph - c) / w) ** 2))
    const s = 1 - 0.045 * k * (bump(0.08, 0.06) + 0.55 * bump(0.3, 0.05))
    if (live.heartCenter) for (const m of live.heart) { m.scale.setScalar(s); m.position.copy(live.heartCenter).multiplyScalar(1 - s) }
    const b = 1 + 0.028 * k * (0.5 - 0.5 * Math.cos((t / 5) * Math.PI * 2))
    for (const [m, side] of live.lungs) { const c = live.lungCenters[side]; if (c) { m.scale.setScalar(b); m.position.copy(c).multiplyScalar(1 - b) } }
  }

  // ------------------------------------------------------------------ progresión de enfermedades (educativo)
  /** Activa una enfermedad (o null para limpiar) y aplica el avance p ∈ [0, 1]. */
  setDisease(def: DiseaseDef | null, p = 0) {
    if (this.disease) for (const h of this.disease.hits) this.resetDiseaseMesh(h.m)
    this.disease = null
    if (!def) return
    const hits: { m: PartMesh; targets: DTarget[]; center: THREE.Vector3 }[] = []
    for (const L of Object.values(this.layers)) {
      if (!L) continue
      for (const m of L.meshes) {
        const key = `${m.userData.zname}|${m.userData.zgroup}`
        const targets = def.targets.filter((t) => t.layer === L.key && t.re.test(key))
        if (!targets.length) continue
        m.geometry.computeBoundingBox()
        hits.push({ m, targets, center: m.geometry.boundingBox!.getCenter(new THREE.Vector3()) })
      }
    }
    this.disease = { def, p, hits }
    this.setDiseaseProgress(p)
  }

  get diseaseHits() { return this.disease?.hits.length || 0 }

  setDiseaseProgress(p: number) {
    const d = this.disease
    if (!d) return
    d.p = p
    for (const h of d.hits) {
      const ud = h.m.userData
      let st = null
      let label = ''
      for (const t of h.targets) { const s = stateAt(t, p); if (s) { st = s; label = t.label } }
      const was = !!ud.dzOn
      if (!st) {
        if (was) this.resetDiseaseMesh(h.m)
        continue
      }
      if (!ud.dz) {
        ud.dz = makeTissueMaterial(this.U, ud.color, ud.tissue, { flow: ud.flow, emissive: '#ff3b30' })
        ud.dz.clippingPlanes = [this.clipBelow]
      }
      const mat = ud.dz
      this.ca.set(st.c0); this.cb.set(st.c1)
      mat.color.copy(this.ca.lerp(this.cb, st.f))
      mat.emissive.copy(mat.color).lerp(new THREE.Color('#ffffff'), 0.15)
      ud.dzGlow = st.glow
      mat.opacity = st.opacity * Math.min(1, this.opacity[ud.layer] + 0.5)
      mat.transparent = mat.opacity < 0.999
      mat.depthWrite = mat.opacity > 0.6
      mat.wireframe = this.wireframe
      ud.dzLabel = label
      ud.dzOn = true
      h.m.scale.setScalar(st.scale)
      h.m.position.copy(h.center).multiplyScalar(1 - st.scale)
      if (!was) this.refreshMesh(h.m)
    }
  }

  private resetDiseaseMesh(m: PartMesh) {
    const ud = m.userData
    ud.dzOn = false
    m.scale.setScalar(1)
    m.position.set(0, 0, 0)
    this.refreshMesh(m)
  }

  diseaseBox() {
    const d = this.disease
    if (!d) return null
    const box = new THREE.Box3()
    for (const h of d.hits) if (h.m.userData.dzOn && h.m.visible && h.m.parent?.visible) box.expandByObject(h.m)
    return box.isEmpty() ? null : box
  }

  /** Estructuras afectadas actualmente (nombres en español, únicos). */
  affectedList() {
    const d = this.disease
    if (!d) return []
    const out = new Map<string, number>()
    for (const h of d.hits) if (h.m.userData.dzOn) { const lbl = h.m.userData.dzLabel || nameEs(h.m.userData.zname); out.set(lbl, (out.get(lbl) || 0) + 1) }
    return [...out.entries()].map(([label, n]) => ({ label, n }))
  }

  stats() {
    let meshes = 0, tris = 0, verts = 0
    const per = LAYERS.map((d) => {
      const L = this.layers[d.key]
      if (L) { meshes += L.meshes.length; tris += L.tris; verts += L.verts }
      return { key: d.key, loaded: !!L, meshes: L?.meshes.length || 0, tris: Math.round(L?.tris || 0), loadMs: L?.loadMs || 0 }
    })
    return { meshes, tris: Math.round(tris), verts, per }
  }
}

export type { PartMesh }
