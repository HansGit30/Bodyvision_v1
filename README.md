# BODYVISION AI · Análisis · Simulación · Transformación

Plataforma web para gestionar expedientes corporales, registrar mediciones trazables, capturar imágenes o video con la cámara para extraer los **33 puntos de movimiento** (MediaPipe Pose), explorar un **atlas anatómico 3D por capas** que se adapta al sexo, la estatura y el peso de cada persona, simular la **progresión de enfermedades** y **escenarios de cambio corporal**, y generar **reportes PDF/CSV** trazables.

> Herramienta **no clínica**. Cada dato se rotula como OBSERVADO, ESTIMACIÓN VISUAL, RECONSTRUCCIÓN APROXIMADA o SIMULACIÓN.

## Inicio rápido

### Opción A — Docker (recomendado)
```bash
docker compose up --build
# abre http://localhost:8000
```
Levanta PostgreSQL 16 + la aplicación (API + frontend en la misma imagen). Las migraciones Alembic y los datos de demostración se aplican solos al arrancar.

### Opción B — Desarrollo local sin Docker
```bash
# Backend (Python 3.12+)
cd backend
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000               # usa SQLite por defecto

# Frontend (Node 20+), en otra terminal
cd frontend
npm install                                             # copia WASM de MediaPipe y Draco a public/
npm run dev                                             # http://localhost:5173 (proxy /api → :8000)
```

### Cuentas de demostración (expedientes ficticios)
| Rol | Correo | Contraseña |
|---|---|---|
| Administrador | admin@bodyvision.ai | `BodyVision2026!` (o la de `ADMIN_PASSWORD`) |
| Especialista | especialista@bodyvision.ai | `Especialista2026!` |
| Usuario final | usuario@bodyvision.ai | `Usuario2026!` |

Desactiva los datos demo con `SEED_DEMO=false`.

## Despliegue en Render
1. Sube este proyecto a un repositorio de GitHub/GitLab.
2. En Render: **New → Blueprint** y selecciona el repositorio (usa `render.yaml`).
3. Se crean el servicio web Docker (`/api/health` como health check) y una base PostgreSQL. `SECRET_KEY` se genera automáticamente; define `ADMIN_PASSWORD`.
4. Tamaño de imagen ≈ **260 MB** (límite pedido: 500 MB): python:3.13-slim + dependencias (95 MB) + frontend y modelos 3D (27 MB) + modelo de pose (9 MB).

Notas: en el plan gratuito el disco es efímero (las capturas subidas se pierden al reiniciar; agrega un *Persistent Disk* montado en `/data` para conservarlas). La cámara del navegador requiere **HTTPS** (Render lo da por defecto).

## Módulos
| Módulo | Qué hace |
|---|---|
| Login | JWT, límite de intentos, roles (admin, especialista, usuario final). |
| Dashboard | Resumen del sistema, KPIs, holograma 3D interactivo, evolución corporal, composición y actividad. |
| Expedientes | Código único, búsqueda, paginación, accesos por expediente (propietario/edición/lectura), archivado. |
| Consentimiento | Finalidad, versión, aceptación, revocación; sin consentimiento no se cargan imágenes. |
| Mediciones | Catálogo con unidades y rangos, método, fecha; correcciones **sin perder el original**. |
| Captura corporal | Cámara en vivo o foto; esqueleto de 33 puntos en tiempo real, control de calidad, ángulos articulares, grabación de movimiento (6 s). |
| Análisis IA | Procesamiento asíncrono (queued → completed/needs_review), banderas de calidad, métricas posturales, rango de movimiento, esqueleto 3D, revisión del especialista. |
| Visor 3D | Ver detalle abajo. |
| Analítica | Series por métrica, IMC derivado, cambios de método, periodos faltantes, comparación entre fechas. |
| Simulador | Base vs. escenario en 3D lado a lado; los escenarios se guardan aparte y nunca tocan las mediciones. |
| Reportes | PDF (9 secciones trazables) y CSV con checksum, descarga autenticada y auditada. |
| Administración | Usuarios, matriz RBAC y auditoría con `correlation_id`. |

### Visor anatómico 3D
- Atlas de **2.198 estructuras en 7 capas**: piel, músculos, órganos, arterias, venas, nervios y huesos. Vistas rápidas «solo órganos», «solo venas», «vasos sanguíneos», «solo huesos», etc., o capas combinadas con opacidad.
- **Nombre en español al pasar el cursor** (sistema y lateralidad); clic para seleccionar, enfocar o aislar.
- **Hombre / mujer**: hombros, cintura y pelvis (en todas las capas), volumen mamario y glúteo, cabello largo y top deportivo.
- **Peso y estatura**: al subir o bajar el peso, la piel se deforma según un mapa regional de grasa subcutánea distinto para cada sexo. La transición es animada.
- **Animación de escaneo**: un haz recorre el cuerpo, revela esqueleto y órganos en holograma y restaura la piel.
- Rotación **360°**, vistas frontal/posterior/laterales, zoom, reinicio y pantalla completa.
- Modos **Realista / Holograma / Rayos X / Mapa térmico**.
- **Malla (wireframe)** real de la geometría: apagada, superpuesta o solo malla, con control de opacidad.
- **Control térmico**: métrica (grosor subcutáneo estimado o cambio respecto al peso del expediente), escala mín/máx con modo automático, paleta térmica o divergente, isolíneas, leyenda en cm y fuente del dato.
- **Progresión de enfermedades** (educativo): 14 enfermedades frecuentes con etapas, reproducción ▶ y deslizador. Los órganos afectados cambian de color, crecen o se atrofian y la enfermedad se extiende a otros órganos. Incluye la descripción oficial en español desde la **API de MedlinePlus Connect** (Biblioteca Nacional de Medicina de EE. UU.) por código CIE-10.
- **Vida**: latido, respiración y flujo sanguíneo ilustrativos.
- Landmarks MediaPipe del último análisis superpuestos en 3D.

Enfermedades incluidas: cardiopatía isquémica, hipertensión, insuficiencia cardiaca, diabetes tipo 2, hígado graso → cirrosis, EPOC, cáncer de pulmón con metástasis, ACV isquémico, Alzheimer, osteoporosis, artrosis de rodilla, enfermedad renal crónica, cáncer colorrectal y hernia discal con ciática.

## Arquitectura
```
frontend/  React 19 + TypeScript + Vite + React Three Fiber + Drei + three-mesh-bvh + Recharts + MediaPipe Tasks Vision
  src/features/{auth,dashboard,profiles,consent,measurements,capture,pose-analysis,body-viewer,analytics,simulations,reports,admin}
  src/features/body-viewer/engine  AnatomyRig (capas, materiales, BVH, escaneo, enfermedades), morph (sexo/peso), diseases, names_es.json
backend/   FastAPI + SQLAlchemy 2 + Alembic + PostgreSQL/SQLite + Pillow + ReportLab
  app/api/routes  auth, users, profiles, media (+pose), insights (dashboard, analítica, 3D, enfermedades, simulaciones, reportes, auditoría)
  app/services    catálogo, auditoría, media (re-encode sin EXIF), pose (calidad + métricas), simulación, reportes, MedlinePlus
  app/workers     procesamiento asíncrono de análisis de pose
  tests/          unitarias, integración (flujo E2E de API) y seguridad (IDOR, RBAC)
```
API documentada en `/docs` (OpenAPI en `/api/v1/openapi.json`). Salud: `/api/health`.

### Seguridad
Contraseñas bcrypt, JWT HS256, RBAC por permiso más acceso explícito por expediente (404 ante accesos ajenos), consentimiento obligatorio para imágenes, validación del contenido real de los archivos (sin EXIF/GPS, límite de tamaño, protección ante *decompression bombs*), imágenes privadas servidas solo mediante **URL firmada de 5 minutos**, CSP estricta, cabeceras de seguridad, límite de intentos de login, auditoría de accesos, descargas y cambios, y errores con `correlation_id`.

### Pruebas
```bash
cd backend && pytest -q                                         # 24 pruebas (SQLite)
TEST_DATABASE_URL=postgresql://user:pass@host/db pytest -q      # mismas pruebas en PostgreSQL
cd frontend && npm run typecheck && npm run build
```

## Créditos y licencias
- Modelos anatómicos: **Z-Anatomy** / BodyParts3D (DBCLS), licencia **CC BY-SA 4.0**, convertidos a la web por el repositorio [SeemaBansal1/3d-human-body-anatomy](https://github.com/SeemaBansal1/3d-human-body-anatomy) (motor de materiales procedurales adaptado de ese proyecto).
- MediaPipe Pose Landmarker (Google, Apache 2.0). El WASM se sirve desde el mismo origen; el modelo `pose_landmarker_full.task` se descarga durante el build de Docker o, si falla, desde el bucket oficial de Google en el navegador.
- Información de enfermedades: MedlinePlus Connect (NLM), servicio público.
- Traducción al español de las 1.420 denominaciones anatómicas: incluida en `names_es.json`.
