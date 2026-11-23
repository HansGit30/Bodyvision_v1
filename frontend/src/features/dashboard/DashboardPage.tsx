import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  Activity, BarChart3, Box, Camera, CheckCircle2, FileText, FolderOpen, Gauge, Layers, Ruler, ShieldCheck, Sparkles, Users, XCircle,
} from 'lucide-react'
import { api, errMsg } from '../../services/api'
import { useAuth, useCurrentProfile } from '../../services/store'
import type { DashboardSummary } from '../../types'
import { Alert, Card, DataTag, Empty, Kpi, Spinner } from '../../components/ui'
import { fmtNum, timeAgo } from '../../utils/format'
import { HoloPreview } from '../body-viewer/HoloPreview'

const MODULES = [
  { icon: <FolderOpen size={18} />, title: 'Expedientes', text: 'Ficha por código, control de acceso, consentimiento y archivos privados.', to: '/profiles' },
  { icon: <Ruler size={18} />, title: 'Mediciones', text: 'Valor, unidad, método, fecha y responsable; correcciones sin perder historial.', to: '/profiles' },
  { icon: <Camera size={18} />, title: 'Captura corporal', text: 'Cámara o foto con guía de encuadre y detección de 33 puntos de movimiento.', to: '/select/capture' },
  { icon: <Activity size={18} />, title: 'Análisis IA', text: 'Landmarks MediaPipe, ángulos articulares, banderas de calidad y revisión.', to: '/analyses' },
  { icon: <Box size={18} />, title: 'Visor 3D', text: 'Atlas de 2.198 estructuras por capas, rotación 360°, escaneo y nombres al pasar el cursor.', to: '/viewer' },
  { icon: <BarChart3 size={18} />, title: 'Analítica', text: 'Tendencias, comparación de fechas, cambios de método y faltantes.', to: '/select/analytics' },
  { icon: <Sparkles size={18} />, title: 'Simulador', text: 'Escenarios hipotéticos de peso y composición, separados de los datos reales.', to: '/select/simulations' },
  { icon: <FileText size={18} />, title: 'Reportes', text: 'PDF y CSV trazables con fuentes, métodos, versiones y limitaciones.', to: '/reports' },
]

export default function DashboardPage() {
  const user = useAuth((s) => s.user)
  const current = useCurrentProfile((s) => s.current)
  const [data, setData] = useState<DashboardSummary | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api<DashboardSummary>('/dashboard/summary').then((d) => alive && setData(d)).catch((e) => alive && setErr(errMsg(e)))
    return () => { alive = false }
  }, [])

  const words = (user?.full_name || '').split(' ').filter(Boolean)
  const first = /^(dr|dra|lic|ing|mg|mtro|mtra)\.?$/i.test(words[0] || '') ? words.slice(0, 2).join(' ') : words[0] || ''
  const comp = data?.composition
  const pie = comp ? [{ name: 'Masa magra', value: comp.lean_pct }, { name: 'Grasa corporal', value: comp.fat_pct }] : []

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Bienvenido, <span className="glow-text" style={{ color: 'var(--cyan)' }}>{first}</span></h1>
          <p>Tu plataforma de análisis corporal inteligente · {user?.organization_name}</p>
        </div>
        <div className="btn-row">
          <Link className="btn" to="/profiles"><FolderOpen size={16} /> Expedientes</Link>
          <Link className="btn primary" to={current ? `/viewer/${current.id}` : '/viewer'}><Box size={16} /> Abrir visor 3D</Link>
        </div>
      </div>

      {err ? <div className="mb"><Alert kind="error">{err}</Alert></div> : null}

      <div className="grid g-4 mb">
        <Kpi icon={<Users size={22} />} value={data ? data.kpis.profiles : '—'} label="Expedientes activos" color="#22d3ee" />
        <Kpi icon={<Ruler size={22} />} value={data ? data.kpis.measurements.toLocaleString('es-PE') : '—'} label="Mediciones registradas" color="#22c55e" />
        <Kpi icon={<Activity size={22} />} value={data ? data.kpis.analyses : '—'} label="Análisis IA" color="#a78bfa" />
        <Kpi icon={<Gauge size={22} />} value={data?.kpis.avg_quality != null ? `${fmtNum(data.kpis.avg_quality)}%` : '—'} label="Calidad media de captura IA" color="#38bdf8" />
      </div>

      <div className="grid mb" style={{ gridTemplateColumns: 'minmax(0, 0.9fr) minmax(0, 1.4fr)' }}>
        <Card title="Modelo anatómico" tab>
          <HoloPreview height={420} sex={current?.sex || 'M'} />
          <div className="row between small" style={{ paddingTop: 10 }}>
            <span className="muted">Pasa el cursor sobre el holograma para ver cada región</span>
            <Link to={current ? `/viewer/${current.id}` : '/viewer'} className="btn sm">Explorar capas</Link>
          </div>
        </Card>
        <div className="grid" style={{ gridTemplateRows: 'auto auto', gap: 16 }}>
          <div className="grid g-2">
            <Card title="Evolución corporal" sub={<span>Promedio mensual de expedientes visibles · <DataTag kind="observed" /></span>}>
              {!data ? <Spinner /> : data.trend.length ? (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={data.trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(56,189,248,.1)" />
                    <XAxis dataKey="month" stroke="#5d7598" fontSize={11} />
                    <YAxis stroke="#5d7598" fontSize={11} domain={['auto', 'auto']} />
                    <Tooltip contentStyle={{ background: '#071430', border: '1px solid rgba(56,189,248,.4)', borderRadius: 10 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="peso" name="Peso (kg)" stroke="#22d3ee" strokeWidth={2} dot={{ r: 2 }} />
                    <Line type="monotone" dataKey="imc" name="IMC" stroke="#facc15" strokeWidth={2} dot={{ r: 2 }} />
                    <Line type="monotone" dataKey="grasa" name="Grasa %" stroke="#f472b6" strokeWidth={2} dot={{ r: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <Empty title="Sin mediciones recientes">Registra peso y grasa para ver tendencias.</Empty>}
            </Card>
            <Card title="Composición corporal" sub={comp ? <span>{comp.profiles} expediente(s) · <DataTag kind="observed" /></span> : 'Último registro por expediente'}>
              {!data ? <Spinner /> : comp ? (
                <div className="row" style={{ alignItems: 'center' }}>
                  <div style={{ width: 170, height: 170, position: 'relative', flex: 'none' }}>
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie data={pie} dataKey="value" innerRadius={55} outerRadius={75} startAngle={90} endAngle={-270} stroke="none">
                          <Cell fill="#22d3ee" /><Cell fill="#f59e0b" />
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontFamily: 'var(--font-head)', fontSize: 22, fontWeight: 700 }}>{fmtNum(comp.lean_pct)}%</div>
                  </div>
                  <div className="grow small">
                    <div className="stat-line"><span><i style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 9, background: '#22d3ee', marginRight: 6 }} />Masa magra</span><b>{fmtNum(comp.lean_pct)}%</b></div>
                    <div className="stat-line"><span><i style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 9, background: '#f59e0b', marginRight: 6 }} />Grasa corporal</span><b>{fmtNum(comp.fat_pct)}%</b></div>
                    {comp.muscle_pct != null ? <div className="stat-line"><span className="muted">Masa muscular</span><b>{fmtNum(comp.muscle_pct)}%</b></div> : null}
                    <div className="dim mt-s">{comp.source}</div>
                  </div>
                </div>
              ) : <Empty title="Sin datos de composición">Registra grasa corporal (%) en un expediente.</Empty>}
            </Card>
          </div>
          <Card title="Actividad reciente" actions={user?.role === 'admin' ? <Link className="btn sm" to="/admin?tab=audit">Ver todas →</Link> : null}>
            {!data ? <Spinner /> : data.activity.length ? (
              <div className="col" style={{ gap: 4 }}>
                {data.activity.map((a) => (
                  <div key={a.id} className="row small" style={{ padding: '5px 0', borderBottom: '1px dashed rgba(56,189,248,.1)' }}>
                    {a.outcome === 'success' ? <CheckCircle2 size={15} color="#4ade80" /> : <XCircle size={15} color="#fb7185" />}
                    <b className="nowrap">{a.label}</b>
                    <span className="muted grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.actor}</span>
                    <span className="dim nowrap">{timeAgo(a.created_at)}</span>
                  </div>
                ))}
              </div>
            ) : <Empty title="Sin actividad aún" />}
          </Card>
        </div>
      </div>

      <Card title="¿Qué es BODYVISION AI?" tab>
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,1.9fr)', gap: 22 }}>
          <div>
            <p style={{ marginTop: 0, fontSize: 14.5, lineHeight: 1.65 }}>
              <b>BODYVISION AI</b> es una plataforma web para <b>gestionar expedientes</b>, <b>registrar mediciones corporales trazables</b>, <b>capturar imágenes</b> o video con la cámara para extraer
              los <b>33 puntos de movimiento</b> del cuerpo con inteligencia artificial, <b>explorar un modelo anatómico 3D</b> capa por capa
              (piel, músculos, órganos, arterias, venas, nervios y huesos) que se adapta al sexo, la estatura y el peso de cada persona,
              y <b>simular escenarios hipotéticos</b> sin alterar los datos reales.
            </p>
            <p className="muted small">Cada dato se rotula según su origen para que nunca se confunda una estimación o una simulación con una medición:</p>
            <div className="row wrap" style={{ gap: 6 }}>
              <DataTag kind="observed" /><DataTag kind="estimate" /><DataTag kind="reconstruction" /><DataTag kind="simulation" />
            </div>
            <div className="mt">
              <Alert kind="warn">Herramienta <b>no clínica</b>: no diagnostica ni sustituye a un profesional de la salud. Usa datos personales solo con consentimiento vigente.</Alert>
            </div>
            <div className="row wrap mt small muted" style={{ gap: 14 }}>
              <span className="row" style={{ gap: 6 }}><ShieldCheck size={15} color="#22d3ee" /> Roles y auditoría</span>
              <span className="row" style={{ gap: 6 }}><Layers size={15} color="#22d3ee" /> 7 capas · 2.198 estructuras</span>
            </div>
          </div>
          <div className="grid g-2" style={{ gap: 10 }}>
            {MODULES.map((m) => (
              <Link key={m.title} to={m.to} className="card tight" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span className="kpi-icon" style={{ width: 36, height: 36, borderRadius: 10 }}>{m.icon}</span>
                <span>
                  <b style={{ fontFamily: 'var(--font-head)' }}>{m.title}</b>
                  <div className="small muted">{m.text}</div>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </Card>
      {data && data.kpis.simulations ? (
        <div className="small dim mt-s" style={{ textAlign: 'right' }}>
          <Sparkles size={12} /> {data.kpis.simulations} simulación(es) guardadas · las simulaciones no se incluyen en las tendencias observadas
        </div>
      ) : null}
    </>
  )
}
