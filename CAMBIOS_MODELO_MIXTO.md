# BODYVISION AI — Versión mixta (pacientes + especialistas)

## Qué se ha incorporado

- Registro de pacientes desde el login. Se crea automáticamente un expediente propio sin mediciones inventadas.
- Rol `patient` con acceso restringido al expediente creado por su cuenta, comprobado en el backend.
- El paciente puede declarar **peso** y **estatura**, registrar consentimiento, subir JPG/PNG y ejecutar análisis preliminares.
- Los datos declarados se guardan como `self_reported`; el visor distingue peso del expediente de **peso hipotético** del simulador.
- Los especialistas o administradores autorizados pueden aprobar/rechazar análisis de expedientes a los que tengan acceso. Los pacientes no pueden aprobar.
- Se añade la navegación **Revisión profesional** para personal autorizado.
- Los reportes del paciente solo se liberan cuando contienen análisis aprobados y están generados por personal con permiso. Los reportes previos sin trazabilidad de aprobación permanecen ocultos al paciente.
- Se conserva la anatomía 3D y la arquitectura React/FastAPI/PostgreSQL/Docker.
- Se fija `STATIC_DIR=/app/static` en Compose, para evitar el error de frontend no compilado.

## Ejecución local

Desde la carpeta `bodyvision-ai`:

```powershell
docker compose up --build -d
docker compose ps
```

Abrir http://localhost:8001. En el login seleccionar **Soy paciente · Crear mi cuenta**.

Como paciente, registrar consentimiento en Expediente → Consentimiento antes de subir imágenes.

Como administrador, asignar acceso `editor` al especialista que revisará el expediente (Expediente → Accesos).

## Limitaciones importantes antes de producción

1. El registro público **no verifica el correo electrónico**. Es necesario incorporar confirmación por email y controles antiabuso/CAPTCHA antes de exponerlo a Internet.
2. El sistema actual no dispone de un flujo de solicitud automática de especialista. La asignación de accesos se hace manualmente por un administrador o propietario autorizado.
3. La liberación de reportes de pacientes es conservadora: exige análisis aprobados; no equivale a una firma electrónica profesional ni a un diagnóstico.
4. Las estimaciones MediaPipe no determinan peso, estatura real ni composición corporal.
5. No se ha ejecutado una compilación Docker completa en este entorno. Antes de desplegar, ejecutar `docker compose up --build` y los tests de backend.
6. Cambiar contraseñas y secretos predeterminados antes de usar datos personales reales.

## Comprobaciones

```powershell
docker compose exec app python -m pytest -q tests
```

En algunos Dockerfiles los tests no se incluyen; alternativamente instalar `backend/requirements-dev.txt` y ejecutar pytest desde `backend/` en entorno local.

## Archivos principales modificados

- `backend/app/core/security.py`, `backend/app/api/deps.py`, `backend/app/api/routes/auth.py`
- `backend/app/api/routes/profiles.py`, `backend/app/api/routes/media.py`, `backend/app/api/routes/insights.py`, `backend/app/api/routes/users.py`
- `backend/app/schemas/__init__.py`, `backend/app/services/reports.py`
- `frontend/src/features/auth/LoginPage.tsx`, `frontend/src/features/profiles/ProfileDetailPage.tsx`
- `frontend/src/features/pose-analysis/AnalysisPage.tsx`, `frontend/src/features/body-viewer/BodyViewer.tsx`
- `frontend/src/features/body-viewer/ViewerPage.tsx`, `frontend/src/features/body-viewer/BodyScene.tsx`
- `frontend/src/components/layout/AppLayout.tsx`, `frontend/src/types/index.ts`, `frontend/src/App.tsx`, `docker-compose.yml`
