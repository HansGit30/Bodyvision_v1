import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import {
  Activity, Box, Crosshair, Eye, EyeOff, Focus, Gauge, Info, Layers, Maximize2, Minus, Plus, RotateCcw, Rotate3d, ScanLine,
  Sparkles, User, X, Grid3x3, Scan, HeartPulse,
} from 'lucide-react'
import { AnatomyRig, type MeshMode, type PartInfo, type RenderMode } from './engine/AnatomyRig'
import type { HeatMetric } from './engine/morph'
import { ASSET_LICENSE, ASSET_SOURCE, LAYERS, LAYER_BY_KEY, PRESETS, type LayerKey } from './engine/layers'
import { MORPH_ENGINE } from './engine/morph'
import { DISEASES, DISEASE_BY_ID, stageAt } from './engine/diseases'
import { DiseasePanel } from './DiseasePanel'
import { CameraRig, Interaction, Landmarks3D, Lighting, RigLayers, RigRoot, Stage, type CameraApi, type LayerStatus, type ViewName } from './BodyScene'
import { bmi, bmiCategory, fatIndex, fmtNum } from '../../utils/format'
import { DataTag } from '../../components/ui'
import type { LM } from '../../types'

export interface ViewerInitial { sex: 'M' | 'F'; heightCm: number | null; weightKg: number | null; muscleIndex?: number }

const REGIONS: [number, string][] = [[0.88, 'Cabeza y cuello'], [0.7, 'Tórax y miembros superiores'], [0.56, 'Abdomen'], [0.45, 'Pelvis'], [0.26, 'Muslos y rodillas'], [0, 'Piernas y pies']]
const regionAt = (y01: number) => REGIONS.find(([t]) => y01 >= t)?.[1] || 'Pies'
const MODES: { id: RenderMode; label: string }[] = [
  { id: 'real', label: 'Realista' }, { id: 'holo', label: 'Holograma' }, { id: 'xray', label: 'Rayos X' }, { id: 'heat', label: 'Mapa térmico' },
]
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const isMobile = () => typeof window !== 'undefined' && (window.matchMedia?.('(max-width: 900px)').matches || /Mobi|Android/i.test(navigator.userAgent))

export function BodyViewer({ initial, landmarks, profileLabel, onMorphChange, unlinked }: {
  initial: ViewerInitial
  landmarks?: LM[] | null
  profileLabel?: string
  unlinked?: boolean
  onMorphChange?: (v: { sex: 'M' | 'F'; heightCm: number; weightKg: number }) => void
}) {
  const rig = useMemo(() => new AnatomyRig(), [])
  useEffect(() => () => rig.dispose(), [rig])
  const cam = useRef<CameraApi | null>(null)
  const shell = useRef<HTMLDivElement>(null)

  // capas
  const [visible, setVisible] = useState<LayerKey[]>(['skin'])
  const [requested, setRequested] = useState<LayerKey[]>(['skin'])
  const [combine, setCombine] = useState(false)
  const [status, setStatus] = useState<Partial<Record<LayerKey, LayerStatus>>>({})
  const [errors, setErrors] = useState<Partial<Record<LayerKey, string>>>({})
  const [retry, setRetry] = useState<Record<string, number>>({})
  const [opacity, setOpacity] = useState<Record<LayerKey, number>>({ ...rig.opacity })
  const [preset, setPreset] = useState('body')
  // apariencia
  const [mode, setMode] = useState<RenderMode>('real')
  const [meshMode, setMeshMode] = useState<MeshMode>('off')
  const [meshOpacity, setMeshOpacity] = useState(0.35)
  const [heatMetric, setHeatMetric] = useState<HeatMetric>('thickness')
  const [heatRange, setHeatRange] = useState<[number, number]>([0, 0.08])
  const [heatAuto, setHeatAuto] = useState(true)
  const [palette, setPalette] = useState<0 | 1>(0)
  const [bands, setBands] = useState(false)
  const [spin, setSpin] = useState(!reducedMotion())
  const [live, setLive] = useState(false)
  const [hq, setHq] = useState(!isMobile())
  const [panels, setPanels] = useState(true)
  const [showTech, setShowTech] = useState(false)
  const [showLm, setShowLm] = useState(!!landmarks)
  // morfología
  const defH = initial.heightCm || (initial.sex === 'F' ? 162 : 174)
  const defW = initial.weightKg || Math.round(22 * (defH / 100) ** 2)
  const [sex, setSex] = useState<'M' | 'F'>(initial.sex)
  const [heightCm, setHeightCm] = useState(defH)
  const [weightKg, setWeightKg] = useState(defW)
  // interacción
  const [hover, setHover] = useState<PartInfo | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<PartInfo | null>(null)
  const [isolated, setIsolated] = useState(false)
  const [scan, setScan] = useState<{ p: number; y: number } | null>(null)
  const [scanDone, setScanDone] = useState<string | null>(null)
  const [fps, setFps] = useState(0)
  const [ctxLost, setCtxLost] = useState(false)
  const autoScanned = useRef(false)
  // progresión de enfermedades (simulación educativa)
  const [diseaseId, setDiseaseId] = useState('')
  const [dProgress, setDProgress] = useState(0)
  const [dPlaying, setDPlaying] = useState(false)
  const [affected, setAffected] = useState<{ label: string; n: number }[]>([])
  const prevView = useRef<{ visible: LayerKey[]; combine: boolean; skin: number; mode: RenderMode } | null>(null)
  const disease = diseaseId ? DISEASE_BY_ID[diseaseId] : null
  const diseaseRef = useRef(disease)
  diseaseRef.current = disease

  const b = bmi(weightKg, heightCm)
  const cat = bmiCategory(b)
  const latest = useRef({ sex, b })
  latest.current = { sex, b }

  // ---------------------------------------------------------------- sincronización con el rig
  useEffect(() => { rig.setVisibleLayers(visible) }, [rig, visible])
  useEffect(() => { rig.setRenderMode(mode) }, [rig, mode])
  useEffect(() => { rig.setMesh(meshMode, meshOpacity) }, [rig, meshMode, meshOpacity, status])
  const baseFat = fatIndex(bmi(initial.weightKg, initial.heightCm) ?? 22)
  useEffect(() => { rig.setHeat({ metric: heatMetric, baseFat }) }, [rig, heatMetric, baseFat])
  useEffect(() => { setPalette(heatMetric === 'delta' ? 1 : 0) }, [heatMetric])
  useEffect(() => { rig.setHeatScale(heatRange[0], heatRange[1], palette, bands) }, [rig, heatRange, palette, bands])
  // escala automática (percentiles 2–98) al terminar cada transformación o cambio de métrica
  const [morphTick, setMorphTick] = useState(0)
  useEffect(() => {
    const on = () => setMorphTick((t) => t + 1)
    rig.addEventListener('morphend', on)
    return () => rig.removeEventListener('morphend', on)
  }, [rig])
  useEffect(() => {
    if (mode !== 'heat' || !heatAuto) return
    const t = setTimeout(() => {
      const r = rig.heatRange()
      if (!r) return
      if (heatMetric === 'delta') { const m = Math.max(0.005, Math.abs(r[0]), Math.abs(r[1])); setHeatRange([-m, m]) }
      else setHeatRange([Math.max(0, r[0]), Math.max(r[0] + 0.01, r[1])])
    }, 150)
    return () => clearTimeout(t)
  }, [rig, mode, heatAuto, heatMetric, morphTick, status.skin])
  useEffect(() => { rig.setLive(live) }, [rig, live])
  useEffect(() => { rig.setDetail(hq) }, [rig, hq])
  useEffect(() => { for (const L of LAYERS) rig.setOpacity(L.key, opacity[L.key]) }, [rig, opacity])
  const firstMorph = useRef(true)
  useEffect(() => {
    rig.setMorph({ female: sex === 'F' ? 1 : 0, fat: fatIndex(bmi(weightKg, heightCm)), muscle: initial.muscleIndex || 0, heightCm }, firstMorph.current)
    firstMorph.current = false
    onMorphChange?.({ sex, heightCm, weightKg })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rig, sex, heightCm, weightKg])
  // reinicia a los datos del expediente cuando cambian desde fuera
  useEffect(() => {
    setSex(initial.sex)
    setHeightCm(initial.heightCm || (initial.sex === 'F' ? 162 : 174))
    setWeightKg(initial.weightKg || Math.round(22 * ((initial.heightCm || 170) / 100) ** 2))
  }, [initial.sex, initial.heightCm, initial.weightKg])

  const onStatus = useCallback((k: LayerKey, s: LayerStatus, err?: string) => {
    setStatus((o) => (o[k] === s ? o : { ...o, [k]: s }))
    if (err) setErrors((o) => ({ ...o, [k]: err }))
  }, [])

  // precarga de esqueleto y órganos tras la piel (para la revelación del escaneo)
  useEffect(() => {
    if (status.skin === 'ready') {
      const t = setTimeout(() => setRequested((r) => [...new Set<LayerKey>([...r, 'skeleton', 'organs'])]), 400)
      return () => clearTimeout(t)
    }
  }, [status.skin])

  const runScan = useCallback(() => {
    if (rig.scanning || diseaseRef.current) return
    setScanDone(null)
    rig.onScanProgress = (p, y) => {
      setScan(p >= 1 ? null : { p, y })
      if (p >= 1) {
        const st = rig.stats()
        const { sex: sx, b: bm } = latest.current
        setScanDone(`Escaneo completado · ${st.meshes.toLocaleString('es-PE')} estructuras en ${rig.loadedKeys.length} sistemas · ${sx === 'F' ? 'femenino' : 'masculino'} · IMC ${bm ?? '—'}`)
        setTimeout(() => setScanDone(null), 5200)
      }
    }
    rig.startScan()
  }, [rig])

  // escaneo automático la primera vez que el cuerpo y el esqueleto están listos
  useEffect(() => {
    if (autoScanned.current || reducedMotion()) return
    if (status.skin === 'ready' && (status.skeleton === 'ready' || status.skeleton === 'error')) {
      autoScanned.current = true
      const t = setTimeout(runScan, 350)
      return () => clearTimeout(t)
    }
  }, [status.skin, status.skeleton, runScan])

  // ---------------------------------------------------------------- acciones de capas
  const ensure = (keys: LayerKey[]) => setRequested((r) => [...new Set<LayerKey>([...r, ...keys])])
  const applyPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id)!
    setPreset(id)
    ensure(p.layers)
    setVisible(p.layers)
    setCombine(p.layers.length > 1)
    rig.select(null); setSelected(null); setIsolated(false)
  }
  const toggleLayer = (k: LayerKey) => {
    ensure([k])
    setPreset('')
    if (!combine) { setVisible([k]); return }
    setVisible((v) => (v.includes(k) ? (v.length > 1 ? v.filter((x) => x !== k) : v) : [...v, k]))
  }
  const retryLayer = (k: LayerKey) => {
    setErrors((o) => ({ ...o, [k]: undefined }))
    setStatus((o) => ({ ...o, [k]: 'loading' }))
    setRetry((r) => ({ ...r, [k]: (r[k] || 0) + 1 }))
  }

  const onHover = useCallback((info: PartInfo | null, x: number, y: number) => {
    setHover((h) => (h?.zname === info?.zname && h?.layer === info?.layer ? h : info))
    const el = tipRef.current
    if (el && info) { el.style.left = `${x}px`; el.style.top = `${y}px` }
  }, [])
  const onSelect = useCallback((info: PartInfo | null) => { setSelected(info); if (!info) setIsolated(false) }, [])
  useEffect(() => { rig.setIsolated(isolated) }, [rig, isolated, selected])
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName?.match(/INPUT|SELECT|TEXTAREA/)) return
      if (e.key === 'Escape') { rig.select(null); setSelected(null); setIsolated(false) }
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [rig])

  // ---------------------------------------------------------------- enfermedades
  const chooseDisease = (id: string) => {
    if (!id) { clearDisease(); return }
    const def = DISEASE_BY_ID[id]
    if (!prevView.current) prevView.current = { visible, combine, skin: opacity.skin, mode }
    rig.stopScan(); setScan(null)
    rig.select(null); setSelected(null); setIsolated(false)
    ensure(def.layers)
    setCombine(true)
    setVisible(['skin', ...def.layers])
    setOpacity((o) => ({ ...o, skin: def.skinOpacity }))
    setMode('real'); setLive(false); setSpin(false); setPreset('')
    rig.setDisease(def, 0)
    setDiseaseId(id); setDProgress(0); setDPlaying(true)
  }
  function clearDisease() {
    rig.setDisease(null)
    setDiseaseId(''); setDPlaying(false); setDProgress(0); setAffected([])
    const pv = prevView.current
    if (pv) { setVisible(pv.visible); setCombine(pv.combine); setOpacity((o) => ({ ...o, skin: pv.skin })); setMode(pv.mode) }
    prevView.current = null
  }
  useEffect(() => { if (disease) { rig.setDiseaseProgress(dProgress); setAffected(rig.affectedList()) } }, [rig, disease, dProgress, status])
  useEffect(() => {
    if (!dPlaying) return
    let last = performance.now()
    const iv = setInterval(() => {
      const now = performance.now()
      const dt = (now - last) / 1000
      last = now
      setDProgress((p) => {
        const n = Math.min(1, p + dt / 14)
        if (n >= 1) setDPlaying(false)
        return n
      })
    }, 60)
    return () => clearInterval(iv)
  }, [dPlaying])

  const fullscreen = () => {
    const el = shell.current
    if (!el) return
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined)
    else el.requestFullscreen?.().catch(() => undefined)
  }

  const loading = visible.filter((k) => status[k] !== 'ready' && status[k] !== 'error')
  const st = rig.stats()
  const hipY = 0.93 * (heightCm / 174.2)

  return (
    <div className="viewer-shell" ref={shell}>
      <div className="viewer-canvas" style={{ background: 'radial-gradient(ellipse at 50% 30%, #0c2350 0%, #050d22 55%, #020713 100%)' }}>
        {ctxLost ? (
          <div className="center-fill" style={{ height: '100%' }}>
            <Box size={36} />
            <div>El contexto gráfico (WebGL) se perdió.</div>
            <button className="btn primary" onClick={() => window.location.reload()}>Recargar visor</button>
          </div>
        ) : (
          <Canvas
            dpr={hq ? [1, 1.75] : [1, 1]}
            gl={{ antialias: true, alpha: true, powerPreference: 'high-performance', localClippingEnabled: true } as never}
            camera={{ fov: 35, near: 0.01, far: 60, position: [0, 1.1, 3.7] }}
            onCreated={({ gl }) => {
              gl.localClippingEnabled = true
              gl.toneMapping = THREE.ACESFilmicToneMapping
              gl.outputColorSpace = THREE.SRGBColorSpace
              gl.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); setCtxLost(true) })
            }}
          >
            <Lighting />
            <Stage rig={rig} particles={hq} />
            <RigRoot rig={rig} />
            <RigLayers rig={rig} layers={requested} retry={retry} onStatus={onStatus} />
            {landmarks && showLm ? <Landmarks3D world={landmarks} hipY={hipY} /> : null}
            <CameraRig rig={rig} apiRef={cam} autoRotate={spin && !selected} />
            <Interaction rig={rig} onHover={onHover} onSelect={onSelect} />
            <FpsMeter onFps={setFps} />
          </Canvas>
        )}
      </div>

      {/* tooltip de nombre bajo el cursor */}
      <div ref={tipRef} className="viewer-tooltip" style={{ display: hover ? 'block' : 'none', ['--tc' as string]: hover?.color }} role="tooltip">
        {hover ? (
          <>
            <div className="tt-name">{hover.name}</div>
            <div className="tt-sys"><i />{hover.system}{hover.sideLabel ? ` · ${hover.sideLabel.toLowerCase()}` : ''}</div>
            {hover.affected ? <div className="small" style={{ color: '#fda4af', marginTop: 3 }}>⚠ Afectado: {hover.affected}</div> : null}
          </>
        ) : null}
      </div>

      {/* HUD de escaneo */}
      {scan ? (
        <div className="overlay hud-panel scan-hud" aria-live="polite">
          <div className="label"><ScanLine size={12} style={{ verticalAlign: -2 }} /> Escaneo corporal en curso</div>
          <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 18, margin: '2px 0 6px' }}>{regionAt(scan.y)}</div>
          <div className="progress"><i style={{ width: `${Math.round(scan.p * 100)}%` }} /></div>
          <div className="small muted mt-s">{Math.round(scan.p * 100)}% · revelando {rig.scanRevealLayers.map((k) => LAYER_BY_KEY[k].label.toLowerCase()).join(' y ') || 'estructuras'}</div>
        </div>
      ) : scanDone ? (
        <div className="overlay hud-panel scan-hud" style={{ borderColor: 'rgba(34,197,94,.5)' }}>
          <div className="label" style={{ color: '#4ade80' }}>Análisis visual completado</div>
          <div className="small mt-s">{scanDone}</div>
        </div>
      ) : null}

      {panels ? (
        <>
          {/* panel izquierdo: capas y apariencia */}
          <aside className="overlay hud-panel viewer-left" aria-label="Capas anatómicas">
            <div className="row between mb" style={{ marginBottom: 10 }}>
              <div className="card-title"><Layers size={16} /> Capas anatómicas</div>
              <label className="check small" title="Permite activar varias capas a la vez">
                <input type="checkbox" checked={combine} onChange={(e) => { setCombine(e.target.checked); if (!e.target.checked) setVisible((v) => v.slice(0, 1)) }} />
                Combinar
              </label>
            </div>
            <div className="col" style={{ gap: 2 }}>
              {LAYERS.map((L) => {
                const on = visible.includes(L.key)
                const s = status[L.key]
                return (
                  <div key={L.key}>
                    <button className={`layer-btn ${on ? 'on' : ''}`} style={{ ['--lc' as string]: L.color }} onClick={() => toggleLayer(L.key)} aria-pressed={on}>
                      <span className="sw" />
                      <span>{L.label}</span>
                      <span className="meta">
                        {s === 'loading' ? 'cargando…' : s === 'error' ? 'error' : `${L.parts} partes`}
                      </span>
                    </button>
                    {s === 'error' ? (
                      <div className="row small" style={{ padding: '2px 10px 6px', color: '#fda4af' }} title={errors[L.key]}>
                        No se pudo cargar. <button className="btn sm" onClick={() => retryLayer(L.key)}>Reintentar</button>
                      </div>
                    ) : null}
                    {on && combine ? (
                      <div className="row small" style={{ padding: '0 10px 6px' }}>
                        <span className="dim nowrap">Opacidad</span>
                        <input type="range" min={0.1} max={1} step={0.05} value={opacity[L.key]} aria-label={`Opacidad ${L.label}`}
                          onChange={(e) => setOpacity((o) => ({ ...o, [L.key]: Number(e.target.value) }))} />
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
            <div className="nav-section" style={{ padding: '12px 2px 6px' }}>Vistas rápidas</div>
            <div className="row wrap" style={{ gap: 6 }}>
              {PRESETS.map((p) => (
                <button key={p.id} className={`chip ${preset === p.id ? 'on' : ''}`} onClick={() => applyPreset(p.id)}>{p.label}</button>
              ))}
            </div>
            <div className="nav-section" style={{ padding: '12px 2px 6px' }}>Modo de visualización</div>
            <div className="row wrap" style={{ gap: 6 }}>
              {MODES.map((m) => (
                <button key={m.id} className={`chip ${mode === m.id ? 'on' : ''}`} onClick={() => { setMode(m.id); if (m.id === 'heat') { ensure(['skin']); setVisible((v) => (v.includes('skin') ? v : ['skin', ...v])) } }}>{m.label}</button>
              ))}
              {landmarks ? <button className={`chip ${showLm ? 'on' : ''}`} onClick={() => setShowLm(!showLm)}><Crosshair size={13} /> Landmarks</button> : null}
            </div>
            <div className="nav-section" style={{ padding: '12px 2px 6px' }}><Grid3x3 size={11} style={{ verticalAlign: -1 }} /> Malla (wireframe)</div>
            <div className="row" style={{ gap: 4 }}>
              {([['off', 'Apagada'], ['overlay', 'Superpuesta'], ['only', 'Solo malla']] as [MeshMode, string][]).map(([m, l]) => (
                <button key={m} className={`btn sm grow ${meshMode === m ? 'active' : ''}`} onClick={() => setMeshMode(m)} aria-pressed={meshMode === m}>{l}</button>
              ))}
            </div>
            {meshMode !== 'off' ? (
              <div className="row small mt-s">
                <span className="dim nowrap">Opacidad</span>
                <input type="range" min={0.05} max={1} step={0.05} value={meshOpacity} onChange={(e) => setMeshOpacity(Number(e.target.value))} aria-label="Opacidad de la malla" />
                <b>{Math.round(meshOpacity * 100)}%</b>
              </div>
            ) : null}
            {meshMode !== 'off' ? <div className="small dim mt-s">Geometría real del activo: {st.tris.toLocaleString('es-PE')} triángulos cargados.</div> : null}
            {mode === 'heat' ? (
              <div className="card tight mt" style={{ borderColor: 'rgba(250,204,21,.4)' }}>
                <div className="card-title" style={{ fontSize: 13.5, marginBottom: 6 }}>🌡 Control térmico</div>
                <select className="select" value={heatMetric} onChange={(e) => { setHeatMetric(e.target.value as HeatMetric); setHeatAuto(true) }} aria-label="Métrica del mapa térmico">
                  <option value="thickness">Grosor subcutáneo estimado</option>
                  <option value="delta">Cambio vs. peso del expediente</option>
                </select>
                <div className="legend-bar mt-s" style={{ background: palette ? 'linear-gradient(90deg,#2166f2,#ebf2ff,#e6263a)' : undefined }} />
                <div className="row between small"><b>{fmtNum(heatRange[0] * 100, 1)} cm</b><span className="dim">{fmtNum(((heatRange[0] + heatRange[1]) / 2) * 100, 1)}</span><b>{fmtNum(heatRange[1] * 100, 1)} cm</b></div>
                <div className="row small mt-s"><span className="dim nowrap">Mín.</span>
                  <input type="range" min={heatMetric === 'delta' ? -10 : 0} max={10} step={0.1} value={heatRange[0] * 100} aria-label="Escala mínima"
                    onChange={(e) => { setHeatAuto(false); const v = Number(e.target.value) / 100; setHeatRange(([, mx]) => [Math.min(v, mx - 0.001), mx]) }} /></div>
                <div className="row small"><span className="dim nowrap">Máx.</span>
                  <input type="range" min={heatMetric === 'delta' ? -10 : 0} max={12} step={0.1} value={heatRange[1] * 100} aria-label="Escala máxima"
                    onChange={(e) => { setHeatAuto(false); const v = Number(e.target.value) / 100; setHeatRange(([mn]) => [mn, Math.max(v, mn + 0.001)]) }} /></div>
                <div className="row wrap mt-s" style={{ gap: 4 }}>
                  <button className={`btn sm ${heatAuto ? 'active' : ''}`} onClick={() => setHeatAuto(true)}>Auto</button>
                  <button className={`btn sm ${palette === 0 ? 'active' : ''}`} onClick={() => setPalette(0)}>Térmica</button>
                  <button className={`btn sm ${palette === 1 ? 'active' : ''}`} onClick={() => setPalette(1)}>Divergente</button>
                  <button className={`btn sm ${bands ? 'active' : ''}`} onClick={() => setBands(!bands)}>Isolíneas</button>
                </div>
                <div className="small dim mt-s">
                  <b>Fuente:</b> {heatMetric === 'delta'
                    ? `diferencia entre el peso actual (${weightKg} kg) y el del expediente (${initial.weightKg ?? '—'} kg)`
                    : `IMC ${fmtNum(b)} (peso ${weightKg} kg, estatura ${heightCm} cm) y sexo`} · mapa regional {MORPH_ENGINE}.
                </div>
                <div className="mt-s"><DataTag kind="simulation" /> <span className="small dim">estimación visual, no es una medición</span></div>
              </div>
            ) : null}
            {landmarks && showLm ? <div className="small dim mt-s"><DataTag kind="estimate" /> Landmarks MediaPipe del último análisis aprobado.</div> : null}
            <div className="nav-section" style={{ padding: '12px 2px 6px' }}>Progresión de enfermedades</div>
            <select className="select" value={diseaseId} onChange={(e) => chooseDisease(e.target.value)} aria-label="Simular enfermedad">
              <option value="">— Ninguna (cuerpo sano) —</option>
              {[...new Set(DISEASES.map((d) => d.system))].map((sys) => (
                <optgroup key={sys} label={sys}>
                  {DISEASES.filter((d) => d.system === sys).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </optgroup>
              ))}
            </select>
            <div className="small dim mt-s">Simulación educativa sobre el atlas 3D; no representa a este paciente.</div>
          </aside>

          {/* panel derecho: morfología + selección */}
          <aside className="overlay hud-panel viewer-right" aria-label="Morfología y selección">
            {disease ? (
              <DiseasePanel def={disease} progress={dProgress} playing={dPlaying} stage={stageAt(disease, dProgress)} affected={affected}
                onProgress={(v) => { setDPlaying(false); setDProgress(v) }}
                onPlay={() => { if (dProgress >= 1) setDProgress(0); setDPlaying(!dPlaying) }}
                onFocus={() => { const bx = rig.diseaseBox(); if (bx) cam.current?.focus(bx) }}
                onClose={clearDisease} />
            ) : null}
            <div className="card-title"><User size={16} /> Morfología</div>
            <div style={{ margin: '4px 0 8px' }}><DataTag kind="reconstruction" /></div>
            {profileLabel ? <div className="small muted" style={{ marginBottom: 8 }}>{profileLabel} {unlinked ? <Link to="/select/viewer">Vincular a un expediente →</Link> : null}</div> : null}
            <div className="row" style={{ gap: 6, marginBottom: 10 }}>
              <button className={`btn sm grow ${sex === 'M' ? 'active' : ''}`} onClick={() => { setSex('M'); setTimeout(runScan, 750) }} aria-pressed={sex === 'M'}>♂ Hombre</button>
              <button className={`btn sm grow ${sex === 'F' ? 'active' : ''}`} onClick={() => { setSex('F'); setTimeout(runScan, 750) }} aria-pressed={sex === 'F'}>♀ Mujer</button>
            </div>
            <div className="field" style={{ marginBottom: 8 }}>
              <label htmlFor="vw-h" className="row between"><span>Estatura</span><b>{heightCm} cm</b></label>
              <input id="vw-h" type="range" min={140} max={205} step={1} value={heightCm} onChange={(e) => setHeightCm(Number(e.target.value))} />
            </div>
            <div className="field" style={{ marginBottom: 6 }}>
              <label htmlFor="vw-w" className="row between"><span>Peso hipotético (simulación)</span><b>{weightKg} kg</b></label>
              <input id="vw-w" type="range" min={38} max={170} step={0.5} value={weightKg} onChange={(e) => setWeightKg(Number(e.target.value))} />
            </div>
            <div className="row between small" style={{ marginBottom: 4 }}>
              <span className="muted">IMC del escenario simulado</span>
              <span><b>{fmtNum(b)}</b> <span className={`badge ${cat.tone}`}>{cat.label}</span></span>
            </div>
            <div className="small dim" style={{ marginBottom: 8 }}>Peso registrado: {initial.weightKg != null ? `${initial.weightKg} kg` : "No registrado"}. El control anterior no cambia tu expediente.</div>
            {(initial.weightKg && initial.weightKg !== weightKg) || (initial.heightCm && initial.heightCm !== heightCm) || sex !== initial.sex ? (
              <button className="btn sm ghost" onClick={() => { setSex(initial.sex); setHeightCm(defH); setWeightKg(defW) }}><RotateCcw size={13} /> Volver a datos del expediente</button>
            ) : null}

            {selected ? (
              <>
                <div className="divider" />
                <div className="row between">
                  <div className="card-title" style={{ fontSize: 14 }}><Focus size={15} /> Selección</div>
                  <button className="btn ghost icon sm" aria-label="Quitar selección" onClick={() => { rig.select(null); setSelected(null); setIsolated(false) }}><X size={14} /></button>
                </div>
                <div style={{ fontFamily: 'var(--font-head)', fontSize: 17, fontWeight: 700, marginTop: 6, color: '#fff' }}>{selected.name}</div>
                <div className="small muted" style={{ fontStyle: 'italic' }}>{selected.original}</div>
                <div className="mt-s">
                  <div className="stat-line"><span className="muted">Sistema</span><span className="row" style={{ gap: 6 }}><i style={{ width: 8, height: 8, borderRadius: 8, background: selected.color, display: 'inline-block' }} />{selected.system}</span></div>
                  {selected.group ? <div className="stat-line"><span className="muted">Grupo</span><span style={{ textAlign: 'right' }}>{selected.group}</span></div> : null}
                  {selected.sideLabel ? <div className="stat-line"><span className="muted">Lateralidad</span><span>{selected.sideLabel}</span></div> : null}
                  <div className="stat-line"><span className="muted">Geometría</span><span>{selected.triangles.toLocaleString('es-PE')} triángulos</span></div>
                </div>
                <div className="btn-row mt-s">
                  <button className="btn sm" onClick={() => { const bx = rig.selectedBox(); if (bx) cam.current?.focus(bx) }}><Focus size={13} /> Enfocar</button>
                  <button className={`btn sm ${isolated ? 'active' : ''}`} onClick={() => setIsolated(!isolated)}><Eye size={13} /> {isolated ? 'Mostrar todo' : 'Aislar'}</button>
                </div>
              </>
            ) : (
              <div className="small dim mt">Pasa el cursor sobre el cuerpo para ver el nombre de cada estructura; haz clic para seleccionarla.</div>
            )}

            <div className="divider" />
            <button className="btn ghost sm" style={{ width: '100%', justifyContent: 'space-between' }} onClick={() => setShowTech(!showTech)} aria-expanded={showTech}>
              <span className="row" style={{ gap: 6 }}><Info size={14} /> Información técnica</span><span>{showTech ? '−' : '+'}</span>
            </button>
            {showTech ? (
              <div className="small mt-s">
                <div className="stat-line"><span className="muted">Activo</span><span>Atlas anatómico 7 capas</span></div>
                <div className="stat-line"><span className="muted">Licencia</span><span style={{ textAlign: 'right' }}>{ASSET_LICENSE}</span></div>
                <div className="stat-line"><span className="muted">Fuente</span><span style={{ textAlign: 'right' }}>{ASSET_SOURCE}</span></div>
                <div className="stat-line"><span className="muted">Motor morfológico</span><span>{MORPH_ENGINE}</span></div>
                <div className="stat-line"><span className="muted">Estructuras cargadas</span><b>{st.meshes.toLocaleString('es-PE')}</b></div>
                <div className="stat-line"><span className="muted">Triángulos</span><b>{st.tris.toLocaleString('es-PE')}</b></div>
                <div className="stat-line"><span className="muted">FPS</span><b>{fps}</b></div>
                {st.per.filter((p) => p.loaded).map((p) => (
                  <div className="stat-line" key={p.key}><span className="dim">{LAYER_BY_KEY[p.key].label}</span><span>{p.meshes} · {p.loadMs} ms</span></div>
                ))}
                <p className="dim" style={{ marginTop: 8 }}>Visualización educativa no clínica. La forma corporal es una reconstrucción aproximada a partir de sexo, estatura e IMC.</p>
              </div>
            ) : null}
          </aside>
        </>
      ) : null}

      {loading.length ? (
        <div className="overlay hud-panel" style={{ left: '50%', top: '45%', transform: 'translate(-50%,-50%)', padding: '14px 20px', textAlign: 'center' }}>
          <div className="spinner" style={{ margin: '0 auto 8px' }} />
          <div className="small">Cargando {loading.map((k) => LAYER_BY_KEY[k].label.toLowerCase()).join(', ')}…</div>
        </div>
      ) : null}

      {/* dock inferior */}
      <div className="overlay hud-panel viewer-dock" role="toolbar" aria-label="Controles del visor">
        {([['front', 'Frontal'], ['back', 'Posterior'], ['left', 'Lateral izq.'], ['right', 'Lateral der.'], ['persp', 'Perspectiva']] as [ViewName, string][]).map(([v, l]) => (
          <button key={v} className="btn sm" onClick={() => { setSpin(false); cam.current?.view(v) }}>{l}</button>
        ))}
        <button className={`btn sm ${spin ? 'active' : ''}`} onClick={() => setSpin(!spin)} title="Rotación 360° automática"><Rotate3d size={14} /> 360°</button>
        <button className="btn sm icon" onClick={() => cam.current?.zoom(0.8)} aria-label="Acercar"><Plus size={14} /></button>
        <button className="btn sm icon" onClick={() => cam.current?.zoom(1.25)} aria-label="Alejar"><Minus size={14} /></button>
        <button className="btn sm" onClick={() => { cam.current?.reset(); rig.select(null); setSelected(null); setIsolated(false) }}><RotateCcw size={14} /> Reset</button>
        <button className="btn sm primary" onClick={() => { if (scan) { rig.stopScan(); setScan(null) } else runScan() }}><Scan size={14} /> {scan ? 'Detener' : 'Escanear'}</button>
        <button className={`btn sm ${live ? 'active' : ''}`} onClick={() => { setLive(!live); if (!live) ensure(['arteries', 'veins', 'organs']) }} title="Latido cardiaco, respiración y flujo sanguíneo"><HeartPulse size={14} /> Vida</button>
        <button className={`btn sm ${hq ? 'active' : ''}`} onClick={() => setHq(!hq)} title="Calidad alta / rendimiento"><Gauge size={14} /> {hq ? 'Alta' : 'Rápida'}</button>
        <button className="btn sm icon" onClick={() => setPanels(!panels)} aria-label={panels ? 'Ocultar paneles' : 'Mostrar paneles'} title={panels ? 'Ocultar paneles' : 'Mostrar paneles'}>{panels ? <EyeOff size={14} /> : <Eye size={14} />}</button>
        <button className="btn sm icon" onClick={fullscreen} aria-label="Pantalla completa"><Maximize2 size={14} /></button>
        {live ? <span className="badge pink" style={{ alignSelf: 'center' }}><Activity size={11} /> animación ilustrativa</span> : null}
        {mode === 'holo' ? <span className="badge cyan" style={{ alignSelf: 'center' }}><Sparkles size={11} /> holograma</span> : null}
      </div>
    </div>
  )
}

function FpsMeter({ onFps }: { onFps: (n: number) => void }) {
  const acc = useRef({ t: 0, n: 0 })
  useFrame((_, dt) => {
    acc.current.t += dt
    acc.current.n++
    if (acc.current.t >= 1) { onFps(Math.round(acc.current.n / acc.current.t)); acc.current = { t: 0, n: 0 } }
  })
  return null
}
