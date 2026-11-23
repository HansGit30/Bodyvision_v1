import { useEffect, useState, type FormEvent } from 'react'
import { ShieldCheck, ShieldOff } from 'lucide-react'
import { api, errMsg } from '../../services/api'
import { toast } from '../../services/store'
import type { Consent, Profile } from '../../types'
import { Alert, Card, Empty, Field, Modal, Spinner, StatusBadge } from '../../components/ui'
import { PURPOSE_LABEL, fmtDateTime } from '../../utils/format'

export const CONSENT_TEXT: Record<string, string> = {
  image_processing: 'Autorizo la captura y el procesamiento de imágenes corporales para extraer puntos de referencia de pose (landmarks) con fines de análisis visual no clínico. Las imágenes se almacenan de forma privada, sin metadatos, y puedo revocar esta autorización en cualquier momento.',
  data_processing: 'Autorizo el registro y tratamiento de mis mediciones corporales para seguimiento y comparación en el tiempo, conforme a la Ley 29733 de Protección de Datos Personales.',
  report_sharing: 'Autorizo la generación y entrega de reportes con mis datos a las personas autorizadas del expediente.',
}

export function ConsentForm({ profile, onClose, onSaved, purpose: fixed }: { profile: Profile; onClose: () => void; onSaved: () => void; purpose?: string }) {
  const [purpose, setPurpose] = useState(fixed || 'image_processing')
  const [version, setVersion] = useState('1.0')
  const [ok, setOk] = useState(false)
  const [evidence, setEvidence] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!ok) { setErr('El titular debe aceptar expresamente el texto de la finalidad'); return }
    setBusy(true)
    try {
      await api(`/profiles/${profile.id}/consents`, { body: { purpose, policy_version: version, accepted: true, evidence: evidence || 'Aceptación registrada en BODYVISION AI' } })
      toast('Consentimiento registrado', 'success')
      onSaved()
    } catch (e2) { setErr(errMsg(e2)) } finally { setBusy(false) }
  }
  return (
    <Modal title="Registrar consentimiento" onClose={onClose}>
      <form onSubmit={submit}>
        <Field label="Finalidad" htmlFor="c-purpose">
          <select id="c-purpose" className="select" value={purpose} onChange={(e) => { setPurpose(e.target.value); setOk(false) }} disabled={!!fixed}>
            {Object.entries(PURPOSE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <div className="card tight" style={{ background: 'rgba(3,10,26,.6)', marginBottom: 12 }}><p className="small" style={{ margin: 0, lineHeight: 1.6 }}>{CONSENT_TEXT[purpose]}</p></div>
        <div className="grid g-2" style={{ gap: 12 }}>
          <Field label="Versión de la política" htmlFor="c-ver"><input id="c-ver" className="input" value={version} onChange={(e) => setVersion(e.target.value)} maxLength={20} /></Field>
          <Field label="Evidencia (opcional)" htmlFor="c-ev"><input id="c-ev" className="input" value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Ej.: firma física N.º 123" maxLength={1000} /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> El titular leyó y acepta la finalidad descrita.</label>
        {err ? <div className="mt-s"><Alert kind="error">{err}</Alert></div> : null}
        <div className="btn-row mt" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={busy || !ok}><ShieldCheck size={15} /> Registrar aceptación</button>
        </div>
      </form>
    </Modal>
  )
}

export function ConsentPanel({ profile, canWrite, onChanged }: { profile: Profile; canWrite: boolean; onChanged: () => void }) {
  const [rows, setRows] = useState<Consent[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    api<Consent[]>(`/profiles/${profile.id}/consents`).then(setRows).catch((e) => setErr(errMsg(e)))
  }, [profile.id, tick])
  const revoke = async (c: Consent) => {
    if (!window.confirm(`¿Revocar el consentimiento de "${PURPOSE_LABEL[c.purpose]}"? Se bloquearán nuevos procesos de esa finalidad.`)) return
    try { await api(`/consents/${c.id}/revoke`, { method: 'POST' }); toast('Consentimiento revocado', 'success'); setTick((t) => t + 1); onChanged() } catch (e) { toast(errMsg(e), 'error') }
  }
  return (
    <Card title="Consentimientos" sub="Finalidad, versión, aceptación y revocación. Sin consentimiento vigente no se pueden cargar ni procesar imágenes."
      actions={canWrite ? <button className="btn primary sm" onClick={() => setAdding(true)}><ShieldCheck size={14} /> Registrar consentimiento</button> : null}>
      {err ? <Alert kind="error">{err}</Alert> : !rows ? <Spinner /> : rows.length === 0 ? <Empty title="Sin consentimientos registrados" /> : (
        <table className="table">
          <thead><tr><th>Finalidad</th><th>Versión</th><th>Estado</th><th>Aceptado</th><th>Revocado / expira</th><th>Evidencia</th><th /></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>{PURPOSE_LABEL[c.purpose]}</td><td className="mono">{c.policy_version}</td><td><StatusBadge status={c.status} /></td>
                <td className="nowrap">{fmtDateTime(c.accepted_at)}</td>
                <td className="nowrap">{c.revoked_at ? fmtDateTime(c.revoked_at) : c.expires_at ? fmtDateTime(c.expires_at) : '—'}</td>
                <td className="small muted">{c.evidence}</td>
                <td>{canWrite && c.status === 'accepted' ? <button className="btn danger sm" onClick={() => revoke(c)}><ShieldOff size={14} /> Revocar</button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {adding ? <ConsentForm profile={profile} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); setTick((t) => t + 1); onChanged() }} /> : null}
    </Card>
  )
}
