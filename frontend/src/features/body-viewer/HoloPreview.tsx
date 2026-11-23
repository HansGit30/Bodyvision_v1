import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import { AnatomyRig, type PartInfo, type RenderMode } from './engine/AnatomyRig'
import { CameraRig, Interaction, Lighting, RigLayers, RigRoot, Stage, type LayerStatus } from './BodyScene'
import type { LayerKey } from './engine/layers'

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Vista holográfica compacta (dashboard / login) con rotación 360°, escaneo periódico y nombres al pasar el cursor. */
export function HoloPreview({ sex = 'M', fat = 0, mode = 'holo', interactive = true, height = 380, layers = ['skin'], periodicScan = true }: {
  sex?: 'M' | 'F'; fat?: number; mode?: RenderMode; interactive?: boolean; height?: number | string; layers?: LayerKey[]; periodicScan?: boolean
}) {
  const rig = useMemo(() => new AnatomyRig(), [])
  useEffect(() => () => rig.dispose(), [rig])
  const [ready, setReady] = useState(false)
  const [hover, setHover] = useState<PartInfo | null>(null)
  const tip = useRef<HTMLDivElement>(null)
  const req = useMemo<LayerKey[]>(() => [...new Set<LayerKey>([...layers, 'skeleton'])], [layers])

  useEffect(() => { rig.setVisibleLayers(layers); rig.setRenderMode(mode) }, [rig, layers, mode])
  useEffect(() => { rig.setMorph({ female: sex === 'F' ? 1 : 0, fat, heightCm: sex === 'F' ? 165 : 175 }, !ready) }, [rig, sex, fat, ready])
  const onStatus = useCallback((k: LayerKey, s: LayerStatus) => { if (k === layers[0] && s === 'ready') setReady(true) }, [layers])
  useEffect(() => {
    if (!ready || !periodicScan || reduced()) return
    const first = setTimeout(() => rig.startScan(), 1200)
    const iv = setInterval(() => rig.startScan(), 14000)
    return () => { clearTimeout(first); clearInterval(iv) }
  }, [rig, ready, periodicScan])
  const onHover = useCallback((info: PartInfo | null, x: number, y: number) => {
    setHover((h) => (h?.zname === info?.zname ? h : info))
    if (tip.current && info) { tip.current.style.left = `${x}px`; tip.current.style.top = `${y}px` }
  }, [])

  return (
    <div className="holo-frame" style={{ height }}>
      <Canvas
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, localClippingEnabled: true } as never}
        camera={{ fov: 32, near: 0.01, far: 40, position: [0, 1.05, 3.9] }}
        onCreated={({ gl }) => { gl.localClippingEnabled = true; gl.toneMapping = THREE.ACESFilmicToneMapping }}
      >
        <Lighting />
        <Stage rig={rig} particles radius={0.55} />
        <RigRoot rig={rig} />
        <RigLayers rig={rig} layers={req} retry={{}} onStatus={onStatus} />
        <CameraRig rig={rig} autoRotate={!reduced()} />
        {interactive ? <Interaction rig={rig} onHover={onHover} /> : null}
      </Canvas>
      {!ready ? <div className="overlay" style={{ left: '50%', top: '50%', transform: 'translate(-50%,-50%)' }}><div className="spinner" /></div> : null}
      {interactive ? (
        <div ref={tip} className="viewer-tooltip" style={{ display: hover ? 'block' : 'none', ['--tc' as string]: hover?.color }}>
          {hover ? <><div className="tt-name">{hover.name}</div><div className="tt-sys"><i />{hover.system}</div></> : null}
        </div>
      ) : null}
    </div>
  )
}

/** Comparación BASE vs SIMULACIÓN en una misma escena (cámaras sincronizadas). */
export function DualBody({ sex, heightCm, base, scenario, muscle }: {
  sex: 'M' | 'F'; heightCm: number; base: number; scenario: number; muscle: number
}) {
  const rigA = useMemo(() => new AnatomyRig(), [])
  const rigB = useMemo(() => new AnatomyRig(), [])
  useEffect(() => () => { rigA.dispose(); rigB.dispose() }, [rigA, rigB])
  const [ready, setReady] = useState({ a: false, b: false })
  const [mode, setMode] = useState<RenderMode>('real')
  useEffect(() => { rigA.setRenderMode(mode); rigB.setRenderMode(mode) }, [rigA, rigB, mode])
  useEffect(() => { rigA.setMorph({ female: sex === 'F' ? 1 : 0, fat: base, muscle: 0, heightCm }, !ready.a) }, [rigA, sex, base, heightCm, ready.a])
  useEffect(() => { rigB.setMorph({ female: sex === 'F' ? 1 : 0, fat: scenario, muscle, heightCm }, !ready.b) }, [rigB, sex, scenario, muscle, heightCm, ready.b])
  const sa = useCallback((_: LayerKey, s: LayerStatus) => { if (s === 'ready') setReady((r) => ({ ...r, a: true })) }, [])
  const sb = useCallback((_: LayerKey, s: LayerStatus) => { if (s === 'ready') setReady((r) => ({ ...r, b: true })) }, [])
  const tag = (txt: string, color: string) => (
    <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, letterSpacing: '.14em', fontSize: 12, color, background: 'rgba(3,12,30,.85)', border: `1px solid ${color}`, padding: '3px 10px', borderRadius: 8, whiteSpace: 'nowrap' }}>{txt}</div>
  )
  return (
    <div className="holo-frame" style={{ height: 520 }}>
      <Canvas
        dpr={[1, 1.6]}
        gl={{ antialias: true, alpha: true, localClippingEnabled: true } as never}
        camera={{ fov: 34, near: 0.01, far: 40, position: [0, 1.0, 4.4] }}
        onCreated={({ gl }) => { gl.localClippingEnabled = true; gl.toneMapping = THREE.ACESFilmicToneMapping }}
      >
        <Lighting />
        <group position={[-0.5, 0, 0]}><Stage rig={rigA} particles={false} radius={0.42} /></group>
        <group position={[0.5, 0, 0]}><Stage rig={rigB} particles={false} radius={0.42} /></group>
        <RigRoot rig={rigA} position={[-0.5, 0, 0]} />
        <RigRoot rig={rigB} position={[0.5, 0, 0]} />
        <RigLayers rig={rigA} layers={['skin']} retry={{}} onStatus={sa} />
        <RigLayers rig={rigB} layers={['skin']} retry={{}} onStatus={sb} />
        <CameraRig rig={rigA} autoRotate={false} />
      </Canvas>
      <div className="overlay" style={{ left: '30%', top: 14, transform: 'translateX(-50%)' }}>{tag('BASE · OBSERVADO', '#4ade80')}</div>
      <div className="overlay" style={{ left: '70%', top: 14, transform: 'translateX(-50%)' }}>{tag('SIMULACIÓN', '#f472b6')}</div>
      <div className="overlay row" style={{ right: 12, bottom: 12, gap: 6 }}>
        {(['real', 'holo', 'heat'] as RenderMode[]).map((m) => (
          <button key={m} className={`chip ${mode === m ? 'on' : ''}`} onClick={() => setMode(m)}>{m === 'real' ? 'Realista' : m === 'holo' ? 'Holograma' : 'Mapa térmico'}</button>
        ))}
      </div>
    </div>
  )
}
