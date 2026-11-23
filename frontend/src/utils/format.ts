const dtf = new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', year: 'numeric' })
const dttf = new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export const fmtDate = (s?: string | null) => (s ? dtf.format(new Date(s)) : '—')
export const fmtDateTime = (s?: string | null) => (s ? dttf.format(new Date(s)) : '—')
export const fmtNum = (v: number | null | undefined, d = 1) =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : v.toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: d })

export function timeAgo(s: string) {
  const diff = (Date.now() - new Date(s).getTime()) / 1000
  if (diff < 60) return 'hace unos segundos'
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`
  if (diff < 86400 * 30) return `hace ${Math.floor(diff / 86400)} d`
  return fmtDate(s)
}

export function ageFrom(birth: string | null) {
  if (!birth) return null
  const b = new Date(birth)
  const n = new Date()
  let a = n.getFullYear() - b.getFullYear()
  if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--
  return a
}

export const bmi = (w?: number | null, hcm?: number | null) => (w && hcm ? Math.round((w / (hcm / 100) ** 2) * 10) / 10 : null)
export function bmiCategory(b: number | null) {
  if (b === null) return { label: 'sin datos', tone: 'gray' }
  if (b < 18.5) return { label: 'bajo peso', tone: 'amber' }
  if (b < 25) return { label: 'normal', tone: 'green' }
  if (b < 30) return { label: 'sobrepeso', tone: 'amber' }
  return { label: 'obesidad', tone: 'red' }
}
/** Índice morfológico visual (0 ≈ IMC 22). Igual que el backend. */
export const fatIndex = (b: number | null) => (b === null ? 0 : Math.max(-0.6, Math.min(2, (b - 22) / 10)))

/** Fecha local → valor para <input type="datetime-local">. */
export function toLocalInput(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
/** <input type="datetime-local"> → ISO con zona horaria local explícita. */
export function localInputToISO(v: string) {
  const d = new Date(v)
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const p = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0')
  return `${v.length === 16 ? v + ':00' : v}${sign}${p(off / 60)}:${p(off % 60)}`
}

export const METHOD_LABEL: Record<string, string> = { manual: 'Manual', device: 'Dispositivo', visual_estimate: 'Estimación visual' }
export const PURPOSE_LABEL: Record<string, string> = {
  image_processing: 'Procesamiento de imágenes', data_processing: 'Tratamiento de datos', report_sharing: 'Compartir reportes',
}
export const ROLE_LABEL: Record<string, string> = { admin: 'Administrador', specialist: 'Especialista', viewer: 'Usuario final', patient: 'Paciente' }
export const STATUS_LABEL: Record<string, string> = {
  queued: 'En cola', processing: 'Procesando', completed: 'Completado', failed: 'Fallido', needs_review: 'Requiere revisión',
  pending: 'Pendiente', approved: 'Aprobado', rejected: 'Rechazado', accepted: 'Vigente', revoked: 'Revocado', expired: 'Expirado',
  active: 'Activo', archived: 'Archivado', restricted: 'Restringido', superseded: 'Sustituido', disabled: 'Deshabilitado',
}
