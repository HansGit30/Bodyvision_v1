"""Registro de auditoría: actor, acción, recurso, resultado y correlation_id."""
from __future__ import annotations

import logging
from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session

from app.models import AuditEvent, User

log = logging.getLogger("bodyvision.audit")


def client_ip(request: Request | None) -> str:
    if request is None:
        return ""
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()[:64]
    return (request.client.host if request.client else "")[:64]


def record(
    db: Session,
    request: Request | None,
    actor: User | None,
    action: str,
    resource_type: str = "",
    resource_id: str = "",
    outcome: str = "success",
    details: dict[str, Any] | None = None,
    commit: bool = True,
    actor_email: str | None = None,
) -> None:
    ev = AuditEvent(
        organization_id=actor.organization_id if actor else None,
        actor_id=actor.id if actor else None,
        actor_email=(actor.email if actor else (actor_email or ""))[:255],
        action=action,
        resource_type=resource_type,
        resource_id=resource_id or "",
        outcome=outcome,
        details=details or {},
        ip=client_ip(request),
        correlation_id=getattr(request.state, "correlation_id", "") if request else "",
    )
    db.add(ev)
    if commit:
        db.commit()
    log.info("audit action=%s resource=%s:%s outcome=%s", action, resource_type, resource_id, outcome)
