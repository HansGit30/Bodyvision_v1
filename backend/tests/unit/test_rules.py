"""Reglas unitarias: catálogo, IMC, firma de URLs, motor de pose y simulación."""
from __future__ import annotations

import time

import pytest

from app.core.security import has_permission, sign_resource, verify_signed
from app.services import pose, simulation
from app.services.catalog import bmi, fat_index, validate_value
from tests.conftest import fake_landmarks, fake_world


def test_validate_value():
    m, unit = validate_value("weight", 70, None)
    assert unit == "kg"
    with pytest.raises(ValueError):
        validate_value("weight", 5, "kg")
    with pytest.raises(ValueError):
        validate_value("weight", 70, "lb")
    with pytest.raises(ValueError):
        validate_value("desconocida", 1, None)


def test_bmi_and_index():
    assert bmi(70, 175) == 22.9
    assert bmi(None, 175) is None
    assert fat_index(22) == 0
    assert fat_index(60) == 2.0 and fat_index(10) == -0.6


def test_signed_urls():
    tok, exp = sign_resource("media", "abc", ttl=60)
    assert exp > time.time()
    assert verify_signed(tok, "media", "abc")
    assert not verify_signed(tok, "media", "otro")
    assert not verify_signed(tok, "report", "abc")
    expired, _ = sign_resource("media", "abc", ttl=-5)
    assert not verify_signed(expired, "media", "abc")


def test_rbac_matrix():
    assert has_permission("admin", "audit:read")
    assert not has_permission("specialist", "users:manage")
    assert not has_permission("viewer", "measurements:write")


def test_pose_good_capture():
    res = pose.evaluate(fake_landmarks(), fake_world(), None, 720, 1280, 130, "frontal")
    assert res["status"] == "completed"
    angles = res["metrics"]["angulos_articulares_deg"]
    assert 170 <= angles["rodilla_izq"] <= 180
    assert res["metrics"]["inclinacion_hombros_deg"] == 0


def test_pose_no_landmarks():
    res = pose.evaluate(None, None, None, 720, 1280, 130)
    assert res["status"] == "failed"


def test_pose_lateral_flag():
    lms = fake_landmarks()
    lms[11]["x"], lms[12]["x"] = 0.49, 0.51
    res = pose.evaluate(lms, None, None, 720, 1280, 130, "frontal")
    assert any(f["code"] == "not_frontal" for f in res["flags"])


def test_simulation_isolated():
    base = {"weight_kg": 80, "height_cm": 175, "body_fat_pct": 25, "muscle_pct": 40}
    out = simulation.run(dict(base), {"target_weight_kg": 75, "body_fat_delta_pct": -2, "muscle_delta_pct": 5})
    assert out["bmi_base"] == 26.1 and out["bmi_scenario"] == 24.5
    assert out["body_fat_pct_scenario"] == 23
    assert out["delta_weight_kg"] == -5
    assert out["label"] == "SIMULACIÓN"
    assert base["weight_kg"] == 80


def test_medlineplus_parse_and_validation():
    from app.services import medlineplus
    sample = {"feed": {"entry": [{"title": {"_value": "Diabetes tipo 2"}, "link": [{"href": "https://medlineplus.gov/spanish/diabetestype2.html"}],
                                  "summary": {"_value": "<h3>¿Qué es?</h3><p>Texto <b>uno</b>.</p><ul><li>a</li><li>b</li></ul><script>x</script>"}}]}}
    r = medlineplus.parse(sample)
    assert r["available"] and r["title"] == "Diabetes tipo 2"
    assert r["summary"][:2] == ["¿Qué es?", "Texto uno."]
    assert all("<" not in p for p in r["summary"])
    assert medlineplus.parse({"feed": {}}) == {"available": False}
    assert medlineplus.lookup("DROP TABLE") == {"available": False}
