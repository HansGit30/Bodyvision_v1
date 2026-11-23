"""BODYVISION AI — API FastAPI + servidor del frontend compilado (SPA)."""
from __future__ import annotations

import logging
import mimetypes
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse

from app.api.routes import auth, health, insights, media, profiles, users
from app.core.config import settings
from app.core.errors import install_error_handlers

mimetypes.add_type("application/wasm", ".wasm")
mimetypes.add_type("model/gltf-binary", ".glb")
mimetypes.add_type("application/octet-stream", ".task")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("bodyvision")

CSP = (
    "default-src 'self'; "
    "script-src 'self' 'wasm-unsafe-eval'; "
    "worker-src 'self' blob:; "
    "connect-src 'self' blob: data: https://storage.googleapis.com; "
    "img-src 'self' blob: data:; "
    "media-src 'self' blob:; "
    "style-src 'self' 'unsafe-inline'; "
    "font-src 'self' data:; "
    "frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
)


def run_migrations() -> None:
    from alembic import command
    from alembic.config import Config

    backend_dir = Path(__file__).resolve().parents[1]
    cfg = Config(str(backend_dir / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend_dir / "alembic"))
    cfg.set_main_option("sqlalchemy.url", settings.DATABASE_URL.replace("%", "%%"))
    command.upgrade(cfg, "head")


@asynccontextmanager
async def lifespan(_: FastAPI):
    from app.db.seed import seed
    from app.db.session import SessionLocal

    run_migrations()
    with SessionLocal() as db:
        seed(db)
    if settings.EPHEMERAL_SECRET:
        log.warning("SECRET_KEY no definida: se usa una clave efímera (las sesiones se invalidan al reiniciar).")
    log.info("BODYVISION AI listo · DB=%s · static=%s", "sqlite" if settings.is_sqlite else "postgresql", settings.STATIC_DIR)
    yield


app = FastAPI(
    title="BODYVISION AI API",
    version=settings.APP_VERSION,
    description="Expedientes, mediciones trazables, captura, análisis de pose, visor 3D, simulación y reportes.",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url=None,
    openapi_url="/api/v1/openapi.json",
)
install_error_handlers(app)
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Correlation-ID"],
    expose_headers=["X-Correlation-ID"],
)


@app.middleware("http")
async def correlation_and_headers(request: Request, call_next):
    cid = request.headers.get("x-correlation-id") or uuid.uuid4().hex[:16]
    request.state.correlation_id = cid[:40]
    t0 = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Correlation-ID"] = request.state.correlation_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(self), microphone=(), geolocation=()"
    if request.url.path.startswith("/docs"):
        pass  # Swagger UI carga recursos de su CDN
    elif not request.url.path.startswith("/api/"):
        response.headers["Content-Security-Policy"] = CSP
        response.headers["X-Frame-Options"] = "DENY"
    if request.url.path.startswith("/api/"):
        ms = (time.perf_counter() - t0) * 1000
        log.info("%s %s %s %.0fms cid=%s", request.method, request.url.path, response.status_code, ms, request.state.correlation_id)
    return response


API = "/api/v1"
app.include_router(health.router, prefix="/api")  # alias /api/health (documento técnico)
app.include_router(health.router, prefix=API)
for r in (auth.router, users.router, profiles.router, media.router, insights.router):
    app.include_router(r, prefix=API)


# ---------------------------------------------------------------- SPA (frontend compilado)
STATIC = Path(settings.STATIC_DIR)


@app.api_route("/api/{rest:path}", methods=["GET", "POST", "PATCH", "DELETE", "PUT"], include_in_schema=False)
def api_not_found(rest: str):
    return JSONResponse({"error": {"code": "NOT_FOUND", "message": "Ruta de API inexistente", "correlation_id": "-"}}, status_code=404)


@app.api_route("/{full_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
def spa(full_path: str):
    if not STATIC.exists():
        return JSONResponse({"service": settings.APP_NAME, "message": "Frontend no compilado. Ejecuta `npm run build` en /frontend.", "docs": "/docs"})
    target = (STATIC / full_path).resolve()
    if full_path and STATIC.resolve() in target.parents and target.is_file():
        headers = {}
        if full_path.startswith("assets/"):
            headers["Cache-Control"] = "public, max-age=31536000, immutable"
        elif full_path.startswith(("models/", "mediapipe/", "draco/")):
            headers["Cache-Control"] = "public, max-age=604800"
        return FileResponse(target, headers=headers)
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-cache"})
