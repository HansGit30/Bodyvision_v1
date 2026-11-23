"""Contraseñas, JWT, URLs firmadas y matriz RBAC."""
from __future__ import annotations

import base64
import hashlib
import hmac
import time
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt

from app.core.config import settings

ALGORITHM = "HS256"

# ---------------------------------------------------------------- contraseñas

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8")[:72], bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8")[:72], hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


# ---------------------------------------------------------------- JWT

def create_access_token(user_id: str, role: str, org_id: str) -> tuple[str, int]:
    exp_minutes = settings.ACCESS_TOKEN_MINUTES
    now = datetime.now(UTC)
    payload = {
        "sub": user_id,
        "role": role,
        "org": org_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=exp_minutes)).timestamp()),
        "typ": "access",
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM), exp_minutes * 60


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM], options={"require": ["exp", "sub"]})


# ---------------------------------------------------------------- URLs firmadas

def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def sign_resource(kind: str, resource_id: str, ttl: int | None = None) -> tuple[str, int]:
    exp = int(time.time()) + (ttl or settings.SIGNED_URL_TTL_SECONDS)
    payload = f"{kind}:{resource_id}:{exp}"
    sig = hmac.new(settings.SECRET_KEY.encode(), payload.encode(), hashlib.sha256).digest()
    return f"{_b64(payload.encode())}.{_b64(sig)}", exp


def verify_signed(token: str, kind: str, resource_id: str) -> bool:
    try:
        p64, s64 = token.split(".", 1)
        payload = base64.urlsafe_b64decode(p64 + "=" * (-len(p64) % 4)).decode()
        sig = base64.urlsafe_b64decode(s64 + "=" * (-len(s64) % 4))
        expected = hmac.new(settings.SECRET_KEY.encode(), payload.encode(), hashlib.sha256).digest()
        if not hmac.compare_digest(sig, expected):
            return False
        k, rid, exp = payload.split(":")
        return k == kind and rid == resource_id and int(exp) >= int(time.time())
    except Exception:
        return False


# ---------------------------------------------------------------- RBAC

ROLES = {
    "admin": {
        "name": "Administrador",
        "description": "Usuarios, roles, permisos, catálogos, auditoría y políticas.",
    },
    "specialist": {
        "name": "Especialista",
        "description": "Expedientes autorizados, consentimientos, mediciones, capturas, análisis, simulaciones y reportes.",
    },
    "patient": {
        "name": "Paciente",
        "description": "Autoservicio sobre su propio expediente; revisión reservada a especialistas.",
    },
    "viewer": {
        "name": "Usuario final",
        "description": "Consulta los expedientes y reportes que se le hayan autorizado.",
    },
}

PERMISSIONS = {
    "profiles:create": "Crear expedientes",
    "profiles:read": "Consultar expedientes autorizados",
    "profiles:write": "Actualizar expedientes autorizados",
    "consents:write": "Registrar o revocar consentimientos",
    "measurements:write": "Registrar y corregir mediciones",
    "media:upload": "Cargar capturas",
    "media:read": "Ver capturas (URL firmada)",
    "pose:run": "Ejecutar y revisar análisis de pose",
    "simulations:write": "Crear simulaciones",
    "reports:generate": "Generar reportes",
    "reports:read": "Descargar reportes",
    "users:manage": "Gestionar usuarios y roles",
    "audit:read": "Consultar auditoría",
}

ROLE_PERMISSIONS: dict[str, set[str]] = {
    "admin": set(PERMISSIONS.keys()),
    "specialist": {
        "profiles:create", "profiles:read", "profiles:write", "consents:write", "measurements:write",
        "media:upload", "media:read", "pose:run", "simulations:write", "reports:generate", "reports:read",
    },
    "patient": {"profiles:read", "profiles:write", "consents:write",
                "measurements:write", "media:upload", "media:read", "pose:run",
                "simulations:write", "reports:read"},
    "viewer": {"profiles:read", "media:read", "reports:read"},
}


def has_permission(role: str, perm: str) -> bool:
    return perm in ROLE_PERMISSIONS.get(role, set())
