import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Archive, ArrowRight, Save, Sparkles, TriangleAlert } from 'lucide-react'
import { api, errMsg } from '../../services/api'
import { toast, useAuth, useCurrentProfile } from '../../services/store'
import type { BodyModels, Profile, Simulation } from '../../types'
import { Alert, Card, DataTag, Empty, Field, Spinner } from '../../components/ui'
import { bmi, bmiCategory, fatIndex, fmtDateTime, fmtNum } from '../../utils/format'
import { DualBody } from '../body-viewer/HoloPreview'

export default function SimulationPage() {
  const { profileId = '' } = useParams()
  const can = useAuth((s) => s.can)
  const setCurrent = useCurrentProfile((s) => s.setCurrent)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [models, setModels] = useState<BodyModels | null>(null)
  const [sims, setSims] = useState<Simulation[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [target, setTarget] = useState(70)
  const [fatD, setFatD] = useState(0)
  const [musD, setMusD] = useState(0)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    Promise.all([api<Profile>(`/profiles/${profileId}`), api<BodyModels>(`/profiles/${profileId}/body-models`)])
      .then(([p, m]) => {
        setProfile(p); setModels(m)
        setCurrent({ id: p.id, code: p.display_code, name: p.display_name, sex: p.sex })
        if (m.reconstruction.weight_kg) setTarget(Math.round(m.reconstruction.weight_kg - 5))
      })
      .catch((e) => setErr(errMsg(e)))
  }, [profileId, setCurrent])
  useEffect(() => { api<Simulation[]>(`/profiles/${profileId}/simulations`).then(setSims).catch(() => setSims([])) }, [profileId, tick])

  const r = models?.reconstruction
  const w0 = r?.weight_kg ?? null
  const h = r?.height_cm ?? null
  const b0 = bmi(w0, h)
  const b1 = bmi(target, h)
  const fat0 = fatIndex(b0)
  const fat1 = Math.max(-0.6, Math.min(2, fatIndex(b1) + fatD / 40))
  const c0 = bmiCategory(b0), c1 = bmiCategory(b1)
  const preview = useMemo(() => ({
    fatPct: r?.body_fat_pct != null ? Math.max(3, Math.min(65, r.body_fat_pct + fatD)) : null,
    musPct: r?.muscle_pct != null ? Math.max(10, Math.min(70, r.muscle_pct * (1 + musD / 100))) : null,
  }), [r, fatD, musD])

  const save = async () => {
    if (!title.trim()) { toast('Escribe un título para el escenario', 'error'); return }
    setBusy(true)
    try {
      await api(`/profiles/${profileId}/simulations`, { body: { title: title.trim(), parameters: { target_weight_kg: target, body_fat_delta_pct: fatD, muscle_delta_pct: musD } } })
      toast('Escenario guardado (no modifica las mediciones reales)', 'success')
      setTitle('')
      setTick((t) => t + 1)
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }
  const archive = async (s: Simulation) => {
    try { await api(`/simulations/${s.id}/archive`, { method: 'POST' }); setTick((t) => t + 1); toast('Escenario archivado', 'success') } catch (e) { toast(errMsg(e), 'error') }
  }
  const load = (s: Simulation) => { setTarget(s.parameters_json.target_weight_kg); setFatD(s.parameters_json.body_fat_delta_pct); setMusD(s.parameters_json.muscle_delta_pct) }

  if (err) return <Alert kind="error">{err}</Alert>
  if (!profile || !models) return <Spinner lg label="Cargando estado de referencia…" />
  const noBase = !w0 || !h

  return (
    <>
      <div className="page-head">
        <div>
          <div className="row" style={{ gap: 8 }}><DataTag kind="simulation" /><span className="badge gray">{'bodyvision-morph 1.0.0'}</span></div>
          <h1 style={{ marginTop: 8 }}>Simulación de cambios</h1>
          <p><span className="mono">{profile.display_code}</span> · {profile.display_name} — escenarios hipotéticos aislados de los datos observados.</p>
        </div>
      </div>
      <div className="mb"><Alert kind="warn"><b>SIMULACIÓN ILUSTRATIVA.</b> La deformación 3D y los valores resultantes son aproximaciones visuales sin validación clínica; nunca modifican las mediciones registradas.</Alert></div>
      {noBase ? (
        <Card><Empty title="Falta el estado de referencia" icon={<TriangleAlert size={34} />}>Registra al menos un <b>peso</b> y una <b>estatura</b> en el expediente. <Link to={`/profiles/${profileId}?tab=measurements`}>Ir a mediciones →</Link></Empty></Card>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.6fr) minmax(300px,1fr)' }}>
          <Card title="Base vs escenario" tab>
            <DualBody sex={profile.sex} heightCm={h!} base={fat0} scenario={fat1} muscle={musD / 30} />
          </Card>
          <div className="col" style={{ gap: 16 }}>
            <Card title="Parámetros">
              <Field label={`Peso objetivo: ${target} kg`} htmlFor="s-w">
                <input id="s-w" type="range" min={Math.max(30, Math.round(w0! * 0.6))} max={Math.round(w0! * 1.5)} step={0.5} value={target} onChange={(e) => setTarget(Number(e.target.value))} />
              </Field>
              <Field label={`Grasa corporal: ${fatD > 0 ? '+' : ''}${fatD} puntos porcentuales`} htmlFor="s-f">
                <input id="s-f" type="range" min={-15} max={15} step={0.5} value={fatD} onChange={(e) => setFatD(Number(e.target.value))} />
              </Field>
              <Field label={`Masa muscular: ${musD > 0 ? '+' : ''}${musD}%`} htmlFor="s-m">
                <input id="s-m" type="range" min={-20} max={20} step={1} value={musD} onChange={(e) => setMusD(Number(e.target.value))} />
              </Field>
            </Card>
            <Card title="Resultado del escenario" sub={<DataTag kind="simulation" />}>
              <div className="stat-line"><span className="muted">Peso</span><span>{fmtNum(w0)} <ArrowRight size={12} /> <b>{fmtNum(target)}</b> kg ({target - w0! > 0 ? '+' : ''}{fmtNum(target - w0!)} kg)</span></div>
              <div className="stat-line"><span className="muted">IMC</span><span>{fmtNum(b0)} <span className={`badge ${c0.tone}`}>{c0.label}</span> <ArrowRight size={12} /> <b>{fmtNum(b1)}</b> <span className={`badge ${c1.tone}`}>{c1.label}</span></span></div>
              {preview.fatPct != null ? <div className="stat-line"><span className="muted">Grasa corporal</span><span>{fmtNum(r!.body_fat_pct)} → <b>{fmtNum(preview.fatPct)}</b> %</span></div> : null}
              {preview.musPct != null ? <div className="stat-line"><span className="muted">Masa muscular</span><span>{fmtNum(r!.muscle_pct)} → <b>{fmtNum(preview.musPct)}</b> %</span></div> : null}
              <div className="stat-line"><span className="muted">Cintura (estimación ilustrativa)</span><b>{(target - w0!) * 0.9 > 0 ? '+' : ''}{fmtNum((target - w0!) * 0.9)} cm</b></div>
              {can('simulations:write') ? (
                <div className="mt">
                  <Field label="Título del escenario" htmlFor="s-t"><input id="s-t" className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="Ej.: −5 kg con +5% músculo" /></Field>
                  <button className="btn primary" style={{ width: '100%' }} onClick={save} disabled={busy}><Save size={16} /> Simular y guardar escenario</button>
                </div>
              ) : null}
            </Card>
          </div>
        </div>
      )}
      <Card className="mt" title={<><Sparkles size={16} /> Escenarios guardados</>} sub="Parámetros, versión del motor y salida; se pueden comparar o descartar.">
        {!sims ? <Spinner /> : sims.length === 0 ? <Empty title="Sin escenarios guardados" /> : (
          <table className="table">
            <thead><tr><th>Fecha</th><th>Título</th><th>Parámetros</th><th>IMC</th><th>Motor</th><th /></tr></thead>
            <tbody>{sims.map((s) => (
              <tr key={s.id}>
                <td className="nowrap">{fmtDateTime(s.created_at)}</td>
                <td><b>{s.title}</b> <span className="badge pink dtag">Simulación</span></td>
                <td className="small">{s.parameters_json.target_weight_kg} kg · grasa {s.parameters_json.body_fat_delta_pct > 0 ? '+' : ''}{s.parameters_json.body_fat_delta_pct} pp · músculo {s.parameters_json.muscle_delta_pct > 0 ? '+' : ''}{s.parameters_json.muscle_delta_pct}%</td>
                <td>{fmtNum(s.output_metadata.bmi_base)} → <b>{fmtNum(s.output_metadata.bmi_scenario)}</b></td>
                <td className="small muted">{s.engine_version}</td>
                <td className="nowrap">
                  <button className="btn sm" onClick={() => load(s)}>Cargar</button>{' '}
                  {can('simulations:write') ? <button className="btn sm ghost" onClick={() => archive(s)} aria-label="Archivar"><Archive size={14} /></button> : null}
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </>
  )
}
