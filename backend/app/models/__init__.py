"""Entidades ORM (persistencia). Importar aquí todas para Alembic."""
from app.models.entities import (  # noqa: F401
    AuditEvent,
    BodyModel,
    Consent,
    Measurement,
    MediaAsset,
    Organization,
    PoseAnalysis,
    Profile,
    ProfileAccess,
    Report,
    Role,
    Simulation,
    User,
)
