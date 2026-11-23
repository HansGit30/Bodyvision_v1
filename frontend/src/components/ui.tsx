import { useEffect, useRef, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, X, XCircle, Inbox } from 'lucide-react'
import { useToasts } from '../services/store'
import { STATUS_LABEL } from '../utils/format'

export function Card({ title, sub, actions, children, className = '', tab }: {
  title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; tab?: boolean
}) {
  return (
    <section className={`card ${className}`}>
      {tab && title ? <div className="tab-title">{title}</div> : null}
      {(!tab && (title || actions)) || (tab && actions) ? (
        <div className="card-head">
          <div>
            {!tab && title ? <div className="card-title">{title}</div> : null}
            {sub ? <div className="card-sub">{sub}</div> : null}
          </div>
          {actions ? <div className="btn-row">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export function Spinner({ lg = false, label }: { lg?: boolean; label?: string }) {
  return (
    <div className="center-fill" role="status" aria-live="polite">
      <div className={`spinner ${lg ? 'lg' : ''}`} />
      {label ? <span>{label}</span> : <span className="sr-only">Cargando…</span>}
    </div>
  )
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="empty">
      {icon ?? <Inbox size={34} />}
      <h3>{title}</h3>
      {children ? <div className="muted small">{children}</div> : null}
    </div>
  )
}

export function Alert({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'error' | 'success'; children: ReactNode }) {
  const Icon = kind === 'error' ? XCircle : kind === 'warn' ? AlertTriangle : kind === 'success' ? CheckCircle2 : Info
  return <div className={`alert ${kind}`} role={kind === 'error' ? 'alert' : 'note'}><Icon size={16} /><div>{children}</div></div>
}

const TONES: Record<string, string> = {
  active: 'green', accepted: 'green', completed: 'green', approved: 'green', ready: 'green', processed: 'cyan',
  queued: 'cyan', processing: 'cyan', pending: 'amber', needs_review: 'amber', restricted: 'amber', superseded: 'gray',
  failed: 'red', rejected: 'red', revoked: 'red', expired: 'gray', archived: 'gray', disabled: 'gray', deleted: 'gray',
}
export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${TONES[status] || 'gray'}`}>{STATUS_LABEL[status] || status}</span>
}

export type DataKind = 'observed' | 'estimate' | 'reconstruction' | 'simulation' | 'derived'
const DT: Record<DataKind, [string, string, string]> = {
  observed: ['green', 'Observado', 'Dato registrado directamente (manual o con instrumento).'],
  estimate: ['amber', 'Estimación visual', 'Inferido por un modelo de IA a partir de una imagen; no es una medición clínica.'],
  reconstruction: ['violet', 'Reconstrucción aproximada', 'Geometría 3D aproximada generada desde los datos disponibles.'],
  simulation: ['pink', 'Simulación', 'Escenario hipotético; nunca modifica mediciones reales.'],
  derived: ['cyan', 'Derivado', 'Calculado a partir de datos observados (p. ej. IMC).'],
}
export function DataTag({ kind }: { kind: DataKind }) {
  const [tone, label, title] = DT[kind]
  return <span className={`badge ${tone} dtag`} title={title}>{label}</span>
}
export const sourceKind = (source: string): DataKind => (source === 'visual_estimate' ? 'estimate' : 'observed')

export function Modal({ title, onClose, children, wide = false, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])')
    first?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.() }
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost icon" onClick={onClose} aria-label="Cerrar" data-close><X size={18} /></button>
        </div>
        {children}
        {footer ? <div className="btn-row mt" style={{ justifyContent: 'flex-end' }}>{footer}</div> : null}
      </div>
    </div>
  )
}

export function Toasts() {
  const { items, dismiss } = useToasts()
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === 'error' ? <XCircle size={17} color="#fb7185" /> : t.kind === 'success' ? <CheckCircle2 size={17} color="#4ade80" /> : <Info size={17} color="#38bdf8" />}
          <div className="grow">{t.text}</div>
          <button className="btn ghost icon sm" onClick={() => dismiss(t.id)} aria-label="Cerrar notificación"><X size={14} /></button>
        </div>
      ))}
    </div>
  )
}

export function Field({ label, children, hint, error, htmlFor }: { label: string; children: ReactNode; hint?: ReactNode; error?: string | null; htmlFor?: string }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <span className="error-text">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </div>
  )
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode }[] }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((it) => (
        <button key={it.id} role="tab" aria-selected={value === it.id} onClick={() => onChange(it.id)}>{it.label}</button>
      ))}
    </div>
  )
}

export function Kpi({ icon, value, label, color }: { icon: ReactNode; value: ReactNode; label: string; color: string }) {
  return (
    <div className="card kpi" style={{ ['--kc' as string]: color }}>
      <div className="kpi-icon">{icon}</div>
      <div>
        <div className="kpi-value">{value}</div>
        <div className="kpi-label">{label}</div>
      </div>
    </div>
  )
}
