"""Dependencias comunes: usuario autenticado, permisos y acceso por expediente."""
from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime

import jwt
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.security import decode_access_token, has_permission
from app.db.session import get_db
from app.models import Profile, ProfileAccess, User

bearer = HTTPBearer(auto_error=False)


def get_current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if not creds or creds.scheme.lower() != "bearer":
        raise AppError(401, "Autenticación requerida")
    try:
        payload = decode_access_token(creds.credentials)
    except jwt.ExpiredSignatureError as exc:
        raise AppError(401, "La sesión expiró, vuelve a iniciar sesión") from exc
    except jwt.PyJWTError as exc:
        raise AppError(401, "Token inválido") from exc
    user = db.get(User, payload.get("sub"))
    if not user or user.status != "active":
        raise AppError(401, "Usuario inactivo o inexistente")
    request.state.user = user
    return user


def require(perm: str) -> Callable[..., User]:
    def _dep(user: User = Depends(get_current_user)) -> User:
        if not has_permission(user.role, perm):
            raise AppError(403, "No tienes permiso para esta operación", details={"permission": perm})
        return user

    return _dep


LEVEL_RANK = {"viewer": 1, "editor": 2, "owner": 3}


def access_level_for(db: Session, user: User, profile: Profile) -> str | None:
    """Nivel efectivo del usuario sobre un expediente (None = sin acceso)."""
    if profile.organization_id != user.organization_id:
        return None
    if user.role == "admin":
        return "owner"
    if user.role == "patient" and profile.created_by != user.id:
        return None
    now = datetime.now(UTC)
    acc = db.scalar(
        select(ProfileAccess).where(
            ProfileAccess.profile_id == profile.id,
            ProfileAccess.user_id == user.id,
            or_(ProfileAccess.expires_at.is_(None), ProfileAccess.expires_at > now),
        )
    )
    return acc.access_level if acc else None


def visible_profile_ids_query(user: User):
    """Subconsulta de ids de expedientes visibles (aislamiento por organización y acceso)."""
    q = select(Profile.id).where(Profile.organization_id == user.organization_id)
    if user.role == "patient":
        q = q.where(Profile.created_by == user.id)
    if user.role != "admin":
        now = datetime.now(UTC)
        q = q.join(ProfileAccess, ProfileAccess.profile_id == Profile.id).where(
            ProfileAccess.user_id == user.id,
            or_(ProfileAccess.expires_at.is_(None), ProfileAccess.expires_at > now),
        )
    return q


def get_profile_checked(db: Session, user: User, profile_id: str, need: str = "viewer") -> tuple[Profile, str]:
    profile = db.get(Profile, profile_id)
    level = access_level_for(db, user, profile) if profile else None
    # 404 también cuando no hay acceso: no se revela la existencia del recurso (IDOR).
    if not profile or not level:
        raise AppError(404, "Expediente no encontrado")
    if LEVEL_RANK[level] < LEVEL_RANK[need]:
        raise AppError(403, "Tu nivel de acceso al expediente no permite esta operación")
    if need != "viewer" and profile.status == "archived":
        raise AppError(409, "El expediente está archivado; reactívalo para modificarlo")
    return profile, level
