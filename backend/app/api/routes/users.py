from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import require
from app.core.errors import AppError
from app.core.security import PERMISSIONS, ROLE_PERMISSIONS, ROLES, hash_password
from app.db.session import get_db
from app.models import User
from app.schemas import UserCreate, UserOut, UserUpdate
from app.services import audit

router = APIRouter(tags=["administración"])


@router.get("/users", response_model=list[UserOut])
def list_users(user: User = Depends(require("users:manage")), db: Session = Depends(get_db)):
    return list(db.scalars(select(User).where(User.organization_id == user.organization_id).order_by(User.created_at)))


@router.get("/users/directory")
def directory(user: User = Depends(require("profiles:read")), db: Session = Depends(get_db)):
    """Listado mínimo (id, nombre, rol) para conceder accesos a expedientes."""
    if user.role == "patient":
        raise AppError(403, "El directorio de usuarios es exclusivo del personal")
    rows = db.scalars(select(User).where(User.organization_id == user.organization_id, User.status == "active").order_by(User.full_name))
    return [{"id": u.id, "full_name": u.full_name, "email": u.email, "role": u.role} for u in rows]


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(body: UserCreate, request: Request, admin: User = Depends(require("users:manage")), db: Session = Depends(get_db)):
    if db.scalar(select(User).where(func.lower(User.email) == body.email.lower())):
        raise AppError(409, "Ya existe un usuario con ese correo")
    u = User(organization_id=admin.organization_id, email=body.email.lower(), full_name=body.full_name,
             password_hash=hash_password(body.password), role=body.role)
    db.add(u)
    db.commit()
    audit.record(db, request, admin, "user.create", "user", u.id, details={"role": u.role})
    return u


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(user_id: str, body: UserUpdate, request: Request, admin: User = Depends(require("users:manage")), db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if not u or u.organization_id != admin.organization_id:
        raise AppError(404, "Usuario no encontrado")
    changes = body.model_dump(exclude_unset=True)
    if u.id == admin.id and (changes.get("role") not in (None, "admin") or changes.get("status") == "disabled"):
        raise AppError(409, "No puedes quitarte el rol de administrador ni desactivar tu propia cuenta")
    if "password" in changes and changes["password"]:
        u.password_hash = hash_password(changes.pop("password"))
    else:
        changes.pop("password", None)
    for k, v in changes.items():
        if v is not None:
            setattr(u, k, v)
    db.commit()
    audit.record(db, request, admin, "user.update", "user", u.id, details={k: v for k, v in changes.items() if k != "password"})
    return u


@router.get("/roles")
def roles(_: User = Depends(require("profiles:read"))):
    return {
        "roles": [{"code": c, **r, "permissions": sorted(ROLE_PERMISSIONS[c])} for c, r in ROLES.items()],
        "permissions": [{"code": c, "label": lbl} for c, lbl in PERMISSIONS.items()],
    }
