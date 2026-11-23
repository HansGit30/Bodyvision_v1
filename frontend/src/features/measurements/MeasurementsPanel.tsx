import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { History, Pencil, Plus } from 'lucide-react'
import { api, errMsg } from '../../services/api'
import { toast } from '../../services/store'
import type { Measurement, MetricDef, Profile } from '../../types'
import { Alert, Card, DataTag, Empty, Field, Modal, Spinner, StatusBadge, sourceKind } from '../../components/ui'
import { METHOD_LABEL, fmtDateTime, fmtNum, localInputToISO, toLocalInput } from '../../utils/format'

let catalogCache: MetricDef[] | null = null
export async function loadCatalog() {
  if (!catalogCache) catalogCache = await api<MetricDef[]>('/catalog/metrics')
  return catalogCache
}

export function MeasurementsPanel({ profile, canWrite, onChanged }: { profile: Profile; canWrite: boolean; onChanged: () => void }) {
  const [catalog, setCatalog] = useState<MetricDef[]>([])
  const [rows, setRows] = useState<Measurement[] | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [metric, setMetric] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [correcting, setCorrecting] = useState<Measurement | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => { loadCatalog().then(setCatalog).catch((e) => setErr(errMsg(e))) }, [])
  useEffect(() => {
    let alive = true
    const p = new URLSearchParams()
    if (showAll) p.set('include_superseded', 'true')
    if (metric) p.set('metric', metric)
    api<Measurement[]>(`/profiles/${profile.id}/measurements?${p}`).then((r) => alive && setRows(r)).catch((e) => alive && setErr(errMsg(e)))
    return () => { alive = false }
  }, [profile.id, showAll, metric, tick])
  const label = useMemo(() => Object.fromEntries(catalog.map((m) => [m.code, m.label])), [catalog])
  const refresh = () => { setTick((t) => t + 1); onChanged() }

  return (
    <Card title="Historial de mediciones" sub="Las correcciones crean un nuevo registro y conservan el original (no se sobrescribe el historial)."
      actions={<>
        <select className="select" style={{ width: 190 }} value={metric} onChange={(e) => setMetric(e.target.value)} aria-label="Filtrar métrica">
          <option value="">Todas las métricas</option>
          {catalog.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
        </select>
        <button className={`btn sm ${showAll ? 'active' : ''}`} onClick={() => setShowAll(!showAll)}><History size={14} /> {showAll ? 'Ocultar sustituidas' : 'Ver sustituidas'}</button>
        {canWrite ? <button className="btn primary sm" onClick={() => setAdding(true)}><Plus size={14} /> Registrar medición</button> : null}
      </>}>
      {err ? <Alert kind="error">{err}</Alert> : !rows ? <Spinner /> : rows.length === 0 ? <Empty title="Sin mediciones">Registra la primera medición del expediente.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Fecha</th><th>Métrica</th><th className="num">Valor</th><th>Método</th><th>Tipo de dato</th><th>Estado</th><th>Notas</th><th /></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} className={m.status === 'superseded' ? 'muted-row' : ''}>
                  <td className="nowrap">{fmtDateTime(m.measured_at)}</td>
                  <td>{label[m.metric_code] || m.metric_code}</td>
                  <td className="num"><b>{fmtNum(m.value, 2)}</b> {m.unit}</td>
                  <td>{METHOD_LABEL[m.method]}</td>
                  <td><DataTag kind={sourceKind(m.source_type)} /></td>
                  <td>
                    <StatusBadge status={m.status} />
                    {m.supersedes_id ? <span className="badge cyan" title={`Motivo: ${m.correction_reason}`} style={{ marginLeft: 4 }}>corrección</span> : null}
                  </td>
                  <td className="small muted" style={{ maxWidth: 240 }}>{m.supersedes_id ? `Corrección: ${m.correction_reason}` : m.notes}</td>
                  <td>{canWrite && m.status === 'active' ? <button className="btn sm ghost" onClick={() => setCorrecting(m)} aria-label="Corregir"><Pencil size={14} /> Corregir</button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding ? <MeasurementForm profile={profile} catalog={catalog} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refresh() }} /> : null}
      {correcting ? <CorrectionForm m={correcting} label={label[correcting.metric_code]} onClose={() => setCorrecting(null)} onSaved={() => { setCorrecting(null); refresh() }} /> : null}
    </Card>
  )
}

function MeasurementForm({ profile, catalog, onClose, onSaved }: { profile: Profile; catalog: MetricDef[]; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState('weight')
  const [value, setValue] = useState('')
  const [when, setWhen] = useState(toLocalInput())
  const [method, setMethod] = useState<'manual' | 'device' | 'visual_estimate'>('manual')
  const [notes, setNotes] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const def = catalog.find((m) => m.code === code)
  const num = Number(value.replace(',', '.'))
  const invalid = !value || Number.isNaN(num) || (def ? num < def.min || num > def.max : false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (invalid || !def) { setErr(def ? `Ingresa un valor entre ${def.min} y ${def.max} ${def.unit}` : 'Selecciona una métrica'); return }
    if (new Date(when).getTime() > Date.now() + 60000) { setErr('La fecha no puede estar en el futuro'); return }
    setBusy(true); setErr(null)
    try {
      await api(`/profiles/${profile.id}/measurements`, { body: { metric_code: code, value: num, unit: def.unit, method, measured_at: localInputToISO(when), notes } })
      toast(`${def.label} registrada`, 'success')
      onSaved()
    } catch (e2) { setErr(errMsg(e2)) } finally { setBusy(false) }
  }
  return (
    <Modal title="Registrar medición" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="grid g-2" style={{ gap: 12 }}>
          <Field label="Métrica" htmlFor="m-code">
            <select id="m-code" className="select" value={code} onChange={(e) => setCode(e.target.value)}>
              {catalog.map((m) => <option key={m.code} value={m.code}>{m.label} ({m.unit})</option>)}
            </select>
          </Field>
          <Field label={`Valor${def ? ` (${def.unit})` : ''}`} htmlFor="m-val" error={value && invalid && def ? `Rango válido: ${def.min}–${def.max} ${def.unit}` : null}>
            <input id="m-val" className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={!!value && invalid} placeholder={def ? `${def.min}–${def.max}` : ''} />
          </Field>
          <Field label="Fecha y hora de la medición" htmlFor="m-when"><input id="m-when" type="datetime-local" className="input" value={when} max={toLocalInput()} onChange={(e) => setWhen(e.target.value)} /></Field>
          <Field label="Método / fuente" htmlFor="m-method">
            <select id="m-method" className="select" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
              <option value="manual">Manual (observado)</option><option value="device">Dispositivo (observado)</option><option value="visual_estimate">Estimación visual</option>
            </select>
          </Field>
        </div>
        {def ? <Alert kind="info"><b>Instrucciones:</b> {def.instructions}</Alert> : null}
        <div className="mt" />
        <Field label="Notas (instrumento, condiciones…)" htmlFor="m-notes"><textarea id="m-notes" className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} /></Field>
        {method === 'visual_estimate' ? <Alert kind="warn">Se rotulará como <b>ESTIMACIÓN VISUAL</b> y no se mezclará con datos observados.</Alert> : null}
        {err ? <div className="mt-s"><Alert kind="error">{err}</Alert></div> : null}
        <div className="btn-row mt" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar medición'}</button>
        </div>
      </form>
    </Modal>
  )
}

function CorrectionForm({ m, label, onClose, onSaved }: { m: Measurement; label?: string; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState(String(m.value))
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const v = Number(value.replace(',', '.'))
    if (Number.isNaN(v)) { setErr('Valor inválido'); return }
    if (reason.trim().length < 3) { setErr('Indica el motivo de la corrección'); return }
    setBusy(true); setErr(null)
    try {
      await api(`/measurements/${m.id}`, { method: 'PATCH', body: { value: v, reason: reason.trim() } })
      toast('Corrección registrada; el valor original se conserva en el historial', 'success')
      onSaved()
    } catch (e2) { setErr(errMsg(e2)) } finally { setBusy(false) }
  }
  return (
    <Modal title={`Corregir ${label || m.metric_code}`} onClose={onClose}>
      <form onSubmit={submit}>
        <Alert kind="info">Valor actual: <b>{fmtNum(m.value, 2)} {m.unit}</b> ({fmtDateTime(m.measured_at)}). La corrección queda auditada.</Alert>
        <div className="mt" />
        <Field label={`Nuevo valor (${m.unit})`} htmlFor="c-val"><input id="c-val" className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></Field>
        <Field label="Motivo de la corrección *" htmlFor="c-reason"><input id="c-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Ej.: error de transcripción" /></Field>
        {err ? <Alert kind="error">{err}</Alert> : null}
        <div className="btn-row mt" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy}>Registrar corrección</button>
        </div>
      </form>
    </Modal>
  )
}
