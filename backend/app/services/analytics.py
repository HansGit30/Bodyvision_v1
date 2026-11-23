"""Analítica temporal: series por métrica, estadísticos, cambios de método y faltantes."""
from __future__ import annotations

from statistics import mean
from typing import Any

from app.models import Measurement
from app.services.catalog import METRICS


def series_for(rows: list[Measurement], metric: str) -> dict[str, Any]:
    pts = [r for r in rows if r.metric_code == metric]
    meta = METRICS.get(metric)
    data = [{
        "id": r.id, "date": r.measured_at.isoformat(), "value": r.value, "unit": r.unit,
        "method": r.method, "source_type": r.source_type, "corrected": bool(r.supersedes_id),
    } for r in pts]
    method_changes = []
    for a, b in zip(pts, pts[1:], strict=False):
        if a.method != b.method:
            method_changes.append({"date": b.measured_at.isoformat(), "from": a.method, "to": b.method})
    gaps = []
    for a, b in zip(pts, pts[1:], strict=False):
        days = (b.measured_at - a.measured_at).days
        if days > 45:
            gaps.append({"from": a.measured_at.isoformat(), "to": b.measured_at.isoformat(), "days": days})
    stats: dict[str, Any] = {"count": len(pts)}
    if pts:
        vals = [p.value for p in pts]
        stats.update({
            "first": vals[0], "last": vals[-1], "min": min(vals), "max": max(vals),
            "mean": round(mean(vals), 2), "change": round(vals[-1] - vals[0], 2),
            "change_pct": round((vals[-1] - vals[0]) / vals[0] * 100, 2) if vals[0] else None,
        })
    return {
        "metric": metric, "label": meta.label if meta else metric, "unit": meta.unit if meta else "",
        "points": data, "stats": stats, "method_changes": method_changes, "gaps": gaps,
        "calculation": "Diferencia último − primero dentro del periodo; solo registros activos (las correcciones reemplazan al original).",
    }


def compare(rows: list[Measurement], date_a: str, date_b: str) -> list[dict[str, Any]]:
    """Valor más cercano (≤ fecha) de cada métrica en dos fechas, solo unidades compatibles."""
    out = []
    for code, meta in METRICS.items():
        pts = [r for r in rows if r.metric_code == code]
        if not pts:
            continue

        def at(d: str):
            c = [p for p in pts if p.measured_at.date().isoformat() <= d]
            return c[-1] if c else None

        a, b = at(date_a), at(date_b)
        out.append({
            "metric": code, "label": meta.label, "unit": meta.unit,
            "a": a.value if a else None, "a_date": a.measured_at.isoformat() if a else None,
            "b": b.value if b else None, "b_date": b.measured_at.isoformat() if b else None,
            "delta": round(b.value - a.value, 2) if a and b else None,
            "method_a": a.method if a else None, "method_b": b.method if b else None,
            "method_changed": bool(a and b and a.method != b.method),
        })
    return out
