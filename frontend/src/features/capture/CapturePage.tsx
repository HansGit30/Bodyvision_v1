import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Camera, CameraOff, CheckCircle2, Circle, FlipHorizontal2, ImageUp, Loader2, RefreshCw, Save, ScanLine, ShieldAlert, Square, Video, XCircle } from 'lucide-react'
import type { PoseLandmarker } from '@mediapipe/tasks-vision'
import { api, errMsg } from '../../services/api'
import { toast, useCurrentProfile } from '../../services/store'
import type { LM, PoseFrame, Profile } from '../../types'
import { Alert, Card, DataTag, Spinner } from '../../components/ui'
import { JOINT_LABEL, drawPose, jointAngles, liveQuality, sanitize, type LiveQuality } from '../../utils/pose'
import { ConsentForm } from '../consent/ConsentPanel'
import { getPoseEngine, setMode, type EngineInfo } from './poseEngine'

type View = 'frontal' | 'lateral' | 'posterior'
interface Captured {
  blob: Blob
  url: string
  width: number
  height: number
  landmarks: LM[] | null
  world: LM[] | null
  frames: PoseFrame[] | null
  mode: 'image' | 'sequence'
}
const REC_SECONDS = 6
const REC_INTERVAL = 66

export default function CapturePage() {
  const { profileId = '' } = useParams()
  const nav = useNavigate()
  const setCurrent = useCurrentProfile((s) => s.setCurrent)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [perr, setPerr] = useState<string | null>(null)
  const [source, setSource] = useState<'camera' | 'upload'>('camera')
  const [view, setView] = useState<View>('frontal')
  const [engine, setEngine] = useState<{ lm: PoseLandmarker; info: EngineInfo } | null>(null)
  const [engineErr, setEngineErr] = useState<string | null>(null)
  const [cam, setCam] = useState<'idle' | 'starting' | 'on' | 'error'>('idle')
  const [camErr, setCamErr] = useState<string | null>(null)
  const [facing, setFacing] = useState<'user' | 'environment'>('user')
  const [quality, setQuality] = useState<LiveQuality | null>(null)
  const [angles, setAngles] = useState<Record<string, number | null>>({})
  const [fps, setFps] = useState(0)
  const [recording, setRecording] = useState<number | null>(null)
  const [captured, setCaptured] = useState<Captured | null>(null)
  const [saving, setSaving] = useState(false)
  const [needConsent, setNeedConsent] = useState(false)
  const [detectingImg, setDetectingImg] = useState(false)

  const video = useRef<HTMLVideoElement>(null)
  const overlay = useRef<HTMLCanvasElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const raf = useRef(0)
  const last = useRef<{ lms: LM[] | null; world: LM[] | null; ts: number }>({ lms: null, world: null, ts: 0 })
  const rec = useRef<{ start: number; lastT: number; frames: PoseFrame[]; snap: Captured | null } | null>(null)
  const bright = useRef(128)
  const viewRef = useRef(view)
  viewRef.current = view

  const loadProfile = useCallback(() => {
    api<Profile>(`/profiles/${profileId}`).then((p) => { setProfile(p); setCurrent({ id: p.id, code: p.display_code, name: p.display_name, sex: p.sex }) }).catch((e) => setPerr(errMsg(e)))
  }, [profileId, setCurrent])
  useEffect(() => { loadProfile() }, [loadProfile])

  const loadEngine = useCallback(() => {
    setEngineErr(null)
    getPoseEngine().then(setEngine).catch((e) => setEngineErr(`No se pudo cargar el modelo de pose (${errMsg(e)}). Verifica la conexión a internet.`))
  }, [])
  useEffect(() => { loadEngine() }, [loadEngine])

  // ---------------------------------------------------------------- cámara
  const stopCamera = useCallback(() => {
    cancelAnimationFrame(raf.current)
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    setCam('idle')
  }, [])
  useEffect(() => () => stopCamera(), [stopCamera])

  const startCamera = async () => {
    setCamErr(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setCam('error'); setCamErr('La cámara requiere un contexto seguro (HTTPS o localhost) y un navegador compatible.'); return
    }
    setCam('starting')
    try {
      stopCamera()
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false })
      stream.current = s
      const v = video.current!
      v.srcObject = s
      await v.play()
      setCam('on')
    } catch (e) {
      const n = (e as DOMException).name
      setCam('error')
      setCamErr(n === 'NotAllowedError' ? 'Permiso de cámara denegado. Habilítalo en la configuración del navegador.' : n === 'NotFoundError' ? 'No se encontró ninguna cámara.' : n === 'NotReadableError' ? 'La cámara está siendo usada por otra aplicación.' : `No se pudo iniciar la cámara (${n || 'error'}).`)
    }
  }
  useEffect(() => { if (cam === 'on') startCamera() /* cambiar cámara frontal/trasera */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing])

  // bucle de detección en tiempo real
  useEffect(() => {
    if (cam !== 'on' || !engine || captured) return
    let alive = true
    let lastVideoTime = -1
    let frames = 0, fpsT = performance.now(), qT = 0, bT = 0
    const small = document.createElement('canvas')
    small.width = 32; small.height = 32
    const sctx = small.getContext('2d', { willReadFrequently: true })!
    const loop = async () => {
      if (!alive) return
      const v = video.current, c = overlay.current
      if (v && c && v.readyState >= 2 && v.videoWidth) {
        if (c.width !== v.videoWidth) { c.width = v.videoWidth; c.height = v.videoHeight }
        const now = performance.now()
        if (v.currentTime !== lastVideoTime) {
          lastVideoTime = v.currentTime
          try {
            await setMode(engine.lm, 'VIDEO')
            const ts = Math.max(now, last.current.ts + 1)
            const res = engine.lm.detectForVideo(v, ts)
            const lms = sanitize(res.landmarks?.[0])
            const world = sanitize(res.worldLandmarks?.[0])
            last.current = { lms, world, ts }
            const ctx = c.getContext('2d')!
            ctx.clearRect(0, 0, c.width, c.height)
            if (lms) drawPose(ctx, lms, c.width, c.height)
            if (now - bT > 600) {
              bT = now
              sctx.drawImage(v, 0, 0, 32, 32)
              const d = sctx.getImageData(0, 0, 32, 32).data
              let s = 0
              for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
              bright.current = s / (d.length / 4)
            }
            if (now - qT > 250) {
              qT = now
              setQuality(lms ? liveQuality(lms, v.videoWidth, v.videoHeight, bright.current, viewRef.current) : null)
              setAngles(lms ? jointAngles(lms, v.videoWidth, v.videoHeight) : {})
            }
            const r = rec.current
            if (r && lms) {
              const t = (now - r.start) / 1000
              if (now - r.lastT >= REC_INTERVAL) { r.frames.push({ t: Math.round(t * 1000) / 1000, landmarks: lms, world_landmarks: world }); r.lastT = now }
              setRecording(Math.min(REC_SECONDS, t))
              if (t >= REC_SECONDS || r.frames.length >= 120) finishRecording()
            }
          } catch { /* fotograma inválido: se ignora */ }
          frames++
          if (now - fpsT > 1000) { setFps(Math.round((frames * 1000) / (now - fpsT))); frames = 0; fpsT = now }
        }
      }
      raf.current = requestAnimationFrame(loop)
    }
    raf.current = requestAnimationFrame(loop)
    return () => { alive = false; cancelAnimationFrame(raf.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cam, engine, captured])

  const snapshot = async (): Promise<Captured | null> => {
    const v = video.current
    if (!v || !v.videoWidth) return null
    const c = document.createElement('canvas')
    c.width = v.videoWidth; c.height = v.videoHeight
    c.getContext('2d')!.drawImage(v, 0, 0)
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.92))
    if (!blob) return null
    return { blob, url: URL.createObjectURL(blob), width: c.width, height: c.height, landmarks: last.current.lms, world: last.current.world, frames: null, mode: 'image' }
  }

  const capturePhoto = async () => {
    if (!last.current.lms) { toast('No se detecta una persona en el encuadre', 'error'); return }
    const s = await snapshot()
    if (s) setCaptured(s)
  }

  const startRecording = async () => {
    if (!last.current.lms) { toast('Colócate frente a la cámara antes de grabar', 'error'); return }
    const snap = await snapshot()
    rec.current = { start: performance.now(), lastT: 0, frames: [], snap }
    setRecording(0)
  }
  function finishRecording() {
    const r = rec.current
    rec.current = null
    setRecording(null)
    if (!r || !r.snap) return
    if (r.frames.length < 5) { toast('Secuencia demasiado corta, intenta de nuevo', 'error'); return }
    setCaptured({ ...r.snap, frames: r.frames, mode: 'sequence' })
  }

  // ---------------------------------------------------------------- subida de foto
  const onFile = async (file: File | undefined) => {
    if (!file || !engine) return
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { toast('Formato no admitido: usa JPEG, PNG o WEBP', 'error'); return }
    if (file.size > 10 * 1024 * 1024) { toast('El archivo supera 10 MB', 'error'); return }
    setDetectingImg(true)
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
      const scale = Math.min(1, 2048 / Math.max(bmp.width, bmp.height))
      const c = document.createElement('canvas')
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale)
      c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
      bmp.close()
      await setMode(engine.lm, 'IMAGE')
      const res = engine.lm.detect(c)
      const lms = sanitize(res.landmarks?.[0])
      const world = sanitize(res.worldLandmarks?.[0])
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.92))
      if (!blob) throw new Error('No se pudo procesar la imagen')
      if (!lms) toast('No se detectó una pose en la imagen. Puedes guardarla igualmente para revisión.', 'error')
      else { setQuality(liveQuality(lms, c.width, c.height, 128, view)); setAngles(jointAngles(lms, c.width, c.height)) }
      setCaptured({ blob, url: URL.createObjectURL(blob), width: c.width, height: c.height, landmarks: lms, world, frames: null, mode: 'image' })
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setDetectingImg(false)
    }
  }

  // dibuja la superposición sobre la captura congelada
  const stillCanvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = stillCanvas.current
    if (!c || !captured) return
    c.width = captured.width; c.height = captured.height
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    if (captured.landmarks) drawPose(ctx, captured.landmarks, c.width, c.height)
  }, [captured])
  useEffect(() => () => { if (captured) URL.revokeObjectURL(captured.url) }, [captured])

  const discard = () => { setCaptured(null); setQuality(null) }

  const save = async () => {
    if (!captured || !profile || !engine) return
    if (!profile.consent_image) { setNeedConsent(true); return }
    if (captured.mode === 'image' && !captured.landmarks) { toast('Sin landmarks no se puede crear el análisis. Repite la captura.', 'error'); return }
    setSaving(true)
    try {
      const fd = new FormData()
      fd.append('file', captured.blob, `captura-${view}.jpg`)
      fd.append('capture_view', view)
      const media = await api<{ id: string }>(`/profiles/${profile.id}/media`, { form: fd, timeout: 60000 })
      const body = {
        engine: engine.info.engine, model_name: engine.info.model_name, model_version: engine.info.model_version,
        config: { ...engine.info.config, running_mode: captured.mode === 'sequence' ? 'VIDEO' : source === 'camera' ? 'VIDEO' : 'IMAGE', source },
        mode: captured.mode, capture_view: view,
        landmarks: captured.mode === 'image' ? captured.landmarks : undefined,
        world_landmarks: captured.mode === 'image' ? captured.world : undefined,
        frames: captured.mode === 'sequence' ? captured.frames : undefined,
      }
      const pa = await api<{ id: string }>(`/media/${media.id}/pose-analyses`, { body, timeout: 60000 })
      toast('Captura guardada. Procesando análisis…', 'success')
      stopCamera()
      nav(`/analyses/${pa.id}`)
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  if (perr) return <Alert kind="error">{perr}</Alert>
  if (!profile) return <Spinner lg label="Cargando expediente…" />

  const Check = ({ ok, label }: { ok: boolean; label: string }) => (
    <div className="check-item">{ok ? <CheckCircle2 size={16} className="ok" /> : <XCircle size={16} className="bad" />}<span>{label}</span></div>
  )

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Captura corporal</h1>
          <p><span className="mono">{profile.display_code}</span> · {profile.display_name} — detección de 33 puntos de movimiento con MediaPipe Pose</p>
        </div>
        <div className="btn-row">
          <button className={`btn ${source === 'camera' ? 'active' : ''}`} onClick={() => { setSource('camera'); discard() }}><Camera size={16} /> Cámara en vivo</button>
          <button className={`btn ${source === 'upload' ? 'active' : ''}`} onClick={() => { setSource('upload'); stopCamera(); discard() }}><ImageUp size={16} /> Subir foto</button>
        </div>
      </div>

      {!profile.consent_image ? (
        <div className="mb"><Alert kind="warn"><b>Consentimiento requerido.</b> Antes de guardar imágenes registra el consentimiento de procesamiento de imágenes. <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => setNeedConsent(true)}><ShieldAlert size={14} /> Registrar ahora</button></Alert></div>
      ) : null}
      {engineErr ? <div className="mb"><Alert kind="error">{engineErr} <button className="btn sm" onClick={loadEngine}><RefreshCw size={13} /> Reintentar</button></Alert></div> : null}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.5fr) minmax(280px, 1fr)' }}>
        <Card>
          <div className="capture-stage">
            {source === 'camera' ? (
              <>
                <video ref={video} playsInline muted className={facing === 'user' ? 'mirror' : ''} />
                <canvas ref={overlay} className={facing === 'user' ? 'mirror' : ''} />
                <div className="frame-guide" />
                {cam !== 'on' ? (
                  <div className="center-fill" style={{ position: 'absolute', inset: 0, background: 'rgba(2,8,20,.85)' }}>
                    {cam === 'starting' ? <><Loader2 className="spin" /><span>Iniciando cámara…</span></> : (
                      <>
                        <Camera size={40} color="#22d3ee" />
                        <div style={{ maxWidth: 360, textAlign: 'center' }}>{camErr || 'Activa la cámara para detectar tus puntos de movimiento en tiempo real.'}</div>
                        <button className="btn primary" onClick={startCamera} disabled={!engine}>{engine ? <><Video size={16} /> Activar cámara</> : <><Loader2 size={16} className="spin" /> Cargando modelo IA…</>}</button>
                      </>
                    )}
                  </div>
                ) : null}
                {recording !== null ? (
                  <div className="overlay hud-panel row" style={{ left: 12, top: 12, padding: '6px 12px' }}>
                    <span className="rec-dot" /> Grabando movimiento {recording.toFixed(1)} / {REC_SECONDS}s
                  </div>
                ) : cam === 'on' && !captured ? (
                  <div className="overlay hud-panel small" style={{ right: 12, top: 12, padding: '4px 10px' }}>{fps} fps · {String(engine?.info.config.delegate ?? '')}</div>
                ) : null}
              </>
            ) : !captured ? (
              <label className="center-fill" style={{ position: 'absolute', inset: 0, cursor: 'pointer' }}>
                {detectingImg ? <><div className="spinner lg" /><span>Detectando pose…</span></> : (
                  <>
                    <ImageUp size={44} color="#22d3ee" />
                    <b>Selecciona una foto de cuerpo completo</b>
                    <span className="small dim">JPEG, PNG o WEBP · máx. 10 MB · se eliminan los metadatos</span>
                    <span className="btn primary">{engine ? 'Elegir imagen' : 'Cargando modelo IA…'}</span>
                  </>
                )}
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={!engine || detectingImg} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = '' }} />
              </label>
            ) : null}
            {captured ? (
              <div style={{ position: 'absolute', inset: 0, background: '#020814' }}>
                <img src={captured.url} alt="Captura" />
                <canvas ref={stillCanvas} />
                <div className="overlay" style={{ left: 12, top: 12 }}>
                  <span className="badge cyan">{captured.mode === 'sequence' ? `Movimiento · ${captured.frames?.length} fotogramas` : 'Imagen capturada'}</span>
                </div>
              </div>
            ) : null}
          </div>
          <div className="btn-row mt" style={{ justifyContent: 'center' }}>
            {captured ? (
              <>
                <button className="btn" onClick={discard}><RefreshCw size={16} /> Repetir</button>
                <button className="btn primary" onClick={save} disabled={saving}>{saving ? <Loader2 size={16} /> : <Save size={16} />} Guardar y analizar</button>
              </>
            ) : source === 'camera' && cam === 'on' ? (
              <>
                <button className="btn" onClick={() => setFacing(facing === 'user' ? 'environment' : 'user')} title="Cambiar cámara"><FlipHorizontal2 size={16} /></button>
                <button className="btn primary" onClick={capturePhoto} disabled={recording !== null}><Circle size={16} /> Capturar foto</button>
                {recording === null
                  ? <button className="btn" onClick={startRecording}><Video size={16} /> Grabar movimiento ({REC_SECONDS}s)</button>
                  : <button className="btn danger" onClick={finishRecording}><Square size={16} /> Detener</button>}
                <button className="btn ghost" onClick={stopCamera}><CameraOff size={16} /> Apagar</button>
              </>
            ) : null}
          </div>
        </Card>

        <div className="col" style={{ gap: 16 }}>
          <Card title="Guía de captura" sub="Postura, iluminación, distancia y encuadre">
            <div className="row" style={{ gap: 6, marginBottom: 10 }}>
              {(['frontal', 'lateral', 'posterior'] as View[]).map((v) => (
                <button key={v} className={`btn sm grow ${view === v ? 'active' : ''}`} onClick={() => setView(v)}>{v === 'frontal' ? 'Frontal' : v === 'lateral' ? 'Lateral' : 'Posterior'}</button>
              ))}
            </div>
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
              <li>De pie, cuerpo completo visible (cabeza a pies), brazos ligeramente separados.</li>
              <li>Distancia de 2 a 3 m; cámara a la altura de la cadera.</li>
              <li>Luz uniforme y frontal; evita contraluces y fondos saturados.</li>
              <li>Ropa ajustada para mejorar la precisión de los puntos.</li>
            </ul>
          </Card>
          <Card title="Control de calidad" sub={<span><ScanLine size={13} style={{ verticalAlign: -2 }} /> {captured ? 'De la captura' : 'En tiempo real'}</span>}>
            {quality ? (
              <>
                <Check ok={quality.fullBody} label={quality.fullBody ? 'Cuerpo completo visible' : `Falta: ${quality.missing.join(', ')}`} />
                <Check ok={quality.centered} label="Sujeto centrado" />
                <Check ok={quality.distance === 'ok'} label={quality.distance === 'ok' ? 'Distancia adecuada' : quality.distance === 'near' ? 'Demasiado cerca: retrocede' : 'Demasiado lejos: acércate'} />
                <Check ok={quality.light === 'ok'} label={quality.light === 'ok' ? 'Iluminación adecuada' : quality.light === 'dark' ? 'Poca luz' : 'Sobreexposición'} />
                <Check ok={quality.orientation} label={view === 'lateral' ? 'Orientación lateral' : 'De frente a la cámara'} />
                <div className="row between small mt-s"><span className="muted">Visibilidad media</span><b>{Math.round(quality.visibility * 100)}%</b></div>
                <div className="progress mt-s"><i style={{ width: `${Math.round(quality.visibility * 100)}%` }} /></div>
              </>
            ) : <div className="small dim">{engine ? 'Esperando una persona en el encuadre…' : 'Cargando modelo de pose…'}</div>}
          </Card>
          <Card title="Puntos de movimiento" sub={<DataTag kind="estimate" />}>
            {Object.keys(angles).length ? (
              <div className="grid g-2" style={{ gap: 6 }}>
                {Object.entries(angles).map(([k, v]) => (
                  <div key={k} className="stat-line"><span className="muted small">{JOINT_LABEL[k]}</span><b>{v === null ? '—' : `${v}°`}</b></div>
                ))}
              </div>
            ) : <div className="small dim">Los ángulos articulares aparecen al detectar la pose.</div>}
            <div className="small dim mt-s">Ángulos 2D aproximados (referencia visual, no clínica).</div>
          </Card>
          {engine ? <div className="small dim">Motor: {engine.info.engine} · {engine.info.model_name} {engine.info.model_version} · {String(engine.info.config.model_source)}</div> : null}
          <Link to={`/profiles/${profile.id}?tab=media`} className="small">Ver capturas y análisis previos →</Link>
        </div>
      </div>
      {needConsent ? <ConsentForm profile={profile} purpose="image_processing" onClose={() => setNeedConsent(false)} onSaved={() => { setNeedConsent(false); setProfile({ ...profile, consent_image: true }); loadProfile() }} /> : null}
    </>
  )
}
