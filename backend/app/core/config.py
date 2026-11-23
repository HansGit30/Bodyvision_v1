"""Configuración centralizada (variables de entorno → Settings)."""
from __future__ import annotations

import secrets
from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
PROJECT_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore", case_sensitive=False)

    APP_NAME: str = "BODYVISION AI"
    APP_VERSION: str = "1.0.0"
    ENVIRONMENT: str = "development"  # development | staging | production

    DATABASE_URL: str = f"sqlite:///{(BACKEND_DIR / 'bodyvision.db').as_posix()}"
    SECRET_KEY: str = ""
    ACCESS_TOKEN_MINUTES: int = 480

    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"

    UPLOAD_DIR: str = str(BACKEND_DIR / "uploads")
    MAX_UPLOAD_MB: int = 10
    SIGNED_URL_TTL_SECONDS: int = 300
    MEDIA_RETENTION_DAYS: int = 365

    STATIC_DIR: str = str(PROJECT_DIR / "frontend" / "dist")
    POSE_MODEL_PATH: str = "/app/models/pose_landmarker_full.task"

    ADMIN_EMAIL: str = "admin@bodyvision.ai"
    ADMIN_PASSWORD: str = "BodyVision2026!"
    ADMIN_NAME: str = "Administrador BodyVision"
    SEED_DEMO: bool = True

    EPHEMERAL_SECRET: bool = False
    LOGIN_MAX_ATTEMPTS: int = 8
    LOGIN_WINDOW_SECONDS: int = 900

    @field_validator("DATABASE_URL")
    @classmethod
    def _normalize_db(cls, v: str) -> str:
        v = v.strip()
        # Render / Heroku entregan postgres:// o postgresql://; SQLAlchemy necesita el driver explícito.
        if v.startswith("postgres://"):
            v = "postgresql+psycopg://" + v[len("postgres://"):]
        elif v.startswith("postgresql://"):
            v = "postgresql+psycopg://" + v[len("postgresql://"):]
        return v

    @field_validator("ADMIN_PASSWORD")
    @classmethod
    def _admin_pw(cls, v: str) -> str:
        # Una variable vacía (p. ej. Render con sync:false sin valor) no debe crear una clave vacía.
        return v if v and len(v) >= 8 else "BodyVision2026!"

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def is_sqlite(self) -> bool:
        return self.DATABASE_URL.startswith("sqlite")

    @property
    def media_dir(self) -> Path:
        p = Path(self.UPLOAD_DIR) / "media"
        p.mkdir(parents=True, exist_ok=True)
        return p

    @property
    def reports_dir(self) -> Path:
        p = Path(self.UPLOAD_DIR) / "reports"
        p.mkdir(parents=True, exist_ok=True)
        return p


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    if not s.SECRET_KEY:
        # Sin SECRET_KEY se genera una efímera: los tokens no sobreviven a un reinicio.
        s.SECRET_KEY = secrets.token_urlsafe(48)
        s.EPHEMERAL_SECRET = True
    return s


settings = get_settings()
