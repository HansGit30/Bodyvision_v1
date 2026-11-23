// Copia los binarios WASM de MediaPipe y el decodificador Draco a /public (se sirven desde el mismo origen).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const copies = [
  ['node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js', 'public/mediapipe/vision_wasm_internal.js'],
  ['node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm', 'public/mediapipe/vision_wasm_internal.wasm'],
  ['node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.js', 'public/draco/draco_decoder.js'],
  ['node_modules/three/examples/jsm/libs/draco/gltf/draco_decoder.wasm', 'public/draco/draco_decoder.wasm'],
  ['node_modules/three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js', 'public/draco/draco_wasm_wrapper.js'],
]
for (const [from, to] of copies) {
  const src = join(root, from)
  const dst = join(root, to)
  if (!existsSync(src)) { console.warn('[assets] no encontrado:', from); continue }
  mkdirSync(dirname(dst), { recursive: true })
  copyFileSync(src, dst)
}
console.log('[assets] MediaPipe WASM y Draco copiados a public/')
