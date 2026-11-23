import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowDownRight, ArrowUpRight, CalendarRange, GitCompare, Minus } from 'lucide-react'
import { api, errMsg } from '../../services/api'
import { useCurrentProfile } from '../../services/store'
import type { Profile } from '../../types'
import { Alert, Card, DataTag, Empty, Field, Spinner } from '../../components/ui'
import { METHOD_LABEL, fmtDate, fmtNum } from '../../utils/format'

interface Pt { id?: string; date: string; value: number; unit?: string; method: string; source_type?: string; corrected?: boolean }
interface Series {
  metric: string; label: string; unit: string; points: Pt[]
  stats: { count: number; first?: number; last?: number; min?: number; max?: number; mean?: number; change?: number; change_pct?: number | null }
  method_changes: { date: string; from: string; to: string }[]; gaps: { from: string; to: string; days: number }[]; calculation: string
}
interface Analytics { series: Series[]; bmi: Pt[]; comparison: { metric: string; label: string; unit: string; a: number | null; a_date: string | null; b: number | null; b_date: string | null; delta: number | null; method_changed: boolean }[] | null }

const COLORS = ['#22d3ee', '#a78bfa', '#f472b6', '#facc15', '#4ade80', '#fb923c', '#38bdf8', '#f87171', '#c084fc', '#2dd4bf']
const iso = (d: Date) => d.toISOString().slice(0, 10)

export default function AnalyticsPage() {
  const { profileId = '' } = useParams()
  const setCurrent = useCurrentProfile((s) => s.setCurrent)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [cmpA, setCmpA] = useState(iso(new Date(Date.now() - 1000 * 3600 * 24 * 150)))
  const [cmpB, setCmpB] = useState(iso(new Date()))
  const [data, setData] = useState<Analytics | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [sel, setSel] = useState<string[]>([])

  useEffect(() => {
    api<Profile>(`/profiles/${profileId}`).then((p) => { setProfile(p); setCurrent({ id: p.id, code: p.display_code, name: p.display_name, sex: p.sex }) }).catch((e) => setErr(errMsg(e)))
  }, [profileId, setCurrent])
  useEffect(() => {
    if (from && to && from > to) { setErr('La fecha inicial debe ser anterior a la final'); return }
    setErr(null)
    const q = new URLSearchParams()
    if (from) q.set('date_from', from)
    if (to) q.set('date_to', to)
    if (cmpA && cmpB) { q.set('compare_a', cmpA); q.set('compare_b', cmpB) }
    let alive = true
    api<Analytics>(`/analytics/${profileId}?${q}`).then((d) => {
      if (!alive) return
      setData(d)
      setSel((s) => (s.length ? s.filter((m) => d.series.some((x) => x.metric === m)) : d.series.slice(0, 4).map((x) => x.metric)))
    }).catch((e) => alive && setErr(errMsg(e)))
    return () => { alive = false }
  }, [profileId, from, to, cmpA, cmpB])

  const shown = useMemo(() => data?.series.filter((s) => sel.includes(s.metric)) || [], [data, sel])

  return (
    <>
      <div className="page-head">
        <div><h1>Analítica temporal</h1><p>{profile ? <><span className="mono">{profile.display_code}</span> · {profile.display_name}</> : '…'} — solo registros activos; las correcciones reemplazan al original.</p></div>
        <Link className="btn" to={`/profiles/${profileId}?tab=measurements`}>Ver mediciones</Link>
      </div>
      <Card className="mb">
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          <CalendarRange size={18} className="dim" style={{ marginBottom: 22 }} />
          <Field label="Desde" htmlFor="an-from"><input id="an-from" type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Hasta" htmlFor="an-to"><input id="an-to" type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <div className="btn-row" style={{ marginBottom: 12 }}>
            {[30, 90, 180, 365].map((d) => <button key={d} className="btn sm" onClick={() => { setFrom(iso(new Date(Date.now() - d * 864e5))); setTo(iso(new Date())) }}>{d} días</button>)}
            <button className="btn sm ghost" onClick={() => { setFrom(''); setTo('') }}>Todo</button>
          </div>
        </div>
        {data ? (
          <div className="row wrap" style={{ gap: 6 }}>
            {data.series.map((s, i) => (
              <button key={s.metric} className={`chip ${sel.includes(s.metric) ? 'on' : ''}`} style={{ ['--chip' as string]: COLORS[i % COLORS.length] }}
                onClick={() => setSel((x) => (x.includes(s.metric) ? x.filter((m) => m !== s.metric) : [...x, s.metric]))}>
                <span className="dot" />{s.label}
              </button>
            ))}
          </div>
        ) : null}
      </Card>
      {err ? <Alert kind="error">{err}</Alert> : !data ? <Spinner /> : data.series.length === 0 ? <Card><Empty title="Sin mediciones en el periodo">Ajusta el rango de fechas o registra mediciones.</Empty></Card> : (
        <>
          <div className="grid g-2">
            {shown.map((s) => {
              const color = COLORS[data.series.indexOf(s) % COLORS.length]
              const chg = s.stats.change ?? 0
              const pts = s.points.map((p) => ({ ...p, t: new Date(p.date).getTime() }))
              return (
                <Card key={s.metric} title={s.label} sub={<span>{s.stats.count} registros · <DataTag kind="observed" /></span>}
                  actions={<span className={`badge ${chg === 0 ? 'gray' : chg > 0 ? 'amber' : 'green'}`}>{chg > 0 ? <ArrowUpRight size={12} /> : chg < 0 ? <ArrowDownRight size={12} /> : <Minus size={12} />} {chg > 0 ? '+' : ''}{fmtNum(chg, 2)} {s.unit}{s.stats.change_pct != null ? ` (${fmtNum(s.stats.change_pct, 1)}%)` : ''}</span>}>
                  <ResponsiveContainer width="100%" height={210}>
                    <LineChart data={pts} margin={{ top: 6, right: 10, left: -14, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(56,189,248,.1)" />
                      <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={(v) => new Date(v).toLocaleDateString('es-PE', { month: 'short', day: '2-digit' })} stroke="#5d7598" fontSize={11} />
                      <YAxis stroke="#5d7598" fontSize={11} domain={['auto', 'auto']} unit={s.unit === '%' ? '%' : ''} />
                      <Tooltip contentStyle={{ background: '#071430', border: '1px solid rgba(56,189,248,.4)', borderRadius: 10 }}
                        labelFormatter={(v) => fmtDate(new Date(Number(v)).toISOString())}
                        formatter={(v, _n, item) => [`${fmtNum(Number(v), 2)} ${s.unit} · ${METHOD_LABEL[(item?.payload as Pt)?.method] || ''}`, s.label]} />
                      {s.method_changes.map((mc) => <ReferenceLine key={mc.date} x={new Date(mc.date).getTime()} stroke="#f59e0b" strokeDasharray="4 3" label={{ value: 'cambio de método', fill: '#f59e0b', fontSize: 10 }} />)}
                      <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2.2} dot={{ r: 3, fill: color }} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                  <div className="grid g-4 small" style={{ gap: 6 }}>
                    <div><div className="dim">Primero</div><b>{fmtNum(s.stats.first, 2)}</b></div>
                    <div><div className="dim">Último</div><b>{fmtNum(s.stats.last, 2)}</b></div>
                    <div><div className="dim">Mín / Máx</div><b>{fmtNum(s.stats.min, 1)} / {fmtNum(s.stats.max, 1)}</b></div>
                    <div><div className="dim">Media</div><b>{fmtNum(s.stats.mean, 2)}</b></div>
                  </div>
                  {s.gaps.length ? <div className="small mt-s" style={{ color: '#fcd34d' }}>Periodos sin registros: {s.gaps.map((g) => `${g.days} días (${fmtDate(g.from)} → ${fmtDate(g.to)})`).join('; ')}</div> : null}
                </Card>
              )
            })}
            {data.bmi.length ? (
              <Card title="IMC" sub={<span>calculado con la estatura vigente · <DataTag kind="derived" /></span>}>
                <ResponsiveContainer width="100%" height={210}>
                  <LineChart data={data.bmi.map((p) => ({ ...p, t: new Date(p.date).getTime() }))} margin={{ top: 6, right: 10, left: -14, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(56,189,248,.1)" />
                    <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={(v) => new Date(v).toLocaleDateString('es-PE', { month: 'short', day: '2-digit' })} stroke="#5d7598" fontSize={11} />
                    <YAxis stroke="#5d7598" fontSize={11} domain={['auto', 'auto']} />
                    <ReferenceLine y={25} stroke="#f59e0b" strokeDasharray="3 3" />
                    <ReferenceLine y={18.5} stroke="#38bdf8" strokeDasharray="3 3" />
                    <Tooltip contentStyle={{ background: '#071430', border: '1px solid rgba(56,189,248,.4)', borderRadius: 10 }} labelFormatter={(v) => fmtDate(new Date(Number(v)).toISOString())} />
                    <Line type="monotone" dataKey="value" name="IMC" stroke="#facc15" strokeWidth={2.2} dot={{ r: 3 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </Card>
            ) : null}
          </div>
          <Card className="mt" title={<><GitCompare size={16} /> Comparación entre fechas</>} sub="Valor vigente más cercano (≤ fecha) por métrica; solo unidades compatibles."
            actions={<>
              <input type="date" className="input" style={{ width: 160 }} value={cmpA} onChange={(e) => setCmpA(e.target.value)} aria-label="Fecha A" />
              <span className="muted">vs</span>
              <input type="date" className="input" style={{ width: 160 }} value={cmpB} onChange={(e) => setCmpB(e.target.value)} aria-label="Fecha B" />
            </>}>
            {data.comparison?.length ? (
              <table className="table">
                <thead><tr><th>Métrica</th><th className="num">Fecha A</th><th className="num">Fecha B</th><th className="num">Diferencia</th><th>Observación</th></tr></thead>
                <tbody>{data.comparison.map((c) => (
                  <tr key={c.metric}>
                    <td>{c.label}</td>
                    <td className="num">{c.a != null ? `${fmtNum(c.a, 2)} ${c.unit}` : '—'}<div className="small dim">{fmtDate(c.a_date)}</div></td>
                    <td className="num">{c.b != null ? `${fmtNum(c.b, 2)} ${c.unit}` : '—'}<div className="small dim">{fmtDate(c.b_date)}</div></td>
                    <td className="num"><b>{c.delta != null ? `${c.delta > 0 ? '+' : ''}${fmtNum(c.delta, 2)} ${c.unit}` : '—'}</b></td>
                    <td className="small">{c.method_changed ? <span className="badge amber">cambio de método</span> : c.a == null || c.b == null ? <span className="dim">sin dato en una fecha</span> : null}</td>
                  </tr>
                ))}</tbody>
              </table>
            ) : <Empty title="Sin datos para comparar" />}
            <p className="small dim">Las correlaciones simples no implican causalidad. Los datos simulados no se incluyen.</p>
          </Card>
        </>
      )}
    </>
  )
}
