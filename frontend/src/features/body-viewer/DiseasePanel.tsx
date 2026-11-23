import { useEffect, useState } from 'react'
import { ExternalLink, Focus, Pause, Play, X } from 'lucide-react'
import { api } from '../../services/api'
import { DataTag } from '../../components/ui'
import type { DiseaseDef, DStage } from './engine/diseases'

interface Info { available: boolean; title?: string; summary?: string[]; url?: string; source?: string }
const cache = new Map<string, Info>()

export function DiseasePanel({ def, progress, playing, stage, affected, onProgress, onPlay, onFocus, onClose }: {
  def: DiseaseDef; progress: number; playing: boolean; stage: DStage; affected: { label: string; n: number }[]
  onProgress: (v: number) => void; onPlay: () => void; onFocus: () => void; onClose: () => void
}) {
  const [info, setInfo] = useState<Info | null>(cache.get(def.icd10) || null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (cache.has(def.icd10)) { setInfo(cache.get(def.icd10)!); return }
    setInfo(null)
    let alive = true
    api<Info>(`/diseases/${encodeURIComponent(def.icd10)}/info`, { timeout: 15000 })
      .then((r) => { cache.set(def.icd10, r); if (alive) setInfo(r) })
      .catch(() => { if (alive) setInfo({ available: false }) })
    return () => { alive = false }
  }, [def.icd10])
  return (
    <div style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
      <div className="row between">
        <DataTag kind="simulation" />
        <button className="btn ghost icon sm" onClick={onClose} aria-label="Quitar enfermedad"><X size={14} /></button>
      </div>
      <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 16, color: '#fff', marginTop: 6 }}>{def.name}</div>
      <div className="small muted">CIE-10 <span className="mono">{def.icd10}</span> · {def.system}</div>
      <p className="small" style={{ margin: '8px 0' }}>{def.summary}</p>

      <div className="row" style={{ gap: 8 }}>
        <button className="btn sm icon" onClick={onPlay} aria-label={playing ? 'Pausar' : 'Reproducir evolución'}>{playing ? <Pause size={14} /> : <Play size={14} />}</button>
        <input type="range" min={0} max={1} step={0.005} value={progress} onChange={(e) => onProgress(Number(e.target.value))} aria-label="Avance de la enfermedad" />
        <b className="small nowrap">{Math.round(progress * 100)}%</b>
      </div>
      <div className="row" style={{ gap: 3, margin: '6px 0 2px' }}>
        {def.stages.map((s, i) => {
          const on = progress >= s.p
          const cur = s === stage
          return <button key={i} title={s.label} onClick={() => onProgress(s.p)} style={{ flex: 1, height: 6, borderRadius: 4, border: 'none', cursor: 'pointer', background: cur ? '#f472b6' : on ? 'rgba(244,114,182,.45)' : 'rgba(148,172,208,.18)' }} />
        })}
      </div>
      <div className="card tight" style={{ marginTop: 8, borderColor: 'rgba(244,114,182,.45)' }}>
        <b style={{ color: '#f9a8d4' }}>{stage.label}</b>
        <div className="small">{stage.text}</div>
      </div>
      {affected.length ? (
        <div className="small mt-s">
          <div className="muted" style={{ marginBottom: 4 }}>Estructuras afectadas</div>
          <div className="row wrap" style={{ gap: 4 }}>
            {affected.map((a) => <span key={a.label} className="badge red">{a.label}</span>)}
          </div>
        </div>
      ) : <div className="small dim mt-s">Aún sin afectación visible en esta etapa.</div>}
      <div className="btn-row mt-s">
        <button className="btn sm" onClick={onFocus} disabled={!affected.length}><Focus size={13} /> Enfocar zona</button>
        <button className="btn sm ghost" onClick={() => setOpen(!open)} aria-expanded={open}>Descripción oficial {open ? '−' : '+'}</button>
      </div>
      {open ? (
        <div className="small mt-s" style={{ maxHeight: 220, overflowY: 'auto', paddingRight: 4 }}>
          {!info ? <span className="dim">Consultando MedlinePlus…</span> : info.available ? (
            <>
              <b>{info.title}</b>
              {info.summary?.map((p, i) => <p key={i} style={{ margin: '6px 0' }}>{p}</p>)}
              {info.url ? <a href={info.url} target="_blank" rel="noopener noreferrer">Leer completo en MedlinePlus <ExternalLink size={11} /></a> : null}
              <div className="dim" style={{ marginTop: 4 }}>Fuente: {info.source}</div>
            </>
          ) : <span className="dim">El servicio MedlinePlus no está disponible ahora. La simulación funciona sin conexión.</span>}
        </div>
      ) : null}
    </div>
  )
}
