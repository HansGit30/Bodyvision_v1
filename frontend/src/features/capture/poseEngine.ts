/**
 * MediaPipe Pose Landmarker (tasks-vision). WASM servido desde el mismo origen; modelo oficial
 * local si existe (/mediapipe/pose_landmarker_full.task) o desde el bucket oficial de Google.
 */
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision'

declare const __MP_VERSION__: string

const BASE = import.meta.env.BASE_URL
const LOCAL_MODEL = `${BASE}mediapipe/pose_landmarker_full.task`
const REMOTE_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task'

export interface EngineInfo {
  engine: string
  model_name: string
  model_version: string
  config: Record<string, unknown>
}

let loading: Promise<{ lm: PoseLandmarker; info: EngineInfo }> | null = null
let mode: 'VIDEO' | 'IMAGE' = 'VIDEO'

async function resolveModel(): Promise<[string, 'local' | 'remote']> {
  try {
    const r = await fetch(LOCAL_MODEL, { method: 'HEAD', cache: 'no-store' })
    const ct = r.headers.get('content-type') || ''
    if (r.ok && !ct.includes('html')) return [LOCAL_MODEL, 'local']
  } catch { /* sin modelo local */ }
  return [REMOTE_MODEL, 'remote']
}

export function getPoseEngine() {
  if (!loading) {
    loading = (async () => {
      const vision = await FilesetResolver.forVisionTasks(`${BASE}mediapipe`)
      const [modelAssetPath, source] = await resolveModel()
      const opts = (delegate: 'GPU' | 'CPU') => ({
        baseOptions: { modelAssetPath, delegate },
        runningMode: 'VIDEO' as const,
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      })
      let lm: PoseLandmarker
      let delegate: 'GPU' | 'CPU' = 'GPU'
      try {
        lm = await PoseLandmarker.createFromOptions(vision, opts('GPU'))
      } catch {
        delegate = 'CPU'
        lm = await PoseLandmarker.createFromOptions(vision, opts('CPU'))
      }
      mode = 'VIDEO'
      return {
        lm,
        info: {
          engine: 'mediapipe-tasks-vision',
          model_name: 'pose_landmarker_full',
          model_version: `float16/1 · tasks-vision ${__MP_VERSION__}`,
          config: { delegate, model_source: source, num_poses: 1, min_detection_confidence: 0.5, min_presence_confidence: 0.5, min_tracking_confidence: 0.5 },
        },
      }
    })()
    loading.catch(() => { loading = null })
  }
  return loading
}

export async function setMode(lm: PoseLandmarker, m: 'VIDEO' | 'IMAGE') {
  if (mode === m) return
  await lm.setOptions({ runningMode: m })
  mode = m
}
