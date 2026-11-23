/**
 * bodyvision-morph 1.0 — deformación paramétrica (sexo, IMC/grasa, masa muscular) del atlas anatómico.
 *
 * Coordenadas del modelo: metros, Y arriba (0 = pies, 1.742 = vértice del cráneo), +Z hacia delante,
 * +X = lado izquierdo del sujeto. Es una RECONSTRUCCIÓN APROXIMADA con fines visuales, no un modelo
 * antropométrico validado.
 *
 *  · Sexo femenino: hombros más estrechos, cintura más estrecha y pelvis más ancha (todas las capas,
 *    para que esqueleto, órganos y músculos queden dentro de la piel), más volumen mamario y glúteo (piel).
 *  · Grasa: la piel se desplaza a lo largo de su normal según un mapa regional de tejido subcutáneo
 *    (abdomen, flancos, caderas, muslos, brazos...) con distribución distinta por sexo.
 *  · Masa muscular: los músculos (y la piel que los cubre) se expanden ligeramente.
 */
import type { LayerKey } from './layers'

const g = (v: number, c: number, s: number) => { const t = (v - c) / s; return Math.exp(-t * t) }
const ss = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t) }

/** Factor de escala lateral (X) del cuerpo femenino respecto al masculino base. */
function femaleKx(ax: number, y: number) {
  const torso = 1 - ss(0.15, 0.19, ax)
  const notHands = 1 - ss(0.19, 0.215, ax)
  const shoulders = -0.075 * ss(1.15, 1.4, y) * (1 - 0.6 * ss(1.47, 1.58, y))
  const waist = -0.07 * g(y, 1.07, 0.07) * torso
  const hips = 0.09 * g(y, 0.88, 0.11) * notHands
  return 1 + shoulders + waist + hips
}

/** Peso regional (m por unidad de índice de grasa) del tejido subcutáneo. */
export function fatWeight(x: number, y: number, z: number, female: boolean) {
  const ax = Math.abs(x)
  const torso = 1 - ss(0.15, 0.19, ax)
  const front = ss(0.0, 0.1, z)
  const back = ss(0.0, -0.08, z)
  const hand = ss(0.205, 0.225, ax) * g(y, 0.8, 0.07)
  const foot = 1 - ss(0.03, 0.1, y)
  const legMask = 1 - ss(0.185, 0.215, ax)
  const armUpper = ss(0.17, 0.21, ax) * g(y, 1.22, 0.12)
  const F = female
  let w = 0
  w += (F ? 0.04 : 0.062) * g(y, 1.02, 0.11) * g(x, 0, 0.11) * front // abdomen
  w += (F ? 0.024 : 0.03) * g(y, 1.03, 0.08) * g(ax, 0.14, 0.045) * torso // flancos
  w += 0.012 * g(y, 1.05, 0.08) * back * torso // zona lumbar
  w += (F ? 0.042 : 0.022) * g(y, 0.86, 0.09) * (0.4 + back) * legMask // caderas y glúteos
  w += (F ? 0.03 : 0.016) * g(y, 0.68, 0.13) * legMask // muslos
  w += (F ? 0.02 : 0.014) * armUpper // brazos
  w += 0.006 * g(y, 0.98, 0.08) * ss(0.19, 0.22, ax) * (1 - hand) // antebrazos
  w += (F ? 0.0 : 0.02) * g(y, 1.28, 0.06) * g(ax, 0.09, 0.06) * front // pecho (masculino)
  w += 0.01 * g(y, 1.32, 0.08) * back * torso // espalda alta
  w += 0.012 * g(y, 1.525, 0.035) * (0.3 + 0.7 * front) * (1 - ss(0.07, 0.1, ax)) // cuello / papada
  w += 0.006 * g(y, 1.6, 0.035) * (1 - ss(0.06, 0.09, ax)) // mejillas
  w += 0.008 * g(y, 0.33, 0.1) * legMask // pantorrillas
  w += 0.004 // base
  w *= (1 - hand) * (1 - foot * 0.9)
  return Math.min(w, 0.085)
}

/** Volumen mamario (vector de desplazamiento) para el cuerpo femenino. */
function breast(x: number, y: number, z: number, out: [number, number, number]) {
  const ax = Math.abs(x)
  const b = 0.044 * Math.exp(-(((ax - 0.095) / 0.062) ** 2 + ((y - 1.268) / 0.058) ** 2)) * ss(0.03, 0.09, z)
  // dirección: hacia delante, algo lateral y hacia abajo (gravedad)
  out[0] = Math.sign(x) * 0.21 * b
  out[1] = -0.17 * b
  out[2] = 0.96 * b
}

function glute(x: number, y: number, z: number) {
  const ax = Math.abs(x)
  return -0.024 * g(y, 0.865, 0.07) * ss(-0.03, -0.1, z) * (1 - ss(0.15, 0.19, ax)) * g(ax, 0.08, 0.08)
}

export interface MorphParams { female: number; fat: number; muscle: number }

/** Métrica del mapa térmico: grosor subcutáneo estimado (m) o cambio respecto a la referencia (m). */
export type HeatMetric = 'thickness' | 'delta'
export interface HeatOpts { metric: HeatMetric; baseFat: number }

/** Datos precalculados por geometría (posición/normal originales y pesos regionales). */
export interface MorphData {
  orig: Float32Array
  norm: Float32Array
  wM?: Float32Array
  wF?: Float32Array
  fem?: Float32Array // desplazamiento femenino de tejido blando (mamas + glúteos) xyz
}

/** Cabello femenino: alarga hacia abajo el casquete de pelo por detrás y a los lados (melena). */
function hairFemale(x: number, y: number, z: number, out: [number, number, number]) {
  const back = ss(0.06, -0.04, z) // 1 detrás de la cabeza
  const side = ss(0.04, 0.08, Math.abs(x))
  const w = Math.max(back, side * 0.8) * ss(1.7, 1.6, y)
  out[0] = Math.sign(x) * 0.012 * w
  out[1] = -0.15 * w * (0.55 + 0.45 * back)
  out[2] = -0.018 * w * back
}

export function prepareMorph(pos: Float32Array, nor: Float32Array, layer: LayerKey, isHair = false): MorphData {
  const d: MorphData = { orig: pos.slice(), norm: nor.slice() }
  if (isHair) {
    const n = pos.length / 3
    d.fem = new Float32Array(n * 3)
    const h: [number, number, number] = [0, 0, 0]
    for (let i = 0; i < n; i++) {
      hairFemale(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], h)
      d.fem[i * 3] = h[0]; d.fem[i * 3 + 1] = h[1]; d.fem[i * 3 + 2] = h[2]
    }
    return d
  }
  if (layer === 'skin' || layer === 'muscles') {
    const n = pos.length / 3
    d.wM = new Float32Array(n)
    d.wF = new Float32Array(n)
    if (layer === 'skin') d.fem = new Float32Array(n * 3)
    const b: [number, number, number] = [0, 0, 0]
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2]
      d.wM[i] = fatWeight(x, y, z, false)
      d.wF[i] = fatWeight(x, y, z, true)
      if (d.fem) {
        breast(x, y, z, b)
        d.fem[i * 3] = b[0]
        d.fem[i * 3 + 1] = b[1]
        d.fem[i * 3 + 2] = b[2] + glute(x, y, z)
      }
    }
  }
  return d
}

/**
 * Escribe en `out` las posiciones deformadas. Devuelve el valor de calor (grosor subcutáneo relativo)
 * por vértice en `heat` si se proporciona.
 */
export function applyMorph(d: MorphData, out: Float32Array, layer: LayerKey, p: MorphParams, heat?: Float32Array, ho: HeatOpts = { metric: 'thickness', baseFat: 0 }) {
  const { orig, norm } = d
  const n = orig.length / 3
  const f = p.female
  const isSkin = layer === 'skin'
  const isMuscle = layer === 'muscles'
  const fat = p.fat
  const fatScale = isSkin ? (fat >= 0 ? 1 : 0.35) : isMuscle ? (fat >= 0 ? 0.15 : 0.05) : 0
  const musc = (isSkin || isMuscle) ? p.muscle * 0.006 : 0
  const breastGain = 1 + 0.4 * Math.max(0, fat)
  for (let i = 0; i < n; i++) {
    const i3 = i * 3
    let x = orig[i3], y = orig[i3 + 1], z = orig[i3 + 2]
    if (f > 0) {
      const kx = femaleKx(Math.abs(x), y)
      x *= 1 + (kx - 1) * f
      if (d.fem) {
        x += d.fem[i3] * f * breastGain
        y += d.fem[i3 + 1] * f * breastGain
        z += d.fem[i3 + 2] * f * breastGain
      }
    }
    if (d.wM && d.wF) {
      const w = d.wM[i] * (1 - f) + d.wF[i] * f
      let disp = fat * w * fatScale
      if (disp < -0.008) disp = -0.008
      disp += musc
      x += norm[i3] * disp
      y += norm[i3 + 1] * disp
      z += norm[i3 + 2] * disp
      if (heat) {
        if (ho.metric === 'delta') {
          const dsp = (f0: number) => Math.max(-0.008, f0 * w * (f0 >= 0 ? 1 : 0.35))
          heat[i] = dsp(fat) - dsp(ho.baseFat)
        } else heat[i] = 0.003 + w * Math.max(0, fat + 0.6)
      }
    }
    out[i3] = x
    out[i3 + 1] = y
    out[i3 + 2] = z
  }
}

export const MORPH_ENGINE = 'bodyvision-morph 1.0.0'
