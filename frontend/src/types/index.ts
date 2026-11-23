export type Role = 'admin' | 'specialist' | 'viewer' | 'patient'

export interface Me {
  id: string
  email: string
  full_name: string
  role: Role
  status: string
  organization_id: string
  organization_name: string
  permissions: string[]
  created_at: string
  last_login_at: string | null
}

export interface UserRow {
  id: string
  email: string
  full_name: string
  role: Role
  status: 'active' | 'disabled'
  created_at: string
  last_login_at: string | null
}

export interface Page<T> { items: T[]; total: number; limit: number; offset: number }

export interface LatestMetric { value: number; unit: string; measured_at: string; method: string; source_type: string }

export interface Profile {
  id: string
  display_code: string
  display_name: string
  sex: 'M' | 'F'
  birth_date: string | null
  notes: string
  status: 'active' | 'archived' | 'restricted'
  is_demo: boolean
  created_at: string
  updated_at: string
  access_level: 'owner' | 'editor' | 'viewer' | null
  consent_image: boolean
  latest: Record<string, LatestMetric>
  measurement_count: number
  analysis_count: number
}

export interface MetricDef { code: string; label: string; unit: string; min: number; max: number; decimals: number; instructions: string; group: string }

export interface Measurement {
  id: string
  profile_id: string
  metric_code: string
  value: number
  unit: string
  method: 'manual' | 'device' | 'visual_estimate'
  source_type: string
  measured_at: string
  notes: string
  status: 'active' | 'superseded'
  supersedes_id: string | null
  correction_reason: string
  created_by: string | null
  created_at: string
}

export interface Consent {
  id: string
  profile_id: string
  purpose: 'image_processing' | 'data_processing' | 'report_sharing'
  policy_version: string
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  accepted_at: string | null
  revoked_at: string | null
  expires_at: string | null
  evidence: string
  created_at: string
}

export interface MediaAsset {
  id: string
  profile_id: string
  mime_type: string
  checksum: string
  size_bytes: number
  width: number
  height: number
  capture_view: string
  status: string
  retention_until: string | null
  created_at: string
}

export interface LM { x: number; y: number; z: number; visibility?: number | null; presence?: number | null }
export interface PoseFrame { t: number; landmarks: LM[]; world_landmarks?: LM[] | null }
export interface QualityFlag { code: string; severity: 'info' | 'warning' | 'critical'; message: string }

export interface PoseAnalysis {
  id: string
  media_asset_id: string
  profile_id: string
  engine: string
  model_name: string
  model_version: string
  config_json: Record<string, unknown>
  mode: 'image' | 'sequence'
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'needs_review'
  landmarks_json: LM[] | null
  world_landmarks_json: LM[] | null
  frames_json: PoseFrame[] | null
  quality_flags: QualityFlag[]
  quality_score: number | null
  metrics_json: Record<string, any>
  review_status: 'pending' | 'approved' | 'rejected'
  review_notes: string
  reviewed_at: string | null
  error: string
  created_at: string
  completed_at: string | null
}

export interface PoseSummary {
  id: string
  media_asset_id: string
  profile_id: string
  engine: string
  model_version: string
  mode: string
  status: PoseAnalysis['status']
  quality_score: number | null
  quality_flags: QualityFlag[]
  review_status: string
  created_at: string
  profile_code?: string
}

export interface Simulation {
  id: string
  profile_id: string
  title: string
  base_reference: Record<string, any>
  parameters_json: { target_weight_kg: number; body_fat_delta_pct: number; muscle_delta_pct: number }
  engine_version: string
  output_metadata: Record<string, any>
  status: string
  illustrative_only: boolean
  created_at: string
}

export interface ReportRow {
  id: string
  profile_id: string
  report_type: 'pdf' | 'csv'
  period_from: string | null
  period_to: string | null
  checksum: string
  size_bytes: number
  source_refs: Record<string, any>
  created_at: string
  profile_code: string
}

export interface AuditRow {
  id: string
  actor_id: string | null
  actor_email: string
  action: string
  resource_type: string
  resource_id: string
  outcome: string
  details: Record<string, any>
  ip: string
  correlation_id: string
  created_at: string
}

export interface BodyModels {
  assets: { asset_key: string; layer: string; format: string; model_version: string; license_ref: string; checksum: string; size_bytes: number; meta: Record<string, any> }[]
  reconstruction: {
    source_type: string; label: string; engine: string; sex: 'M' | 'F'; height_cm: number | null; weight_kg: number | null
    bmi: number | null; fat_index: number; body_fat_pct: number | null; muscle_pct: number | null; source_dates: Record<string, string>
  }
  landmarks: { analysis_id: string; world: LM[]; created_at: string; model_version: string; label: string } | null
}

export interface DashboardSummary {
  kpis: { profiles: number; measurements: number; analyses: number; avg_quality: number | null; simulations: number }
  trend: { month: string; peso?: number; imc?: number; grasa?: number }[]
  composition: { fat_pct: number; lean_pct: number; muscle_pct: number | null; profiles: number; source: string } | null
  activity: { id: string; action: string; label: string; actor: string; outcome: string; created_at: string; resource_type: string }[]
}
