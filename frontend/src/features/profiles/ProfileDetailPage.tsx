import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Activity, BarChart3, Box, Camera, FileText, ImageIcon, KeyRound, Pencil, ShieldCheck, Sparkles, Trash2, UserPlus } from 'lucide-react'
import { absUrl, api, errMsg } from '../../services/api'
import { toast, useAuth, useCurrentProfile } from '../../services/store'
import type { MediaAsset, PoseSummary, Profile } from '../../types'
import { Alert, Card, DataTag, Empty, Field, Modal, Spinner, StatusBadge, Tabs } from '../../components/ui'
import { ROLE_LABEL, ageFrom, bmi, bmiCategory, fmtDate, fmtDateTime, fmtNum } from '../../utils/format'
import { MeasurementsPanel } from '../measurements/MeasurementsPanel'
import { ConsentPanel } from '../consent/ConsentPanel'
import { ProfileForm } from './ProfilesPage'

type Tab = 'summary' | 'measurements' | 'consent' | 'media' | 'access'

export default function ProfileDetailPage() {
  const { id = '' } = useParams()
  const [sp, setSp] = useSearchParams()
  const tab = (sp.get('tab') as Tab) || 'summary'
  const setTab = (t: Tab) => setSp(t === 'summary' ? {} : { tab: t }, { replace: true })
  const { can } = useAuth()
  const setCurrent = useCurrentProfile((s) => s.setCurrent)
  const [p, setP] = useState<Profile | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const load = useCallback(() => {
    api<Profile>(`/profiles/${id}`).then((x) => {
      setP(x)
      setCurrent({ id: x.id, code: x.display_code, name: x.display_name, sex: x.sex })
    }).catch((e) => setErr(errMsg(e)))
  }, [id, setCurrent])
  useEffect(() => { setP(null); setErr(null); load() }, [load])

  if (err) return <Alert kind="error">{err}</Alert>
  if (!p) return <Spinner lg label="Cargando expediente…" />
  const writable = p.access_level !== 'viewer' && p.status !== 'archived'
  const w = p.latest.weight?.value, h = p.latest.height?.value
  const b = bmi(w, h)
  const cat = bmiCategory(b)
  const age = ageFrom(p.birth_date)

  return (
    <>
      <div className="page-head">
        <div>
          <div className="row" style={{ gap: 8 }}>
            <span className="badge cyan mono">{p.display_code}</span>
            <StatusBadge status={p.status} />
            {p.is_demo ? <span className="badge violet">expediente de demostración</span> : null}
            <span className="badge gray">acceso: {p.access_level === 'owner' ? 'propietario' : p.access_level === 'editor' ? 'edición' : 'lectura'}</span>
          </div>
          <h1 style={{ marginTop: 8 }}>{p.display_name}</h1>
          <p>{p.sex === 'F' ? 'Femenino' : 'Masculino'}{age !== null ? ` · ${age} años` : ''} · creado {fmtDate(p.created_at)}</p>
        </div>
        <div className="btn-row">
          {can('media:upload') && writable ? <Link className="btn" to={`/capture/${p.id}`}><Camera size={16} /> Captura</Link> : null}
          <Link className="btn" to={`/analytics/${p.id}`}><BarChart3 size={16} /> Analítica</Link>
          {can('simulations:write') ? <Link className="btn" to={`/simulations/${p.id}`}><Sparkles size={16} /> Simular</Link> : null}
          <Link className="btn primary" to={`/viewer/${p.id}`}><Box size={16} /> Visor 3D</Link>
          {can('profiles:write') && p.access_level !== 'viewer' ? <button className="btn icon" onClick={() => setEditing(true)} aria-label="Editar expediente"><Pencil size={16} /></button> : null}
        </div>
      </div>
      {p.status === 'archived' ? <div className="mb"><Alert kind="warn">Expediente archivado: es de solo lectura hasta reactivarlo.</Alert></div> : null}

      <Tabs value={tab} onChange={setTab} items={[
        { id: 'summary', label: 'Resumen' },
        { id: 'measurements', label: `Mediciones (${p.measurement_count})` },
        { id: 'consent', label: <><ShieldCheck size={14} /> Consentimiento</> },
        { id: 'media', label: `Capturas y análisis (${p.analysis_count})` },
        ...(useAuth.getState().user?.role === 'patient' ? [] : [{ id: 'access' as Tab, label: <><KeyRound size={14} /> Accesos</> }]),
      ]} />

      {tab === 'summary' ? (
        <div className="grid g-3">
          <Card title="Indicadores actuales" sub={<span className="small muted">Datos registrados; pueden ser declarados o verificados</span>}>
            {[['weight', 'Peso'], ['height', 'Estatura'], ['waist', 'Cintura'], ['hip', 'Cadera'], ['body_fat', 'Grasa corporal'], ['muscle_mass', 'Masa muscular']].map(([k, l]) => (
              <div className="stat-line" key={k}><span className="muted">{l}</span><span>{p.latest[k] ? <><b>{fmtNum(p.latest[k].value)}</b> {p.latest[k].unit} <span className="dim small">· {p.is_demo ? "Dato ficticio" : p.latest[k].source_type === "self_reported" ? "Declarado por paciente · sin verificar" : p.latest[k].source_type === "visual_estimate" ? "Estimación visual" : "Registrado por profesional"} · {fmtDate(p.latest[k].measured_at)}</span></> : '—'}</span></div>
            ))}
            <div className="stat-line"><span className="muted">IMC <DataTag kind="derived" /></span><span><b>{fmtNum(b)}</b> <span className={`badge ${cat.tone}`}>{cat.label}</span></span></div>
          </Card>
          <Card title="Estado del expediente">
            <div className="stat-line"><span className="muted">Consentimiento de imágenes</span>{p.consent_image ? <span className="badge green">vigente</span> : <span className="badge amber">pendiente</span>}</div>
            <div className="stat-line"><span className="muted">Mediciones activas</span><b>{p.measurement_count}</b></div>
            <div className="stat-line"><span className="muted">Análisis de pose</span><b>{p.analysis_count}</b></div>
            <div className="stat-line"><span className="muted">Última actualización</span><span>{fmtDateTime(p.updated_at)}</span></div>
            {p.notes ? <p className="small muted" style={{ marginBottom: 0 }}>{p.notes}</p> : null}
            {!p.consent_image && writable ? <div className="mt-s"><button className="btn sm" onClick={() => setTab('consent')}><ShieldCheck size={14} /> Registrar consentimiento</button></div> : null}
          </Card>
          <Card title="Acciones rápidas">
            <div className="col">
              {can('measurements:write') && writable ? <button className="btn" onClick={() => setTab('measurements')}><Activity size={15} /> Registrar medición</button> : null}
              {can('media:upload') && writable ? <Link className="btn" to={`/capture/${p.id}`}><Camera size={15} /> Captura corporal con IA</Link> : null}
              <Link className="btn" to={`/viewer/${p.id}`}><Box size={15} /> Ver reconstrucción 3D</Link>
              {can('reports:generate') ? <Link className="btn" to={`/reports?profile=${p.id}`}><FileText size={15} /> Generar reporte</Link> : null}
            </div>
          </Card>
        </div>
      ) : null}
      {tab === 'measurements' ? <MeasurementsPanel profile={p} canWrite={can('measurements:write') && writable} onChanged={load} /> : null}
      {tab === 'consent' ? <ConsentPanel profile={p} canWrite={can('consents:write') && writable} onChanged={load} /> : null}
      {tab === 'media' ? <MediaPanel profile={p} canWrite={can('media:upload') && writable} /> : null}
      {tab === 'access' ? <AccessPanel profile={p} canManage={p.access_level === 'owner'} /> : null}
      {editing ? <ProfileForm initial={p} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load() }} /> : null}
    </>
  )
}

function Thumb({ media }: { media: MediaAsset }) {
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    let alive = true
    api<{ url: string }>(`/media/${media.id}/signed-url`).then((r) => alive && setUrl(absUrl(r.url))).catch(() => alive && setErr(true))
    return () => { alive = false }
  }, [media.id])
  return (
    <div style={{ aspectRatio: '3/4', background: '#020814', borderRadius: 10, overflow: 'hidden', display: 'grid', placeItems: 'center', border: '1px solid var(--border)' }}>
      {url && !err ? <img src={url} alt={`Captura ${media.capture_view}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={() => setErr(true)} /> : err ? <ImageIcon className="dim" /> : <div className="spinner" />}
    </div>
  )
}

function MediaPanel({ profile, canWrite }: { profile: Profile; canWrite: boolean }) {
  const [media, setMedia] = useState<MediaAsset[] | null>(null)
  const [analyses, setAnalyses] = useState<PoseSummary[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    Promise.all([api<MediaAsset[]>(`/profiles/${profile.id}/media`), api<PoseSummary[]>(`/profiles/${profile.id}/pose-analyses`)])
      .then(([m, a]) => { setMedia(m); setAnalyses(a) }).catch((e) => setErr(errMsg(e)))
  }, [profile.id, tick])
  const del = async (m: MediaAsset) => {
    if (!window.confirm('¿Eliminar esta captura del almacenamiento privado? Los análisis asociados se conservarán sin imagen.')) return
    try { await api(`/media/${m.id}`, { method: 'DELETE' }); toast('Captura eliminada', 'success'); setTick((t) => t + 1) } catch (e) { toast(errMsg(e), 'error') }
  }
  if (err) return <Alert kind="error">{err}</Alert>
  if (!media || !analyses) return <Spinner />
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)' }}>
      <Card title="Análisis de pose" sub={<DataTag kind="estimate" />} actions={canWrite ? <Link className="btn primary sm" to={`/capture/${profile.id}`}><Camera size={14} /> Nueva captura</Link> : null}>
        {analyses.length === 0 ? <Empty title="Sin análisis">Realiza una captura con cámara o foto.</Empty> : (
          <table className="table">
            <thead><tr><th>Fecha</th><th>Modo</th><th>Estado</th><th className="num">Calidad</th><th>Revisión</th><th /></tr></thead>
            <tbody>
              {analyses.map((a) => (
                <tr key={a.id}>
                  <td className="nowrap">{fmtDateTime(a.created_at)}</td>
                  <td>{a.mode === 'sequence' ? 'Movimiento' : 'Imagen'}</td>
                  <td><StatusBadge status={a.status} /></td>
                  <td className="num">{a.quality_score != null ? `${fmtNum(a.quality_score, 0)}%` : '—'}</td>
                  <td><StatusBadge status={a.review_status} /></td>
                  <td><Link className="btn sm" to={`/analyses/${a.id}`}>Abrir</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Capturas privadas" sub="Servidas solo mediante URL firmada temporal (5 min).">
        {media.length === 0 ? <Empty title="Sin capturas" /> : (
          <div className="grid g-3" style={{ gap: 10 }}>
            {media.map((m) => (
              <div key={m.id}>
                <Thumb media={m} />
                <div className="row between small mt-s"><span className="muted">{m.capture_view} · {fmtDate(m.created_at)}</span>
                  {canWrite ? <button className="btn ghost icon sm" onClick={() => del(m)} aria-label="Eliminar captura"><Trash2 size={13} /></button> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

interface AccessRow { id: string; user_id: string; access_level: string; expires_at: string | null; user_email: string; user_name: string }
function AccessPanel({ profile, canManage }: { profile: Profile; canManage: boolean }) {
  const [rows, setRows] = useState<AccessRow[] | null>(null)
  const [users, setUsers] = useState<{ id: string; full_name: string; email: string; role: string }[]>([])
  const [adding, setAdding] = useState(false)
  const [uid, setUid] = useState('')
  const [level, setLevel] = useState('viewer')
  const [err, setErr] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const me = useAuth((s) => s.user)
  useEffect(() => { api<AccessRow[]>(`/profiles/${profile.id}/access`).then(setRows).catch((e) => setErr(errMsg(e))) }, [profile.id, tick])
  useEffect(() => { if (canManage) api<typeof users>('/users/directory').then(setUsers).catch(() => undefined) }, [canManage])
  const grant = async () => {
    try { await api(`/profiles/${profile.id}/access`, { body: { user_id: uid, access_level: level } }); toast('Acceso concedido', 'success'); setAdding(false); setTick((t) => t + 1) } catch (e) { toast(errMsg(e), 'error') }
  }
  const revoke = async (r: AccessRow) => {
    if (!window.confirm(`¿Revocar el acceso de ${r.user_name}?`)) return
    try { await api(`/profiles/${profile.id}/access/${r.id}`, { method: 'DELETE' }); toast('Acceso revocado', 'success'); setTick((t) => t + 1) } catch (e) { toast(errMsg(e), 'error') }
  }
  const selected = users.find((u) => u.id === uid)
  return (
    <Card title="Control de acceso al expediente" sub="Solo los usuarios listados (y los administradores) pueden ver este expediente."
      actions={canManage ? <button className="btn primary sm" onClick={() => setAdding(true)}><UserPlus size={14} /> Conceder acceso</button> : null}>
      {err ? <Alert kind="error">{err}</Alert> : !rows ? <Spinner /> : (
        <table className="table">
          <thead><tr><th>Usuario</th><th>Correo</th><th>Nivel</th><th>Expira</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td>{r.user_name}</td><td className="muted">{r.user_email}</td>
              <td><span className="badge cyan">{r.access_level === 'owner' ? 'propietario' : r.access_level === 'editor' ? 'edición' : 'lectura'}</span></td>
              <td>{r.expires_at ? fmtDate(r.expires_at) : 'sin vencimiento'}</td>
              <td>{canManage && r.user_id !== me?.id ? <button className="btn danger sm" onClick={() => revoke(r)}>Revocar</button> : null}</td></tr>
          ))}</tbody>
        </table>
      )}
      {adding ? (
        <Modal title="Conceder acceso" onClose={() => setAdding(false)} footer={<><button className="btn" onClick={() => setAdding(false)}>Cancelar</button><button className="btn primary" disabled={!uid} onClick={grant}>Conceder</button></>}>
          <Field label="Usuario" htmlFor="ac-user">
            <select id="ac-user" className="select" value={uid} onChange={(e) => { setUid(e.target.value); const u = users.find((x) => x.id === e.target.value); if (u?.role === 'viewer') setLevel('viewer') }}>
              <option value="">Selecciona…</option>
              {users.filter((u) => !rows?.some((r) => r.user_id === u.id)).map((u) => <option key={u.id} value={u.id}>{u.full_name} · {ROLE_LABEL[u.role]}</option>)}
            </select>
          </Field>
          <Field label="Nivel de acceso" htmlFor="ac-level">
            <select id="ac-level" className="select" value={level} onChange={(e) => setLevel(e.target.value)}>
              <option value="viewer">Lectura</option>
              <option value="editor" disabled={selected?.role === 'viewer'}>Edición</option>
              <option value="owner" disabled={selected?.role === 'viewer'}>Propietario</option>
            </select>
          </Field>
        </Modal>
      ) : null}
    </Card>
  )
}
