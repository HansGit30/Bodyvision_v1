import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, FolderOpen, Plus, Search } from 'lucide-react'
import { api, errMsg } from '../../services/api'
import { toast, useAuth, useCurrentProfile } from '../../services/store'
import type { Page, Profile } from '../../types'
import { Alert, Card, Empty, Field, Modal, Spinner, StatusBadge } from '../../components/ui'
import { bmi, fmtDate, fmtNum } from '../../utils/format'

const PAGE = 12

export function ProfileForm({ initial, onSaved, onClose }: { initial?: Profile; onSaved: (p: Profile) => void; onClose: () => void }) {
  const [name, setName] = useState(initial?.display_name || '')
  const [sex, setSex] = useState<'M' | 'F'>(initial?.sex || 'M')
  const [birth, setBirth] = useState(initial?.birth_date || '')
  const [notes, setNotes] = useState(initial?.notes || '')
  const [code, setCode] = useState('')
  const [status, setStatus] = useState(initial?.status || 'active')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(null)
    if (name.trim().length < 2) { setErr('El nombre visible debe tener al menos 2 caracteres'); return }
    setBusy(true)
    try {
      const body: Record<string, unknown> = { display_name: name.trim(), sex, birth_date: birth || null, notes }
      let p: Profile
      if (initial) p = await api<Profile>(`/profiles/${initial.id}`, { method: 'PATCH', body: { ...body, status } })
      else p = await api<Profile>('/profiles', { body: code.trim() ? { ...body, display_code: code.trim() } : body })
      toast(initial ? 'Expediente actualizado' : `Expediente ${p.display_code} creado`, 'success')
      onSaved(p)
    } catch (e2) { setErr(errMsg(e2)) } finally { setBusy(false) }
  }
  return (
    <Modal title={initial ? `Editar expediente ${initial.display_code}` : 'Nuevo expediente'} onClose={onClose}>
      <form onSubmit={submit}>
        <Alert kind="info">Minimiza los datos personales: usa un nombre visible o alias. El código único identifica el expediente en reportes.</Alert>
        <div className="mt" />
        <Field label="Nombre visible *" htmlFor="pf-name"><input id="pf-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} /></Field>
        <div className="grid g-2" style={{ gap: 12 }}>
          <Field label="Sexo (modelo 3D) *">
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className={`btn grow ${sex === 'M' ? 'active' : ''}`} onClick={() => setSex('M')}>♂ Masculino</button>
              <button type="button" className={`btn grow ${sex === 'F' ? 'active' : ''}`} onClick={() => setSex('F')}>♀ Femenino</button>
            </div>
          </Field>
          <Field label="Fecha de nacimiento" htmlFor="pf-birth"><input id="pf-birth" type="date" className="input" value={birth} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setBirth(e.target.value)} /></Field>
        </div>
        {!initial ? (
          <Field label="Código (opcional)" htmlFor="pf-code" hint="Si lo dejas vacío se genera uno único (BV-AAAA-NNNNN).">
            <input id="pf-code" className="input mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={32} placeholder="BV-2026-00001" />
          </Field>
        ) : (
          <Field label="Estado" htmlFor="pf-status" hint="Archivar no borra datos; bloquea nuevas modificaciones.">
            <select id="pf-status" className="select" value={status} onChange={(e) => setStatus(e.target.value as Profile['status'])}>
              <option value="active">Activo</option><option value="archived">Archivado</option><option value="restricted">Restringido</option>
            </select>
          </Field>
        )}
        <Field label="Notas" htmlFor="pf-notes"><textarea id="pf-notes" className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} /></Field>
        {err ? <Alert kind="error">{err}</Alert> : null}
        <div className="btn-row mt" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : initial ? 'Guardar cambios' : 'Crear expediente'}</button>
        </div>
      </form>
    </Modal>
  )
}

export default function ProfilesPage() {
  const can = useAuth((s) => s.can)
  const setCurrent = useCurrentProfile((s) => s.setCurrent)
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [status, setStatus] = useState('')
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState<Page<Profile> | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => { const t = setTimeout(() => { setDebounced(q); setOffset(0) }, 300); return () => clearTimeout(t) }, [q])
  useEffect(() => {
    let alive = true
    setErr(null)
    const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) })
    if (debounced) params.set('q', debounced)
    if (status) params.set('status', status)
    api<Page<Profile>>(`/profiles?${params}`).then((d) => alive && setData(d)).catch((e) => alive && setErr(errMsg(e)))
    return () => { alive = false }
  }, [debounced, status, offset])

  const open = (p: Profile) => { setCurrent({ id: p.id, code: p.display_code, name: p.display_name, sex: p.sex }); nav(`/profiles/${p.id}`) }

  return (
    <>
      <div className="page-head">
        <div><h1>Expedientes</h1><p>Listado de expedientes autorizados para tu cuenta.</p></div>
        {can('profiles:create') ? <button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} /> Nuevo expediente</button> : null}
      </div>
      <Card>
        <div className="row wrap mb">
          <div style={{ position: 'relative', flex: '1 1 260px' }}>
            <Search size={16} style={{ position: 'absolute', left: 12, top: 12, color: 'var(--dim)' }} />
            <input className="input" style={{ paddingLeft: 36 }} placeholder="Buscar por nombre o código…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar expedientes" />
          </div>
          <select className="select" style={{ width: 200 }} value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0) }} aria-label="Filtrar por estado">
            <option value="">Todos los estados</option><option value="active">Activos</option><option value="archived">Archivados</option><option value="restricted">Restringidos</option>
          </select>
        </div>
        {err ? <Alert kind="error">{err}</Alert> : !data ? <Spinner /> : data.items.length === 0 ? (
          <Empty title="Sin expedientes" icon={<FolderOpen size={34} />}>{debounced ? 'Ningún expediente coincide con la búsqueda.' : 'Crea el primer expediente para comenzar.'}</Empty>
        ) : (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Código</th><th>Nombre</th><th>Sexo</th><th className="num">Peso</th><th className="num">Estatura</th><th className="num">IMC</th><th>Consent.</th><th className="num">Registros</th><th>Estado</th><th>Creado</th></tr></thead>
                <tbody>
                  {data.items.map((p) => {
                    const w = p.latest.weight?.value, h = p.latest.height?.value
                    return (
                      <tr key={p.id} className="clickable" onClick={() => open(p)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') open(p) }}>
                        <td className="mono">{p.display_code} {p.is_demo ? <span className="badge violet">demo</span> : null}</td>
                        <td><b>{p.display_name}</b></td>
                        <td>{p.sex === 'F' ? '♀ F' : '♂ M'}</td>
                        <td className="num">{w ? `${fmtNum(w)} kg` : '—'}</td>
                        <td className="num">{h ? `${fmtNum(h)} cm` : '—'}</td>
                        <td className="num">{fmtNum(bmi(w, h))}</td>
                        <td>{p.consent_image ? <span className="badge green">vigente</span> : <span className="badge gray">no</span>}</td>
                        <td className="num">{p.measurement_count} / {p.analysis_count}</td>
                        <td><StatusBadge status={p.status} /></td>
                        <td className="dim nowrap">{fmtDate(p.created_at)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="row between mt small muted">
              <span>{data.total} expediente(s) · mediciones / análisis</span>
              <div className="btn-row">
                <button className="btn sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} aria-label="Página anterior"><ChevronLeft size={14} /></button>
                <span>{Math.floor(offset / PAGE) + 1} / {Math.max(1, Math.ceil(data.total / PAGE))}</span>
                <button className="btn sm" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)} aria-label="Página siguiente"><ChevronRight size={14} /></button>
              </div>
            </div>
          </>
        )}
      </Card>
      {creating ? <ProfileForm onClose={() => setCreating(false)} onSaved={(p) => { setCreating(false); open(p) }} /> : null}
    </>
  )
}

/** Selector de expediente para módulos que lo requieren (captura, analítica, simulador, mediciones). */
export function SelectProfilePage() {
  const { target = 'viewer' } = useParams()
  const nav = useNavigate()
  const setCurrent = useCurrentProfile((s) => s.setCurrent)
  const [data, setData] = useState<Profile[] | null>(null)
  const [q, setQ] = useState('')
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    const t = setTimeout(() => {
      api<Page<Profile>>(`/profiles?limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}`).then((d) => setData(d.items)).catch((e) => setErr(errMsg(e)))
    }, 250)
    return () => clearTimeout(t)
  }, [q])
  const titles: Record<string, string> = { capture: 'Captura corporal', analytics: 'Analítica', simulations: 'Simulador', measurements: 'Mediciones', viewer: 'Visor 3D' }
  const go = (p: Profile) => {
    setCurrent({ id: p.id, code: p.display_code, name: p.display_name, sex: p.sex })
    const to = target === 'measurements' ? `/profiles/${p.id}?tab=measurements` : `/${target}/${p.id}`
    nav(to)
  }
  return (
    <>
      <div className="page-head"><div><h1>{titles[target] || 'Seleccionar expediente'}</h1><p>Elige el expediente con el que deseas trabajar.</p></div></div>
      <Card>
        <input className="input mb" placeholder="Buscar expediente…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar expediente" />
        {err ? <Alert kind="error">{err}</Alert> : !data ? <Spinner /> : data.length === 0 ? <Empty title="No hay expedientes disponibles" /> : (
          <div className="grid g-3">
            {data.map((p) => (
              <button key={p.id} className="card tight" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => go(p)}>
                <div className="row between"><span className="mono">{p.display_code}</span><StatusBadge status={p.status} /></div>
                <div style={{ fontWeight: 700, marginTop: 4 }}>{p.display_name}</div>
                <div className="small muted">{p.sex === 'F' ? 'Femenino' : 'Masculino'} · {p.measurement_count} mediciones</div>
              </button>
            ))}
          </div>
        )}
      </Card>
    </>
  )
}
