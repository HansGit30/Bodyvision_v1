from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.exc import IntegrityError
import secrets
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.errors import AppError
from app.core.security import ROLE_PERMISSIONS, create_access_token, verify_password, hash_password
from app.db.session import get_db
from app.models import Organization, User, Profile, ProfileAccess
from app.schemas import LoginIn, MeOut, TokenOut
from app.services import audit
from app.services.audit import client_ip

router = APIRouter(tags=["auth"])

_attempts: dict[str, deque[float]] = defaultdict(deque)
_lock = threading.Lock()


def _rate_check(key: str) -> None:
    now = time.time()
    with _lock:
        q = _attempts[key]
        while q and now - q[0] > settings.LOGIN_WINDOW_SECONDS:
            q.popleft()
        if len(q) >= settings.LOGIN_MAX_ATTEMPTS:
            raise AppError(429, "Demasiados intentos fallidos. Intenta nuevamente en unos minutos.")


def _rate_fail(key: str) -> None:
    with _lock:
        _attempts[key].append(time.time())


def _rate_reset(key: str) -> None:
    with _lock:
        _attempts.pop(key, None)


def me_payload(db: Session, user: User) -> MeOut:
    org = db.get(Organization, user.organization_id)
    data = MeOut.model_validate({
        **{k: getattr(user, k) for k in ("id", "email", "full_name", "role", "status", "organization_id", "created_at", "last_login_at")},
        "permissions": sorted(ROLE_PERMISSIONS.get(user.role, set())),
        "organization_name": org.name if org else "",
    })
    return data


@router.post("/auth/login", response_model=TokenOut)
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    email = body.email.lower()
    key = f"{client_ip(request)}|{email}"
    _rate_check(key)
    user = db.scalar(select(User).where(func.lower(User.email) == email))
    if not user or not verify_password(body.password, user.password_hash) or user.status != "active":
        _rate_fail(key)
        audit.record(db, request, None, "auth.login", "user", user.id if user else "", "failure", {"email": email}, actor_email=email)
        raise AppError(401, "Credenciales inválidas")
    _rate_reset(key)
    user.last_login_at = datetime.now(UTC)
    db.commit()
    token, exp = create_access_token(user.id, user.role, user.organization_id)
    audit.record(db, request, user, "auth.login", "user", user.id)
    return TokenOut(access_token=token, expires_in=exp, user=me_payload(db, user))


@router.post("/auth/logout", status_code=204)
def logout(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    audit.record(db, request, user, "auth.logout", "user", user.id)


@router.get("/users/me", response_model=MeOut)
def me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return me_payload(db, user)


class PatientRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=72)
    full_name: str = Field(min_length=2, max_length=160)
    sex: str = Field(pattern="^(M|F)$")


@router.post("/auth/register-patient", response_model=TokenOut, status_code=201)
def register_patient(body: PatientRegister, request: Request, db: Session = Depends(get_db)):
    """Alta pública de paciente y expediente propio. No crea cuentas profesionales."""
    key = f"register|{client_ip(request)}"
    _rate_check(key)
    # Rate limit también para registros exitosos, evitando creación masiva en la misma IP.
    _rate_fail(key)
    email = str(body.email).strip().lower()
    if db.scalar(select(User.id).where(func.lower(User.email) == email)):
        raise AppError(409, "Este correo ya está registrado")
    org = db.scalar(select(Organization).where(Organization.status == "active").order_by(Organization.created_at).limit(1))
    if not org:
        raise AppError(503, "No hay una organización habilitada para registros")
    u = User(organization_id=org.id, email=email, full_name=body.full_name.strip(),
             password_hash=hash_password(body.password), role="patient", status="active")
    db.add(u)
    try:
        db.flush()
        p = Profile(organization_id=org.id, display_code="PAT-" + secrets.token_hex(7).upper(),
                    display_name=u.full_name, sex=body.sex, created_by=u.id, is_demo=False)
        db.add(p)
        db.flush()
        db.add(ProfileAccess(profile_id=p.id, user_id=u.id, access_level="owner", granted_by=u.id))
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise AppError(409, "No se pudo registrar la cuenta. Revisa los datos.") from exc
    audit.record(db, request, u, "auth.register", "user", u.id, details={"profile_id": p.id})
    token, exp = create_access_token(u.id, u.role, u.organization_id)
    return TokenOut(access_token=token, expires_in=exp, user=me_payload(db, u))
