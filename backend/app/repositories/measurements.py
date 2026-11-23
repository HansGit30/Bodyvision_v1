"""Consultas de mediciones (repositorio)."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Measurement


def active_measurements(db: Session, profile_id: str, metric: str | None = None,
                        date_from: datetime | None = None, date_to: datetime | None = None) -> list[Measurement]:
    q = select(Measurement).where(Measurement.profile_id == profile_id, Measurement.status == "active")
    if metric:
        q = q.where(Measurement.metric_code == metric)
    if date_from:
        q = q.where(Measurement.measured_at >= date_from)
    if date_to:
        q = q.where(Measurement.measured_at <= date_to)
    return list(db.scalars(q.order_by(Measurement.measured_at.asc(), Measurement.created_at.asc())))


def latest_by_metric(db: Session, profile_id: str) -> dict[str, Measurement]:
    rows = active_measurements(db, profile_id)
    out: dict[str, Measurement] = {}
    for m in rows:  # ordenado asc → el último gana
        out[m.metric_code] = m
    return out


def base_reference(db: Session, profile) -> dict:
    """Copia inmutable del estado de referencia registrado (para simulación / 3D)."""
    latest = latest_by_metric(db, profile.id)

    def v(code: str):
        return latest[code].value if code in latest else None

    return {
        "sex": profile.sex,
        "weight_kg": v("weight"),
        "height_cm": v("height"),
        "waist_cm": v("waist"),
        "hip_cm": v("hip"),
        "body_fat_pct": v("body_fat"),
        "muscle_pct": v("muscle_mass"),
        "source_measurement_ids": {k: m.id for k, m in latest.items()},
        "source_dates": {k: m.measured_at.isoformat() for k, m in latest.items()},
    }
