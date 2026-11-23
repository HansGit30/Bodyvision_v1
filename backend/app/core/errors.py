"""Errores consistentes: {"error": {"code", "message", "correlation_id", "details"}}."""
from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("bodyvision.errors")

STATUS_CODES = {
    400: "VALIDATION_ERROR",
    401: "UNAUTHENTICATED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    409: "CONFLICT",
    413: "FILE_TOO_LARGE",
    415: "UNSUPPORTED_MEDIA_TYPE",
    422: "UNPROCESSABLE_ENTITY",
    429: "RATE_LIMITED",
    500: "INTERNAL_ERROR",
}


class AppError(Exception):
    def __init__(self, status: int, message: str, code: str | None = None, details: Any = None):
        self.status = status
        self.message = message
        self.code = code or STATUS_CODES.get(status, "ERROR")
        self.details = details
        super().__init__(message)


def _cid(request: Request) -> str:
    return getattr(request.state, "correlation_id", "-")


def _body(request: Request, code: str, message: str, details: Any = None) -> dict:
    err: dict[str, Any] = {"code": code, "message": message, "correlation_id": _cid(request)}
    if details is not None:
        err["details"] = details
    return {"error": err}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError):
        headers = {"WWW-Authenticate": "Bearer"} if exc.status == 401 else None
        return JSONResponse(_body(request, exc.code, exc.message, exc.details), status_code=exc.status, headers=headers)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException):
        code = STATUS_CODES.get(exc.status_code, "ERROR")
        msg = exc.detail if isinstance(exc.detail, str) else code
        if exc.status_code == 404 and msg == "Not Found":
            msg = "Recurso no encontrado"
        return JSONResponse(_body(request, code, msg), status_code=exc.status_code, headers=getattr(exc, "headers", None))

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError):
        details = []
        for e in exc.errors():
            loc = ".".join(str(x) for x in e.get("loc", []) if x != "body")
            details.append({"field": loc, "message": e.get("msg", "")})
        return JSONResponse(_body(request, "VALIDATION_ERROR", "Datos de entrada inválidos", details), status_code=422)

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception):
        log.exception("Error no controlado [%s]: %s", _cid(request), exc)
        return JSONResponse(_body(request, "INTERNAL_ERROR", "Error interno inesperado"), status_code=500)
