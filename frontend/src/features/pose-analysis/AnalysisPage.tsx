import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Activity, AlertTriangle, Box, CheckCircle2, Info, Pause, Play, ThumbsDown, ThumbsUp, XCircle } from 'lucide-react'
import { absUrl, api, errMsg } from '../../services/api'
import { toast, useAuth } from '../../services/store'
import type { PoseAnalysis, PoseSummary } from '../../types'
import { Alert, Card, DataTag, Empty, Field, Spinner, StatusBadge } from '../../components/ui'
import { STATUS_LABEL, fmtDateTime, fmtNum } from '../../utils/format'
import { JOINT_LABEL, drawPose } from '../../utils/pose'
import { Landmarks3D } from '../body-viewer/BodyScene'

const SEV = { critical: ['red', XCircle], warning: ['amber', AlertTriangle], info: ['cyan', Info] } as const
const METRIC_LABEL: Record<string, [string, string]> = {
  inclinacion_hombros_deg: ['Inclinación de hombros', '°'], inclinacion_pelvis_deg: ['Inclinación pélvica', '°'], inclinacion_tronco_deg: ['Inclinación del tronco', '°'],
  ancho_hombros_m: ['Ancho de hombros', 'm'], ancho_caderas_m: ['Ancho de caderas', 'm'], relacion_hombro_cadera: ['Relación hombro/cadera', ''],
  longitud_pierna_m: ['Longitud de pierna', 'm'], longitud_brazo_m: ['Longitud de brazo', 'm'], visibilidad_media: ['Visibilidad media', ''], visibilidad_puntos_clave: ['Visibilidad puntos clave', ''],
}

export default function AnalysisPage() {
  const { id = '' } = useParams()
  const can = useAuth((s) => s.can)
  const role = useAuth((s) => s.user?.role)
  const [a, setA] = useState<PoseAnalysis | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [img, setImg] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const load = () => api<PoseAnalysis>(`/pose-analyses/${id}`).then((x) => {
      if (!alive) return
      setA(x)
      if (x.status === 'queued' || x.status === 'processing') timer = setTimeout(load, 900)
    }).catch((e) => alive && setErr(errMsg(e)))
    load()
    return () => { alive = false; clearTimeout(timer) }
  }, [id])
  useEffect(() => {
    if (!a?.media_asset_id) return
    api<{ url: string }>(`/media/${a.media_asset_id}/signed-url`).then((r) => setImg(absUrl(r.url))).catch(() => setImg(null))
  }, [a?.media_asset_id])

  const review = async (decision: 'approved' | 'rejected') => {
    setBusy(true)
    try { setA(await api<PoseAnalysis>(`/pose-analyses/${id}/review`, { body: { decision, notes } })); toast(decision === 'approved' ? 'Análisis aprobado' : 'Análisis rechazado', 'success') } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }

  if (err) return <Alert kind="error">{err}</Alert>
  if (!a) return <Spinner lg label="Cargando análisis…" />
  const pending = a.status === 'queued' || a.status === 'processing'
  const m = a.metrics_json || {}
  const angles = (m.angulos_articulares_deg || {}) as Record<string, number | null>
  const rom = (m.rango_movimiento_deg || {}) as Record<string, { min: number; max: number; rango: number }>

  return (
    <>
      <div className="page-head">
        <div>
          <div className="row" style={{ gap: 8 }}><StatusBadge status={a.status} /><StatusBadge status={a.review_status} /><DataTag kind="estimate" /></div>
          <h1 style={{ marginTop: 8 }}>Análisis de pose · {a.mode === 'sequence' ? 'Movimiento' : 'Imagen'}</h1>
          <p>{fmtDateTime(a.created_at)} · {a.engine} · {a.model_name} {a.model_version}</p>
        </div>
        <div className="btn-row">
          <Link className="btn" to={`/profiles/${a.profile_id}?tab=media`}>Expediente</Link>
          {a.world_landmarks_json ? <Link className="btn primary" to={`/viewer/${a.profile_id}?analysis=${a.id}`}><Box size={16} /> Ver en visor 3D</Link> : null}
        </div>
      </div>
      {pending ? <div className="mb"><Alert kind="info"><span className="row"><span className="spinner" style={{ width: 16, height: 16 }} /> {STATUS_LABEL[a.status]}: el servicio de IA está evaluando la calidad y calculando métricas…</span></Alert></div> : null}
      {a.status === 'failed' ? <div className="mb"><Alert kind="error">El análisis falló: {a.error || a.quality_flags.map((f) => f.message).join(' ')}</Alert></div> : null}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,1fr) minmax(0,1fr)' }}>
        <Card title="Imagen y landmarks" sub="Imagen privada (URL firmada temporal)">
          <PoseImage src={img} analysis={a} />
        </Card>
        <Card title="Esqueleto 3D" sub="Landmarks del mundo (metros, origen en la cadera)">
          {a.world_landmarks_json ? (
            <div className="holo-frame" style={{ height: 380 }}>
              <Canvas camera={{ position: [0, 0.2, 2.6], fov: 40 }}>
                <ambientLight intensity={0.8} />
                <gridHelper args={[3, 12, '#0e7490', '#0b2a4a']} position={[0, -1, 0]} />
                <Landmarks3D world={a.world_landmarks_json} hipY={0} />
                <OrbitControls autoRotate autoRotateSpeed={1.2} enableDamping />
              </Canvas>
            </div>
          ) : <Empty title="Sin landmarks 3D" />}
        </Card>
        <Card title="Calidad de la captura" sub={a.quality_score != null ? `Puntuación ${fmtNum(a.quality_score, 0)}%` : ''}>
          {a.quality_score != null ? <div className="progress mb"><i style={{ width: `${a.quality_score}%` }} /></div> : null}
          {a.quality_flags.length === 0 && !pending ? <Alert kind="success">Sin advertencias: encuadre, visibilidad e iluminación correctos.</Alert> : (
            <div className="col" style={{ gap: 8 }}>
              {a.quality_flags.map((f, i) => {
                const [tone, Icon] = SEV[f.severity] || SEV.info
                return <div key={i} className={`alert ${tone === 'red' ? 'error' : tone === 'amber' ? 'warn' : 'info'}`}><Icon size={16} /><div><b className="small">{f.code}</b><div>{f.message}</div></div></div>
              })}
            </div>
          )}
          {can('pose:run') && (role === 'admin' || role === 'specialist') && !pending && a.status !== 'failed' ? (
            <>
              <div className="divider" />
              <div className="card-title" style={{ fontSize: 14 }}>Revisión del especialista</div>
              {a.reviewed_at ? <div className="small muted mt-s">Revisado {fmtDateTime(a.reviewed_at)} {a.review_notes ? `· ${a.review_notes}` : ''}</div> : null}
              <Field label="Notas de revisión" htmlFor="rv-notes"><textarea id="rv-notes" className="textarea" style={{ minHeight: 60 }} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} /></Field>
              <div className="btn-row">
                <button className="btn primary sm" disabled={busy} onClick={() => review('approved')}><ThumbsUp size={14} /> Aprobar</button>
                <button className="btn danger sm" disabled={busy} onClick={() => review('rejected')}><ThumbsDown size={14} /> Rechazar</button>
              </div>
            </>
          ) : null}
        </Card>
      </div>

      {!pending && a.status !== 'failed' ? (
        <div className="grid g-2 mt">
          <Card title="Métricas posturales" sub={<span><DataTag kind="estimate" /> referencias visuales, no mediciones clínicas</span>}>
            <div className="grid g-2" style={{ gap: 4 }}>
              {Object.entries(METRIC_LABEL).filter(([k]) => m[k] !== undefined && m[k] !== null).map(([k, [l, u]]) => (
                <div className="stat-line" key={k}><span className="muted">{l}</span><b>{typeof m[k] === 'number' ? (k.startsWith('visib') ? `${Math.round(m[k] * 100)}%` : `${fmtNum(m[k], 3)} ${u}`) : '—'}</b></div>
              ))}
            </div>
            <div className="divider" />
            <div className="card-title" style={{ fontSize: 14, marginBottom: 6 }}><Activity size={15} /> Ángulos articulares</div>
            <div className="grid g-2" style={{ gap: 4 }}>
              {Object.entries(angles).map(([k, v]) => <div className="stat-line" key={k}><span className="muted">{JOINT_LABEL[k] || k}</span><b>{v == null ? '—' : `${v}°`}</b></div>)}
            </div>
          </Card>
          {a.mode === 'sequence' && a.frames_json?.length ? (
            <Card title="Secuencia de movimiento" sub={`${a.frames_json.length} fotogramas · ${m.secuencia?.duracion_s ?? '—'} s`}>
              <SequencePlayer frames={a.frames_json} />
              {Object.keys(rom).length ? (
                <table className="table mt">
                  <thead><tr><th>Articulación</th><th className="num">Mín.</th><th className="num">Máx.</th><th className="num">Rango</th></tr></thead>
                  <tbody>{Object.entries(rom).map(([k, r]) => <tr key={k}><td>{JOINT_LABEL[k] || k}</td><td className="num">{r.min}°</td><td className="num">{r.max}°</td><td className="num"><b>{r.rango}°</b></td></tr>)}</tbody>
                </table>
              ) : null}
            </Card>
          ) : (
            <Card title="Trazabilidad del resultado">
              <div className="stat-line"><span className="muted">Motor</span><span>{a.engine}</span></div>
              <div className="stat-line"><span className="muted">Modelo</span><span>{a.model_name} · {a.model_version}</span></div>
              {Object.entries(a.config_json || {}).map(([k, v]) => <div className="stat-line" key={k}><span className="muted">{k}</span><span className="mono">{String(v)}</span></div>)}
              <div className="stat-line"><span className="muted">Procesado</span><span>{fmtDateTime(a.completed_at)}</span></div>
              <p className="small dim">Los landmarks son referencias de postura y alineación aproximada; no equivalen a perímetros ni composición corporal.</p>
            </Card>
          )}
        </div>
      ) : null}
    </>
  )
}

function PoseImage({ src, analysis }: { src: string | null; analysis: PoseAnalysis }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    const c = canvas.current
    if (!c || !dims || !analysis.landmarks_json) return
    c.width = dims.w; c.height = dims.h
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    drawPose(ctx, analysis.landmarks_json, dims.w, dims.h)
  }, [dims, analysis.landmarks_json])
  return (
    <div className="capture-stage" style={{ maxHeight: 420 }}>
      {src ? <img src={src} alt="Captura analizada" onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} /> : <div className="center-fill" style={{ height: '100%' }}><span className="dim small">Imagen no disponible</span></div>}
      <canvas ref={canvas} />
    </div>
  )
}

function SequencePlayer({ frames }: { frames: NonNullable<PoseAnalysis['frames_json']> }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [playing, setPlaying] = useState(true)
  const [i, setI] = useState(0)
  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => setI((x) => (x + 1) % frames.length), 70)
    return () => clearInterval(t)
  }, [playing, frames.length])
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    c.width = 480; c.height = 480
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#020814'
    ctx.fillRect(0, 0, c.width, c.height)
    for (let k = Math.max(0, i - 6); k < i; k++) drawPose(ctx, frames[k].landmarks, c.width, c.height, { alpha: 0.08 + (0.1 * (k - i + 6)) / 6, color: '#0ea5e9' })
    drawPose(ctx, frames[i].landmarks, c.width, c.height)
  }, [i, frames])
  return (
    <div>
      <canvas ref={canvas} style={{ width: '100%', maxWidth: 420, aspectRatio: '1', borderRadius: 12, border: '1px solid var(--border)', display: 'block', margin: '0 auto' }} />
      <div className="row mt-s" style={{ justifyContent: 'center' }}>
        <button className="btn sm" onClick={() => setPlaying(!playing)}>{playing ? <Pause size={14} /> : <Play size={14} />}</button>
        <input type="range" min={0} max={frames.length - 1} value={i} onChange={(e) => { setPlaying(false); setI(Number(e.target.value)) }} style={{ maxWidth: 260 }} aria-label="Fotograma" />
        <span className="small mono">{frames[i].t.toFixed(2)} s</span>
      </div>
    </div>
  )
}

export function AnalysesListPage() {
  const [rows, setRows] = useState<PoseSummary[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { api<PoseSummary[]>('/pose-analyses?limit=100').then(setRows).catch((e) => setErr(errMsg(e))) }, [])
  return (
    <>
      <div className="page-head"><div><h1>Análisis IA</h1><p>Resultados de pose versionados de los expedientes autorizados.</p></div><Link className="btn primary" to="/select/capture">Nueva captura</Link></div>
      <Card>
        {err ? <Alert kind="error">{err}</Alert> : !rows ? <Spinner /> : rows.length === 0 ? (
          <Empty title="Aún no hay análisis">Realiza una captura corporal con cámara o foto para generar landmarks.</Empty>
        ) : (
          <table className="table">
            <thead><tr><th>Fecha</th><th>Expediente</th><th>Modo</th><th>Motor / versión</th><th>Estado</th><th className="num">Calidad</th><th>Advertencias</th><th>Revisión</th><th /></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td className="nowrap">{fmtDateTime(r.created_at)}</td><td className="mono">{r.profile_code}</td><td>{r.mode === 'sequence' ? 'Movimiento' : 'Imagen'}</td>
                <td className="small muted">{r.engine} · {r.model_version}</td><td><StatusBadge status={r.status} /></td>
                <td className="num">{r.quality_score != null ? `${fmtNum(r.quality_score, 0)}%` : '—'}</td>
                <td>{r.quality_flags.length ? <span className="badge amber">{r.quality_flags.length}</span> : <CheckCircle2 size={16} color="#4ade80" />}</td>
                <td><StatusBadge status={r.review_status} /></td>
                <td><Link className="btn sm" to={`/analyses/${r.id}`}>Abrir</Link></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </>
  )
}
