# syntax=docker/dockerfile:1
# BODYVISION AI — imagen única (API FastAPI + frontend compilado). Tamaño final aprox. 260 MB.

# ---------- 1) Frontend (React + TS + Vite) ----------
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
COPY frontend/scripts ./scripts
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# prebuild: copia WASM de MediaPipe/Draco e intenta descargar el modelo oficial pose_landmarker_full.task
RUN npm run build && rm -rf node_modules

# ---------- 2) Runtime Python ----------
FROM python:3.13-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    ENVIRONMENT=production \
    STATIC_DIR=/app/static \
    UPLOAD_DIR=/data/uploads \
    PORT=8000
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
 && find /usr/local/lib/python3.13 -depth \( -name '__pycache__' -o -name 'tests' -o -name '*.pyc' \) -exec rm -rf {} + \
 && useradd --create-home --uid 10001 bodyvision
COPY backend/app ./app
COPY backend/alembic ./alembic
COPY backend/alembic.ini ./
COPY --from=web /web/dist /app/static
RUN mkdir -p /data/uploads && chown -R bodyvision:bodyvision /data /app
USER bodyvision
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD python -c "import os,urllib.request;urllib.request.urlopen('http://127.0.0.1:%s/api/health' % os.environ.get('PORT','8000'), timeout=4)"
# Las migraciones Alembic y los datos iniciales se aplican al arrancar (lifespan).
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*' --timeout-keep-alive 30"]
