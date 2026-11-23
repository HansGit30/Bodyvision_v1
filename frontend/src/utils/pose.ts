import type { LM } from '../types'

export const POSE_EDGES: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 29], [29, 31], [27, 31], [28, 30], [30, 32], [28, 32], [15, 17], [15, 19], [17, 19], [15, 21], [16, 18], [16, 20], [18, 20], [16, 22],
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10],
]
export const KEY_POINTS = [0, 11, 12, 23, 24, 25, 26, 27, 28]
export const JOINTS: Record<string, [number, number, number, string]> = {
  rodilla_izq: [23, 25, 27, 'Rodilla izq.'],
  rodilla_der: [24, 26, 28, 'Rodilla der.'],
  codo_izq: [11, 13, 15, 'Codo izq.'],
  codo_der: [12, 14, 16, 'Codo der.'],
  cadera_izq: [11, 23, 25, 'Cadera izq.'],
  cadera_der: [12, 24, 26, 'Cadera der.'],
  hombro_izq: [23, 11, 13, 'Hombro izq.'],
  hombro_der: [24, 12, 14, 'Hombro der.'],
}
export const JOINT_LABEL: Record<string, string> = Object.fromEntries(Object.entries(JOINTS).map(([k, v]) => [k, v[3]]))

const vis = (p?: LM) => (p ? (p.visibility ?? 1) : 0)

export function angle(a: LM, b: LM, c: LM, w = 1, h = 1) {
  const bax = (a.x - b.x) * w, bay = (a.y - b.y) * h, bcx = (c.x - b.x) * w, bcy = (c.y - b.y) * h
  const na = Math.hypot(bax, bay), nc = Math.hypot(bcx, bcy)
  if (na < 1e-9 || nc < 1e-9) return null
  const cos = Math.max(-1, Math.min(1, (bax * bcx + bay * bcy) / (na * nc)))
  return Math.round((Math.acos(cos) * 180) / Math.PI)
}

export function jointAngles(lms: LM[], w = 1, h = 1) {
  const out: Record<string, number | null> = {}
  for (const [k, [a, b, c]] of Object.entries(JOINTS)) {
    out[k] = Math.min(vis(lms[a]), vis(lms[b]), vis(lms[c])) < 0.35 ? null : angle(lms[a], lms[b], lms[c], w, h)
  }
  return out
}

export interface LiveQuality { fullBody: boolean; centered: boolean; distance: 'ok' | 'near' | 'far'; light: 'ok' | 'dark' | 'bright'; orientation: boolean; visibility: number; missing: string[] }

const NAMES: Record<number, string> = { 0: 'cabeza', 11: 'hombro izq.', 12: 'hombro der.', 23: 'cadera izq.', 24: 'cadera der.', 25: 'rodilla izq.', 26: 'rodilla der.', 27: 'tobillo izq.', 28: 'tobillo der.' }

export function liveQuality(lms: LM[], w: number, h: number, brightness: number, view: string): LiveQuality {
  const missing = KEY_POINTS.filter((i) => vis(lms[i]) < 0.5 || lms[i].x < 0.01 || lms[i].x > 0.99 || lms[i].y < 0.01 || lms[i].y > 0.99).map((i) => NAMES[i])
  const midHip = (lms[23].x + lms[24].x) / 2
  const span = Math.max(lms[27].y, lms[28].y) - lms[0].y
  const sh = Math.abs(lms[11].x - lms[12].x) * w
  const torso = Math.abs((lms[11].y + lms[12].y) / 2 - (lms[23].y + lms[24].y) / 2) * h
  const ratio = torso > 1 ? sh / torso : 0
  return {
    fullBody: missing.length === 0,
    centered: midHip > 0.3 && midHip < 0.7,
    distance: span > 0.95 ? 'near' : span < 0.5 ? 'far' : 'ok',
    light: brightness < 55 ? 'dark' : brightness > 215 ? 'bright' : 'ok',
    orientation: view === 'lateral' ? ratio < 0.6 : ratio >= 0.45,
    visibility: lms.reduce((s, p) => s + vis(p), 0) / lms.length,
    missing,
  }
}

export function sanitize(arr: { x: number; y: number; z: number; visibility?: number; presence?: number }[] | undefined | null): LM[] | null {
  if (!arr || arr.length !== 33) return null
  const f = (n: number | undefined) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 1e5) / 1e5 : 0)
  return arr.map((p) => ({ x: f(p.x), y: f(p.y), z: f(p.z), visibility: p.visibility == null ? null : f(p.visibility), presence: p.presence == null ? null : f(p.presence) }))
}

/** Dibuja el esqueleto de pose (coordenadas normalizadas) sobre un canvas. */
export function drawPose(ctx: CanvasRenderingContext2D, lms: LM[], w: number, h: number, opts: { color?: string; alpha?: number } = {}) {
  const color = opts.color || '#22d3ee'
  ctx.save()
  ctx.globalAlpha = opts.alpha ?? 1
  ctx.lineCap = 'round'
  const lw = Math.max(2, Math.min(w, h) / 220)
  ctx.shadowColor = color
  ctx.shadowBlur = lw * 4
  for (const [a, b] of POSE_EDGES) {
    const pa = lms[a], pb = lms[b]
    if (!pa || !pb || Math.min(vis(pa), vis(pb)) < 0.3) continue
    ctx.strokeStyle = a >= 23 || b >= 23 ? '#a78bfa' : color
    ctx.lineWidth = lw
    ctx.beginPath()
    ctx.moveTo(pa.x * w, pa.y * h)
    ctx.lineTo(pb.x * w, pb.y * h)
    ctx.stroke()
  }
  ctx.shadowBlur = lw * 3
  lms.forEach((p, i) => {
    const v = vis(p)
    if (v < 0.3) return
    ctx.fillStyle = v > 0.7 ? '#e0fbff' : '#fbbf24'
    ctx.beginPath()
    ctx.arc(p.x * w, p.y * h, KEY_POINTS.includes(i) ? lw * 2.2 : lw * 1.4, 0, Math.PI * 2)
    ctx.fill()
  })
  ctx.restore()
}
