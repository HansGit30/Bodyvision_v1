import ES from './names_es.json'
import { LAYER_BY_KEY, type LayerKey } from './layers'

const dict = ES as Record<string, string>

const stripSide = (n: string) => n.replace(/\.(l|r|g|i|s|t|e)$/i, '').trim()

export function sideOf(zname: string): 'izquierdo' | 'derecho' | null {
  if (/\.l$/i.test(zname)) return 'izquierdo'
  if (/\.r$/i.test(zname)) return 'derecho'
  return null
}

/** Traducción al español del nombre anatómico (con respaldo legible si faltara). */
export function nameEs(zname: string): string {
  const base = stripSide(zname)
  return dict[base] ?? dict[base.replace(/^\(|\)$/g, '')] ?? base.replace(/[()*]/g, '').replace(/_/g, ' ')
}

export function groupEs(zgroup: string): string {
  if (!zgroup) return ''
  return nameEs(zgroup)
}

export function describePart(zname: string, zgroup: string, layer: LayerKey) {
  const side = sideOf(zname)
  const group = groupEs(zgroup)
  const name = nameEs(zname)
  return {
    name,
    original: stripSide(zname),
    side,
    sideLabel: side ? `Lado ${side}` : null,
    group: group && group !== name ? group : '',
    system: LAYER_BY_KEY[layer].system,
    color: LAYER_BY_KEY[layer].color,
  }
}
