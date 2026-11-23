"""Worker de análisis de pose: queued → processing → completed | needs_review | failed.

Se ejecuta fuera del ciclo HTTP (BackgroundTasks). Para escalar puede moverse a una cola
(RQ/Celery) sin cambiar el contrato: la API solo crea la tarea y el cliente consulta el estado.
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime

from app.db.session import SessionLocal
from app.models import AuditEvent, MediaAsset, PoseAnalysis
from app.services import pose as pose_service
from app.services.media import image_brightness

log = logging.getLogger("bodyvision.worker")


def process_pose_analysis(analysis_id: str, raw_landmarks, raw_world, raw_frames) -> None:
    db = SessionLocal()
    try:
        pa = db.get(PoseAnalysis, analysis_id)
        if not pa:
            return
        pa.status = "processing"
        db.commit()
        media = db.get(MediaAsset, pa.media_asset_id)
        brightness = image_brightness(media.storage_key) if media else None
        res = pose_service.evaluate(
            raw_landmarks, raw_world, raw_frames,
            media.width if media else 1, media.height if media else 1,
            brightness, media.capture_view if media else "frontal",
        )
        pa.mode = res["mode"]
        pa.status = res["status"]
        pa.quality_flags = res["flags"]
        pa.quality_score = res["score"]
        pa.metrics_json = res["metrics"]
        pa.landmarks_json = res["landmarks"]
        pa.world_landmarks_json = res["world"]
        pa.frames_json = raw_frames
        pa.completed_at = datetime.now(UTC)
        if media and media.status == "ready" and res["status"] != "failed":
            media.status = "processed"
        db.add(AuditEvent(actor_id=None, actor_email="servicio-ia", action="pose.processed",
                          organization_id=None, resource_type="pose_analysis", resource_id=pa.id,
                          outcome="success" if res["status"] != "failed" else "failure",
                          details={"status": res["status"], "score": res["score"]}))
        db.commit()
    except Exception as exc:  # pragma: no cover - fallo controlado
        log.exception("Fallo procesando análisis %s", analysis_id)
        db.rollback()
        pa = db.get(PoseAnalysis, analysis_id)
        if pa:
            pa.status = "failed"
            pa.error = str(exc)[:500]
            db.commit()
    finally:
        db.close()
