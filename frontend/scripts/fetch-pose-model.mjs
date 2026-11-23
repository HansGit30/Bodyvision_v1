// Descarga opcional del modelo oficial pose_landmarker_full.task para servirlo desde el mismo origen.
// Si no hay red, el frontend usa la URL oficial de Google en tiempo de ejecución.
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'mediapipe', 'pose_landmarker_full.task')
const url = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task'
if (existsSync(out)) { console.log('[pose] modelo ya presente'); process.exit(0) }
try {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 30000)
  const r = await fetch(url, { signal: ctrl.signal }); clearTimeout(t)
  if (!r.ok) throw new Error('HTTP ' + r.status)
  const buf = Buffer.from(await r.arrayBuffer())
  if (buf.length < 1_000_000) throw new Error('tamaño inesperado')
  writeFileSync(out, buf)
  console.log('[pose] modelo descargado', (buf.length / 1e6).toFixed(1), 'MB')
} catch (e) {
  console.warn('[pose] no se pudo descargar el modelo (' + e.message + '); se usará la URL oficial en tiempo de ejecución')
}
