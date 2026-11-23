"""Pruebas de registro, aislamiento y revisión profesional."""
from __future__ import annotations

from datetime import UTC, datetime


def _register(client, email):
    r = client.post("/api/v1/auth/register-patient", json={
        "email": email, "password": "PruebaPaciente2026!",
        "full_name": "Paciente de Prueba", "sex": "M",
    })
    assert r.status_code == 201, r.text
    return {"Authorization": "Bearer " + r.json()["access_token"]}


def test_patient_selfservice_isolation(client):
    a = _register(client, "paciente-test-a@ejemplo.com")
    b = _register(client, "paciente-test-b@ejemplo.com")
    own = client.get("/api/v1/profiles", headers=a).json()["items"]
    assert len(own) == 1
    pid = own[0]["id"]
    assert own[0]["latest"] == {}
    assert client.get(f"/api/v1/profiles/{pid}", headers=b).status_code == 404
    assert client.get("/api/v1/users/directory", headers=a).status_code == 403
    assert client.get(f"/api/v1/profiles/{pid}/access", headers=a).status_code == 403
    assert client.post("/api/v1/profiles", headers=a, json={"display_name":"Otro", "sex":"M"}).status_code == 403
    measurement = client.post(f"/api/v1/profiles/{pid}/measurements", headers=a, json={
        "metric_code": "weight", "value": 74, "unit": "kg",
        "method": "manual", "measured_at": datetime.now(UTC).isoformat(),
    })
    assert measurement.status_code == 201, measurement.text
    assert measurement.json()["source_type"] == "self_reported"
    assert client.get(f"/api/v1/profiles/{pid}", headers=a).json()["latest"]["weight"]["source_type"] == "self_reported"
    assert client.post(f"/api/v1/profiles/{pid}/measurements", headers=a, json={
        "metric_code": "body_fat", "value": 20, "unit": "%",
        "method": "manual", "measured_at": datetime.now(UTC).isoformat(),
    }).status_code == 403
