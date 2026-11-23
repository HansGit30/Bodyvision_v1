export type LayerKey = 'skin' | 'muscles' | 'organs' | 'arteries' | 'veins' | 'nerves' | 'skeleton'

export interface LayerDef {
  key: LayerKey
  label: string
  system: string
  color: string
  holo: string
  parts: number
}

export const LAYERS: LayerDef[] = [
  { key: 'skin', label: 'Piel', system: 'Sistema tegumentario', color: '#f0a07a', holo: '#7ff5e6', parts: 256 },
  { key: 'muscles', label: 'Músculos', system: 'Sistema muscular', color: '#ef4444', holo: '#ff7a5c', parts: 476 },
  { key: 'organs', label: 'Órganos', system: 'Órganos y vísceras', color: '#f472b6', holo: '#ff8fb1', parts: 297 },
  { key: 'arteries', label: 'Arterias', system: 'Sistema circulatorio · arterias', color: '#ff3b4e', holo: '#ff4d6d', parts: 417 },
  { key: 'veins', label: 'Venas', system: 'Sistema circulatorio · venas', color: '#3b82f6', holo: '#4d8dff', parts: 226 },
  { key: 'nerves', label: 'Nervios', system: 'Sistema nervioso', color: '#facc15', holo: '#ffe066', parts: 255 },
  { key: 'skeleton', label: 'Huesos', system: 'Sistema esquelético', color: '#e8e2cf', holo: '#9ee7ff', parts: 271 },
]
export const LAYER_BY_KEY = Object.fromEntries(LAYERS.map((l) => [l.key, l])) as Record<LayerKey, LayerDef>

/** Vistas rápidas: "solo órganos", "solo venas", "vasos sanguíneos", etc. */
export const PRESETS: { id: string; label: string; layers: LayerKey[] }[] = [
  { id: 'body', label: 'Cuerpo completo', layers: ['skin'] },
  { id: 'muscles', label: 'Solo músculos', layers: ['muscles'] },
  { id: 'organs', label: 'Solo órganos', layers: ['organs'] },
  { id: 'vessels', label: 'Vasos sanguíneos', layers: ['arteries', 'veins'] },
  { id: 'arteries', label: 'Solo arterias', layers: ['arteries'] },
  { id: 'veins', label: 'Solo venas', layers: ['veins'] },
  { id: 'nerves', label: 'Solo nervios', layers: ['nerves'] },
  { id: 'skeleton', label: 'Solo huesos', layers: ['skeleton'] },
  { id: 'circ', label: 'Corazón y circulación', layers: ['organs', 'arteries', 'veins'] },
  { id: 'deep', label: 'Músculos + esqueleto', layers: ['muscles', 'skeleton'] },
  { id: 'all-int', label: 'Todo interno', layers: ['organs', 'arteries', 'veins', 'nerves', 'skeleton'] },
]

export const modelUrl = (key: LayerKey) => `${import.meta.env.BASE_URL}models/${key}.glb`
export const DRACO_PATH = `${import.meta.env.BASE_URL}draco/`
export const MODEL_HEIGHT_M = 1.742
export const ASSET_LICENSE = 'CC BY-SA 4.0 · Z-Anatomy / BodyParts3D (DBCLS)'
export const ASSET_SOURCE = 'github.com/SeemaBansal1/3d-human-body-anatomy'
