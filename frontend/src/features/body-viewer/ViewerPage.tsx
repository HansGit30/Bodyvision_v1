import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { api, errMsg } from '../../services/api'
import { useCurrentProfile } from '../../services/store'
import type { BodyModels, LM, PoseAnalysis, Profile } from '../../types'
import { Alert, Spinner } from '../../components/ui'
import { BodyViewer, type ViewerInitial } from './BodyViewer'

export default function ViewerPage() {
  const { profileId } = useParams()
  const [sp] = useSearchParams()
  const analysisId = sp.get('analysis')
  const setCurrent = useCurrentProfile((s) => s.setCurrent)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [models, setModels] = useState<BodyModels | null>(null)
  const [lm, setLm] = useState<LM[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setErr(null)
    if (!profileId) { setProfile(null); setModels(null); setLm(null); return }
    let alive = true
    Promise.all([api<Profile>(`/profiles/${profileId}`), api<BodyModels>(`/profiles/${profileId}/body-models`)])
      .then(([p, m]) => {
        if (!alive) return
        setProfile(p); setModels(m); setLm(m.landmarks?.world || null)
        setCurrent({ id: p.id, code: p.display_code, name: p.display_name, sex: p.sex })
      })
      .catch((e) => alive && setErr(errMsg(e)))
    return () => { alive = false }
  }, [profileId, setCurrent])
  useEffect(() => {
    if (!analysisId) return
    api<PoseAnalysis>(`/pose-analyses/${analysisId}`).then((a) => a.world_landmarks_json && setLm(a.world_landmarks_json)).catch(() => undefined)
  }, [analysisId])

  const initial = useMemo<ViewerInitial>(() => {
    const r = models?.reconstruction
    return { sex: r?.sex || profile?.sex || 'M', heightCm: r?.height_cm ?? null, weightKg: r?.weight_kg ?? null }
  }, [models, profile])

  if (err) return <div className="content"><Alert kind="error">{err}</Alert></div>
  if (profileId && (!profile || !models)) return <Spinner lg label="Preparando reconstrucción 3D…" />
  const label = profile
    ? `${profile.display_code} · ${profile.display_name}${models?.reconstruction.weight_kg != null && models?.reconstruction.height_cm != null ? (profile?.is_demo ? ' · datos ficticios de demostración' : ' · mediciones del expediente (verificar procedencia)' ) : ' · sin mediciones registradas; parámetros de simulación'}`
    : 'Modelo de referencia (sin expediente). Ajusta sexo, estatura y peso.'
  return (
    <>
      <BodyViewer initial={initial} landmarks={lm} profileLabel={label} unlinked={!profileId} />
    </>
  )
}
