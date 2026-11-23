"""Datos iniciales: roles, organización, administrador, catálogo de activos 3D y demo sintética."""
from __future__ import annotations

import hashlib
import logging
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import ROLES, hash_password
from app.models import BodyModel, Consent, Measurement, Organization, Profile, ProfileAccess, Role, User

log = logging.getLogger("bodyvision.seed")

LAYERS = {
    "skin": ("Piel", 256), "muscles": ("Músculos", 476), "organs": ("Órganos", 297),
    "arteries": ("Arterias", 417), "veins": ("Venas", 226), "nerves": ("Nervios", 255), "skeleton": ("Huesos", 271),
}
LICENSE = "CC BY-SA 4.0 — Z-Anatomy / BodyParts3D (DBCLS); modelos web derivados del repositorio SeemaBansal1/3d-human-body-anatomy"


def _sha(path: Path) -> tuple[str, int]:
    if not path.exists():
        return "", 0
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest(), path.stat().st_size


def seed(db: Session) -> None:
    for code, r in ROLES.items():
        if not db.get(Role, code):
            db.add(Role(code=code, name=r["name"], description=r["description"]))
    db.flush()

    org = db.scalar(select(Organization).limit(1))
    if not org:
        org = Organization(name="BODYVISION Organización Principal")
        db.add(org)
        db.flush()

    admin = db.scalar(select(User).where(User.email == settings.ADMIN_EMAIL.lower()))
    if not admin:
        admin = User(organization_id=org.id, email=settings.ADMIN_EMAIL.lower(), full_name=settings.ADMIN_NAME,
                     password_hash=hash_password(settings.ADMIN_PASSWORD), role="admin")
        db.add(admin)
        log.warning("Administrador inicial creado: %s (cambia la contraseña en producción)", settings.ADMIN_EMAIL)

    models_dir = Path(settings.STATIC_DIR) / "models"
    for layer, (label, parts) in LAYERS.items():
        key = f"anatomy/{layer}.glb"
        bm = db.scalar(select(BodyModel).where(BodyModel.asset_key == key))
        checksum, size = _sha(models_dir / f"{layer}.glb")
        if not bm:
            db.add(BodyModel(asset_key=key, layer=layer, format="glb", source_type="authorized_asset", model_version="z-anatomy-web-1.0",
                             license_ref=LICENSE, checksum=checksum, size_bytes=size,
                             meta={"label": label, "parts": parts, "compression": "Draco", "units": "m", "up_axis": "Y"}))
        elif checksum and bm.checksum != checksum:
            bm.checksum, bm.size_bytes = checksum, size
    db.flush()

    if settings.SEED_DEMO and not db.scalar(select(func.count()).select_from(Profile).where(Profile.is_demo.is_(True))):
        _seed_demo(db, org, admin)
    db.commit()


def _seed_demo(db: Session, org: Organization, admin: User) -> None:
    spec = db.scalar(select(User).where(User.email == "especialista@bodyvision.ai"))
    if not spec:
        spec = User(organization_id=org.id, email="especialista@bodyvision.ai", full_name="Dra. Especialista Demo",
                    password_hash=hash_password("Especialista2026!"), role="specialist")
        db.add(spec)
    viewer = db.scalar(select(User).where(User.email == "usuario@bodyvision.ai"))
    if not viewer:
        viewer = User(organization_id=org.id, email="usuario@bodyvision.ai", full_name="Usuario Final Demo",
                      password_hash=hash_password("Usuario2026!"), role="viewer")
        db.add(viewer)
    db.flush()

    now = datetime.now(UTC).replace(hour=9, minute=30, second=0, microsecond=0)
    demos = [
        ("DEMO-0001", "Paciente Demo · Masculino (ficticio)", "M",
         {"height": [176.0] * 6, "weight": [92.4, 90.8, 89.5, 87.9, 86.6, 85.2], "waist": [101, 99.5, 98, 96.2, 94.8, 93.1],
          "hip": [104, 103.4, 102.5, 101.8, 101, 100.2], "body_fat": [29.5, 28.6, 27.9, 26.8, 25.9, 25.1],
          "muscle_mass": [38.2, 38.5, 38.9, 39.3, 39.6, 40.1]}),
        ("DEMO-0002", "Paciente Demo · Femenino (ficticio)", "F",
         {"height": [163.0] * 6, "weight": [71.5, 70.6, 69.4, 68.8, 67.9, 66.8], "waist": [84, 83.1, 81.9, 80.6, 79.8, 78.7],
          "hip": [104.5, 103.8, 103.1, 102.2, 101.6, 100.9], "body_fat": [33.2, 32.5, 31.6, 30.9, 30.1, 29.4],
          "muscle_mass": [31.0, 31.2, 31.5, 31.9, 32.2, 32.6]}),
    ]
    units = {"height": "cm", "weight": "kg", "waist": "cm", "hip": "cm", "body_fat": "%", "muscle_mass": "%"}
    for code, name, sex, series in demos:
        p = Profile(organization_id=org.id, display_code=code, display_name=name, sex=sex, is_demo=True,
                    notes="Expediente sintético de demostración. No contiene datos personales reales.", created_by=admin.id)
        db.add(p)
        db.flush()
        db.add(ProfileAccess(profile_id=p.id, user_id=spec.id, access_level="owner", granted_by=admin.id))
        db.add(ProfileAccess(profile_id=p.id, user_id=viewer.id, access_level="viewer", granted_by=admin.id))
        db.add(Consent(profile_id=p.id, purpose="image_processing", policy_version="1.0", status="accepted",
                       accepted_at=now - timedelta(days=170), evidence="Consentimiento sintético de demostración", recorded_by=admin.id))
        for metric, vals in series.items():
            for i, v in enumerate(vals):
                when = now - timedelta(days=30 * (len(vals) - 1 - i))
                if metric == "height" and i not in (0, len(vals) - 1):
                    continue
                db.add(Measurement(profile_id=p.id, metric_code=metric, value=v, unit=units[metric],
                                   method="device" if metric in ("body_fat", "muscle_mass") else "manual",
                                   source_type="observed_manual", measured_at=when, created_by=spec.id,
                                   notes="Dato sintético de demostración"))
    log.info("Datos de demostración sintéticos creados")
