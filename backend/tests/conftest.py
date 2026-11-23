"""Fixtures: base SQLite temporal, almacenamiento temporal y cliente HTTP con lifespan."""
from __future__ import annotations

import io
import os
import tempfile

import pytest

_TMP = tempfile.mkdtemp(prefix="bv-tests-")
os.environ.update({
    "DATABASE_URL": os.environ.get("TEST_DATABASE_URL", f"sqlite:///{_TMP}/test.db"),
    "UPLOAD_DIR": f"{_TMP}/uploads",
    "SECRET_KEY": "test-secret-key-0123456789-abcdefghijklmnopqrstuvwxyz",
    "STATIC_DIR": f"{_TMP}/no-static",
    "SEED_DEMO": "true",
    "ADMIN_EMAIL": "admin@bodyvision.ai",
    "ADMIN_PASSWORD": "AdminTest2026!",
    "LOGIN_MAX_ATTEMPTS": "50",
})

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


def login(client, email: str, password: str) -> dict:
    r = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture(scope="session")
def admin_h(client):
    return login(client, "admin@bodyvision.ai", "AdminTest2026!")


@pytest.fixture(scope="session")
def spec_h(client):
    return login(client, "especialista@bodyvision.ai", "Especialista2026!")


@pytest.fixture(scope="session")
def viewer_h(client):
    return login(client, "usuario@bodyvision.ai", "Usuario2026!")


def make_jpeg(w: int = 640, h: int = 960, color=(120, 130, 140), exif: bool = False) -> bytes:
    from PIL import Image

    img = Image.new("RGB", (w, h), color)
    buf = io.BytesIO()
    if exif:
        ex = Image.Exif()
        ex[0x010F] = "CamaraSecreta"  # Make
        ex[0x8825] = {2: (12.0, 3.0, 1.0)}  # GPSInfo
        img.save(buf, format="JPEG", exif=ex)
    else:
        img.save(buf, format="JPEG")
    return buf.getvalue()


def fake_landmarks(visibility: float = 0.95) -> list[dict]:
    """33 landmarks de una persona de pie, de frente, cuerpo completo."""
    pts = {
        0: (0.5, 0.12), 11: (0.42, 0.25), 12: (0.58, 0.25), 13: (0.38, 0.38), 14: (0.62, 0.38), 15: (0.37, 0.5), 16: (0.63, 0.5),
        23: (0.45, 0.52), 24: (0.55, 0.52), 25: (0.45, 0.7), 26: (0.55, 0.7), 27: (0.45, 0.88), 28: (0.55, 0.88),
    }
    out = []
    for i in range(33):
        x, y = pts.get(i, (0.5, 0.15 if i < 11 else 0.55))
        out.append({"x": x, "y": y, "z": 0.0, "visibility": visibility, "presence": visibility})
    return out


def fake_world() -> list[dict]:
    lms = fake_landmarks()
    return [{"x": (p["x"] - 0.5) * 1.0, "y": (p["y"] - 0.52) * 1.8, "z": 0.0, "visibility": 0.95} for p in lms]
