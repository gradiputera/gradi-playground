"""HTTP API. Planned endpoints run their checks now and answer 501 until later roadmap steps."""

import re
import time
from collections.abc import Awaitable, Callable, Mapping
from typing import Annotated

from fastapi import Depends, FastAPI, Header, Request, Response
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from reporting_service import log
from reporting_service.auth import Identity, InvalidTokenError
from reporting_service.webhooks import verify_webhook

MAX_EVENT_BYTES = 256 * 1024
REALM = 'Bearer realm="reporting-service"'
_BEARER = re.compile(r"Bearer\s+(\S+)", re.IGNORECASE)


class UnauthorizedError(Exception):
    """A missing or invalid bearer token; the handler answers 401."""


def _error(status: int, code: str, message: str, headers: Mapping[str, str] | None = None) -> JSONResponse:
    return JSONResponse({"error": code, "message": message}, status_code=status, headers=headers)


def _not_implemented() -> JSONResponse:
    return _error(501, "not_implemented", "This endpoint is planned and not implemented yet.")


def _too_large() -> JSONResponse:
    return _error(413, "payload_too_large", "Request body too large.")


def _now() -> int:
    return int(time.time())


def create_app(
    verify_token: Callable[[str], Identity],
    webhook_key: bytes,
    now: Callable[[], int] = _now,
) -> FastAPI:
    """verify_token checks a bearer token; webhook_key is the dispatcher's key; now is for the tests."""
    app = FastAPI(title="reporting-service", openapi_url=None, docs_url=None, redoc_url=None)

    # Logs method, route, status and duration only: no headers, tokens, bodies or user ids.
    @app.middleware("http")
    async def log_requests(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        start = time.perf_counter()
        response = await call_next(request)
        log.info(
            "request",
            method=request.method,
            route=getattr(request.scope.get("route"), "path", "unmatched"),
            status=response.status_code,
            duration_ms=round((time.perf_counter() - start) * 1000),
        )
        return response

    # A plain function, so FastAPI runs it in a worker thread: the JWKS fetch never blocks the loop.
    def authenticate(authorization: Annotated[str | None, Header()] = None) -> Identity:
        match = _BEARER.fullmatch(authorization or "")
        if match is None:
            raise UnauthorizedError("missing bearer token")
        try:
            return verify_token(match.group(1))
        except InvalidTokenError as err:
            raise UnauthorizedError("invalid token") from err

    caller = Annotated[Identity, Depends(authenticate)]

    @app.exception_handler(UnauthorizedError)
    async def unauthorized(_request: Request, exc: UnauthorizedError) -> JSONResponse:
        return _error(401, "unauthorized", str(exc), {"WWW-Authenticate": REALM})

    # Unknown paths answer 404 and known paths with another method 405, as JSON.
    @app.exception_handler(StarletteHTTPException)
    async def http_error(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        if exc.status_code == 404:
            return _error(404, "not_found", "No such route.")
        if exc.status_code == 405:
            return _error(405, "method_not_allowed", "Method not allowed.", exc.headers)
        return _error(exc.status_code, "http_error", "Request failed.")

    # Errors never leak details to the caller or into the logs.
    @app.exception_handler(Exception)
    async def internal_error(_request: Request, exc: Exception) -> JSONResponse:
        log.error("unhandled error", error=type(exc).__name__)
        return _error(500, "internal_error", "Internal error.")

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    # Dispatcher webhooks: only a valid Standard Webhooks signature within the tolerance gets past
    # this point. The raw body is read as bytes, because the signature covers its exact bytes.
    # Processing (inbox, read model) arrives with roadmap step 4.
    @app.post("/events")
    async def events(request: Request) -> JSONResponse:
        declared = request.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > MAX_EVENT_BYTES:
            return _too_large()
        body = bytearray()
        async for chunk in request.stream():
            body += chunk
            if len(body) > MAX_EVENT_BYTES:
                return _too_large()
        reason = verify_webhook(
            webhook_key,
            request.headers.get("webhook-id"),
            request.headers.get("webhook-timestamp"),
            request.headers.get("webhook-signature"),
            bytes(body),
            now(),
        )
        if reason is not None:
            log.warn("webhook rejected", reason=reason)
            return _error(401, "unauthorized", "invalid webhook signature")
        return _not_implemented()

    # Planned endpoints: authenticated now, implemented by later changes (roadmap steps 4 and 5).
    @app.get("/reports/payments-per-day")
    def payments_per_day(_caller: caller) -> JSONResponse:
        return _not_implemented()

    @app.post("/sandbox/reset")
    def sandbox_reset(_caller: caller) -> JSONResponse:
        return _not_implemented()

    return app
