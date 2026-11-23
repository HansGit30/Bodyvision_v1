"""Validación de contenido real, re-encoding (elimina EXIF) y almacenamiento privado."""
from __future__ import annotations

import hashlib
import io
import uuid
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageOps, ImageStat, UnidentifiedImageError

from app.core.config import settings
from app.core.errors import AppError

ALLOWED_FORMATS = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
MAX_SIDE = 2048
MIN_SIDE = 240
Image.MAX_IMAGE_PIXELS = 40_000_000  # protección ante "decompression bombs"


@dataclass
class StoredImage:
    storage_key: str
    checksum: str
    size_bytes: int
    width: int
    height: int
    mime_type: str
    brightness: float


def sanitize_and_store(raw: bytes) -> StoredImage:
    max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
    if len(raw) > max_bytes:
        raise AppError(413, f"El archivo supera el límite de {settings.MAX_UPLOAD_MB} MB")
    if len(raw) < 100:
        raise AppError(400, "Archivo vacío o corrupto")
    try:
        probe = Image.open(io.BytesIO(raw))
        fmt = probe.format
        probe.verify()  # valida estructura sin decodificar todo
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError) as exc:
        raise AppError(415, "El contenido no es una imagen válida (JPEG, PNG o WEBP)") from exc
    if fmt not in ALLOWED_FORMATS:
        raise AppError(415, f"Formato no admitido: {fmt or 'desconocido'}")

    try:
        img = Image.open(io.BytesIO(raw))
        img = ImageOps.exif_transpose(img)  # aplica orientación y descarta metadatos al re-codificar
        img = img.convert("RGB")
    except Exception as exc:  # pragma: no cover - imágenes truncadas
        raise AppError(415, "No se pudo decodificar la imagen") from exc

    if min(img.size) < MIN_SIDE:
        raise AppError(422, f"Resolución insuficiente: mínimo {MIN_SIDE}px por lado")
    if max(img.size) > MAX_SIDE:
        img.thumbnail((MAX_SIDE, MAX_SIDE), Image.Resampling.LANCZOS)

    brightness = ImageStat.Stat(img.convert("L").resize((64, 64))).mean[0]

    out = io.BytesIO()
    img.save(out, format="JPEG", quality=90, optimize=True)  # sin EXIF/GPS: Pillow no copia metadatos
    data = out.getvalue()
    key = f"{uuid.uuid4().hex}.jpg"
    path = settings.media_dir / key
    path.write_bytes(data)
    return StoredImage(
        storage_key=key,
        checksum=hashlib.sha256(data).hexdigest(),
        size_bytes=len(data),
        width=img.width,
        height=img.height,
        mime_type="image/jpeg",
        brightness=round(brightness, 1),
    )


def media_path(storage_key: str) -> Path:
    p = (settings.media_dir / storage_key).resolve()
    if settings.media_dir.resolve() not in p.parents:
        raise AppError(404, "Archivo no encontrado")
    return p


def image_brightness(storage_key: str) -> float | None:
    try:
        with Image.open(media_path(storage_key)) as img:
            return float(ImageStat.Stat(img.convert("L").resize((64, 64))).mean[0])
    except Exception:
        return None


def delete_file(storage_key: str) -> None:
    try:
        media_path(storage_key).unlink(missing_ok=True)
    except AppError:
        pass
