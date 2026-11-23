"""Dashboard, analítica, modelos 3D, simulaciones, reportes y auditoría."""
from __future__ import annotations

from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_profile_checked, require, visible_profile_ids_query
from app.core.config import settings
from app.core.errors import AppError
from app.db.session import get_db
from app.models import AuditEvent, BodyModel, Measurement, PoseAnalysis, Profile, Report, Simulation, User
from app.repositories.measurements import active_measurements, base_reference
from app.schemas import AuditOut, Page, ReportCreate, ReportOut, SimulationCreate, SimulationOut
from app.services import analytics, audit, medlineplus
from app.services import reports as report_service
from app.services import simulation as sim_service
from app.services.catalog import METRICS, bmi, fat_index

router = APIRouter()

MONTHS_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]
ACTION_ES = {
    "auth.login": "Inicio de sesión", "auth.logout": "Cierre de sesión", "profile.create": "Expediente creado",
    "profile.update": "Expediente actualizado", "profile.read": "Expediente consultado", "measurement.create": "Medición registrada",
    "measurement.correct": "Medición corregida", "consent.create": "Consentimiento registrado", "consent.revoke": "Consentimiento revocado",
    "media.upload": "Captura cargada", "media.access": "Captura visualizada", "media.delete": "Captura eliminada",
    "pose.create": "Análisis IA iniciado", "pose.processed": "Análisis IA procesado", "pose.review": "Análisis IA revisado",
    "simulation.create": "Simulación creada", "simulation.archive": "Simulación archivada", "report.generate": "Reporte generado",
    "report.download": "Reporte descargado", "user.create": "Usuario creado", "user.update": "Usuario actualizado",
    "profile.access.grant": "Acceso concedido", "profile.access.revoke": "Acceso revocado",
}


# ---------------------------------------------------------------- dashboard
@router.get("/dashboard/summary", tags=["dashboard"])
def dashboard(user: User = Depends(require("profiles:read")), db: Session = Depends(get_db)):
    vis = visible_profile_ids_query(user)
    profiles = db.scalar(select(func.count()).select_from(Profile).where(Profile.id.in_(vis), Profile.status == "active")) or 0
    measurements = db.scalar(select(func.count()).select_from(Measurement).where(Measurement.profile_id.in_(vis), Measurement.status == "active")) or 0
    analyses = db.scalar(select(func.count()).select_from(PoseAnalysis).where(PoseAnalysis.profile_id.in_(vis))) or 0
    avg_q = db.scalar(select(func.avg(PoseAnalysis.quality_score)).where(PoseAnalysis.profile_id.in_(vis), PoseAnalysis.quality_score.is_not(None)))
    sims = db.scalar(select(func.count()).select_from(Simulation).where(Simulation.profile_id.in_(vis), Simulation.status != "archived")) or 0

    # Evolución: promedio mensual (últimos 6 meses) de peso, IMC y grasa entre expedientes visibles.
    since = datetime.now(UTC) - timedelta(days=186)
    rows = list(db.scalars(select(Measurement).where(
        Measurement.profile_id.in_(vis), Measurement.status == "active", Measurement.measured_at >= since,
        Measurement.metric_code.in_(["weight", "body_fat", "height", "muscle_mass"]))))
    heights: dict[str, float] = {}
    for m in db.scalars(select(Measurement).where(Measurement.profile_id.in_(vis), Measurement.status == "active", Measurement.metric_code == "height").order_by(Measurement.measured_at)):
        heights[m.profile_id] = m.value
    buckets: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for m in rows:
        k = m.measured_at.strftime("%Y-%m")
        if m.metric_code == "weight":
            buckets[k]["peso"].append(m.value)
            b = bmi(m.value, heights.get(m.profile_id))
            if b:
                buckets[k]["imc"].append(b)
        elif m.metric_code == "body_fat":
            buckets[k]["grasa"].append(m.value)
    trend = []
    for k in sorted(buckets):
        y, mo = k.split("-")
        trend.append({"month": f"{MONTHS_ES[int(mo) - 1]} {y[2:]}",
                      **{n: round(sum(v) / len(v), 1) for n, v in buckets[k].items() if v}})

    # Composición: último registro de grasa / masa muscular por expediente visible.
    latest_fat: dict[str, float] = {}
    latest_mus: dict[str, float] = {}
    for m in db.scalars(select(Measurement).where(Measurement.profile_id.in_(vis), Measurement.status == "active",
                                                  Measurement.metric_code.in_(["body_fat", "muscle_mass"])).order_by(Measurement.measured_at)):
        (latest_fat if m.metric_code == "body_fat" else latest_mus)[m.profile_id] = m.value
    composition = None
    if latest_fat:
        fat = round(sum(latest_fat.values()) / len(latest_fat), 1)
        composition = {"fat_pct": fat, "lean_pct": round(100 - fat, 1), "muscle_pct": round(sum(latest_mus.values()) / len(latest_mus), 1) if latest_mus else None,
                       "profiles": len(latest_fat), "source": "Último registro observado (dispositivo/manual) por expediente"}

    q = select(AuditEvent).where(AuditEvent.action.in_(list(ACTION_ES)), AuditEvent.action != "profile.read")
    if user.role == "admin":
        q = q.where((AuditEvent.organization_id == user.organization_id) | (AuditEvent.organization_id.is_(None)))
    else:
        q = q.where(AuditEvent.actor_id == user.id)
    activity = [{"id": e.id, "action": e.action, "label": ACTION_ES.get(e.action, e.action), "actor": e.actor_email,
                 "outcome": e.outcome, "created_at": e.created_at.isoformat(), "resource_type": e.resource_type}
                for e in db.scalars(q.order_by(AuditEvent.created_at.desc()).limit(8))]

    return {
        "kpis": {"profiles": profiles, "measurements": measurements, "analyses": analyses,
                 "avg_quality": round(avg_q, 1) if avg_q is not None else None, "simulations": sims},
        "trend": trend, "composition": composition, "activity": activity,
    }


# ---------------------------------------------------------------- analítica
@router.get("/analytics/{profile_id}", tags=["analítica"])
def analytics_view(
    profile_id: str,
    date_from: date | None = None,
    date_to: date | None = None,
    compare_a: date | None = None,
    compare_b: date | None = None,
    user: User = Depends(require("profiles:read")),
    db: Session = Depends(get_db),
):
    p, _ = get_profile_checked(db, user, profile_id)
    dfrom = datetime.combine(date_from, datetime.min.time(), tzinfo=UTC) if date_from else None
    dto = datetime.combine(date_to, datetime.max.time(), tzinfo=UTC) if date_to else None
    rows = active_measurements(db, p.id, date_from=dfrom, date_to=dto)
    all_rows = active_measurements(db, p.id)
    series = [analytics.series_for(rows, code) for code in METRICS if any(r.metric_code == code for r in rows)]
    # IMC derivado por fecha de peso usando la estatura vigente a esa fecha.
    heights = [r for r in all_rows if r.metric_code == "height"]
    bmi_pts = []
    for r in rows:
        if r.metric_code != "weight":
            continue
        hs = [h for h in heights if h.measured_at <= r.measured_at] or heights[:1]
        b = bmi(r.value, hs[-1].value) if hs else None
        if b:
            bmi_pts.append({"date": r.measured_at.isoformat(), "value": b, "method": "derivado"})
    comparison = analytics.compare(all_rows, compare_a.isoformat(), compare_b.isoformat()) if compare_a and compare_b else None
    return {"profile_id": p.id, "series": series, "bmi": bmi_pts, "comparison": comparison,
            "period": {"from": date_from.isoformat() if date_from else None, "to": date_to.isoformat() if date_to else None}}


# ---------------------------------------------------------------- enfermedades (información externa)
@router.get("/diseases/{icd10}/info", tags=["visor 3D"])
def disease_info(icd10: str, _: User = Depends(require("profiles:read"))):
    """Descripción oficial en español desde MedlinePlus Connect (NLM) por código CIE-10."""
    return medlineplus.lookup(icd10)


# ---------------------------------------------------------------- modelos 3D
@router.get("/profiles/{profile_id}/body-models", tags=["visor 3D"])
def body_models(profile_id: str, user: User = Depends(require("profiles:read")), db: Session = Depends(get_db)):
    p, _ = get_profile_checked(db, user, profile_id)
    assets = list(db.scalars(select(BodyModel).where(BodyModel.profile_id.is_(None)).order_by(BodyModel.asset_key)))
    base = base_reference(db, p)
    b = bmi(base["weight_kg"], base["height_cm"])
    latest_pose = db.scalar(select(PoseAnalysis).where(PoseAnalysis.profile_id == p.id, PoseAnalysis.status == "completed",
                                                       PoseAnalysis.world_landmarks_json.is_not(None)).order_by(PoseAnalysis.created_at.desc()))
    return {
        "assets": [{"asset_key": a.asset_key, "layer": a.layer, "format": a.format, "model_version": a.model_version,
                    "license_ref": a.license_ref, "checksum": a.checksum, "size_bytes": a.size_bytes, "meta": a.meta} for a in assets],
        "reconstruction": {
            "source_type": "reconstruction", "label": "RECONSTRUCCIÓN APROXIMADA", "engine": sim_service.ENGINE_VERSION,
            "sex": p.sex, "height_cm": base["height_cm"], "weight_kg": base["weight_kg"], "bmi": b, "fat_index": fat_index(b),
            "body_fat_pct": base["body_fat_pct"], "muscle_pct": base["muscle_pct"], "source_dates": base["source_dates"],
        },
        "landmarks": {"analysis_id": latest_pose.id, "world": latest_pose.world_landmarks_json, "created_at": latest_pose.created_at.isoformat(),
                      "model_version": latest_pose.model_version, "label": "ESTIMACIÓN VISUAL"} if latest_pose else None,
    }


# ---------------------------------------------------------------- simulaciones
@router.get("/profiles/{profile_id}/simulations", response_model=list[SimulationOut], tags=["simulación"])
def list_simulations(profile_id: str, user: User = Depends(require("profiles:read")), db: Session = Depends(get_db)):
    p, _ = get_profile_checked(db, user, profile_id)
    return list(db.scalars(select(Simulation).where(Simulation.profile_id == p.id, Simulation.status != "archived").order_by(Simulation.created_at.desc())))


@router.post("/profiles/{profile_id}/simulations", response_model=SimulationOut, status_code=201, tags=["simulación"])
def create_simulation(profile_id: str, body: SimulationCreate, request: Request, user: User = Depends(require("simulations:write")), db: Session = Depends(get_db)):
    p, _ = get_profile_checked(db, user, profile_id, need="editor")
    base = base_reference(db, p)
    if not base["weight_kg"] or not base["height_cm"]:
        raise AppError(400, "Se requiere al menos un registro de peso y estatura como estado de referencia")
    params = body.parameters.model_dump()
    sim = Simulation(profile_id=p.id, title=body.title, base_reference=base, parameters_json=params,
                     engine_version=sim_service.ENGINE_VERSION, status="queued", created_by=user.id)
    db.add(sim)
    db.flush()
    try:
        sim.output_metadata = sim_service.run(base, params)
        sim.status = "completed"
    except Exception as exc:  # pragma: no cover
        sim.status, sim.output_metadata = "failed", {"error": str(exc)}
    db.commit()
    audit.record(db, request, user, "simulation.create", "simulation", sim.id, details={"profile": p.display_code, "params": params})
    return sim


@router.get("/simulations/{simulation_id}", response_model=SimulationOut, tags=["simulación"])
def get_simulation(simulation_id: str, user: User = Depends(require("profiles:read")), db: Session = Depends(get_db)):
    s = db.get(Simulation, simulation_id)
    if not s:
        raise AppError(404, "Simulación no encontrada")
    get_profile_checked(db, user, s.profile_id)
    return s


@router.post("/simulations/{simulation_id}/archive", response_model=SimulationOut, tags=["simulación"])
def archive_simulation(simulation_id: str, request: Request, user: User = Depends(require("simulations:write")), db: Session = Depends(get_db)):
    s = db.get(Simulation, simulation_id)
    if not s:
        raise AppError(404, "Simulación no encontrada")
    get_profile_checked(db, user, s.profile_id, need="editor")
    s.status = "archived"
    db.commit()
    audit.record(db, request, user, "simulation.archive", "simulation", s.id)
    return s


# ---------------------------------------------------------------- reportes
def _report_out(r: Report, code: str) -> ReportOut:
    o = ReportOut.model_validate(r)
    o.profile_code = code
    return o


@router.get("/reports", response_model=list[ReportOut], tags=["reportes"])
def list_reports(profile_id: str | None = None, user: User = Depends(require("reports:read")), db: Session = Depends(get_db)):
    q = select(Report, Profile.display_code).join(Profile, Profile.id == Report.profile_id).where(Report.profile_id.in_(visible_profile_ids_query(user)))
    if profile_id:
        q = q.where(Report.profile_id == profile_id)
    rows = list(db.execute(q.order_by(Report.created_at.desc()).limit(200)))
    if user.role == "patient":
        rows = [(r, code) for r, code in rows if _patient_report_approved(db, r)]
    return [_report_out(r, code) for r, code in rows]


@router.post("/profiles/{profile_id}/reports", response_model=ReportOut, status_code=201, tags=["reportes"])
def generate_report(profile_id: str, body: ReportCreate, request: Request, user: User = Depends(require("reports:generate")), db: Session = Depends(get_db)):
    p, _ = get_profile_checked(db, user, profile_id)
    if body.period_from and body.period_to and body.period_from > body.period_to:
        raise AppError(400, "El inicio del periodo debe ser anterior al fin")
    rows = list(db.scalars(select(Measurement).where(Measurement.profile_id == p.id).order_by(Measurement.measured_at, Measurement.created_at)))

    def in_period(d: datetime) -> bool:
        dd = d.date()
        return (not body.period_from or dd >= body.period_from) and (not body.period_to or dd <= body.period_to)

    analyses = [a for a in db.scalars(select(PoseAnalysis).where(PoseAnalysis.profile_id == p.id).order_by(PoseAnalysis.created_at)) if in_period(a.created_at) and a.review_status == "approved"]
    sims = [s for s in db.scalars(select(Simulation).where(Simulation.profile_id == p.id, Simulation.status == "completed").order_by(Simulation.created_at)) if in_period(s.created_at)]
    if body.format == "csv":
        data = report_service.build_csv(p, rows, user, body.period_from, body.period_to)
    else:
        data = report_service.build_pdf(p, rows, analyses, sims, user, body.period_from, body.period_to)
    key, checksum, size = report_service.store(data, body.format)
    r = Report(profile_id=p.id, report_type=body.format, period_from=body.period_from, period_to=body.period_to, storage_key=key,
               checksum=checksum, size_bytes=size, generated_by=user.id,
               source_refs={"measurements": len(rows), "analyses": [a.id for a in analyses], "simulations": [s.id for s in sims]})
    db.add(r)
    db.commit()
    audit.record(db, request, user, "report.generate", "report", r.id, details={"profile": p.display_code, "format": body.format})
    return _report_out(r, p.display_code)


@router.get("/reports/{report_id}/download", tags=["reportes"])
def download_report(report_id: str, request: Request, user: User = Depends(require("reports:read")), db: Session = Depends(get_db)):
    r = db.get(Report, report_id)
    if not r:
        raise AppError(404, "Reporte no encontrado")
    p, _ = get_profile_checked(db, user, r.profile_id)
    if user.role == "patient" and not _patient_report_approved(db, r):
        raise AppError(403, "El reporte requiere revisión profesional")
    path = (settings.reports_dir / r.storage_key).resolve()
    if settings.reports_dir.resolve() not in path.parents or not Path(path).exists():
        raise AppError(404, "El archivo del reporte ya no está disponible")
    audit.record(db, request, user, "report.download", "report", r.id)
    mt = "application/pdf" if r.report_type == "pdf" else "text/csv; charset=utf-8"
    fname = f"BODYVISION_{p.display_code}_{r.created_at.strftime('%Y%m%d_%H%M')}.{r.report_type}"
    return FileResponse(path, media_type=mt, filename=fname, headers={"Cache-Control": "private, no-store"})


# ---------------------------------------------------------------- auditoría
@router.get("/audit-events", response_model=Page[AuditOut], tags=["administración"])
def audit_events(
    action: str | None = Query(default=None, max_length=60),
    actor: str | None = Query(default=None, max_length=255),
    resource_type: str | None = Query(default=None, max_length=40),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(require("audit:read")),
    db: Session = Depends(get_db),
):
    q = select(AuditEvent).where((AuditEvent.organization_id == user.organization_id) | (AuditEvent.organization_id.is_(None)))
    if action:
        q = q.where(AuditEvent.action.like(f"{action}%"))
    if actor:
        q = q.where(func.lower(AuditEvent.actor_email).like(f"%{actor.lower()}%"))
    if resource_type:
        q = q.where(AuditEvent.resource_type == resource_type)
    total = db.scalar(select(func.count()).select_from(q.subquery())) or 0
    items = list(db.scalars(q.order_by(AuditEvent.created_at.desc()).limit(limit).offset(offset)))
    return Page[AuditOut](items=items, total=total, limit=limit, offset=offset)


def _patient_report_approved(db: Session, report: Report) -> bool:
    ids = (report.source_refs or {}).get("analyses", [])
    if not isinstance(ids, list) or not ids:
        return False
    rows = list(db.scalars(select(PoseAnalysis).where(PoseAnalysis.id.in_(ids), PoseAnalysis.profile_id == report.profile_id)))
    return len(rows) == len(ids) and all(a.review_status == "approved" for a in rows)
