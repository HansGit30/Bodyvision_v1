from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_profile_checked, require, visible_profile_ids_query
from app.api.routes.profiles import has_active_consent
from app.core.config import settings
from app.core.errors import AppError
from app.core.security import sign_resource, verify_signed
from app.db.session import get_db
from app.models import MediaAsset, PoseAnalysis, Profile, User
from app.schemas import (
    MediaOut,
    PoseAnalysisCreate,
    PoseAnalysisOut,
    PoseAnalysisSummary,
    PoseReview,
    SignedUrlOut,
)
from app.services import audit
from app.services.media import delete_file, media_path, sanitize_and_store
from app.workers.pose_worker import process_pose_analysis

router = APIRouter(tags=["captura y análisis"])


@router.get("/profiles/{profile_id}/media", response_model=list[MediaOut])
def list_media(profile_id: str, user: User = Depends(require("media:read")), db: Session = Depends(get_db)):
    p, _ = get_profile_checked(db, user, profile_id)
    return list(db.scalars(select(MediaAsset).where(MediaAsset.profile_id == p.id, MediaAsset.status != "deleted").order_by(MediaAsset.created_at.desc())))


@router.post("/profiles/{profile_id}/media", response_model=MediaOut, status_code=201)
async def upload_media(
    profile_id: str,
    request: Request,
    file: UploadFile = File(...),
    capture_view: str = Form(default="frontal", pattern="^(frontal|posterior|lateral)$"),
    user: User = Depends(require("media:upload")),
    db: Session = Depends(get_db),
):
    p, _ = get_profile_checked(db, user, profile_id, need="editor")
    if not has_active_consent(db, p.id, "image_processing"):
        audit.record(db, request, user, "media.upload", "profile", p.id, "denied", {"reason": "consent"})
        raise AppError(403, "Se requiere consentimiento vigente para procesamiento de imágenes", code="CONSENT_REQUIRED")
    max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
    raw = await file.read(max_bytes + 1)
    stored = sanitize_and_store(raw)
    m = MediaAsset(profile_id=p.id, storage_key=stored.storage_key, mime_type=stored.mime_type, checksum=stored.checksum,
                   size_bytes=stored.size_bytes, width=stored.width, height=stored.height, capture_view=capture_view,
                   status="ready", retention_until=datetime.now(UTC) + timedelta(days=settings.MEDIA_RETENTION_DAYS),
                   created_by=user.id)
    db.add(m)
    db.commit()
    audit.record(db, request, user, "media.upload", "media", m.id,
                 details={"profile": p.display_code, "size": m.size_bytes, "checksum": m.checksum[:16], "brightness": stored.brightness})
    return m


def _media_checked(db: Session, user: User, media_id: str, need: str = "viewer") -> MediaAsset:
    m = db.get(MediaAsset, media_id)
    if not m or m.status == "deleted":
        raise AppError(404, "Archivo no encontrado")
    get_profile_checked(db, user, m.profile_id, need=need)
    return m


@router.get("/media/{media_id}/signed-url", response_model=SignedUrlOut)
def signed_url(media_id: str, request: Request, user: User = Depends(require("media:read")), db: Session = Depends(get_db)):
    m = _media_checked(db, user, media_id)
    token, exp = sign_resource("media", m.id)
    audit.record(db, request, user, "media.access", "media", m.id)
    return SignedUrlOut(url=f"/api/v1/media/{m.id}/content?token={token}", expires_at=exp)


@router.get("/media/{media_id}/content", include_in_schema=False)
def media_content(media_id: str, token: str = Query(..., max_length=400), db: Session = Depends(get_db)):
    if not verify_signed(token, "media", media_id):
        raise AppError(403, "URL firmada inválida o expirada")
    m = db.get(MediaAsset, media_id)
    if not m or m.status == "deleted":
        raise AppError(404, "Archivo no encontrado")
    path = media_path(m.storage_key)
    if not path.exists():
        raise AppError(404, "El archivo ya no está disponible en el almacenamiento")
    return FileResponse(path, media_type=m.mime_type, headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})


@router.delete("/media/{media_id}", status_code=204)
def delete_media(media_id: str, request: Request, user: User = Depends(require("media:upload")), db: Session = Depends(get_db)):
    m = _media_checked(db, user, media_id, need="editor")
    delete_file(m.storage_key)
    m.status = "deleted"
    db.commit()
    audit.record(db, request, user, "media.delete", "media", m.id)


# ---------------------------------------------------------------- análisis de pose
@router.post("/media/{media_id}/pose-analyses", response_model=PoseAnalysisOut, status_code=202)
def create_pose_analysis(media_id: str, body: PoseAnalysisCreate, request: Request, background: BackgroundTasks,
                         user: User = Depends(require("pose:run")), db: Session = Depends(get_db)):
    m = _media_checked(db, user, media_id, need="editor")
    if not has_active_consent(db, m.profile_id, "image_processing"):
        raise AppError(403, "Se requiere consentimiento vigente para procesamiento de imágenes", code="CONSENT_REQUIRED")
    if m.status not in ("ready", "processed"):
        raise AppError(409, "El archivo no está listo para análisis")
    if body.mode == "image" and not body.landmarks:
        raise AppError(400, "Faltan landmarks para el análisis de imagen")
    if body.mode == "sequence" and not body.frames:
        raise AppError(400, "Faltan fotogramas para el análisis de secuencia")
    if body.capture_view != m.capture_view:
        m.capture_view = body.capture_view
    pa = PoseAnalysis(media_asset_id=m.id, profile_id=m.profile_id, engine=body.engine, model_name=body.model_name,
                      model_version=body.model_version, config_json=body.config, mode=body.mode, status="queued", created_by=user.id)
    db.add(pa)
    db.commit()
    lms = [lm.model_dump() for lm in body.landmarks] if body.landmarks else None
    wl = [lm.model_dump() for lm in body.world_landmarks] if body.world_landmarks else None
    frames = [f.model_dump() for f in body.frames] if body.frames else None
    background.add_task(process_pose_analysis, pa.id, lms, wl, frames)
    audit.record(db, request, user, "pose.create", "pose_analysis", pa.id, details={"media": m.id, "mode": body.mode, "engine": body.engine})
    return pa


@router.get("/profiles/{profile_id}/pose-analyses", response_model=list[PoseAnalysisSummary])
def list_analyses(profile_id: str, user: User = Depends(require("profiles:read")), db: Session = Depends(get_db)):
    p, _ = get_profile_checked(db, user, profile_id)
    return list(db.scalars(select(PoseAnalysis).where(PoseAnalysis.profile_id == p.id).order_by(PoseAnalysis.created_at.desc())))


@router.get("/pose-analyses", response_model=list[PoseAnalysisSummary])
def recent_analyses(limit: int = Query(default=50, ge=1, le=200), user: User = Depends(require("profiles:read")), db: Session = Depends(get_db)):
    rows = db.execute(
        select(PoseAnalysis, Profile.display_code).join(Profile, Profile.id == PoseAnalysis.profile_id)
        .where(PoseAnalysis.profile_id.in_(visible_profile_ids_query(user))).order_by(PoseAnalysis.created_at.desc()).limit(limit)
    )
    out = []
    for pa, code in rows:
        s = PoseAnalysisSummary.model_validate(pa)
        s.profile_code = code
        out.append(s)
    return out


@router.get("/pose-analyses/{analysis_id}", response_model=PoseAnalysisOut)
def get_analysis(analysis_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    pa = db.get(PoseAnalysis, analysis_id)
    if not pa:
        raise AppError(404, "Análisis no encontrado")
    get_profile_checked(db, user, pa.profile_id)
    return pa


@router.post("/pose-analyses/{analysis_id}/review", response_model=PoseAnalysisOut)
def review_analysis(analysis_id: str, body: PoseReview, request: Request, user: User = Depends(require("pose:run")), db: Session = Depends(get_db)):
    pa = db.get(PoseAnalysis, analysis_id)
    if not pa:
        raise AppError(404, "Análisis no encontrado")
    if user.role not in ("specialist", "admin"):
        raise AppError(403, "Solo especialistas autorizados pueden aprobar o rechazar análisis")
    get_profile_checked(db, user, pa.profile_id, need="editor")
    if pa.status in ("queued", "processing"):
        raise AppError(409, "El análisis aún se está procesando")
    if pa.status == "failed":
        raise AppError(409, "No se puede revisar un análisis fallido")
    pa.review_status, pa.review_notes = body.decision, body.notes
    pa.reviewed_by, pa.reviewed_at = user.id, datetime.now(UTC)
    if body.decision == "approved" and pa.status == "needs_review":
        pa.status = "completed"
    db.commit()
    audit.record(db, request, user, "pose.review", "pose_analysis", pa.id, details={"decision": body.decision})
    return pa
