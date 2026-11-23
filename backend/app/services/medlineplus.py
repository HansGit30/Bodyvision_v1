"""Cliente de MedlinePlus Connect (U.S. National Library of Medicine): descripción oficial en español por código CIE-10.

API pública y gratuita: https://medlineplus.gov/medlineplus-connect/web-service/
Se usa solo texto plano (se eliminan etiquetas HTML) y se cachea 24 h en memoria.
"""
from __future__ import annotations

import json
import logging
import re
import time
import urllib.parse
import urllib.request
from html.parser import HTMLParser

log = logging.getLogger("bodyvision.medlineplus")
ENDPOINT = "https://connect.medlineplus.gov/service"
ICD10_OID = "2.16.840.1.113883.6.90"
ICD_RE = re.compile(r"^[A-Z]\d{2}(\.\d{1,4})?$")
_cache: dict[str, tuple[float, dict]] = {}
TTL = 24 * 3600


class _Text(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.buf: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in ("p", "h3", "li", "br"):
            self.flush()

    def handle_endtag(self, tag):
        if tag in ("p", "h3", "li", "ul"):
            self.flush()

    def handle_data(self, data):
        self.buf.append(data)

    def flush(self):
        t = re.sub(r"\s+", " ", "".join(self.buf)).strip()
        if t:
            self.parts.append(t)
        self.buf = []


def html_to_paragraphs(html: str, limit: int = 12) -> list[str]:
    p = _Text()
    p.feed(html or "")
    p.flush()
    return p.parts[:limit]


def parse(payload: dict) -> dict:
    entries = (payload.get("feed") or {}).get("entry") or []
    if not entries:
        return {"available": False}
    e = entries[0]
    links = e.get("link") or []
    return {
        "available": True,
        "title": (e.get("title") or {}).get("_value", ""),
        "summary": html_to_paragraphs((e.get("summary") or {}).get("_value", "")),
        "url": links[0].get("href", "") if links else "",
        "source": "MedlinePlus · Biblioteca Nacional de Medicina de EE. UU.",
    }


def lookup(icd10: str, lang: str = "es") -> dict:
    code = icd10.strip().upper()
    if not ICD_RE.match(code):
        return {"available": False}
    hit = _cache.get(f"{lang}:{code}")
    if hit and time.time() - hit[0] < TTL:
        return hit[1]
    params = urllib.parse.urlencode({
        "mainSearchCriteria.v.cs": ICD10_OID, "mainSearchCriteria.v.c": code,
        "knowledgeResponseType": "application/json", "informationRecipient.languageCode.c": lang,
    })
    try:
        req = urllib.request.Request(f"{ENDPOINT}?{params}", headers={"User-Agent": "BODYVISION-AI/1.0"})
        with urllib.request.urlopen(req, timeout=7) as r:  # noqa: S310 - URL fija https
            data = parse(json.loads(r.read(1_000_000).decode("utf-8")))
        if not data["available"] and "." in code:
            return lookup(code.split(".")[0], lang)
    except Exception as exc:  # red caída, timeout o respuesta inesperada
        log.warning("MedlinePlus no disponible para %s: %s", code, exc)
        return {"available": False}
    _cache[f"{lang}:{code}"] = (time.time(), data)
    return data
