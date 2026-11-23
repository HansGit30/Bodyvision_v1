"""Contratos Pydantic (DTO) de entrada y salida."""
from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Annotated, Any, Generic, Literal, TypeVar

from pydantic import AfterValidator, BaseModel, ConfigDict, EmailStr, Field, field_validator


def _aware(v: datetime | None) -> datetime | None:
    """Fechas sin zona horaria se interpretan como UTC (ISO 8601 coherente)."""
    if v is None:
        return None
    return v.replace(tzinfo=UTC) if v.tzinfo is None else v


AwareDT = Annotated[datetime, AfterValidator(_aware)]

T = TypeVar("T")


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int


# ------------------------------------------------------------------ auth / users
class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class UserOut(ORM):
    id: str
    email: str
    full_name: str
    role: str
    status: str
    organization_id: str
    created_at: datetime
    last_login_at: datetime | None = None


class MeOut(UserOut):
    permissions: list[str]
    organization_name: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: MeOut


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2, max_length=160)
    password: str = Field(min_length=8, max_length=128)
    role: Literal["admin", "specialist", "viewer", "patient"] = "specialist"


class UserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=160)
    role: Literal["admin", "specialist", "viewer", "patient"] | None = None
    status: Literal["active", "disabled"] | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)


# ------------------------------------------------------------------ profiles
class ProfileCreate(BaseModel):
    display_name: str = Field(min_length=2, max_length=160)
    sex: Literal["M", "F"]
    birth_date: date | None = None
    notes: str = Field(default="", max_length=2000)
    display_code: str | None = Field(default=None, max_length=32, pattern=r"^[A-Za-z0-9\-_]{3,32}$")

    @field_validator("birth_date")
    @classmethod
    def _bd(cls, v: date | None) -> date | None:
        if v and (v > date.today() or v.year < 1900):
            raise ValueError("Fecha de nacimiento fuera de rango")
        return v


class ProfileUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=2, max_length=160)
    sex: Literal["M", "F"] | None = None
    birth_date: date | None = None
    notes: str | None = Field(default=None, max_length=2000)
    status: Literal["active", "archived", "restricted"] | None = None


class LatestMetric(BaseModel):
    value: float
    unit: str
    measured_at: datetime
    method: str
    source_type: str = "observed_manual"


class ProfileOut(ORM):
    id: str
    display_code: str
    display_name: str
    sex: str
    birth_date: date | None
    notes: str
    status: str
    is_demo: bool
    created_at: datetime
    updated_at: datetime
    access_level: str | None = None
    consent_image: bool = False
    latest: dict[str, LatestMetric] = {}
    measurement_count: int = 0
    analysis_count: int = 0


class AccessGrant(BaseModel):
    user_id: str
    access_level: Literal["owner", "editor", "viewer"] = "viewer"
    expires_at: AwareDT | None = None


class AccessOut(ORM):
    id: str
    user_id: str
    access_level: str
    expires_at: datetime | None
    created_at: datetime
    user_email: str = ""
    user_name: str = ""


# ------------------------------------------------------------------ consent
class ConsentCreate(BaseModel):
    purpose: Literal["image_processing", "data_processing", "report_sharing"]
    policy_version: str = Field(default="1.0", max_length=20)
    accepted: bool = True
    evidence: str = Field(default="", max_length=1000)
    expires_at: AwareDT | None = None


class ConsentOut(ORM):
    id: str
    profile_id: str
    purpose: str
    policy_version: str
    status: str
    accepted_at: datetime | None
    revoked_at: datetime | None
    expires_at: datetime | None
    evidence: str
    created_at: datetime


# ------------------------------------------------------------------ measurements
class MeasurementCreate(BaseModel):
    metric_code: str = Field(max_length=32)
    value: float
    unit: str | None = Field(default=None, max_length=12)
    method: Literal["manual", "device", "visual_estimate"] = "manual"
    measured_at: AwareDT
    notes: str = Field(default="", max_length=1000)


class MeasurementCorrection(BaseModel):
    value: float
    measured_at: AwareDT | None = None
    reason: str = Field(min_length=3, max_length=500)


class MeasurementOut(ORM):
    id: str
    profile_id: str
    metric_code: str
    value: float
    unit: str
    method: str
    source_type: str
    measured_at: datetime
    notes: str
    status: str
    supersedes_id: str | None
    correction_reason: str
    created_by: str | None
    created_at: datetime


# ------------------------------------------------------------------ media / pose
class MediaOut(ORM):
    id: str
    profile_id: str
    mime_type: str
    checksum: str
    size_bytes: int
    width: int
    height: int
    capture_view: str
    status: str
    retention_until: datetime | None
    created_at: datetime


class SignedUrlOut(BaseModel):
    url: str
    expires_at: int


class Landmark(BaseModel):
    x: float
    y: float
    z: float = 0.0
    visibility: float | None = None
    presence: float | None = None


class PoseFrame(BaseModel):
    t: float = Field(ge=0, le=600)
    landmarks: list[Landmark] = Field(min_length=33, max_length=33)
    world_landmarks: list[Landmark] | None = None


class PoseAnalysisCreate(BaseModel):
    engine: str = Field(default="mediapipe-tasks-vision", max_length=60)
    model_name: str = Field(default="pose_landmarker_full", max_length=80)
    model_version: str = Field(default="float16/1", max_length=40)
    config: dict[str, Any] = {}
    mode: Literal["image", "sequence"] = "image"
    landmarks: list[Landmark] | None = Field(default=None, max_length=33)
    world_landmarks: list[Landmark] | None = Field(default=None, max_length=33)
    frames: list[PoseFrame] | None = Field(default=None, max_length=240)
    capture_view: Literal["frontal", "posterior", "lateral"] = "frontal"


class PoseReview(BaseModel):
    decision: Literal["approved", "rejected"]
    notes: str = Field(default="", max_length=1000)


class PoseAnalysisOut(ORM):
    id: str
    media_asset_id: str
    profile_id: str
    engine: str
    model_name: str
    model_version: str
    config_json: dict[str, Any]
    mode: str
    status: str
    landmarks_json: list[Any] | None
    world_landmarks_json: list[Any] | None
    frames_json: list[Any] | None
    quality_flags: list[Any]
    quality_score: float | None
    metrics_json: dict[str, Any]
    review_status: str
    review_notes: str
    reviewed_at: datetime | None
    error: str
    created_at: datetime
    completed_at: datetime | None


class PoseAnalysisSummary(ORM):
    id: str
    media_asset_id: str
    profile_id: str
    engine: str
    model_version: str
    mode: str
    status: str
    quality_score: float | None
    quality_flags: list[Any]
    review_status: str
    created_at: datetime
    profile_code: str = ""


# ------------------------------------------------------------------ simulations
class SimulationParams(BaseModel):
    target_weight_kg: float = Field(ge=25, le=300)
    body_fat_delta_pct: float = Field(default=0, ge=-30, le=30)
    muscle_delta_pct: float = Field(default=0, ge=-30, le=30)


class SimulationCreate(BaseModel):
    title: str = Field(min_length=2, max_length=160)
    parameters: SimulationParams


class SimulationOut(ORM):
    id: str
    profile_id: str
    title: str
    base_reference: dict[str, Any]
    parameters_json: dict[str, Any]
    engine_version: str
    output_metadata: dict[str, Any]
    status: str
    illustrative_only: bool
    created_at: datetime


# ------------------------------------------------------------------ reports / audit
class ReportCreate(BaseModel):
    format: Literal["pdf", "csv"] = "pdf"
    period_from: date | None = None
    period_to: date | None = None


class ReportOut(ORM):
    id: str
    profile_id: str
    report_type: str
    period_from: date | None
    period_to: date | None
    checksum: str
    size_bytes: int
    source_refs: dict[str, Any]
    created_at: datetime
    profile_code: str = ""


class AuditOut(ORM):
    id: str
    actor_id: str | None
    actor_email: str
    action: str
    resource_type: str
    resource_id: str
    outcome: str
    details: dict[str, Any]
    ip: str
    correlation_id: str
    created_at: datetime
