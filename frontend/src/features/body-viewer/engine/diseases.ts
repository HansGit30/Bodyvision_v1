/**
 * Catálogo educativo de progresión de enfermedades sobre el atlas anatómico.
 * Cada objetivo (target) selecciona mallas reales por nombre/grupo (Z-Anatomy) y define
 * fotogramas clave según el avance (0 → 1): color del tejido, brillo de lesión, escala y opacidad.
 * Es una SIMULACIÓN ILUSTRATIVA: no representa la evolución clínica de una persona concreta.
 */
import type { LayerKey } from './layers'

export interface DKey { p: number; color: string; glow?: number; scale?: number; opacity?: number }
export interface DTarget { layer: LayerKey; re: RegExp; label: string; keys: DKey[] }
export interface DStage { p: number; label: string; text: string }
export interface DiseaseDef {
  id: string
  name: string
  icd10: string
  system: string
  summary: string
  layers: LayerKey[]
  skinOpacity: number
  stages: DStage[]
  targets: DTarget[]
}

const k = (p: number, color: string, glow = 0.5, scale = 1, opacity = 1): DKey => ({ p, color, glow, scale, opacity })
// Cadena de prueba: `${zname}|${zgroup}`
const LIVER = /segment of liver|^Liver\|/i
const LUNGS = /lobe of (right|left) lung/i
const KIDNEYS = /^Kidney\.[lr]\|/i
const BRAIN = (lobes: string, side = '[lr]') => new RegExp(`\\.${side}\\|(${lobes}) lobe\\.g`, 'i')

export const DISEASES: DiseaseDef[] = [
  {
    id: 'cad', name: 'Cardiopatía isquémica (aterosclerosis coronaria)', icd10: 'I25.10', system: 'Cardiovascular',
    summary: 'Acumulación progresiva de placas de grasa y calcio en las arterias coronarias que reduce el flujo de sangre al corazón.',
    layers: ['arteries', 'organs'], skinOpacity: 0.12,
    stages: [
      { p: 0, label: 'Endotelio sano', text: 'Arterias coronarias permeables y elásticas.' },
      { p: 0.2, label: 'Estrías grasas', text: 'Depósitos de colesterol LDL bajo la pared arterial; sin síntomas.' },
      { p: 0.45, label: 'Placa fibrosa', text: 'La placa crece y endurece la pared; también se afecta la aorta.' },
      { p: 0.7, label: 'Estenosis significativa', text: 'Reducción importante de la luz arterial: angina con el esfuerzo.' },
      { p: 0.88, label: 'Infarto de miocardio', text: 'Rotura de placa y trombo: zona del ventrículo izquierdo sin riego.' },
    ],
    targets: [
      { layer: 'arteries', label: 'Arterias coronarias', re: /coronary artery|interventricular artery|Circumflex artery of heart|Arteries of heart/i,
        keys: [k(0.05, '#d9a03a', 0.3), k(0.45, '#f5c542', 0.7, 1.15), k(0.75, '#ffe08a', 1, 1.25)] },
      { layer: 'arteries', label: 'Aorta', re: /^(Ascending aorta|Aortic arch|Thoracic aorta|Abdominal aorta|Aortic bifurcation)\|/i,
        keys: [k(0.3, '#c8323c', 0.1), k(0.8, '#e0a84a', 0.5)] },
      { layer: 'organs', label: 'Ventrículo izquierdo', re: /^(Left ventricle|.*papillary muscle of left ventricle)\|/i,
        keys: [k(0.82, '#a8303a', 0.2), k(0.95, '#3a0d12', 0.9)] },
    ],
  },
  {
    id: 'hta', name: 'Hipertensión arterial', icd10: 'I10', system: 'Cardiovascular',
    summary: 'Presión elevada y sostenida en las arterias que, con los años, daña vasos, corazón, riñones y ojos.',
    layers: ['arteries', 'organs'], skinOpacity: 0.12,
    stages: [
      { p: 0, label: 'Presión normal', text: 'Arterias con elasticidad conservada.' },
      { p: 0.25, label: 'Rigidez arterial', text: 'Las arterias pierden elasticidad y la presión se mantiene alta.' },
      { p: 0.5, label: 'Hipertrofia cardiaca', text: 'El ventrículo izquierdo engrosa su pared para vencer la resistencia.' },
      { p: 0.72, label: 'Nefropatía', text: 'Daño de los pequeños vasos renales; disminuye la filtración.' },
      { p: 0.88, label: 'Daño de órganos diana', text: 'Retinopatía y riesgo alto de infarto o accidente cerebrovascular.' },
    ],
    targets: [
      { layer: 'arteries', label: 'Arterias sistémicas', re: /^(?!.*[Pp]ulmonary).*/, keys: [k(0.1, '#c8323c', 0.05), k(0.6, '#ff4d5e', 0.55)] },
      { layer: 'organs', label: 'Ventrículo izquierdo', re: /^(Left ventricle|.*of left ventricle)\|/i, keys: [k(0.35, '#a8303a', 0.2), k(0.8, '#d0404c', 0.6, 1.2)] },
      { layer: 'organs', label: 'Riñones', re: KIDNEYS, keys: [k(0.6, '#8a3530', 0.2), k(1, '#5c2a2a', 0.7, 0.9)] },
      { layer: 'organs', label: 'Globos oculares', re: /Eyeball\.g/i, keys: [k(0.8, '#e6e0d8', 0.2), k(1, '#e05050', 0.8)] },
    ],
  },
  {
    id: 'hf', name: 'Insuficiencia cardiaca', icd10: 'I50.9', system: 'Cardiovascular',
    summary: 'El corazón no bombea la sangre con suficiente fuerza; se dilata y se acumula líquido en pulmones e hígado.',
    layers: ['organs', 'veins'], skinOpacity: 0.12,
    stages: [
      { p: 0, label: 'Función conservada', text: 'Bombeo normal.' },
      { p: 0.3, label: 'Remodelado', text: 'Las cavidades cardiacas se dilatan para compensar.' },
      { p: 0.55, label: 'Congestión pulmonar', text: 'El líquido retrocede a los pulmones: falta de aire.' },
      { p: 0.8, label: 'Congestión sistémica', text: 'Hígado aumentado de tamaño y venas distendidas; edemas.' },
    ],
    targets: [
      { layer: 'organs', label: 'Corazón', re: /\|Heart\.g|^(Left|Right) (ventricle|atrium)/i, keys: [k(0.1, '#a8303a', 0.1), k(0.6, '#c0392b', 0.5, 1.18), k(1, '#7a1f2b', 0.8, 1.3)] },
      { layer: 'organs', label: 'Pulmones', re: LUNGS, keys: [k(0.5, '#e39a9a', 0.1), k(0.85, '#6c7fb8', 0.6)] },
      { layer: 'organs', label: 'Hígado', re: LIVER, keys: [k(0.75, '#7b2d24', 0.1), k(1, '#9b3d55', 0.6, 1.12)] },
      { layer: 'veins', label: 'Venas cavas y yugulares', re: /vena cava|jugular vein/i, keys: [k(0.75, '#3f5fbf', 0.2), k(1, '#6a8dff', 0.8, 1.3)] },
    ],
  },
  {
    id: 'dm2', name: 'Diabetes mellitus tipo 2', icd10: 'E11', system: 'Endocrino y metabólico',
    summary: 'Resistencia a la insulina y glucosa elevada que daña con el tiempo vasos pequeños y grandes, nervios, riñones y ojos.',
    layers: ['organs', 'arteries', 'nerves'], skinOpacity: 0.12,
    stages: [
      { p: 0, label: 'Metabolismo normal', text: 'El páncreas regula la glucosa con normalidad.' },
      { p: 0.2, label: 'Resistencia a la insulina', text: 'El páncreas trabaja de más para mantener la glucosa.' },
      { p: 0.4, label: 'Diabetes establecida', text: 'Glucosa alta sostenida; daño vascular incipiente.' },
      { p: 0.6, label: 'Microangiopatía', text: 'Nefropatía y retinopatía diabéticas.' },
      { p: 0.8, label: 'Neuropatía y pie diabético', text: 'Pérdida de sensibilidad y mala circulación en piernas y pies.' },
    ],
    targets: [
      { layer: 'organs', label: 'Páncreas', re: /^Pancreas\||\|Pancreas$/i, keys: [k(0.05, '#e8c07a', 0.3), k(0.5, '#f39c12', 0.9, 1.05), k(1, '#9c6b1f', 0.6, 0.92)] },
      { layer: 'organs', label: 'Riñones', re: KIDNEYS, keys: [k(0.55, '#8a3530', 0.2), k(0.9, '#8e44ad', 0.7)] },
      { layer: 'organs', label: 'Retinas', re: /Eyeball\.g/i, keys: [k(0.6, '#e6e0d8', 0.2), k(0.85, '#e74c3c', 0.9)] },
      { layer: 'arteries', label: 'Arterias de las piernas', re: /tibial artery|Popliteal artery|Dorsalis pedis|plantar|fibular artery/i, keys: [k(0.4, '#c8323c', 0.1), k(0.9, '#5a2a2a', 0.6)] },
      { layer: 'nerves', label: 'Nervios de los pies', re: /plantar|Sural|digital branches of (deep|superficial) fibular|Tibial nerve/i, keys: [k(0.7, '#f0d264', 0.2), k(1, '#ff6b2d', 1)] },
    ],
  },
  {
    id: 'liver', name: 'Hígado graso → cirrosis', icd10: 'K74.60', system: 'Digestivo',
    summary: 'Acumulación de grasa en el hígado que puede inflamarlo (esteatohepatitis), cicatrizarlo (fibrosis) y terminar en cirrosis.',
    layers: ['organs', 'veins'], skinOpacity: 0.12,
    stages: [
      { p: 0, label: 'Hígado sano', text: 'Tamaño y coloración normales.' },
      { p: 0.2, label: 'Esteatosis', text: 'Grasa en los hepatocitos: hígado aumentado y amarillento (reversible).' },
      { p: 0.45, label: 'Esteatohepatitis', text: 'Inflamación y daño celular.' },
      { p: 0.65, label: 'Fibrosis', text: 'Tejido cicatricial que endurece el órgano.' },
      { p: 0.82, label: 'Cirrosis', text: 'Hígado pequeño y nodular; hipertensión portal y bazo agrandado.' },
    ],
    targets: [
      { layer: 'organs', label: 'Hígado', re: LIVER, keys: [k(0.05, '#a0522d', 0.1), k(0.3, '#f5d76e', 0.5, 1.15), k(0.55, '#e67e22', 0.8, 1.12), k(0.75, '#8b5a2b', 0.5, 0.95), k(1, '#5a3a1e', 0.6, 0.78)] },
      { layer: 'organs', label: 'Bazo', re: /^Spleen\|/i, keys: [k(0.75, '#6d2a3c', 0.1), k(1, '#a83279', 0.7, 1.4)] },
      { layer: 'veins', label: 'Sistema porta', re: /portal vein|Splenic vein|mesenteric vein/i, keys: [k(0.78, '#3f5fbf', 0.2), k(1, '#8e44ad', 0.9, 1.3)] },
    ],
  },
  {
    id: 'copd', name: 'EPOC / enfisema pulmonar', icd10: 'J44.9', system: 'Respiratorio',
    summary: 'Inflamación crónica de los bronquios y destrucción de los alvéolos, casi siempre por tabaco; el aire queda atrapado.',
    layers: ['organs'], skinOpacity: 0.12,
    stages: [
      { p: 0, label: 'Pulmón sano', text: 'Bronquios y alvéolos normales.' },
      { p: 0.25, label: 'Bronquitis crónica', text: 'Inflamación y moco en los bronquios: tos persistente.' },
      { p: 0.5, label: 'Enfisema', text: 'Destrucción de alvéolos; pulmones hiperinsuflados.' },
      { p: 0.8, label: 'Cor pulmonale', text: 'El ventrículo derecho se sobrecarga y se dilata.' },
    ],
    targets: [
      { layer: 'organs', label: 'Tráquea y bronquios', re: /Trachea|bronch/i, keys: [k(0.05, '#e3e8ea', 0.2), k(0.4, '#e67e22', 0.9, 1.08)] },
      { layer: 'organs', label: 'Pulmones', re: LUNGS, keys: [k(0.35, '#e39a9a', 0.1), k(0.75, '#9ca3af', 0.5, 1.12), k(1, '#4b5563', 0.6, 1.18, 0.85)] },
      { layer: 'organs', label: 'Ventrículo derecho', re: /^(Right ventricle|.*of right ventricle)\|/i, keys: [k(0.75, '#a8303a', 0.2), k(1, '#d0404c', 0.7, 1.22)] },
    ],
  },
  {
    id: 'lungca', name: 'Cáncer de pulmón con metástasis', icd10: 'C34.90', system: 'Oncología',
    summary: 'Tumor maligno que suele iniciarse en un bronquio o lóbulo y puede diseminarse a ganglios, hígado, huesos y cerebro.',
    layers: ['organs', 'skeleton'], skinOpacity: 0.1,
    stages: [
      { p: 0, label: 'Sin lesión', text: 'Tejido pulmonar normal.' },
      { p: 0.15, label: 'Estadio I', text: 'Tumor localizado en el lóbulo superior derecho.' },
      { p: 0.35, label: 'Estadio II', text: 'Crece e invade el bronquio principal.' },
      { p: 0.55, label: 'Estadio III', text: 'Extensión al resto del pulmón y al pulmón contralateral.' },
      { p: 0.75, label: 'Estadio IV', text: 'Metástasis a distancia: hígado, glándulas suprarrenales, vértebras y cerebro.' },
    ],
    targets: [
      { layer: 'organs', label: 'Lóbulo superior derecho', re: /^Superior lobe of right lung/i, keys: [k(0.08, '#e39a9a', 0.3), k(0.3, '#6b1f4f', 1)] },
      { layer: 'organs', label: 'Bronquio principal derecho', re: /Right main bronchus|bronchus of right lung/i, keys: [k(0.3, '#e3e8ea', 0.3), k(0.5, '#6b1f4f', 1)] },
      { layer: 'organs', label: 'Pulmón derecho', re: /(Middle|Inferior) lobe of right lung/i, keys: [k(0.45, '#e39a9a', 0.2), k(0.65, '#7d2a5c', 0.9)] },
      { layer: 'organs', label: 'Pulmón izquierdo', re: /lobe of left lung/i, keys: [k(0.55, '#e39a9a', 0.2), k(0.75, '#8e3b6e', 0.8)] },
      { layer: 'organs', label: 'Hígado (metástasis)', re: LIVER, keys: [k(0.72, '#7b2d24', 0.2), k(0.88, '#5b2c6f', 0.9)] },
      { layer: 'organs', label: 'Glándulas suprarrenales', re: /Suprarenal gland/i, keys: [k(0.75, '#d9a55e', 0.2), k(0.9, '#5b2c6f', 1, 1.3)] },
      { layer: 'skeleton', label: 'Vértebras (metástasis óseas)', re: /^Vertebra [TL]\d/i, keys: [k(0.8, '#e8e0cc', 0.2), k(0.95, '#8e44ad', 0.9)] },
      { layer: 'organs', label: 'Cerebro (metástasis)', re: /lobe\.g/i, keys: [k(0.86, '#e2b6ae', 0.2), k(1, '#8e44ad', 0.7)] },
    ],
  },
  {
    id: 'stroke', name: 'Accidente cerebrovascular isquémico', icd10: 'I63.9', system: 'Neurológico',
    summary: 'Un coágulo obstruye una arteria cerebral (aquí la cerebral media izquierda) y el tejido que irriga queda sin oxígeno.',
    layers: ['organs', 'arteries'], skinOpacity: 0.1,
    stages: [
      { p: 0, label: 'Flujo normal', text: 'Arteria cerebral media permeable.' },
      { p: 0.15, label: 'Oclusión arterial', text: 'Un trombo bloquea la arteria cerebral media izquierda.' },
      { p: 0.4, label: 'Penumbra isquémica', text: 'Tejido en riesgo que aún puede recuperarse si se trata a tiempo.' },
      { p: 0.7, label: 'Infarto cerebral', text: 'Muerte neuronal en zonas frontal, parietal y temporal izquierdas: alteración del habla y debilidad del lado derecho.' },
    ],
    targets: [
      { layer: 'arteries', label: 'Arteria cerebral media izquierda', re: /\|.*Middle cerebral artery.*\.l$|^Middle cerebral artery.*\.l\|/i, keys: [k(0.05, '#c8323c', 0.3), k(0.2, '#1f2937', 0.9)] },
      { layer: 'organs', label: 'Lóbulo temporal y parietal izq.', re: BRAIN('Temporal|Parietal', 'l'), keys: [k(0.3, '#e2b6ae', 0.2), k(0.55, '#f39c12', 0.8), k(0.85, '#7f1d1d', 0.9, 0.97)] },
      { layer: 'organs', label: 'Lóbulo frontal izq.', re: BRAIN('Frontal', 'l'), keys: [k(0.45, '#e8b8b0', 0.2), k(0.7, '#f39c12', 0.8), k(1, '#7f1d1d', 0.9, 0.97)] },
    ],
  },
  {
    id: 'alz', name: 'Enfermedad de Alzheimer', icd10: 'G30.9', system: 'Neurológico',
    summary: 'Neurodegeneración progresiva que comienza en el hipocampo y el sistema límbico (memoria) y se extiende a toda la corteza, con atrofia cerebral.',
    layers: ['organs'], skinOpacity: 0.1,
    stages: [
      { p: 0, label: 'Cerebro sano', text: 'Volumen cerebral normal.' },
      { p: 0.2, label: 'Preclínica / leve', text: 'Placas amiloides y ovillos tau en el sistema límbico; olvidos recientes.' },
      { p: 0.45, label: 'Moderada', text: 'Afecta los lóbulos temporal y parietal: desorientación y problemas de lenguaje.' },
      { p: 0.75, label: 'Grave', text: 'Atrofia cortical generalizada, incluido el lóbulo frontal; dependencia total.' },
    ],
    targets: [
      { layer: 'organs', label: 'Sistema límbico', re: BRAIN('Limbic'), keys: [k(0.05, '#e0a8a0', 0.2), k(0.4, '#8e6fbf', 0.9, 0.9), k(1, '#4c3575', 0.7, 0.82)] },
      { layer: 'organs', label: 'Lóbulo temporal', re: BRAIN('Temporal'), keys: [k(0.3, '#e6bca6', 0.2), k(0.65, '#8e6fbf', 0.8, 0.94), k(1, '#4c3575', 0.6, 0.88)] },
      { layer: 'organs', label: 'Lóbulo parietal', re: BRAIN('Parietal'), keys: [k(0.45, '#e3b3b8', 0.2), k(0.8, '#8e6fbf', 0.8, 0.95), k(1, '#4c3575', 0.6, 0.9)] },
      { layer: 'organs', label: 'Lóbulo frontal', re: BRAIN('Frontal'), keys: [k(0.65, '#e8b8b0', 0.2), k(1, '#6a4c9c', 0.7, 0.92)] },
    ],
  },
  {
    id: 'osteo', name: 'Osteoporosis', icd10: 'M81.0', system: 'Musculoesquelético',
    summary: 'Pérdida de masa y calidad ósea que vuelve frágiles los huesos, sobre todo vértebras, cadera, fémur y muñeca.',
    layers: ['skeleton'], skinOpacity: 0.1,
    stages: [
      { p: 0, label: 'Hueso sano', text: 'Densidad mineral normal.' },
      { p: 0.25, label: 'Osteopenia', text: 'Disminuye la densidad ósea sin fracturas.' },
      { p: 0.55, label: 'Osteoporosis', text: 'Hueso poroso en columna, cadera y muñeca.' },
      { p: 0.85, label: 'Fractura por fragilidad', text: 'Aplastamiento vertebral lumbar ante esfuerzos mínimos.' },
    ],
    targets: [
      { layer: 'skeleton', label: 'Vértebras', re: /^Vertebra [TL]\d|^(Atlas|Axis)/i, keys: [k(0.05, '#e8e0cc', 0.1), k(0.6, '#b9a98a', 0.4, 1, 0.55)] },
      { layer: 'skeleton', label: 'Huesos de la cadera', re: /^Hip bone/i, keys: [k(0.3, '#e8e0cc', 0.1), k(0.75, '#b9a98a', 0.4, 1, 0.55)] },
      { layer: 'skeleton', label: 'Fémures', re: /^Femur/i, keys: [k(0.4, '#e8e0cc', 0.1), k(0.8, '#b9a98a', 0.4, 1, 0.6)] },
      { layer: 'skeleton', label: 'Radios (muñeca)', re: /^Radius/i, keys: [k(0.45, '#e8e0cc', 0.1), k(0.85, '#b9a98a', 0.4, 1, 0.6)] },
      { layer: 'skeleton', label: 'Vértebra L1 (fractura)', re: /^Vertebra L1\|/i, keys: [k(0.82, '#b9a98a', 0.4, 1, 0.6), k(0.95, '#e74c3c', 1, 0.82, 0.9)] },
    ],
  },
  {
    id: 'oa', name: 'Artrosis de rodilla', icd10: 'M17.9', system: 'Musculoesquelético',
    summary: 'Desgaste del cartílago articular de la rodilla con inflamación, dolor y deformidad progresiva.',
    layers: ['skeleton', 'muscles'], skinOpacity: 0.1,
    stages: [
      { p: 0, label: 'Articulación sana', text: 'Cartílago íntegro.' },
      { p: 0.3, label: 'Leve', text: 'Adelgazamiento del cartílago y dolor al subir escaleras.' },
      { p: 0.6, label: 'Moderada', text: 'Inflamación, osteofitos y rigidez matutina.' },
      { p: 0.85, label: 'Avanzada', text: 'Contacto hueso con hueso; atrofia del cuádriceps.' },
    ],
    targets: [
      { layer: 'skeleton', label: 'Rótulas', re: /^Patella/i, keys: [k(0.1, '#e8e0cc', 0.3), k(0.6, '#f97316', 1), k(1, '#b91c1c', 1)] },
      { layer: 'skeleton', label: 'Tibias', re: /^Tibia/i, keys: [k(0.25, '#e8e0cc', 0.2), k(0.85, '#ea580c', 0.7)] },
      { layer: 'skeleton', label: 'Fémures', re: /^Femur/i, keys: [k(0.3, '#e8e0cc', 0.2), k(0.9, '#ea580c', 0.6)] },
      { layer: 'muscles', label: 'Cuádriceps', re: /Rectus femoris|Vastus/i, keys: [k(0.75, '#b8433c', 0.1), k(1, '#7c4a42', 0.2, 0.9)] },
    ],
  },
  {
    id: 'ckd', name: 'Enfermedad renal crónica', icd10: 'N18.9', system: 'Urinario',
    summary: 'Pérdida progresiva e irreversible de la función de los riñones, que se vuelven pequeños y fibrosos.',
    layers: ['organs', 'arteries'], skinOpacity: 0.12,
    stages: [
      { p: 0, label: 'Función normal', text: 'Filtración glomerular conservada.' },
      { p: 0.25, label: 'Estadios 1–2', text: 'Daño renal con filtración casi normal.' },
      { p: 0.5, label: 'Estadio 3', text: 'Filtración moderadamente reducida; anemia y presión alta.' },
      { p: 0.85, label: 'Estadios 4–5', text: 'Riñones atróficos: puede requerir diálisis o trasplante. Repercusión cardiaca.' },
    ],
    targets: [
      { layer: 'organs', label: 'Riñones', re: KIDNEYS, keys: [k(0.05, '#8a3530', 0.2), k(0.5, '#b5651d', 0.8, 0.92), k(1, '#4a2a22', 0.6, 0.72)] },
      { layer: 'arteries', label: 'Arterias renales', re: /renal arter|Intrarenal arteries/i, keys: [k(0.3, '#c8323c', 0.2), k(0.9, '#5a2a2a', 0.6)] },
      { layer: 'organs', label: 'Ventrículo izquierdo', re: /^(Left ventricle|.*of left ventricle)\|/i, keys: [k(0.7, '#a8303a', 0.2), k(1, '#d0404c', 0.6, 1.15)] },
    ],
  },
  {
    id: 'crc', name: 'Cáncer colorrectal', icd10: 'C18.9', system: 'Oncología',
    summary: 'Tumor que suele originarse en un pólipo del colon sigmoide y puede extenderse al resto del colon, hígado y pulmones.',
    layers: ['organs'], skinOpacity: 0.1,
    stages: [
      { p: 0, label: 'Mucosa normal', text: 'Colon sin lesiones.' },
      { p: 0.15, label: 'Pólipo / estadio I', text: 'Lesión localizada en el colon sigmoide.' },
      { p: 0.4, label: 'Estadios II–III', text: 'Invade la pared y se extiende por el colon.' },
      { p: 0.7, label: 'Estadio IV', text: 'Metástasis hepáticas y pulmonares.' },
    ],
    targets: [
      { layer: 'organs', label: 'Colon sigmoide', re: /^Sigmoid colon/i, keys: [k(0.08, '#e09a86', 0.3), k(0.35, '#6b1f4f', 1)] },
      { layer: 'organs', label: 'Colon descendente y transverso', re: /^(Descending|Transverse) colon/i, keys: [k(0.35, '#e09a86', 0.2), k(0.6, '#7d2a5c', 0.9)] },
      { layer: 'organs', label: 'Hígado (metástasis)', re: LIVER, keys: [k(0.65, '#7b2d24', 0.2), k(0.85, '#5b2c6f', 0.9)] },
      { layer: 'organs', label: 'Pulmones (metástasis)', re: LUNGS, keys: [k(0.8, '#e39a9a', 0.2), k(1, '#8e3b6e', 0.7)] },
    ],
  },
  {
    id: 'disc', name: 'Hernia discal lumbar con ciática', icd10: 'M51.16', system: 'Musculoesquelético y nervioso',
    summary: 'El disco entre las vértebras L4–L5 se desplaza y comprime la raíz nerviosa, con dolor irradiado por el nervio ciático.',
    layers: ['skeleton', 'nerves'], skinOpacity: 0.1,
    stages: [
      { p: 0, label: 'Columna sana', text: 'Discos intervertebrales íntegros.' },
      { p: 0.25, label: 'Degeneración discal', text: 'El disco L4–L5 pierde hidratación y altura.' },
      { p: 0.5, label: 'Hernia', text: 'Protrusión del núcleo que comprime la raíz nerviosa.' },
      { p: 0.75, label: 'Ciática', text: 'Dolor y hormigueo irradiados por el nervio ciático hasta el pie.' },
    ],
    targets: [
      { layer: 'skeleton', label: 'Vértebras L4–L5', re: /^Vertebra L[45]\|/i, keys: [k(0.1, '#e8e0cc', 0.3), k(0.5, '#f97316', 1)] },
      { layer: 'nerves', label: 'Nervio ciático', re: /^Sciatic nerve/i, keys: [k(0.45, '#f0d264', 0.3), k(0.7, '#ff3b30', 1.2, 1.15)] },
      { layer: 'nerves', label: 'Nervios tibial y peroneo', re: /^(Tibial nerve|Common fibular nerve)/i, keys: [k(0.6, '#f0d264', 0.3), k(0.85, '#ff3b30', 1.1)] },
      { layer: 'nerves', label: 'Nervios del pie', re: /plantar|Sural nerve|fibular nerve/i, keys: [k(0.75, '#f0d264', 0.3), k(1, '#ff6b2d', 1)] },
    ],
  },
]

export const DISEASE_BY_ID = Object.fromEntries(DISEASES.map((d) => [d.id, d])) as Record<string, DiseaseDef>

export interface DState { c0: string; c1: string; f: number; glow: number; scale: number; opacity: number }

/** Interpola el estado visual de un objetivo para un avance p (null = aún no afectado). */
export function stateAt(t: DTarget, p: number): DState | null {
  const ks = t.keys
  if (!ks.length || p < ks[0].p) return null
  let a = ks[0], b = ks[0]
  for (let i = 0; i < ks.length; i++) { if (ks[i].p <= p) { a = ks[i]; b = ks[i + 1] || ks[i] } }
  const f = b.p > a.p ? Math.min(1, (p - a.p) / (b.p - a.p)) : 1
  const lerp = (x = 1, y = 1) => x + (y - x) * f
  return { c0: a.color, c1: b.color, f, glow: lerp(a.glow, b.glow), scale: lerp(a.scale, b.scale), opacity: lerp(a.opacity, b.opacity) }
}

export function stageAt(d: DiseaseDef, p: number) {
  let s = d.stages[0]
  for (const st of d.stages) if (p >= st.p) s = st
  return s
}
