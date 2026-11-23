import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Download, FileSpreadsheet, FileText } from 'lucide-react'
import { api, download, errMsg } from '../../services/api'
import { toast, useAuth, useCurrentProfile } from '../../services/store'
import type { Page, Profile, ReportRow } from '../../types'
import { Alert, Card, Empty, Field, Spinner } from '../../components/ui'
import { fmtDate, fmtDateTime } from '../../utils/format'

export default function ReportsPage() {
  const [sp] = useSearchParams()
  const can = useAuth((s) => s.can)
  const current = useCurrentProfile((s) => s.current)
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [pid, setPid] = useState(sp.get('profile') || current?.id || '')
  const [format, setFormat] = useState<'pdf' | 'csv'>('pdf')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [rows, setRows] = useState<ReportRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => { api<Page<Profile>>('/profiles?limit=100').then((d) => { setProfiles(d.items); if (!pid && d.items[0]) setPid(d.items[0].id) }).catch((e) => setErr(errMsg(e))) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { api<ReportRow[]>('/reports').then(setRows).catch((e) => setErr(errMsg(e))) }, [tick])

  const generate = async () => {
    if (!pid) return
    if (from && to && from > to) { toast('El inicio del periodo debe ser anterior al fin', 'error'); return }
    setBusy(true)
    try {
      const r = await api<ReportRow>(`/profiles/${pid}/reports`, { body: { format, period_from: from || null, period_to: to || null }, timeout: 90000 })
      toast(`Reporte ${format.toUpperCase()} generado`, 'success')
      setTick((t) => t + 1)
      await download(`/reports/${r.id}/download`, `BODYVISION_${r.profile_code}.${format}`)
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }

  return (
    <>
      <div className="page-head"><div><h1>Reportes</h1><p>Documentos trazables con fuentes, métodos, fechas, versiones y limitaciones.</p></div></div>
      {err ? <div className="mb"><Alert kind="error">{err}</Alert></div> : null}
      <div className="grid" style={{ gridTemplateColumns: 'minmax(300px, 0.8fr) minmax(0, 1.6fr)' }}>
        {can('reports:generate') ? (
          <Card title="Generar reporte" tab>
            <Field label="Expediente" htmlFor="r-p">
              <select id="r-p" className="select" value={pid} onChange={(e) => setPid(e.target.value)}>
                {profiles.map((p) => <option key={p.id} value={p.id}>{p.display_code} · {p.display_name}</option>)}
              </select>
            </Field>
            <Field label="Formato">
              <div className="row" style={{ gap: 6 }}>
                <button className={`btn grow ${format === 'pdf' ? 'active' : ''}`} onClick={() => setFormat('pdf')}><FileText size={15} /> PDF</button>
                <button className={`btn grow ${format === 'csv' ? 'active' : ''}`} onClick={() => setFormat('csv')}><FileSpreadsheet size={15} /> CSV</button>
              </div>
            </Field>
            <div className="grid g-2" style={{ gap: 10 }}>
              <Field label="Desde (opcional)" htmlFor="r-f"><input id="r-f" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label="Hasta (opcional)" htmlFor="r-t"><input id="r-t" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            </div>
            <Alert kind="info">Incluye: identificación por código, resumen, mediciones (con correcciones), análisis visual, visualización 3D, comparaciones, simulaciones rotuladas, limitaciones y trazabilidad.</Alert>
            <button className="btn primary mt" style={{ width: '100%' }} onClick={generate} disabled={busy || !pid}>{busy ? 'Generando…' : <><Download size={16} /> Generar y descargar</>}</button>
          </Card>
        ) : null}
        <Card title="Reportes generados">
          {!rows ? <Spinner /> : rows.length === 0 ? <Empty title="Aún no hay reportes" /> : (
            <table className="table">
              <thead><tr><th>Fecha</th><th>Expediente</th><th>Formato</th><th>Periodo</th><th className="num">Tamaño</th><th>Checksum</th><th /></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{fmtDateTime(r.created_at)}</td><td className="mono">{r.profile_code}</td>
                  <td><span className={`badge ${r.report_type === 'pdf' ? 'red' : 'green'}`}>{r.report_type.toUpperCase()}</span></td>
                  <td className="small">{r.period_from ? fmtDate(r.period_from) : 'inicio'} → {r.period_to ? fmtDate(r.period_to) : 'hoy'}</td>
                  <td className="num small">{(r.size_bytes / 1024).toFixed(1)} KB</td>
                  <td className="mono small dim" title={r.checksum}>{r.checksum.slice(0, 10)}…</td>
                  <td><button className="btn sm" onClick={() => download(`/reports/${r.id}/download`, `BODYVISION_${r.profile_code}.${r.report_type}`).catch((e) => toast(errMsg(e), 'error'))}><Download size={14} /></button></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  )
}
