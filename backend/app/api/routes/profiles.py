from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import access_level_for, get_profile_checked, require, visible_profile_ids_query
from app.core.errors import AppError
from app.db.session import get_db
from app.models import Consent, Measurement, PoseAnalysis, Profile, ProfileAccess, User
from app.repositories.measurements import latest_by_metric
from app.schemas import (
    AccessGrant,
    AccessOut,
    ConsentCreate,
    ConsentOut,
    LatestMetric,
    MeasurementCorrection,
    MeasurementCreate,
    MeasurementOut,
    Page,
    ProfileCreate,
    ProfileOut,
    ProfileUpdate,
)
from app.services import audit
from app.services.catalog import catalog_list, validate_value

router = APIRouter(tags=["expedientes"])


def has_active_consent(db: Session, profile_id: str, purpose: str) -> bool:
    now = datetime.now(UTC)
    c = db.scalar(select(Consent).where(
        Consent.profile_id == profile_id, Consent.purpose == purpose,
    ).order_by(Consent.created_at.desc(), Consent.id.desc()))
    return bool(c and c.status == "accepted" and (c.expires_at is None or c.expires_at > now))


def profile_out(db: Session, p: Profile, level: str | None) -> ProfileOut:
    latest = latest_by_metric(db, p.id)
    out = ProfileOut.model_validate(p)
    out.access_level = level
    out.consent_image = has_active_consent(db, p.id, "image_processing")
    out.latest = {k: LatestMetric(value=m.value, unit=m.unit, measured_at=m.measured_at, method=m.method, source_type=m.source_type) for k, m in latest.items()}
    out.measurement_count = db.scalar(select(func.count()).select_from(Measurement).where(Measurement.profile_id == p.id, Measurement.status == "active")) or 0
    out.analysis_count = db.scalar(select(func.count()).select_from(PoseAnalysis).where(PoseAnalysis.profile_id == p.id)) or 0
    return out


@router.get("/catalog/metrics")
def metrics_catalog(_: User = Depends(require("profiles:read"))):
    return catalog_list()


@router.get("/profiles", response_model=Page[ProfileOut])
def list_profiles(
    q: str | None = Query(default=None, max_length=80),
    status: str | None = Query(default=None, pattern="^(active|archived|restricted)$"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(require("profiles:read")),
    db: Session = Depends(get_db),
):
    base = select(Profile).where(Profile.id.in_(visible_profile_ids_query(user)))
    if q:
        like = f"%{q.lower()}%"
        base = base.where(or_(func.lower(Profile.display_name).like(like), func.lower(Profile.display_code).like(like)))
    if status:
        base = base.where(Profile.status == status)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.scalars(base.order_by(Profile.created_at.desc()).limit(limit).offset(offset))
    items = [profile_out(db, p, access_level_for(db, user, p)) for p in rows]
    return Page[ProfileOut](items=items, total=total, limit=limit, offset=offset)


def _new_code(db: Session, org_id: str) -> str:
    year = datetime.now(UTC).year
    for _ in range(20):
        code = f"BV-{year}-{secrets.randbelow(10**5):05d}"
        if not db.scalar(select(Profile.id).where(Profile.organization_id == org_id, Profile.display_code == code)):
            return code
    raise AppError(409, "No se pudo generar un código único")  # pragma: no cover


@router.post("/profiles", response_model=ProfileOut, status_code=201)
def create_profile(body: ProfileCreate, request: Request, user: User = Depends(require("profiles:create")), db: Session = Depends(get_db)):
    if user.role == "patient":
        raise AppError(403, "Tu expediente se crea automáticamente al registrarte")
    code = (body.display_code or "").upper() or _new_code(db, user.organization_id)
    if db.scalar(select(Profile.id).where(Profile.organization_id == user.organization_id, Profile.display_code == code)):
        raise AppError(409, "El código de expediente ya existe")
    p = Profile(organization_id=user.organization_id, display_code=code, display_name=body.display_name.strip(), sex=body.sex,
                birth_date=body.birth_date, notes=body.notes, created_by=user.id)
    db.add(p)
    try:
        db.flush()
        db.add(ProfileAccess(profile_id=p.id, user_id=user.id, access_level="owner", granted_by=user.id))
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AppError(409, "El código de expediente ya existe") from exc
    audit.record(db, request, user, "profile.create", "profile", p.id, details={"code": code})
    return profile_out(db, p, "owner")


@router.get("/profiles/{profile_id}", response_model=ProfileOut)
def get_profile(profile_id: str, request: Request, user: User = Depends(require("profiles:read")), db: Session = Depends(get_db)):
    p, level = get_profile_checked(db, user, profile_id)
    audit.record(db, request, user, "profile.read", "profile", p.id)
    return profile_out(db, p, level)


@router.patch("/profiles/{profile_id}", response_model=ProfileOut)
def update_profile(profile_id: str, body: ProfileUpdate, request: Request, user: User = Depends(require("profiles:write")), db: Session = Depends(get_db)):
    p = db.get(Profile, profile_id)
    level = access_level_for(db, user, p) if p else None
    if not p or not level:
        raise AppError(404, "Expediente no encontrado")
    if level == "viewer":
        raise AppError(403, "Tu nivel de acceso al expediente no permite esta operación")
    changes = body.model_dump(exclude_unset=True)
    if user.role == "patient" and "status" in changes:
        raise AppError(403, "El estado del expediente lo gestiona el personal")
    for k, v in changes.items():
        if v is not None:
            setattr(p, k, v.strip() if isinstance(v, str) and k == "display_name" else v)
    db.commit()
    audit.record(db, request, user, "profile.update", "profile", p.id, details={k: str(v) for k, v in changes.items()})
    return profile_out(db, p, level)


# ---------------------------------------------------------------- accesos
@router.get("/profiles/{profile_id}/access", response_model=list[AccessOut])
def list_access(profile_id: str, user: User = Depends(require("profiles:read")), db: Session = Depends(get_db)):
    p, _ = get_profile_checked(db, user, profile_id)
    if user.role == "patient":
        raise AppError(403, "La gestión de accesos corresponde al personal")
    rows = db.execute(select(ProfileAccess, User).join(User, User.id == ProfileAccess.user_id).where(ProfileAccess.profile_id == p.id))
    out = []
    for acc, u in rows:
        o = AccessOut.model_validate(acc)
        o.user_email, o.user_name = u.email, u.full_name
        out.append(o)
    return out


@router.post("/profiles/{profile_id}/access", response_model=AccessOut, status_code=201)
def grant_access(profile_id: str, body: AccessGrant, request: Request, user: User = Depends(require("profiles:write")), db: Session = Depends(get_db)):
    p, _ = get_profile_checked(db, user, profile_id, need="owner")
    if user.role == "patient":
        raise AppError(403, "Solo el personal autorizado puede asignar accesos")
    target = db.get(User, body.user_id)
    if not target or target.organization_id != user.organization_id:
        raise AppError(404, "Usuario no encontrado")
    if target.role == "viewer" and body.access_level != "viewer":
        raise AppError(400, "Un usuario final solo puede recibir acceso de lectura")
    acc = db.scalar(select(ProfileAccess).where(ProfileAccess.profile_id == p.id, ProfileAccess.user_id == target.id))
    if acc:
        acc.access_level, acc.expires_at = body.access_level, body.expires_at
    else:
        acc = ProfileAccess(profile_id=p.id, user_id=target.id, access_level=body.access_level, expires_at=body.expires_at, granted_by=user.id)
        db.add(acc)
    db.commit()
    audit.record(db, request, user, "profile.access.grant", "profile", p.id, details={"user": target.email, "level": body.access_level})
    o = AccessOut.model_validate(acc)
    o.user_email, o.user_name = target.email, target.full_name
    return o


@router.delete("/profiles/{profile_id}/access/{access_id}", status_code=204)
def revoke_access(profile_id: str, access_id: str, request: Request, user: User = Depends(require("profiles:write")), db: Session = Depends(get_db)):
    p, _ = get_profile_checked(db, user, profile_id, need="owner")
    if user.role == "patient":
        raise AppError(403, "Solo el personal autorizado puede revocar accesos")
    acc = db.get(ProfileAccess, access_id)
    if not acc or acc.profile_id != p.id:
        raise AppError(404, "Acceso no encontrado")
    if acc.user_id == user.id:
        raise AppError(409, "No puedes revocar tu propio acceso")
    db.delete(acc)
    db.commit()
    audit.record(db, request, user, "profile.access.revoke", "profile", p.id, details={"access_id": access_id})


# ---------------------------------------------------------------- consentimiento
@router.get("/profiles/{profile_id}/consents", response_model=list[ConsentOut])
def list_consents(profile_id: str, user: User = Depends(require("profiles:read")), db: Session = Depends(get_db)):
    p, _ = get_profile_checked(db, user, profile_id)
    now = datetime.now(UTC)
    rows = list(db.scalars(select(Consent).where(Consent.profile_id == p.id).order_by(Consent.created_at.desc())))
    changed = False
    for c in rows:
        if c.status == "accepted" and c.expires_at and c.expires_at <= now:
            c.status = "expired"
            changed = True
    if changed:
        db.commit()
    return rows


@router.post("/profiles/{profile_id}/consents", response_model=ConsentOut, status_code=201)
def create_consent(profile_id: str, body: ConsentCreate, request: Request, user: User = Depends(require("consents:write")), db: Session = Depends(get_db)):
    p, _ = get_profile_checked(db, user, profile_id, need="editor")
    now = datetime.now(UTC)
    if body.expires_at and body.expires_at <= now:
        raise AppError(400, "La fecha de expiración debe ser futura")
    c = Consent(profile_id=p.id, purpose=body.purpose, policy_version=body.policy_version,
                status="accepted" if body.accepted else "pending", accepted_at=now if body.accepted else None,
                expires_at=body.expires_at, evidence=body.evidence, recorded_by=user.id)
    db.add(c)
    db.commit()
    audit.record(db, request, user, "consent.create", "consent", c.id, details={"purpose": c.purpose, "status": c.status, "version": c.policy_version})
    return c


@router.post("/consents/{consent_id}/revoke", response_model=ConsentOut)
def revoke_consent(consent_id: str, request: Request, user: User = Depends(require("consents:write")), db: Session = Depends(get_db)):
    c = db.get(Consent, consent_id)
    if not c:
        raise AppError(404, "Consentimiento no encontrado")
    get_profile_checked(db, user, c.profile_id, need="editor")
    if c.status == "revoked":
        raise AppError(409, "El consentimiento ya estaba revocado")
    c.status, c.revoked_at = "revoked", datetime.now(UTC)
    db.commit()
    audit.record(db, request, user, "consent.revoke", "consent", c.id, details={"purpose": c.purpose})
    return c


# ---------------------------------------------------------------- mediciones
@router.get("/profiles/{profile_id}/measurements", response_model=list[MeasurementOut])
def list_measurements(
    profile_id: str,
    metric: str | None = Query(default=None, max_length=32),
    include_superseded: bool = False,
    user: User = Depends(require("profiles:read")),
    db: Session = Depends(get_db),
):
    p, _ = get_profile_checked(db, user, profile_id)
    q = select(Measurement).where(Measurement.profile_id == p.id)
    if metric:
        q = q.where(Measurement.metric_code == metric)
    if not include_superseded:
        q = q.where(Measurement.status == "active")
    return list(db.scalars(q.order_by(Measurement.measured_at.desc(), Measurement.created_at.desc())))


@router.post("/profiles/{profile_id}/measurements", response_model=MeasurementOut, status_code=201)
def create_measurement(profile_id: str, body: MeasurementCreate, request: Request, user: User = Depends(require("measurements:write")), db: Session = Depends(get_db)):
    p, _ = get_profile_checked(db, user, profile_id, need="editor")
    if user.role == "patient" and body.metric_code not in ("weight", "height"):
        raise AppError(403, "En autoservicio solo puedes declarar peso y estatura")
    if user.role == "patient" and body.method != "manual":
        raise AppError(400, "Los datos declarados por pacientes utilizan el método manual")
    try:
        _, unit = validate_value(body.metric_code, body.value, body.unit)
    except ValueError as exc:
        raise AppError(400, str(exc)) from exc
    if body.measured_at > datetime.now(UTC) + timedelta(minutes=5):
        raise AppError(400, "La fecha de medición no puede estar en el futuro")
    m = Measurement(profile_id=p.id, metric_code=body.metric_code, value=round(body.value, 2), unit=unit, method=body.method,
                    source_type="self_reported" if user.role == "patient" else ("visual_estimate" if body.method == "visual_estimate" else "observed_manual"),
                    measured_at=body.measured_at, notes=body.notes, created_by=user.id)
    db.add(m)
    db.commit()
    audit.record(db, request, user, "measurement.create", "measurement", m.id, details={"profile": p.display_code, "metric": m.metric_code})
    return m


@router.patch("/measurements/{measurement_id}", response_model=MeasurementOut)
def correct_measurement(measurement_id: str, body: MeasurementCorrection, request: Request, user: User = Depends(require("measurements:write")), db: Session = Depends(get_db)):
    old = db.get(Measurement, measurement_id)
    if not old:
        raise AppError(404, "Medición no encontrada")
    get_profile_checked(db, user, old.profile_id, need="editor")
    if user.role == "patient" and (old.created_by != user.id or old.metric_code not in ("weight", "height")):
        raise AppError(403, "Solo puedes corregir tus propias mediciones declaradas")
    if old.status != "active":
        raise AppError(409, "Solo se puede corregir el registro vigente")
    try:
        validate_value(old.metric_code, body.value, old.unit)
    except ValueError as exc:
        raise AppError(400, str(exc)) from exc
    # Corrección no destructiva: se crea un registro nuevo y el original queda como "superseded".
    new = Measurement(profile_id=old.profile_id, metric_code=old.metric_code, value=round(body.value, 2), unit=old.unit,
                      method=old.method, source_type=old.source_type, measured_at=body.measured_at or old.measured_at,
                      notes=old.notes, supersedes_id=old.id, correction_reason=body.reason, created_by=user.id)
    old.status = "superseded"
    db.add(new)
    db.commit()
    audit.record(db, request, user, "measurement.correct", "measurement", new.id,
                 details={"supersedes": old.id, "from": old.value, "to": new.value, "reason": body.reason})
    return new
