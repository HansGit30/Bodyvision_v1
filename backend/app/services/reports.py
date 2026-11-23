"""Reportes trazables PDF/CSV (Documento Maestro §11.2)."""
from __future__ import annotations

import csv
import hashlib
import io
import uuid
from datetime import UTC, date, datetime
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from app.core.config import settings
from app.models import Measurement, PoseAnalysis, Profile, Simulation, User
from app.services.catalog import METRICS, bmi

NAVY = colors.HexColor("#0a1a33")
CYAN = colors.HexColor("#14b8d4")
SOFT = colors.HexColor("#e8f6fb")

METHOD_ES = {"manual": "Manual", "device": "Dispositivo", "visual_estimate": "Estimación visual", "self_reported": "Declarado por paciente (no verificado)"}
SOURCE_ES = {"observed_manual": "Registrado por profesional", "visual_estimate": "Estimación visual", "self_reported": "Declarado por paciente (no verificado)", "self_reported": "Declarado por paciente (no verificado)"}

LIMITATIONS = [
    "BODYVISION AI no es un dispositivo médico ni una herramienta diagnóstica.",
    "Los landmarks de pose son estimaciones visuales: no equivalen a perímetros, composición corporal ni mediciones clínicas.",
    "La visualización 3D es una reconstrucción aproximada sobre un activo anatómico genérico (Z-Anatomy, CC BY-SA 4.0).",
    "Las simulaciones son escenarios hipotéticos ilustrativos y nunca modifican las mediciones observadas.",
    "Los periodos sin registros se indican como faltantes; no se interpolan valores.",
]


def _fmt_dt(d: datetime | None) -> str:
    return d.astimezone(UTC).strftime("%Y-%m-%d %H:%M UTC") if d else "—"


def _within(m: Measurement, p_from: date | None, p_to: date | None) -> bool:
    d = m.measured_at.date()
    return (not p_from or d >= p_from) and (not p_to or d <= p_to)


def build_csv(profile: Profile, rows: list[Measurement], user: User, p_from, p_to) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["# BODYVISION AI — Exportación de mediciones"])
    w.writerow(["# Expediente", profile.display_code])
    w.writerow(["# Periodo", p_from.isoformat() if p_from else "inicio", p_to.isoformat() if p_to else "hoy"])
    w.writerow(["# Generado", _fmt_dt(datetime.now(UTC)), "por", user.email])
    w.writerow(["# Nota", "Incluye registros activos y corregidos; las correcciones conservan el id del registro sustituido."])
    w.writerow(["id", "metrica", "etiqueta", "valor", "unidad", "metodo", "tipo_dato", "fecha_medicion", "estado", "sustituye_a", "motivo_correccion", "notas"])
    for m in rows:
        if not _within(m, p_from, p_to):
            continue
        meta = METRICS.get(m.metric_code)
        w.writerow([m.id, m.metric_code, meta.label if meta else m.metric_code, m.value, m.unit, m.method, m.source_type,
                    m.measured_at.isoformat(), m.status, m.supersedes_id or "", m.correction_reason, m.notes])
    return ("﻿" + buf.getvalue()).encode("utf-8")


def build_pdf(profile: Profile, rows: list[Measurement], analyses: list[PoseAnalysis], sims: list[Simulation],
              user: User, p_from, p_to) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=18 * mm, bottomMargin=16 * mm,
                            title=f"Reporte {profile.display_code}", author="BODYVISION AI")
    ss = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=ss["Heading1"], textColor=NAVY, fontSize=18, spaceAfter=4)
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], textColor=NAVY, fontSize=12.5, spaceBefore=10, spaceAfter=4)
    body = ParagraphStyle("b", parent=ss["BodyText"], fontSize=9, leading=12, alignment=TA_LEFT)
    small = ParagraphStyle("s", parent=body, fontSize=7.8, leading=10, textColor=colors.HexColor("#3c4b63"))
    tag = ParagraphStyle("t", parent=body, textColor=CYAN, fontSize=8, leading=10)

    def table(data: list[list[Any]], widths: list[float] | None = None) -> Table:
        t = Table(data, colWidths=widths, repeatRows=1)
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), NAVY), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTSIZE", (0, 0), (-1, -1), 8), ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, SOFT]),
            ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#c7d6e6")),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        return t

    in_period = [m for m in rows if _within(m, p_from, p_to)]
    active = [m for m in in_period if m.status == "active"]
    latest: dict[str, Measurement] = {}
    for m in active:
        latest[m.metric_code] = m

    story: list[Any] = []
    story.append(Paragraph("BODYVISION AI · Reporte trazable", h1))
    story.append(Paragraph("Análisis · Simulación · Transformación — documento generado automáticamente", tag))
    story.append(Spacer(1, 6))

    story.append(Paragraph("1. Identificación", h2))
    story.append(table([
        ["Código de expediente", "Sexo", "Periodo", "Estado"],
        [profile.display_code, "Femenino" if profile.sex == "F" else "Masculino",
         f"{p_from.isoformat() if p_from else 'inicio'} → {p_to.isoformat() if p_to else 'hoy'}", profile.status],
    ], [45 * mm, 30 * mm, 60 * mm, 40 * mm]))
    story.append(Paragraph("Se minimizan datos personales: el reporte identifica el expediente por código.", small))

    story.append(Paragraph("2. Resumen", h2))
    w = latest.get("weight")
    h = latest.get("height")
    b = bmi(w.value if w else None, h.value if h else None)
    summary = [["Indicador", "Valor", "Fecha", "Método"]]
    for code in ("weight", "height", "waist", "hip", "body_fat", "muscle_mass"):
        if code in latest:
            m = latest[code]
            summary.append([METRICS[code].label, f"{m.value:g} {m.unit}", m.measured_at.date().isoformat(), METHOD_ES.get(m.method, m.method)])
    if b is not None:
        summary.append(["IMC (calculado)", f"{b:g} kg/m²", "derivado", "peso / estatura²"])
    if len(summary) == 1:
        summary.append(["Sin mediciones en el periodo", "—", "—", "—"])
    story.append(table(summary, [60 * mm, 35 * mm, 35 * mm, 45 * mm]))
    reviewed = sum(1 for a in analyses if a.review_status == "approved")
    story.append(Paragraph(f"Análisis de pose en el periodo: {len(analyses)} (revisados y aprobados: {reviewed}).", small))

    story.append(Paragraph("3. Mediciones", h2))
    mrows = [["Fecha", "Métrica", "Valor", "Método", "Tipo", "Estado"]]
    for m in in_period:
        meta = METRICS.get(m.metric_code)
        st = "Corrección" if m.supersedes_id else ("Sustituida" if m.status == "superseded" else "Activa")
        mrows.append([m.measured_at.date().isoformat(), meta.label if meta else m.metric_code, f"{m.value:g} {m.unit}",
                      METHOD_ES.get(m.method, m.method), SOURCE_ES.get(m.source_type, m.source_type), st])
    if len(mrows) == 1:
        mrows.append(["—", "Sin registros", "—", "—", "—", "—"])
    story.append(table(mrows, [24 * mm, 46 * mm, 26 * mm, 28 * mm, 28 * mm, 23 * mm]))

    story.append(Paragraph("4. Análisis visual (ESTIMACIÓN)", h2))
    arows = [["Fecha", "Motor / versión", "Estado", "Calidad", "Advertencias"]]
    for a in analyses:
        warn = "; ".join(f.get("code", "") for f in (a.quality_flags or [])) or "ninguna"
        arows.append([a.created_at.date().isoformat(), Paragraph(f"{a.engine} · {a.model_name} {a.model_version}", small),
                      f"{a.status} / {a.review_status}", f"{a.quality_score:.0f}%" if a.quality_score is not None else "—",
                      Paragraph(warn, small)])
    if len(arows) == 1:
        arows.append(["—", "Sin análisis", "—", "—", "—"])
    story.append(table(arows, [22 * mm, 50 * mm, 34 * mm, 18 * mm, 51 * mm]))

    story.append(Paragraph("5. Visualización 3D (RECONSTRUCCIÓN APROXIMADA)", h2))
    story.append(Paragraph(
        "Activo: atlas anatómico de 7 capas (piel, músculos, órganos, arterias, venas, nervios y huesos; 2.198 estructuras) "
        "derivado de Z-Anatomy / BodyParts3D (CC BY-SA 4.0) vía el repositorio 3d-human-body-anatomy. "
        "Motor de morfología: bodyvision-morph 1.0.0 (deformación paramétrica por sexo, estatura e IMC). Carácter aproximado.", body))

    story.append(Paragraph("6. Comparaciones", h2))
    crow = [["Métrica", "Primer valor", "Último valor", "Cambio", "Registros"]]
    for code, meta in METRICS.items():
        pts = [m for m in active if m.metric_code == code]
        if len(pts) >= 2:
            crow.append([meta.label, f"{pts[0].value:g} ({pts[0].measured_at.date()})", f"{pts[-1].value:g} ({pts[-1].measured_at.date()})",
                         f"{pts[-1].value - pts[0].value:+.1f} {meta.unit}", str(len(pts))])
    if len(crow) == 1:
        crow.append(["Registros insuficientes", "—", "—", "—", "—"])
    story.append(table(crow, [42 * mm, 40 * mm, 40 * mm, 28 * mm, 25 * mm]))
    story.append(Paragraph("Método: diferencia entre el primer y el último registro activo del periodo con unidades compatibles.", small))

    story.append(Paragraph("7. Simulaciones (SIMULACIÓN — hipotético)", h2))
    srows = [["Fecha", "Título", "Parámetros", "Resultado", "Motor"]]
    for s in sims:
        p = s.parameters_json or {}
        o = s.output_metadata or {}
        srows.append([s.created_at.date().isoformat(), Paragraph(s.title, small),
                      Paragraph(f"peso objetivo {p.get('target_weight_kg')} kg; grasa {p.get('body_fat_delta_pct', 0):+} pp; músculo {p.get('muscle_delta_pct', 0):+}%", small),
                      Paragraph(f"IMC {o.get('bmi_base')} → {o.get('bmi_scenario')}", small), s.engine_version])
    if len(srows) == 1:
        srows.append(["—", "Sin simulaciones", "—", "—", "—"])
    story.append(table(srows, [22 * mm, 38 * mm, 55 * mm, 32 * mm, 28 * mm]))

    lim = [Paragraph("8. Limitaciones", h2)] + [Paragraph("• " + t, body) for t in LIMITATIONS]
    story.append(KeepTogether(lim))

    story.append(Paragraph("9. Trazabilidad", h2))
    story.append(table([
        ["Generado", "Responsable", "Registros incluidos", "Versión plataforma"],
        [_fmt_dt(datetime.now(UTC)), user.email, str(len(in_period)), f"{settings.APP_NAME} {settings.APP_VERSION}"],
    ], [45 * mm, 55 * mm, 35 * mm, 40 * mm]))

    def _footer(canvas, d):
        canvas.saveState()
        canvas.setFillColor(NAVY)
        canvas.rect(0, A4[1] - 8 * mm, A4[0], 8 * mm, fill=1, stroke=0)
        canvas.setFillColor(CYAN)
        canvas.setFont("Helvetica-Bold", 8)
        canvas.drawString(16 * mm, A4[1] - 5.5 * mm, "BODYVISION AI")
        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica", 7.5)
        canvas.drawRightString(A4[0] - 16 * mm, A4[1] - 5.5 * mm, f"Expediente {profile.display_code}")
        canvas.setFillColor(colors.HexColor("#5b6b84"))
        canvas.drawString(16 * mm, 9 * mm, "Documento no clínico · datos observados, estimados, reconstruidos y simulados rotulados por separado")
        canvas.drawRightString(A4[0] - 16 * mm, 9 * mm, f"Página {d.page}")
        canvas.restoreState()

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buf.getvalue()


def store(data: bytes, ext: str) -> tuple[str, str, int]:
    key = f"{uuid.uuid4().hex}.{ext}"
    (settings.reports_dir / key).write_bytes(data)
    return key, hashlib.sha256(data).hexdigest(), len(data)
