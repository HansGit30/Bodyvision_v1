/** Cliente API centralizado: base URL, token, timeout, errores consistentes y correlation id. */
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || ''
export const API = `${BASE}/api/v1`
/** Resuelve rutas /api devueltas por el backend (p. ej. URLs firmadas) contra la base configurada. */
export const absUrl = (p: string) => (p.startsWith('/api') ? BASE + p : p)

export class ApiError extends Error {
  status: number
  code: string
  correlationId: string
  details?: unknown
  constructor(status: number, code: string, message: string, correlationId = '-', details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.correlationId = correlationId
    this.details = details
  }
}

let token: string | null = null
let onUnauthorized: (() => void) | null = null
export const setToken = (t: string | null) => { token = t }
export const getToken = () => token
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn }

type Opts = { method?: string; body?: unknown; form?: FormData; timeout?: number; raw?: boolean; signal?: AbortSignal }

export async function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeout ?? 30000)
  opts.signal?.addEventListener('abort', () => ctrl.abort())
  const headers: Record<string, string> = { 'X-Correlation-ID': Math.random().toString(16).slice(2, 14) }
  if (token) headers.Authorization = `Bearer ${token}`
  let body: BodyInit | undefined
  if (opts.form) body = opts.form
  else if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.body) }
  let res: Response
  try {
    res = await fetch(path.startsWith('http') ? path : path.startsWith('/api') ? BASE + path : API + path, { method: opts.method || (body ? 'POST' : 'GET'), headers, body, signal: ctrl.signal })
  } catch (e) {
    clearTimeout(timer)
    if ((e as Error).name === 'AbortError') throw new ApiError(0, 'TIMEOUT', 'La solicitud tardó demasiado o fue cancelada')
    throw new ApiError(0, 'NETWORK', 'No se pudo conectar con el servidor')
  }
  clearTimeout(timer)
  if (res.status === 401 && token && !path.includes('/auth/login')) onUnauthorized?.()
  if (!res.ok) {
    let code = 'ERROR', message = `Error ${res.status}`, cid = res.headers.get('X-Correlation-ID') || '-', details: unknown
    try {
      const j = await res.json()
      if (j?.error) { code = j.error.code; message = j.error.message; cid = j.error.correlation_id || cid; details = j.error.details }
    } catch { /* cuerpo no JSON */ }
    if (Array.isArray(details) && details.length) {
      message += ': ' + (details as { field: string; message: string }[]).map((d) => `${d.field} ${d.message}`).join('; ')
    }
    throw new ApiError(res.status, code, message, cid, details)
  }
  if (opts.raw) return res as unknown as T
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/** Descarga autenticada de archivos (reportes) sin exponer el token en la URL. */
export async function download(path: string, fallbackName: string) {
  const res = await api<Response>(path, { raw: true, timeout: 60000 })
  const blob = await res.blob()
  const cd = res.headers.get('Content-Disposition') || ''
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)
  const name = m ? decodeURIComponent(m[1]) : fallbackName
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Error inesperado')
