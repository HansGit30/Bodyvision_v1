"""Motor de escenarios hipotéticos (ilustrativo). Nunca modifica mediciones observadas."""
from __future__ import annotations

from typing import Any

from app.services.catalog import bmi, fat_index

ENGINE_VERSION = "bodyvision-morph 1.0.0"

WARNINGS = [
    "SIMULACIÓN: escenario hipotético ilustrativo; no es una medición ni una predicción clínica.",
    "La deformación 3D es una aproximación visual paramétrica sin validación anatómica.",
    "No sustituye la evaluación de un profesional de la salud.",
]


def bmi_category(v: float | None) -> str:
    if v is None:
        return "sin datos"
    if v < 18.5:
        return "bajo peso"
    if v < 25:
        return "normal"
    if v < 30:
        return "sobrepeso"
    return "obesidad"


def run(base: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
    """base: {sex, weight_kg, height_cm, body_fat_pct, muscle_pct, ...} (copia inmutable)."""
    w0 = base.get("weight_kg")
    h = base.get("height_cm")
    w1 = float(params["target_weight_kg"])
    b0 = bmi(w0, h)
    b1 = bmi(w1, h)
    fat0 = base.get("body_fat_pct")
    fat1 = None
    if fat0 is not None:
        fat1 = round(max(3.0, min(65.0, fat0 + float(params.get("body_fat_delta_pct", 0)))), 1)
    musc0 = base.get("muscle_pct")
    musc1 = None
    if musc0 is not None:
        musc1 = round(max(10.0, min(70.0, musc0 * (1 + float(params.get("muscle_delta_pct", 0)) / 100))), 1)
    dw = round(w1 - w0, 1) if w0 else None
    fi0 = fat_index(b0)
    # El índice visual combina IMC y el cambio de grasa solicitado (escala ilustrativa).
    fi1 = round(max(-0.6, min(2.0, fat_index(b1) + float(params.get("body_fat_delta_pct", 0)) / 40.0)), 3)
    return {
        "bmi_base": b0,
        "bmi_scenario": b1,
        "bmi_category_base": bmi_category(b0),
        "bmi_category_scenario": bmi_category(b1),
        "delta_weight_kg": dw,
        "body_fat_pct_scenario": fat1,
        "muscle_pct_scenario": musc1,
        "estimated_waist_delta_cm": round(dw * 0.9, 1) if dw is not None else None,
        "fat_index_base": fi0,
        "fat_index_scenario": fi1,
        "muscle_index_scenario": round(float(params.get("muscle_delta_pct", 0)) / 30.0, 3),
        "warnings": WARNINGS,
        "label": "SIMULACIÓN",
    }
