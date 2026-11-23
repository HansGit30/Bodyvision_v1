"""Flujos E2E de API: expediente → consentimiento → medición → captura → pose → simulación → reporte."""
from __future__ import annotations

import time

from tests.conftest import fake_landmarks, fake_world, make_jpeg

API = "/api/v1"


def test_health(client):
    for path in ("/api/health", f"{API}/health"):
        r = client.get(path)
        assert r.status_code == 200
        assert r.json()["database"] == "ok"
        assert "X-Correlation-ID" in r.headers


def test_login_and_me(client, spec_h):
    r = client.get(f"{API}/users/me", headers=spec_h)
    assert r.status_code == 200
    me = r.json()
    assert me["role"] == "specialist"
    assert "profiles:create" in me["permissions"]
    assert "users:manage" not in me["permissions"]


def test_login_invalid(client):
    r = client.post(f"{API}/auth/login", json={"email": "admin@bodyvision.ai", "password": "malo"})
    assert r.status_code == 401
    body = r.json()["error"]
    assert body["code"] == "UNAUTHENTICATED" and body["correlation_id"]


def test_catalog(client, spec_h):
    r = client.get(f"{API}/catalog/metrics", headers=spec_h)
    codes = {m["code"] for m in r.json()}
    assert {"weight", "height", "waist", "body_fat"} <= codes


def test_demo_profiles_visible(client, spec_h):
    r = client.get(f"{API}/profiles", headers=spec_h)
    assert r.status_code == 200
    data = r.json()
    assert data["total"] >= 2
    demo = [p for p in data["items"] if p["display_code"] == "DEMO-0001"][0]
    assert demo["latest"]["weight"]["unit"] == "kg"
    assert demo["consent_image"] is True


def test_full_flow(client, spec_h):
    # 1. Crear expediente
    r = client.post(f"{API}/profiles", headers=spec_h, json={"display_name": "Prueba Integración", "sex": "F"})
    assert r.status_code == 201, r.text
    p = r.json()
    pid = p["id"]
    assert p["display_code"].startswith("BV-") and p["access_level"] == "owner"

    # 2. Mediciones con validación de rango y unidad
    now = "2026-11-17T09:30:00-05:00"
    assert client.post(f"{API}/profiles/{pid}/measurements", headers=spec_h,
                       json={"metric_code": "weight", "value": 900, "measured_at": now}).status_code == 400
    assert client.post(f"{API}/profiles/{pid}/measurements", headers=spec_h,
                       json={"metric_code": "weight", "value": 70, "unit": "lb", "measured_at": now}).status_code == 400
    r = client.post(f"{API}/profiles/{pid}/measurements", headers=spec_h,
                    json={"metric_code": "weight", "value": 68.4, "measured_at": now, "method": "manual"})
    assert r.status_code == 201
    w = r.json()
    assert w["unit"] == "kg" and w["source_type"] == "observed_manual"
    client.post(f"{API}/profiles/{pid}/measurements", headers=spec_h, json={"metric_code": "height", "value": 165, "measured_at": now})
    # fecha naive interpretada como UTC
    r = client.post(f"{API}/profiles/{pid}/measurements", headers=spec_h, json={"metric_code": "waist", "value": 80, "measured_at": "2026-11-16T10:00:00"})
    assert r.status_code == 201 and r.json()["measured_at"].endswith(("Z", "+00:00"))

    # 3. Corrección no destructiva
    r = client.patch(f"{API}/measurements/{w['id']}", headers=spec_h, json={"value": 68.9, "reason": "Error de transcripción"})
    assert r.status_code == 200
    corr = r.json()
    assert corr["supersedes_id"] == w["id"] and corr["value"] == 68.9
    hist = client.get(f"{API}/profiles/{pid}/measurements?include_superseded=true&metric=weight", headers=spec_h).json()
    assert {h["status"] for h in hist} == {"active", "superseded"}
    assert client.patch(f"{API}/measurements/{w['id']}", headers=spec_h, json={"value": 70, "reason": "otra"}).status_code == 409

    # 4. Captura bloqueada sin consentimiento
    img = make_jpeg(exif=True)
    r = client.post(f"{API}/profiles/{pid}/media", headers=spec_h, files={"file": ("x.jpg", img, "image/jpeg")})
    assert r.status_code == 403 and r.json()["error"]["code"] == "CONSENT_REQUIRED"

    # 5. Consentimiento y carga
    r = client.post(f"{API}/profiles/{pid}/consents", headers=spec_h, json={"purpose": "image_processing", "policy_version": "1.0"})
    assert r.status_code == 201
    consent_id = r.json()["id"]
    r = client.post(f"{API}/profiles/{pid}/media", headers=spec_h, files={"file": ("x.jpg", img, "image/jpeg")}, data={"capture_view": "frontal"})
    assert r.status_code == 201, r.text
    media = r.json()
    assert media["status"] == "ready" and media["mime_type"] == "image/jpeg"

    # 6. URL firmada y contenido sin EXIF
    su = client.get(f"{API}/media/{media['id']}/signed-url", headers=spec_h).json()
    r = client.get(su["url"])
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"
    assert b"CamaraSecreta" not in r.content and b"Exif" not in r.content[:200]
    assert client.get(su["url"] + "x").status_code == 403
    assert client.get(f"{API}/media/{media['id']}/content?token=abc.def").status_code == 403

    # 7. Análisis de pose (asíncrono)
    r = client.post(f"{API}/media/{media['id']}/pose-analyses", headers=spec_h,
                    json={"landmarks": fake_landmarks(), "world_landmarks": fake_world(), "mode": "image"})
    assert r.status_code == 202, r.text
    aid = r.json()["id"]
    for _ in range(30):
        a = client.get(f"{API}/pose-analyses/{aid}", headers=spec_h).json()
        if a["status"] not in ("queued", "processing"):
            break
        time.sleep(0.1)
    assert a["status"] in ("completed", "needs_review"), a
    assert a["model_version"] and a["engine"] == "mediapipe-tasks-vision"
    assert a["metrics_json"]["angulos_articulares_deg"]["rodilla_izq"] is not None
    assert a["quality_score"] > 0

    # secuencia de movimiento
    frames = [{"t": i * 0.1, "landmarks": fake_landmarks(), "world_landmarks": fake_world()} for i in range(12)]
    r = client.post(f"{API}/media/{media['id']}/pose-analyses", headers=spec_h, json={"mode": "sequence", "frames": frames})
    assert r.status_code == 202
    sid = r.json()["id"]
    time.sleep(0.3)
    s = client.get(f"{API}/pose-analyses/{sid}", headers=spec_h).json()
    assert s["mode"] == "sequence" and s["metrics_json"]["secuencia"]["frames"] == 12

    r = client.post(f"{API}/pose-analyses/{aid}/review", headers=spec_h, json={"decision": "approved", "notes": "ok"})
    assert r.status_code == 200 and r.json()["review_status"] == "approved"

    # 8. Visor 3D: activos + reconstrucción + landmarks
    bm = client.get(f"{API}/profiles/{pid}/body-models", headers=spec_h).json()
    assert len(bm["assets"]) == 7
    assert bm["reconstruction"]["sex"] == "F" and bm["reconstruction"]["bmi"] == round(68.9 / 1.65 ** 2, 1)
    assert bm["landmarks"]["world"] is not None

    # 9. Simulación aislada de mediciones reales
    before = client.get(f"{API}/profiles/{pid}/measurements", headers=spec_h).json()
    r = client.post(f"{API}/profiles/{pid}/simulations", headers=spec_h,
                    json={"title": "Escenario -5 kg", "parameters": {"target_weight_kg": 63.9, "body_fat_delta_pct": -3, "muscle_delta_pct": 5}})
    assert r.status_code == 201, r.text
    sim = r.json()
    assert sim["status"] == "completed" and sim["illustrative_only"] is True
    assert sim["output_metadata"]["label"] == "SIMULACIÓN"
    after = client.get(f"{API}/profiles/{pid}/measurements", headers=spec_h).json()
    assert before == after

    # 10. Analítica
    an = client.get(f"{API}/analytics/{pid}?compare_a=2026-11-16&compare_b=2026-11-17", headers=spec_h).json()
    assert any(s["metric"] == "weight" for s in an["series"])
    assert an["comparison"] is not None

    # 11. Reportes PDF y CSV
    for fmt in ("pdf", "csv"):
        r = client.post(f"{API}/profiles/{pid}/reports", headers=spec_h, json={"format": fmt})
        assert r.status_code == 201, r.text
        rid = r.json()["id"]
        d = client.get(f"{API}/reports/{rid}/download", headers=spec_h)
        assert d.status_code == 200
        if fmt == "pdf":
            assert d.content[:4] == b"%PDF"
        else:
            assert "weight" in d.content.decode("utf-8-sig")

    # 12. Revocación bloquea nuevos procesos
    assert client.post(f"{API}/consents/{consent_id}/revoke", headers=spec_h).status_code == 200
    r = client.post(f"{API}/profiles/{pid}/media", headers=spec_h, files={"file": ("x.jpg", img, "image/jpeg")})
    assert r.status_code == 403

    # 13. Dashboard
    d = client.get(f"{API}/dashboard/summary", headers=spec_h).json()
    assert d["kpis"]["profiles"] >= 3 and d["kpis"]["analyses"] >= 2


def test_bad_uploads(client, spec_h):
    pid = [p for p in client.get(f"{API}/profiles", headers=spec_h).json()["items"] if p["display_code"] == "DEMO-0002"][0]["id"]
    # MIME falso: texto con extensión .jpg
    r = client.post(f"{API}/profiles/{pid}/media", headers=spec_h, files={"file": ("x.jpg", b"no soy una imagen" * 20, "image/jpeg")})
    assert r.status_code == 415
    # imagen demasiado pequeña
    r = client.post(f"{API}/profiles/{pid}/media", headers=spec_h, files={"file": ("x.jpg", make_jpeg(100, 100), "image/jpeg")})
    assert r.status_code == 422
    # demasiado grande
    big = b"\xff\xd8" + b"0" * (11 * 1024 * 1024)
    r = client.post(f"{API}/profiles/{pid}/media", headers=spec_h, files={"file": ("x.jpg", big, "image/jpeg")})
    assert r.status_code == 413


def test_partial_pose_needs_review(client, spec_h):
    pid = [p for p in client.get(f"{API}/profiles", headers=spec_h).json()["items"] if p["display_code"] == "DEMO-0002"][0]["id"]
    media = client.post(f"{API}/profiles/{pid}/media", headers=spec_h, files={"file": ("x.jpg", make_jpeg(color=(20, 20, 20)), "image/jpeg")}).json()
    lms = fake_landmarks()
    for i in (25, 26, 27, 28):
        lms[i]["visibility"] = 0.1
    aid = client.post(f"{API}/media/{media['id']}/pose-analyses", headers=spec_h, json={"landmarks": lms}).json()["id"]
    time.sleep(0.3)
    a = client.get(f"{API}/pose-analyses/{aid}", headers=spec_h).json()
    codes = {f["code"] for f in a["quality_flags"]}
    assert a["status"] == "needs_review"
    assert "partial_body" in codes and "low_light" in codes


def test_api_404_json(client):
    r = client.get(f"{API}/no-existe")
    assert r.status_code == 404 and r.json()["error"]["code"] == "NOT_FOUND"
