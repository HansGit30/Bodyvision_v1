"""Seguridad: autenticación, RBAC, aislamiento por expediente (IDOR) y auditoría."""
from __future__ import annotations

from tests.conftest import login

API = "/api/v1"


def test_requires_auth(client):
    for path in ("/profiles", "/dashboard/summary", "/audit-events", "/users"):
        r = client.get(API + path)
        assert r.status_code == 401, path


def test_invalid_token(client):
    r = client.get(f"{API}/profiles", headers={"Authorization": "Bearer xxx.yyy.zzz"})
    assert r.status_code == 401


def test_viewer_is_read_only(client, viewer_h):
    items = client.get(f"{API}/profiles", headers=viewer_h).json()["items"]
    assert items, "el usuario final demo debe ver sus expedientes autorizados"
    pid = items[0]["id"]
    assert client.post(f"{API}/profiles", headers=viewer_h, json={"display_name": "X Y", "sex": "M"}).status_code == 403
    assert client.post(f"{API}/profiles/{pid}/measurements", headers=viewer_h,
                       json={"metric_code": "weight", "value": 70, "measured_at": "2026-11-10T10:00:00Z"}).status_code == 403
    assert client.get(f"{API}/users", headers=viewer_h).status_code == 403
    assert client.get(f"{API}/audit-events", headers=viewer_h).status_code == 403


def test_cross_access_blocked(client, admin_h, spec_h):
    # El admin crea un segundo especialista sin acceso a los expedientes demo.
    r = client.post(f"{API}/users", headers=admin_h, json={"email": "otro@bodyvision.ai", "full_name": "Otro Especialista",
                                                         "password": "OtroPass2026!", "role": "specialist"})
    assert r.status_code == 201
    other_h = login(client, "otro@bodyvision.ai", "OtroPass2026!")
    demo = [p for p in client.get(f"{API}/profiles", headers=spec_h).json()["items"] if p["display_code"] == "DEMO-0001"][0]
    assert client.get(f"{API}/profiles", headers=other_h).json()["total"] == 0
    for path in (f"/profiles/{demo['id']}", f"/profiles/{demo['id']}/measurements", f"/analytics/{demo['id']}",
                 f"/profiles/{demo['id']}/body-models", f"/profiles/{demo['id']}/media"):
        assert client.get(API + path, headers=other_h).status_code == 404, path
    # Concesión de acceso por el propietario
    other_id = [u for u in client.get(f"{API}/users", headers=admin_h).json() if u["email"] == "otro@bodyvision.ai"][0]["id"]
    r = client.post(f"{API}/profiles/{demo['id']}/access", headers=spec_h, json={"user_id": other_id, "access_level": "viewer"})
    assert r.status_code == 201
    assert client.get(f"{API}/profiles/{demo['id']}", headers=other_h).status_code == 200
    # lectura no permite escribir
    r = client.post(f"{API}/profiles/{demo['id']}/measurements", headers=other_h,
                    json={"metric_code": "weight", "value": 70, "measured_at": "2026-11-10T10:00:00Z"})
    assert r.status_code == 403


def test_admin_cannot_demote_self(client, admin_h):
    me = client.get(f"{API}/users/me", headers=admin_h).json()
    r = client.patch(f"{API}/users/{me['id']}", headers=admin_h, json={"role": "viewer"})
    assert r.status_code == 409


def test_audit_trail(client, admin_h):
    r = client.get(f"{API}/audit-events?limit=200", headers=admin_h)
    assert r.status_code == 200
    actions = {e["action"] for e in r.json()["items"]}
    assert {"auth.login", "profile.create", "measurement.create"} <= actions
