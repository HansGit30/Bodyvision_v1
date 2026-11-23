"""Catálogo administrado de métricas (metric_code estable, unidad, rangos y método)."""
from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class Metric:
    code: str
    label: str
    unit: str
    min: float
    max: float
    decimals: int
    instructions: str
    group: str


METRICS: dict[str, Metric] = {m.code: m for m in [
    Metric("weight", "Peso corporal", "kg", 20, 350, 1,
           "Báscula calibrada, sin calzado, ropa ligera, preferentemente en ayunas.", "general"),
    Metric("height", "Estatura", "cm", 80, 250, 1,
           "Tallímetro, sin calzado, talones juntos y mirada al frente (plano de Frankfort).", "general"),
    Metric("waist", "Perímetro de cintura", "cm", 40, 250, 1,
           "Cinta métrica en el punto medio entre la última costilla y la cresta ilíaca, al final de una espiración.", "perimetros"),
    Metric("hip", "Perímetro de cadera", "cm", 50, 250, 1,
           "Cinta horizontal en la máxima protuberancia de los glúteos.", "perimetros"),
    Metric("chest", "Perímetro de tórax", "cm", 50, 220, 1,
           "Cinta a la altura de los pezones (mesoesternal), respiración normal.", "perimetros"),
    Metric("neck", "Perímetro de cuello", "cm", 20, 80, 1,
           "Cinta inmediatamente por debajo de la prominencia laríngea.", "perimetros"),
    Metric("arm", "Perímetro de brazo relajado", "cm", 10, 80, 1,
           "Punto medio acromio-radial, brazo relajado al costado.", "perimetros"),
    Metric("thigh", "Perímetro de muslo", "cm", 25, 120, 1,
           "1 cm por debajo del pliegue glúteo, peso repartido en ambas piernas.", "perimetros"),
    Metric("body_fat", "Grasa corporal", "%", 2, 70, 1,
           "Bioimpedancia o plicometría; registrar el dispositivo o la ecuación usada en notas.", "composicion"),
    Metric("muscle_mass", "Masa muscular", "%", 10, 70, 1,
           "Bioimpedancia; registrar el dispositivo en notas.", "composicion"),
]}


def catalog_list() -> list[dict]:
    return [asdict(m) for m in METRICS.values()]


def validate_value(code: str, value: float, unit: str | None) -> tuple[Metric, str]:
    m = METRICS.get(code)
    if not m:
        raise ValueError(f"Métrica desconocida: {code}")
    if unit and unit != m.unit:
        raise ValueError(f"Unidad incompatible para {m.label}: se esperaba {m.unit}")
    if not (m.min <= value <= m.max):
        raise ValueError(f"{m.label} fuera de rango ({m.min}–{m.max} {m.unit})")
    return m, m.unit


def bmi(weight_kg: float | None, height_cm: float | None) -> float | None:
    if not weight_kg or not height_cm:
        return None
    h = height_cm / 100.0
    return round(weight_kg / (h * h), 1)


def fat_index(bmi_value: float | None) -> float:
    """Índice morfológico usado por el visor 3D (0 ≈ IMC 22). Solo visual, no clínico."""
    if bmi_value is None:
        return 0.0
    return round(max(-0.6, min(2.0, (bmi_value - 22.0) / 10.0)), 3)
