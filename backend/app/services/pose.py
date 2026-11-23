"""Evaluación de calidad y métricas derivadas de landmarks MediaPipe Pose (33 puntos).

Los resultados son ESTIMACIONES VISUALES: referencias de postura y alineación aproximada,
no perímetros ni mediciones clínicas (Documento Maestro §9.1).
"""
from __future__ import annotations

import math
from statistics import mean
from typing import Any

NAMES = [
    "nariz", "ojo izq. interno", "ojo izq.", "ojo izq. externo", "ojo der. interno", "ojo der.",
    "ojo der. externo", "oreja izq.", "oreja der.", "boca izq.", "boca der.", "hombro izq.",
    "hombro der.", "codo izq.", "codo der.", "muñeca izq.", "muñeca der.", "meñique izq.",
    "meñique der.", "índice izq.", "índice der.", "pulgar izq.", "pulgar der.", "cadera izq.",
    "cadera der.", "rodilla izq.", "rodilla der.", "tobillo izq.", "tobillo der.", "talón izq.",
    "talón der.", "punta pie izq.", "punta pie der.",
]
KEY_POINTS = [0, 11, 12, 23, 24, 25, 26, 27, 28]
JOINTS = {
    "rodilla_izq": (23, 25, 27),
    "rodilla_der": (24, 26, 28),
    "codo_izq": (11, 13, 15),
    "codo_der": (12, 14, 16),
    "cadera_izq": (11, 23, 25),
    "cadera_der": (12, 24, 26),
    "hombro_izq": (23, 11, 13),
    "hombro_der": (24, 12, 14),
}
JOINT_LABELS = {
    "rodilla_izq": "Rodilla izquierda", "rodilla_der": "Rodilla derecha",
    "codo_izq": "Codo izquierdo", "codo_der": "Codo derecho",
    "cadera_izq": "Cadera izquierda", "cadera_der": "Cadera derecha",
    "hombro_izq": "Hombro izquierdo (abducción)", "hombro_der": "Hombro derecho (abducción)",
}


def _vis(lm: dict) -> float:
    v = lm.get("visibility")
    return 1.0 if v is None else float(v)


def _angle3(a: tuple[float, ...], b: tuple[float, ...], c: tuple[float, ...]) -> float | None:
    ba = [a[i] - b[i] for i in range(len(a))]
    bc = [c[i] - b[i] for i in range(len(c))]
    na = math.sqrt(sum(x * x for x in ba))
    nc = math.sqrt(sum(x * x for x in bc))
    if na < 1e-9 or nc < 1e-9:
        return None
    cos = max(-1.0, min(1.0, sum(ba[i] * bc[i] for i in range(len(ba))) / (na * nc)))
    return round(math.degrees(math.acos(cos)), 1)


def _pt(lms: list[dict], i: int, w: float, h: float, world: bool) -> tuple[float, ...]:
    p = lms[i]
    if world:
        return (float(p["x"]), float(p["y"]), float(p.get("z", 0.0)))
    return (float(p["x"]) * w, float(p["y"]) * h)


def joint_angles(lms: list[dict], world: list[dict] | None, w: float, h: float) -> dict[str, float | None]:
    src, is_world = (world, True) if world and len(world) == 33 else (lms, False)
    out: dict[str, float | None] = {}
    for key, (a, b, c) in JOINTS.items():
        if min(_vis(lms[a]), _vis(lms[b]), _vis(lms[c])) < 0.35:
            out[key] = None
            continue
        out[key] = _angle3(_pt(src, a, w, h, is_world), _pt(src, b, w, h, is_world), _pt(src, c, w, h, is_world))
    return out


def _tilt(lms: list[dict], i: int, j: int, w: float, h: float) -> float | None:
    if min(_vis(lms[i]), _vis(lms[j])) < 0.4:
        return None
    dx = (lms[i]["x"] - lms[j]["x"]) * w
    dy = (lms[i]["y"] - lms[j]["y"]) * h
    if abs(dx) < 1e-6:
        return None
    ang = math.degrees(math.atan2(dy, dx))
    # normaliza a desviación respecto de la horizontal (−90..90)
    if ang > 90:
        ang -= 180
    elif ang < -90:
        ang += 180
    return round(ang, 1)


def _dist(a: dict, b: dict) -> float:
    return math.sqrt((a["x"] - b["x"]) ** 2 + (a["y"] - b["y"]) ** 2 + (a.get("z", 0) - b.get("z", 0)) ** 2)


def static_metrics(lms: list[dict], world: list[dict] | None, w: float, h: float) -> dict[str, Any]:
    m: dict[str, Any] = {}
    m["inclinacion_hombros_deg"] = _tilt(lms, 11, 12, w, h)
    m["inclinacion_pelvis_deg"] = _tilt(lms, 23, 24, w, h)
    if min(_vis(lms[i]) for i in (11, 12, 23, 24)) >= 0.4:
        msx = (lms[11]["x"] + lms[12]["x"]) / 2 * w
        msy = (lms[11]["y"] + lms[12]["y"]) / 2 * h
        mhx = (lms[23]["x"] + lms[24]["x"]) / 2 * w
        mhy = (lms[23]["y"] + lms[24]["y"]) / 2 * h
        m["inclinacion_tronco_deg"] = round(math.degrees(math.atan2(msx - mhx, mhy - msy)), 1)
    else:
        m["inclinacion_tronco_deg"] = None
    m["angulos_articulares_deg"] = joint_angles(lms, world, w, h)
    if world and len(world) == 33:
        sw = _dist(world[11], world[12])
        hw = _dist(world[23], world[24])
        leg = (_dist(world[23], world[25]) + _dist(world[25], world[27]) + _dist(world[24], world[26]) + _dist(world[26], world[28])) / 2
        arm = (_dist(world[11], world[13]) + _dist(world[13], world[15]) + _dist(world[12], world[14]) + _dist(world[14], world[16])) / 2
        m["ancho_hombros_m"] = round(sw, 3)
        m["ancho_caderas_m"] = round(hw, 3)
        m["relacion_hombro_cadera"] = round(sw / hw, 2) if hw > 1e-6 else None
        m["longitud_pierna_m"] = round(leg, 3)
        m["longitud_brazo_m"] = round(arm, 3)
    return m


def evaluate(
    landmarks: list[dict] | None,
    world: list[dict] | None,
    frames: list[dict] | None,
    width: int,
    height: int,
    brightness: float | None,
    capture_view: str = "frontal",
) -> dict[str, Any]:
    """Devuelve status, flags, score, métricas y landmarks representativos."""
    flags: list[dict[str, str]] = []

    def flag(code: str, severity: str, message: str) -> None:
        flags.append({"code": code, "severity": severity, "message": message})

    w, h = float(width or 1), float(height or 1)
    mode = "sequence" if frames else "image"
    rep_lms, rep_world = landmarks, world
    rom: dict[str, Any] = {}

    if frames:
        valid = [f for f in frames if f.get("landmarks") and len(f["landmarks"]) == 33]
        if not valid:
            return {"status": "failed", "flags": [{"code": "no_pose", "severity": "critical", "message": "No se detectó ninguna pose en la secuencia."}],
                    "score": 0.0, "metrics": {}, "landmarks": None, "world": None, "mode": mode}
        best = max(valid, key=lambda f: mean(_vis(p) for p in f["landmarks"]))
        rep_lms, rep_world = best["landmarks"], best.get("world_landmarks")
        series: dict[str, list[float]] = {k: [] for k in JOINTS}
        for f in valid:
            ang = joint_angles(f["landmarks"], f.get("world_landmarks"), w, h)
            for k, v in ang.items():
                if v is not None:
                    series[k].append(v)
        for k, vals in series.items():
            if len(vals) >= 3:
                rom[k] = {"min": round(min(vals), 1), "max": round(max(vals), 1), "rango": round(max(vals) - min(vals), 1), "muestras": len(vals)}
        dur = max(float(f.get("t", 0)) for f in valid) - min(float(f.get("t", 0)) for f in valid)
        if len(valid) < 10:
            flag("short_sequence", "warning", "Secuencia muy corta: se recomiendan al menos 2 segundos de movimiento.")
        rom_meta = {"frames": len(valid), "duracion_s": round(dur, 2)}
    else:
        rom_meta = {}

    if not rep_lms or len(rep_lms) != 33:
        return {"status": "failed", "flags": [{"code": "no_pose", "severity": "critical", "message": "No se detectó una pose en la imagen."}],
                "score": 0.0, "metrics": {}, "landmarks": None, "world": None, "mode": mode}

    vis_all = mean(_vis(p) for p in rep_lms)
    vis_key = mean(_vis(rep_lms[i]) for i in KEY_POINTS)
    missing = [NAMES[i] for i in KEY_POINTS if _vis(rep_lms[i]) < 0.5]
    out_of_frame = [NAMES[i] for i in KEY_POINTS if not (0.0 <= rep_lms[i]["x"] <= 1.0 and 0.0 <= rep_lms[i]["y"] <= 1.0)]

    if missing or out_of_frame:
        flag("partial_body", "critical",
             "Encuadre incompleto: no se ven con claridad " + ", ".join(sorted(set(missing + out_of_frame))) + ". Solicitar nueva captura de cuerpo completo.")
    if vis_all < 0.6:
        flag("low_visibility", "warning", "Visibilidad media baja: posibles oclusiones u objetos delante del cuerpo. Análisis limitado.")
    if brightness is not None:
        if brightness < 55:
            flag("low_light", "warning", "Iluminación insuficiente: se recomienda luz uniforme y frontal.")
        elif brightness > 215:
            flag("overexposed", "warning", "Imagen sobreexpuesta: reducir la luz directa o el contraluz.")
    if min(width, height) and min(width, height) < 360:
        flag("low_resolution", "warning", "Resolución baja: la precisión de los landmarks puede disminuir.")

    # Orientación: en vista frontal los hombros deben verse separados respecto al alto del tronco.
    if min(_vis(rep_lms[i]) for i in (11, 12, 23, 24)) >= 0.4:
        sh = abs(rep_lms[11]["x"] - rep_lms[12]["x"]) * w
        torso = abs((rep_lms[11]["y"] + rep_lms[12]["y"]) / 2 - (rep_lms[23]["y"] + rep_lms[24]["y"]) / 2) * h
        ratio = sh / torso if torso > 1e-6 else 0
        if capture_view in ("frontal", "posterior") and ratio < 0.45:
            flag("not_frontal", "warning", "El cuerpo no parece estar de frente a la cámara. Solicitar vista frontal.")
        if capture_view == "lateral" and ratio > 0.6:
            flag("not_lateral", "warning", "La captura no parece lateral. Girar 90° respecto a la cámara.")

    metrics = static_metrics(rep_lms, rep_world, w, h)
    st = metrics.get("inclinacion_hombros_deg")
    if st is not None and abs(st) > 6:
        flag("shoulder_asymmetry", "info", f"Diferencia de altura entre hombros de {abs(st):.1f}° (referencia visual, no diagnóstica).")
    pt = metrics.get("inclinacion_pelvis_deg")
    if pt is not None and abs(pt) > 6:
        flag("pelvis_asymmetry", "info", f"Diferencia de altura pélvica de {abs(pt):.1f}° (referencia visual, no diagnóstica).")
    if rom:
        metrics["rango_movimiento_deg"] = rom
        metrics["secuencia"] = rom_meta

    penalty = 1.0
    for f in flags:
        penalty *= {"critical": 0.55, "warning": 0.85, "info": 1.0}[f["severity"]]
    score = round(100 * (0.4 * vis_all + 0.6 * vis_key) * penalty, 1)
    metrics["visibilidad_media"] = round(vis_all, 3)
    metrics["visibilidad_puntos_clave"] = round(vis_key, 3)

    critical = any(f["severity"] == "critical" for f in flags)
    status = "needs_review" if critical or score < 60 else "completed"
    return {"status": status, "flags": flags, "score": score, "metrics": metrics,
            "landmarks": rep_lms, "world": rep_world, "mode": mode}
