# Design

## Context

`services/reporting-service/` holds only a README and its OpenSpec folder. The platform layer already provides:
- the `reporting` schema, owned by the `reporting_service` role (`search_path = reporting`). The role cannot reach the other schemas and has no CREATE on the database;
- a local-only role password and a local dispatcher secret (`whsec_` plus base64 of `local-dev-only-reporting`) in `supabase/seed.sql`;
- the dispatcher (`supabase/migrations/20261121000300_eventbus_dispatcher.sql`), which signs every delivery with Standard Webhooks:
  - headers `webhook-id`, `webhook-timestamp` and `webhook-signature: v1,<base64 HMAC-SHA256 of "<id>.<timestamp>.<body>">`;
  - the key is the base64 part of the consumer's `whsec_` secret in Vault (`eventbus_webhook_secret_reporting`);
  - the `reporting` consumer group subscribes to `payment.succeeded.v1`, `payment.failed.v1` and `ledger.entry-posted.v1`.

payment, ledger, account and notification run on Vercel with the skeleton pattern. notification-service (Express) is the closest model: this change keeps its behaviour, limits and test cases, in Python.

The local machine has uv 0.13.9 (installed with winget for this change; not on the shell's PATH yet, see `tasks.md`) and Python 3.13 from Laragon, but no working Docker.

Everything in the Appendix was prototyped on a temporary branch. The `reporting-service` workflow passed:
- Ruff, mypy (strict) and `openspec validate`;
- 19 of 19 tests, none skipped;
- the oasdiff check;
- the Docker build;
- the smoke test, including 401 for an unsigned webhook and for both protected endpoints without a token.

## Goals / Non-Goals

**Goals:**
- A deployable, tested FastAPI skeleton that validates Supabase tokens, verifies dispatcher signatures, and owns its migrations.
- The `inbox` table ready for idempotent consumption in step 4.

**Non-Goals:**
- Event processing, the payments-per-day read model and query, sandbox reset logic, guest restrictions, the site fault flag, telemetry, the Grafana KPI role, and the dispatcher endpoint configuration.

## Decisions

### D1. FastAPI on uvicorn, managed with uv
- **Project:** `pyproject.toml` with exact `==` pins, `requires-python = ">=3.13,<3.14"` and `.python-version` `3.13`. `[tool.uv] package = false`: uv installs the dependencies only, and the code runs from the service folder as the `reporting_service` package. `uv.lock` pins every transitive version with hashes.
- **App rules:**
  - `openapi_url`, `docs_url` and `redoc_url` are disabled: the contract file is the documentation, and the API surface stays exactly what the contract lists.
  - Unknown paths answer JSON 404 and known paths with another method JSON 405 (FastAPI raises these; one handler formats them).
  - Errors answer 500 with no detail; the log line carries only the exception type.
  - `/events` reads the raw body as bytes in chunks and stops at 256 KiB (413), checking `Content-Length` first. The signature covers the exact bytes, so the body is never parsed before verification.
  - The token check is a plain (synchronous) FastAPI dependency, so FastAPI runs it in a worker thread and a JWKS fetch never blocks the event loop.
- **Server:** `uvicorn.Server` started from `reporting_service/main.py` after the migrations:
  - `host="0.0.0.0"`, `server_header=False`, uvicorn's own logging and access log off (the app logs requests itself);
  - `timeout_keep_alive=60`;
  - `timeout_graceful_shutdown=20`: on SIGTERM uvicorn stops accepting connections and lets in-flight requests finish for up to 20 seconds.
- **Logging:** `reporting_service/log.py` writes one JSON object per line. The request log has method, matched route template, status and duration only.

### D2. JWT validation with PyJWT
`docs/security/auth.md` names `PyJWT[crypto]` for Python. `TokenVerifier`:
1. reads the unverified header; `alg` must be ES256 or RS256 and `kid` a string, so `none` and HS256 are rejected before any key lookup;
2. gets the key for `kid`, and requires the key's algorithm to equal the header's (an RSA key is never used for an ES256 token);
3. calls `jwt.decode` with `algorithms=["ES256","RS256"]`, `audience="authenticated"`, the issuer `<SUPABASE_URL>/auth/v1`, `leeway=30` and `options={"require": ["exp","sub","iss","aud"]}`;
4. checks `sub` is a non-empty string.

It returns only `Identity(user_id, anonymous)`, from `sub` and `is_anonymous`.

`JwksKeys` replaces PyJWT's `PyJWKClient`, which refetches the JWKS on every unknown `kid` with no cooldown:
- fetches `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` with `urllib` and a 5-second timeout;
- caches the keys for an hour;
- refetches for an unknown `kid` at most once every 5 minutes (every 30 seconds while it has no keys at all), so forged key ids cannot flood the endpoint;
- keeps serving cached keys when a refetch fails;
- holds a lock while fetching, so concurrent requests share one fetch.

### D3. Webhook signature verification (`reporting_service/webhooks.py`)
Same rules as notification-service:
- **Secret:** `WEBHOOK_SECRET` must be `whsec_<base64>` with a valid, non-empty key, checked at startup.
- **Headers:** `webhook-id`, `webhook-timestamp` and `webhook-signature` must all be present.
- **Timestamp:** 1 to 12 digits, and no more than **300 seconds** before or after now.
- **Expected value:** `base64(HMAC-SHA256(key, "<id>.<timestamp>." + raw body))`.
- **Comparison:** each space-separated `v1,<base64>` value is decoded and compared with `hmac.compare_digest`. Other versions and undecodable values are skipped.

Any failure gets 401 and a log line with only the reason (`missing headers`, `bad timestamp`, `timestamp out of tolerance`, `bad signature`), never the body or the headers.

### D4. Database access: SQLAlchemy with pg8000
- **Driver choice:** psycopg is the usual driver, but it is LGPL-3.0. pg8000 is BSD-3-Clause and pure Python (no native build), which keeps every dependency permissive, as in the other services.
- **URL:** `DATABASE_URL` keeps the `postgres://` form every service uses. `reporting_service/db.py` parses it with SQLAlchemy's `make_url`, switches the driver to `postgresql+pg8000`, and removes `sslmode`, which pg8000 does not understand, mapping it to an SSL context:
  - absent or `disable`: no TLS (the local stack);
  - `allow`, `prefer`, `require`: TLS without certificate verification, as libpq's `require` does. The hosted pooler URL uses `sslmode=require`;
  - `verify-ca`: TLS with verification, no hostname check;
  - `verify-full`: TLS with full verification;
  - anything else: a startup error.
- **Timeouts:** pg8000's 30-second socket timeout covers connecting and every read; a `connect` event sets `statement_timeout = 30000` outside a transaction, so it lasts for the session. `application_name` is `reporting-service`.
- **Pooling:** `NullPool`. The skeleton opens one connection per startup for the migrations; step 4 decides on pooling for request queries.
- **Queries:** this change runs only fixed statements (the advisory lock, Alembic's own, and the integration tests' checks). No endpoint queries the database yet: `GET /reports/payments-per-day` answers 501 before any query. Its parameterized query arrives with step 4.

### D5. Migrations: Alembic, applied by the service
- **Layout:** `migrations/env.py`, `migrations/script.py.mako`, `migrations/versions/0001_create_inbox.py`. Revision ids are short sequence numbers (`0001`), set in each file.
- **Startup:** `migrate()` builds an Alembic `Config` in code (no ini file at runtime), opens one transaction, takes `pg_advisory_xact_lock(hashtext('reporting-service.migrations'))`, and runs `command.upgrade(config, "head")` on that connection. The migrations and the version table commit together, and the lock is released at commit, so concurrent cold starts apply each revision once.
- **Version table:** `env.py` sets `version_table_schema="reporting"`, so Alembic creates `reporting.alembic_version`. Alembic never creates a schema, so the role needs no database-level grant (unlike Drizzle's migrator, see notification-service D4).
- **Counting:** an `on_version_apply` callback counts the revisions applied, which the service logs as `migrations applied`.
- **Tables:** every operation names `schema="reporting"` explicitly.
- **New revisions:** `alembic.ini` exists only for `uv run alembic revision -m "<message>"`. `env.py` refuses to run without the service's connection, so there is no standalone or offline mode that could target the wrong database.

### D6. `inbox` table
`event_id text primary key`, `event_type text not null`, `received_at timestamptz not null default now()`. Step 4 inserts the event id in the same transaction as the read-model update and acknowledges duplicates without applying them twice.

### D7. Container image
- **Build stage:** `python:3.13.18-slim-trixie` with the uv 0.13.9 binary copied from `ghcr.io/astral-sh/uv:0.13.9`. `uv sync --locked --no-dev --no-install-project` installs the locked runtime dependencies into `/app/.venv`, using the image's Python (`UV_PYTHON_DOWNLOADS=never`) and compiling bytecode. Then it copies `reporting_service/` and `migrations/`.
- **Runtime stage:** the same `python:3.13.18-slim-trixie`, so the virtual environment's interpreter path is valid. No uv, no tests. A system user with uid 10001 runs `python -m reporting_service.main` on `PORT=8080`.

### D8. Tests and CI
- **Unit and HTTP tests** (pytest, 16 tests):
  - `test_auth.py`: local EC and RSA keys; valid ES256 and RS256 tokens; 11 rejected tokens; the JWKS cache and cooldown with a fake clock; cached keys surviving a failed refetch;
  - `test_webhooks.py`: the signature rules;
  - `test_app.py`: FastAPI's `TestClient`, a stand-in verifier and a fixed clock: health, 401, 501, 404, 405, 413, and no `/docs` or `/openapi.json`.
- **`test_integration.py`** (3 tests): skipped unless the three `REPORTING_TEST_*` variables are set.
- **CI workflow `reporting-service`:**
  - `astral-sh/setup-uv@v10.3.3` with uv 0.13.9, Python 3.13 and the uv cache; `uv sync --locked`;
  - Ruff check and format check, mypy (strict), `openspec validate`;
  - oasdiff (Docker image) on PRs;
  - local Supabase, then `uv run pytest`, with the summary required to read exactly `19 passed` (any skip changes that line);
  - the Docker build, and a smoke test using the local dispatcher secret, derived in the workflow rather than committed.
- **Dependabot:** watches `uv` and `docker` in the service folder. `setup-uv` publishes no major-version tag, so the workflow pins the full version, and the existing `github-actions` entry updates it.
- **Lockfile:** the plan ships the prototype's exact `uv.lock` in `assets/`. The local secret appears nowhere as a literal (gitleaks' generic-key rule flags it). `.env.example` explains how to print it, and the workflow derives it.
- **`.gitignore`:** gains `.mypy_cache/` next to the existing Python entries.

### D9. Dependencies and quotas
| Package / image | Version | License | Why |
|---|---|---|---|
| `fastapi` | 0.165.0 | MIT | HTTP framework (D1) |
| `uvicorn` | 0.54.0 | BSD-3-Clause | ASGI server, graceful shutdown (D1) |
| `pyjwt[crypto]` | 2.15.1 | MIT (`cryptography`: Apache-2.0 or BSD-3-Clause) | JWT and JWK handling (D2) |
| `sqlalchemy` | 2.1.9 | MIT | Engine and connection handling for Alembic and later queries (D4) |
| `alembic` | 1.20.1 | MIT | Migrations (D5) |
| `pg8000` | 1.31.6 | BSD-3-Clause | Pure-Python Postgres driver (D4) |
| `pytest` (dev) | 9.2.0 | MIT | Tests |
| `httpx2` (dev) | 2.16.2 | BSD-3-Clause | HTTP client for Starlette's `TestClient` (which now prefers it to `httpx`) and the integration test's sign-up call |
| `ruff` (dev) | 0.17.6 | MIT | Lint and format |
| `mypy` (dev) | 2.4.1 | MIT | Type checking |
| `python` image | 3.13.18-slim-trixie | PSF-2.0 | Build and runtime base |
| `ghcr.io/astral-sh/uv` image | 0.13.9 | MIT or Apache-2.0 | uv binary in the build stage only |

All are permissive and compatible with the MIT-licensed repository. Transitive versions (Starlette, Pydantic and others) are pinned through `uv.lock`.

Free-tier usage:
- **Vercel Hobby:** one more project.
- **Database:** one connection per cold start for migrations.
- **JWKS:** about one fetch per hour per warm container.
- **Dispatcher traffic:** none until step 4 points the dispatcher at the service.

## Risks / Trade-offs

- [pg8000 instead of psycopg] → Slower for heavy workloads, which this read model does not have. The `sslmode` mapping is small and the hosted `require` case matches libpq. If the pooler needs something pg8000 lacks, swapping the driver changes only `db.py`.
- [Own JWKS cache instead of `PyJWKClient`] → About 40 lines with its own tests (cache, cooldown, failure). It exists to add the cooldown `PyJWKClient` lacks.
- [Verified events answer 501 until step 4] → Harmless: the dispatcher is not pointed at the service until step 4, and when it is, 501 means "retry later".
- [Root files touched by a service change] → Only the service's CI wiring and one `.gitignore` line for its tooling cache.
- [Local machine without Docker] → Lint, types and the 16 unit and HTTP tests run locally. CI is authoritative for the integration tests, the image and the smoke test.

## Appendix

Copy every file exactly. Paths are relative to the repository root. `uv.lock` is not in this appendix: copy it from `services/reporting-service/openspec/changes/service-skeleton/assets/uv.lock`.

### A1. `services/reporting-service/pyproject.toml` (full file)

````toml
[project]
name = "reporting-service"
version = "0.1.0"
description = "Read model of cross-service summaries built from events, for gradi-playground."
license = "MIT"
requires-python = ">=3.13,<3.14"
dependencies = [
  "alembic==1.20.1",
  "fastapi==0.165.0",
  "pg8000==1.31.6",
  "pyjwt[crypto]==2.15.1",
  "sqlalchemy==2.1.9",
  "uvicorn==0.54.0",
]

[dependency-groups]
dev = [
  "httpx2==2.16.2",
  "mypy==2.4.1",
  "pytest==9.2.0",
  "ruff==0.17.6",
]

[tool.uv]
# An application, not a library: uv installs the dependencies only, and the code runs from this folder.
package = false

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
addopts = "-ra"

[tool.ruff]
line-length = 110
target-version = "py313"

[tool.ruff.lint]
select = ["E", "W", "F", "I", "B", "UP", "S", "N", "SIM", "RUF"]

[tool.ruff.lint.per-file-ignores]
"tests/**" = ["S101", "S105", "S106"]

[tool.mypy]
strict = true
python_version = "3.13"
files = ["reporting_service", "migrations", "tests"]
````

### A2. `services/reporting-service/.python-version` (full file)

````text
3.13
````

### A3. `services/reporting-service/alembic.ini` (full file)

````ini
# Used only to create new migration files: uv run alembic revision -m "<message>".
# The service applies migrations itself on startup (reporting_service/db.py).
[alembic]
script_location = %(here)s/migrations
file_template = %%(rev)s_%%(slug)s
````

### A4. `services/reporting-service/reporting_service/__init__.py` (full file)

````python
"""reporting-service: read model of cross-service summaries built from events."""
````

### A5. `services/reporting-service/reporting_service/main.py` (full file)

````python
"""Entry point: checks the configuration, applies migrations, then serves HTTP with uvicorn."""

import os
import sys

import uvicorn

from reporting_service import log
from reporting_service.app import create_app
from reporting_service.auth import JwksKeys, TokenVerifier, issuer_for
from reporting_service.db import migrate
from reporting_service.webhooks import webhook_key


def main() -> None:
    database_url = os.environ.get("DATABASE_URL", "")
    supabase_url = os.environ.get("SUPABASE_URL", "")
    secret = os.environ.get("WEBHOOK_SECRET", "")
    try:
        if not database_url or not supabase_url or not secret:
            raise ValueError("DATABASE_URL, SUPABASE_URL and WEBHOOK_SECRET must be set")
        port = int(os.environ.get("PORT") or "80")
        key = webhook_key(secret)
        applied = migrate(database_url)
    except Exception as err:
        # The exception type and message only; never the configuration values.
        log.error("reporting-service stopped", error=f"{type(err).__name__}: {err}")
        sys.exit(1)
    log.info("migrations applied", applied=applied)

    issuer = issuer_for(supabase_url)
    verifier = TokenVerifier(JwksKeys(f"{issuer}/.well-known/jwks.json"), issuer)
    config = uvicorn.Config(
        create_app(verifier, key),
        host="0.0.0.0",  # noqa: S104 - the container must accept outside connections
        port=port,
        log_config=None,
        access_log=False,
        server_header=False,
        timeout_keep_alive=60,
        # Vercel sends SIGTERM and allows 30 seconds; finish in-flight requests within 20.
        timeout_graceful_shutdown=20,
    )
    log.info("listening", port=port)
    uvicorn.Server(config).run()
    log.info("shut down")


if __name__ == "__main__":
    main()
````

### A6. `services/reporting-service/reporting_service/log.py` (full file)

````python
"""One JSON object per line on stdout, which Vercel collects as logs.

Callers pass only non-sensitive fields: never tokens, signatures, email addresses or webhook bodies.
"""

import json
import sys
from datetime import UTC, datetime
from typing import Any


def _write(level: str, msg: str, fields: dict[str, Any]) -> None:
    time = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    sys.stdout.write(json.dumps({"time": time, "level": level, "msg": msg, **fields}) + "\n")
    sys.stdout.flush()


def info(msg: str, **fields: Any) -> None:
    _write("info", msg, fields)


def warn(msg: str, **fields: Any) -> None:
    _write("warn", msg, fields)


def error(msg: str, **fields: Any) -> None:
    _write("error", msg, fields)
````

### A7. `services/reporting-service/reporting_service/auth.py` (full file)

````python
"""Validates Supabase Auth access tokens with PyJWT (ADR 0007).

Checks the signature with a key from the project's JWKS, the algorithm (ES256 or RS256 only), iss,
aud (authenticated), exp (required) and sub (required).
"""

import json
import threading
import time
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import jwt
from jwt import PyJWK, PyJWKSet

AUDIENCE = "authenticated"

# Asymmetric algorithms Supabase signing keys use; none and HS256 are rejected.
ALGORITHMS = ("ES256", "RS256")

FETCH_TIMEOUT_SECONDS = 5
CACHE_SECONDS = 60 * 60
# An unknown key id triggers at most one JWKS fetch per cooldown; with no keys yet, the wait is shorter.
COOLDOWN_SECONDS = 5 * 60
EMPTY_COOLDOWN_SECONDS = 30


@dataclass(frozen=True)
class Identity:
    """What handlers learn about the caller. It never holds the token itself."""

    user_id: str
    anonymous: bool


class InvalidTokenError(Exception):
    """The token is missing, malformed, or fails a check. The message never contains the token."""


# Returns the signing key for a key id, or raises InvalidTokenError.
KeySource = Callable[[str], PyJWK]


def issuer_for(supabase_url: str) -> str:
    return supabase_url.rstrip("/") + "/auth/v1"


class TokenVerifier:
    """Verifies a token against any key source; the tests pass local keys."""

    def __init__(self, keys: KeySource, issuer: str) -> None:
        self._keys = keys
        self._issuer = issuer

    def __call__(self, token: str) -> Identity:
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError as err:
            raise InvalidTokenError("malformed token") from err
        alg, kid = header.get("alg"), header.get("kid")
        if alg not in ALGORITHMS or not isinstance(kid, str):
            raise InvalidTokenError("unsupported token")
        key = self._keys(kid)
        if key.algorithm_name != alg:
            raise InvalidTokenError("algorithm does not match the key")
        try:
            claims = jwt.decode(
                token,
                key,
                algorithms=list(ALGORITHMS),
                audience=AUDIENCE,
                issuer=self._issuer,
                leeway=30,
                options={"require": ["exp", "sub", "iss", "aud"]},
            )
        except jwt.PyJWTError as err:
            raise InvalidTokenError("invalid token") from err
        sub = claims.get("sub")
        if not isinstance(sub, str) or sub == "":
            raise InvalidTokenError("token has no subject")
        return Identity(user_id=sub, anonymous=claims.get("is_anonymous") is True)


def _http_get_json(url: str) -> Any:
    request = urllib.request.Request(url, headers={"Accept": "application/json"})  # noqa: S310
    with urllib.request.urlopen(request, timeout=FETCH_TIMEOUT_SECONDS) as response:  # noqa: S310
        return json.load(response)


class JwksKeys:
    """Signing keys from the Supabase JWKS endpoint.

    Each fetch times out after 5 seconds and keys are cached for an hour. An unknown key id triggers
    a refetch at most once every 5 minutes, so forged key ids cannot flood the endpoint.
    """

    def __init__(
        self,
        url: str,
        fetch: Callable[[], Any] | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._fetch = fetch or (lambda: _http_get_json(url))
        self._clock = clock
        self._lock = threading.Lock()
        self._keys: dict[str, PyJWK] = {}
        self._fetched_at: float | None = None
        self._attempted_at: float | None = None

    def __call__(self, kid: str) -> PyJWK:
        with self._lock:
            now = self._clock()
            stale = self._fetched_at is None or now - self._fetched_at >= CACHE_SECONDS
            if stale or kid not in self._keys:
                cooldown = COOLDOWN_SECONDS if self._keys else EMPTY_COOLDOWN_SECONDS
                if self._attempted_at is None or now - self._attempted_at >= cooldown:
                    self._refresh(now)
            key = self._keys.get(kid)
        if key is None:
            raise InvalidTokenError("unknown signing key")
        return key

    def _refresh(self, now: float) -> None:
        self._attempted_at = now
        try:
            keyset = PyJWKSet.from_dict(self._fetch())
        except Exception:
            # Keep the cached keys; a caller with an unknown key id gets 401.
            return
        self._keys = {key.key_id: key for key in keyset.keys if key.key_id}
        self._fetched_at = now
````

### A8. `services/reporting-service/reporting_service/webhooks.py` (full file)

````python
"""Standard Webhooks verification, matching the platform dispatcher (eventbus.sign, ADR 0005).

webhook-signature carries one or more space-separated "v1,<base64 HMAC-SHA256>" values over
"<webhook-id>.<webhook-timestamp>.<raw body>", keyed with the base64 key of a whsec_ secret.
"""

import base64
import binascii
import hashlib
import hmac
import re

# Signed events older or newer than this are rejected, against replay.
TOLERANCE_SECONDS = 5 * 60

_TIMESTAMP = re.compile(r"[0-9]{1,12}")


def webhook_key(secret: str) -> bytes:
    """Decodes a whsec_<base64> secret into its key bytes; raises ValueError for any other form."""
    if not secret.startswith("whsec_"):
        raise ValueError("WEBHOOK_SECRET must use the whsec_<base64> form")
    try:
        key = base64.b64decode(secret.removeprefix("whsec_"), validate=True)
    except binascii.Error as err:
        raise ValueError("WEBHOOK_SECRET is not valid base64") from err
    if not key:
        raise ValueError("WEBHOOK_SECRET has an empty key")
    return key


def sign(key: bytes, msg_id: str, timestamp: int, body: bytes) -> str:
    digest = hmac.new(key, f"{msg_id}.{timestamp}.".encode() + body, hashlib.sha256).digest()
    return base64.b64encode(digest).decode()


def verify_webhook(
    key: bytes,
    msg_id: str | None,
    timestamp: str | None,
    signature: str | None,
    body: bytes,
    now: int,
) -> str | None:
    """Returns None for a valid delivery, otherwise the reason it was rejected."""
    if not msg_id or not timestamp or not signature:
        return "missing headers"
    if not _TIMESTAMP.fullmatch(timestamp):
        return "bad timestamp"
    sent_at = int(timestamp)
    if abs(now - sent_at) > TOLERANCE_SECONDS:
        return "timestamp out of tolerance"

    expected = base64.b64decode(sign(key, msg_id, sent_at, body))
    for candidate in signature.split(" "):
        version, _, value = candidate.partition(",")
        if version != "v1" or not value:
            continue
        try:
            given = base64.b64decode(value, validate=True)
        except binascii.Error:
            continue
        if hmac.compare_digest(given, expected):
            return None
    return "bad signature"
````

### A9. `services/reporting-service/reporting_service/app.py` (full file)

````python
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
````

### A10. `services/reporting-service/reporting_service/db.py` (full file)

````python
"""Database access as the reporting_service role, and the startup migrations (Alembic)."""

import ssl
from pathlib import Path
from typing import Any

from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, event, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.pool import NullPool

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"
SOCKET_TIMEOUT_SECONDS = 30
STATEMENT_TIMEOUT_MS = 30_000


def _ssl_context(sslmode: str | None) -> ssl.SSLContext | None:
    """Maps libpq's sslmode onto pg8000, which takes an SSL context instead."""
    if sslmode in (None, "disable"):
        return None
    if sslmode in ("allow", "prefer", "require"):
        # libpq's require encrypts without verifying the certificate; Supabase's pooler uses its own CA.
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        return context
    if sslmode == "verify-ca":
        context = ssl.create_default_context()
        context.check_hostname = False
        return context
    if sslmode == "verify-full":
        return ssl.create_default_context()
    raise ValueError("DATABASE_URL has an unsupported sslmode")


def _engine_url(database_url: str) -> tuple[URL, ssl.SSLContext | None]:
    """Accepts the postgres:// form every service uses and selects the pg8000 driver."""
    url = make_url(database_url)
    if url.drivername not in ("postgres", "postgresql"):
        raise ValueError("DATABASE_URL must start with postgres:// or postgresql://")
    sslmode = url.query.get("sslmode")
    if isinstance(sslmode, tuple):
        raise ValueError("DATABASE_URL has more than one sslmode")
    url = url.set(drivername="postgresql+pg8000").difference_update_query(["sslmode"])
    return url, _ssl_context(sslmode)


def create_db_engine(database_url: str) -> Engine:
    """No pooling: each use opens one connection and closes it, with timeouts on every step."""
    url, context = _engine_url(database_url)
    engine = create_engine(
        url,
        poolclass=NullPool,
        connect_args={
            "ssl_context": context,
            "timeout": SOCKET_TIMEOUT_SECONDS,
            "application_name": "reporting-service",
        },
    )

    @event.listens_for(engine, "connect")
    def set_statement_timeout(dbapi_connection: Any, _record: Any) -> None:
        # Outside a transaction, so the setting lasts for the whole session.
        dbapi_connection.autocommit = True
        cursor = dbapi_connection.cursor()
        cursor.execute(f"set statement_timeout = {STATEMENT_TIMEOUT_MS}")
        cursor.close()
        dbapi_connection.autocommit = False

    return engine


def migrate(database_url: str) -> int:
    """Applies pending Alembic migrations to the reporting schema and returns how many ran.

    Everything runs in one transaction: a transaction-level advisory lock serialises concurrent cold
    starts, and the version table (reporting.alembic_version) commits together with the migrations.
    """
    applied: list[str] = []
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    config.attributes["on_version_apply"] = lambda **kwargs: applied.append(kwargs["step"].up_revision_id)

    engine = create_db_engine(database_url)
    try:
        with engine.begin() as connection:
            connection.execute(text("select pg_advisory_xact_lock(hashtext('reporting-service.migrations'))"))
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
    finally:
        engine.dispose()
    return len(applied)
````

### A11. `services/reporting-service/migrations/env.py` (full file)

````python
"""Alembic environment. The service passes an open connection (reporting_service/db.py)."""

from alembic import context

config = context.config
connection = config.attributes.get("connection")
if connection is None:
    raise RuntimeError("Migrations run on service startup; there is no offline or standalone mode.")

context.configure(
    connection=connection,
    # The history table lives in the reporting schema, next to the service's tables.
    version_table_schema="reporting",
    on_version_apply=config.attributes.get("on_version_apply"),
)
with context.begin_transaction():
    context.run_migrations()
````

### A12. `services/reporting-service/migrations/script.py.mako` (full file)

````mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
${imports if imports else ""}
revision: str = ${repr(up_revision)}
down_revision: str | None = ${repr(down_revision)}
branch_labels: str | Sequence[str] | None = ${repr(branch_labels)}
depends_on: str | Sequence[str] | None = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
````

### A13. `services/reporting-service/migrations/versions/0001_create_inbox.py` (full file)

````python
"""Create the inbox table: event ids already processed, for idempotent consumption (ADR 0005).

Revision ID: 0001
Revises:
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "inbox",
        sa.Column("event_id", sa.Text(), primary_key=True),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        schema="reporting",
    )


def downgrade() -> None:
    op.drop_table("inbox", schema="reporting")
````

### A14. `services/reporting-service/tests/test_auth.py` (full file)

````python
import base64
import hashlib
import hmac
import json
import time
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from jwt import PyJWK
from jwt.algorithms import ECAlgorithm, RSAAlgorithm

from reporting_service.auth import (
    AUDIENCE,
    COOLDOWN_SECONDS,
    Identity,
    InvalidTokenError,
    JwksKeys,
    TokenVerifier,
)

ISSUER = "https://project.example/auth/v1"
USER = "6f1c7d0e-0000-4000-8000-000000000001"

EC_KEY = ec.generate_private_key(ec.SECP256R1())
OTHER_EC_KEY = ec.generate_private_key(ec.SECP256R1())
RSA_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _jwk(public_jwk: str, alg: str, kid: str) -> dict[str, Any]:
    return {**json.loads(public_jwk), "alg": alg, "kid": kid, "use": "sig"}


JWKS = {
    "keys": [
        _jwk(ECAlgorithm.to_jwk(EC_KEY.public_key()), "ES256", "ec-key"),
        _jwk(RSAAlgorithm.to_jwk(RSA_KEY.public_key()), "RS256", "rsa-key"),
    ]
}
KEYS = {jwk["kid"]: PyJWK(jwk) for jwk in JWKS["keys"]}


def local_keys(kid: str) -> PyJWK:
    if kid not in KEYS:
        raise InvalidTokenError("unknown signing key")
    return KEYS[kid]


verify = TokenVerifier(local_keys, ISSUER)


def claims(remove: tuple[str, ...] = (), **overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "sub": USER,
        "iss": ISSUER,
        "aud": AUDIENCE,
        "exp": int(time.time()) + 3600,
        "is_anonymous": True,
        **overrides,
    }
    for name in remove:
        del payload[name]
    return payload


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def test_accepts_a_valid_guest_token() -> None:
    token = jwt.encode(claims(), EC_KEY, algorithm="ES256", headers={"kid": "ec-key"})
    assert verify(token) == Identity(user_id=USER, anonymous=True)


def test_accepts_a_valid_rs256_token() -> None:
    token = jwt.encode(claims(is_anonymous=False), RSA_KEY, algorithm="RS256", headers={"kid": "rsa-key"})
    assert verify(token) == Identity(user_id=USER, anonymous=False)


def test_rejects_invalid_tokens() -> None:
    now = int(time.time())
    payload = b64url(json.dumps(claims()).encode())
    hs_header = b64url(b'{"alg":"HS256","typ":"JWT","kid":"ec-key"}')
    hs_signature = b64url(
        hmac.new(b"shared-secret", f"{hs_header}.{payload}".encode(), hashlib.sha256).digest()
    )
    cases = {
        "expired": jwt.encode(claims(exp=now - 3600), EC_KEY, algorithm="ES256", headers={"kid": "ec-key"}),
        "no expiry": jwt.encode(claims(("exp",)), EC_KEY, algorithm="ES256", headers={"kid": "ec-key"}),
        "wrong issuer": jwt.encode(
            claims(iss="https://attacker.example/auth/v1"),
            EC_KEY,
            algorithm="ES256",
            headers={"kid": "ec-key"},
        ),
        "wrong audience": jwt.encode(
            claims(aud="anon"), EC_KEY, algorithm="ES256", headers={"kid": "ec-key"}
        ),
        "no subject": jwt.encode(claims(("sub",)), EC_KEY, algorithm="ES256", headers={"kid": "ec-key"}),
        "other signing key": jwt.encode(claims(), OTHER_EC_KEY, algorithm="ES256", headers={"kid": "ec-key"}),
        "key of another algorithm": jwt.encode(
            claims(), EC_KEY, algorithm="ES256", headers={"kid": "rsa-key"}
        ),
        "unknown key id": jwt.encode(claims(), EC_KEY, algorithm="ES256", headers={"kid": "nope"}),
        "alg none": f"{b64url(b'{"alg":"none","typ":"JWT"}')}.{payload}.",
        "alg HS256": f"{hs_header}.{payload}.{hs_signature}",
        "garbage": "not-a-jwt",
    }
    for name, token in cases.items():
        with pytest.raises(InvalidTokenError):
            verify(token)
            pytest.fail(f"{name} must be rejected")


class FakeJwks:
    def __init__(self) -> None:
        self.calls = 0
        self.now = 1000.0

    def fetch(self) -> dict[str, Any]:
        self.calls += 1
        return JWKS

    def clock(self) -> float:
        return self.now


def test_jwks_keys_are_cached_and_unknown_ids_refetch_at_most_once_per_cooldown() -> None:
    fake = FakeJwks()
    keys = JwksKeys("https://project.example/jwks", fetch=fake.fetch, clock=fake.clock)

    assert keys("ec-key").key_id == "ec-key"
    assert keys("rsa-key").key_id == "rsa-key"
    assert fake.calls == 1, "known keys come from the cache"

    for _ in range(3):
        with pytest.raises(InvalidTokenError):
            keys("forged-kid")
    assert fake.calls == 1, "no refetch within the cooldown"

    fake.now += COOLDOWN_SECONDS
    with pytest.raises(InvalidTokenError):
        keys("forged-kid")
    assert fake.calls == 2, "one refetch after the cooldown"

    fake.now += 60 * 60
    keys("ec-key")
    assert fake.calls == 3, "the cache expires after an hour"


def test_jwks_fetch_failure_keeps_cached_keys() -> None:
    fake = FakeJwks()
    keys = JwksKeys("https://project.example/jwks", fetch=fake.fetch, clock=fake.clock)
    keys("ec-key")

    def failing() -> dict[str, Any]:
        raise OSError("timed out")

    keys._fetch = failing
    fake.now += 60 * 60
    assert keys("ec-key").key_id == "ec-key", "stale keys still verify while the endpoint is down"
````

### A15. `services/reporting-service/tests/test_webhooks.py` (full file)

````python
import base64

import pytest

from reporting_service.webhooks import TOLERANCE_SECONDS, sign, verify_webhook, webhook_key

# Same form as the local dispatcher secret in supabase/seed.sql (not a real credential).
KEY = webhook_key("whsec_" + base64.b64encode(b"test-only-reporting").decode())
NOW = 1_800_000_000
BODY = b'{"id":"evt-1","type":"payment.succeeded.v1"}'


def test_accepts_a_valid_signature() -> None:
    signature = "v1," + sign(KEY, "evt-1", NOW, BODY)
    assert verify_webhook(KEY, "evt-1", str(NOW), signature, BODY, NOW) is None


def test_accepts_a_valid_signature_among_several_values() -> None:
    signature = "v1," + base64.b64encode(bytes(32)).decode() + " v1," + sign(KEY, "evt-1", NOW, BODY)
    assert verify_webhook(KEY, "evt-1", str(NOW), signature, BODY, NOW) is None


def test_rejects_missing_headers() -> None:
    assert verify_webhook(KEY, "evt-1", None, "v1,x", BODY, NOW) == "missing headers"


def test_rejects_a_timestamp_outside_the_tolerance_in_both_directions() -> None:
    for sent_at in (NOW - TOLERANCE_SECONDS - 1, NOW + TOLERANCE_SECONDS + 1):
        signature = "v1," + sign(KEY, "evt-1", sent_at, BODY)
        assert (
            verify_webhook(KEY, "evt-1", str(sent_at), signature, BODY, NOW) == "timestamp out of tolerance"
        )


def test_rejects_tampering_another_key_or_version_and_bad_values() -> None:
    signature = "v1," + sign(KEY, "evt-1", NOW, BODY)
    other_key = webhook_key("whsec_" + base64.b64encode(b"other").decode())
    checks = [
        verify_webhook(KEY, "evt-1", str(NOW), signature, BODY + b" ", NOW),
        verify_webhook(KEY, "evt-2", str(NOW), signature, BODY, NOW),
        verify_webhook(KEY, "evt-1", str(NOW - 1), signature, BODY, NOW),
        verify_webhook(other_key, "evt-1", str(NOW), signature, BODY, NOW),
        verify_webhook(KEY, "evt-1", str(NOW), "v2," + sign(KEY, "evt-1", NOW, BODY), BODY, NOW),
        verify_webhook(KEY, "evt-1", str(NOW), "v1,short", BODY, NOW),
        verify_webhook(KEY, "evt-1", str(NOW), "v1,not*base64", BODY, NOW),
    ]
    assert checks == ["bad signature"] * len(checks)


def test_rejects_a_malformed_timestamp() -> None:
    assert verify_webhook(KEY, "evt-1", "17e8", "v1,x", BODY, NOW) == "bad timestamp"


def test_accepts_only_whsec_secrets_with_a_key() -> None:
    for secret in ("plain-secret", "whsec_", "whsec_not*base64"):
        with pytest.raises(ValueError, match="WEBHOOK_SECRET"):
            webhook_key(secret)
````

### A16. `services/reporting-service/tests/test_app.py` (full file)

````python
import base64

from fastapi.testclient import TestClient

from reporting_service.app import MAX_EVENT_BYTES, create_app
from reporting_service.auth import Identity, InvalidTokenError
from reporting_service.webhooks import sign, webhook_key

KEY = webhook_key("whsec_" + base64.b64encode(b"test-only-reporting").decode())
NOW = 1_800_000_000


def stand_in_verifier(token: str) -> Identity:
    """Stand-in for the JWKS verifier, which has its own tests."""
    if token != "good-token":
        raise InvalidTokenError("invalid token")
    return Identity(user_id="user-1", anonymous=True)


client = TestClient(create_app(stand_in_verifier, KEY, now=lambda: NOW))


def test_serves_health_without_a_token() -> None:
    res = client.get("/health")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("application/json")
    assert res.json() == {"status": "ok"}


def test_requires_a_token_on_planned_endpoints_then_answers_501() -> None:
    for method, path in (("POST", "/sandbox/reset"), ("GET", "/reports/payments-per-day")):
        anonymous = client.request(method, path)
        assert anonymous.status_code == 401
        assert anonymous.headers["www-authenticate"] == 'Bearer realm="reporting-service"'

        bad = client.request(method, path, headers={"Authorization": "Bearer bad-token"})
        assert bad.status_code == 401

        good = client.request(method, path, headers={"Authorization": "Bearer good-token"})
        assert good.status_code == 501
        assert good.json()["error"] == "not_implemented"


def test_accepts_only_correctly_signed_webhooks_on_events_then_answers_501() -> None:
    body = b'{"specversion":"1.0","id":"evt-1","type":"payment.succeeded.v1"}'
    signed = {
        "content-type": "application/cloudevents+json",
        "webhook-id": "evt-1",
        "webhook-timestamp": str(NOW),
        "webhook-signature": "v1," + sign(KEY, "evt-1", NOW, body),
    }

    unsigned = client.post("/events", content=body, headers={"content-type": "application/json"})
    assert unsigned.status_code == 401

    tampered = client.post("/events", content=body + b" ", headers=signed)
    assert tampered.status_code == 401

    valid = client.post("/events", content=body, headers=signed)
    assert valid.status_code == 501

    too_large = client.post("/events", content=b"x" * (MAX_EVENT_BYTES + 1), headers=signed)
    assert too_large.status_code == 413


def test_answers_404_and_405_as_json() -> None:
    missing = client.get("/nope")
    assert missing.status_code == 404
    assert missing.json()["error"] == "not_found"

    wrong_method = client.get("/events")
    assert wrong_method.status_code == 405
    assert wrong_method.json()["error"] == "method_not_allowed"

    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404
````

### A17. `services/reporting-service/tests/test_integration.py` (full file)

````python
"""Runs against the local Supabase stack.

Skipped unless REPORTING_TEST_DATABASE_URL, REPORTING_TEST_SUPABASE_URL and REPORTING_TEST_SUPABASE_KEY
are set (the reporting-service CI workflow sets them).
"""

import base64
import os

import httpx2
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import exc, text

from reporting_service.app import create_app
from reporting_service.auth import JwksKeys, TokenVerifier, issuer_for
from reporting_service.db import create_db_engine, migrate
from reporting_service.webhooks import webhook_key

DATABASE_URL = os.environ.get("REPORTING_TEST_DATABASE_URL", "")
SUPABASE_URL = os.environ.get("REPORTING_TEST_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("REPORTING_TEST_SUPABASE_KEY", "")

pytestmark = pytest.mark.skipif(
    not (DATABASE_URL and SUPABASE_URL and SUPABASE_KEY), reason="integration environment not set"
)


def test_applies_migrations_into_the_reporting_schema_and_a_rerun_is_a_no_op() -> None:
    migrate(DATABASE_URL)
    assert migrate(DATABASE_URL) == 0, "the second run applies nothing"
    engine = create_db_engine(DATABASE_URL)
    try:
        with engine.connect() as connection:
            tables = connection.execute(
                text(
                    "select to_regclass('reporting.inbox') is not null as inbox,"
                    " to_regclass('reporting.alembic_version') is not null as history"
                )
            ).one()
            assert (tables.inbox, tables.history) == (True, True)
            version = connection.execute(
                text("select version_num from reporting.alembic_version")
            ).scalar_one()
            assert version == "0001"
    finally:
        engine.dispose()


def test_refuses_the_role_access_to_other_schemas() -> None:
    engine = create_db_engine(DATABASE_URL)
    try:
        for schema in ("account", "ledger", "payment", "notification"):
            with engine.connect() as connection, pytest.raises(exc.DBAPIError) as raised:
                connection.execute(text(f"select 1 from {schema}.any_table"))  # noqa: S608 - fixed names
            assert raised.value.orig is not None
            assert raised.value.orig.args[0]["C"] == "42501", f"insufficient_privilege on {schema}"
    finally:
        engine.dispose()


def test_accepts_a_supabase_guest_token_through_the_jwks() -> None:
    issuer = issuer_for(SUPABASE_URL)
    verifier = TokenVerifier(JwksKeys(f"{issuer}/.well-known/jwks.json"), issuer)
    key = webhook_key("whsec_" + base64.b64encode(b"test-only-reporting").decode())
    client = TestClient(create_app(verifier, key))

    assert client.post("/sandbox/reset").status_code == 401

    signup = httpx2.post(
        f"{issuer}/signup",
        headers={"apikey": SUPABASE_KEY, "content-type": "application/json"},
        content=b"{}",
        timeout=10,
    )
    assert signup.status_code == 200, "anonymous sign-in"
    token = signup.json()["access_token"]

    with_guest = client.post("/sandbox/reset", headers={"Authorization": f"Bearer {token}"})
    assert with_guest.status_code == 501
````

### A18. `services/reporting-service/Dockerfile` (full file)

````dockerfile
# One image for Vercel (Container runtime), Docker Compose and Kubernetes (ADR 0003).

FROM ghcr.io/astral-sh/uv:0.13.9 AS uv

FROM python:3.13.18-slim-trixie AS build
COPY --from=uv /uv /usr/local/bin/uv
# Use the image's Python, compile bytecode at build time, and put the environment in /app/.venv.
ENV UV_PYTHON_DOWNLOADS=never UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/app/.venv
WORKDIR /app
COPY pyproject.toml uv.lock .python-version ./
# Runtime dependencies only, exactly as locked.
RUN uv sync --locked --no-dev --no-install-project
COPY reporting_service ./reporting_service
COPY migrations ./migrations

# Same Python base without uv, running as a non-root user.
FROM python:3.13.18-slim-trixie
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin app
WORKDIR /app
COPY --from=build /app /app
# A non-root user cannot bind port 80, so the image listens on 8080. Set PORT=8080 on Vercel too.
ENV PATH=/app/.venv/bin:$PATH PORT=8080 PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
EXPOSE 8080
USER 10001
CMD ["python", "-m", "reporting_service.main"]
````

### A19. `services/reporting-service/.dockerignore` (full file)

````text
.env
.env.*
.venv/
__pycache__/
.pytest_cache/
.ruff_cache/
.mypy_cache/
tests/
openspec/
README.md
Dockerfile
.dockerignore
vercel.json
alembic.ini
````

### A20. `services/reporting-service/vercel.json` (full file)

````json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "container"
}
````

### A21. `services/reporting-service/.env.example` (full file)

````text
# Local development only. Copy to .env (gitignored). Hosted values live only in Vercel.
PORT=8085
# Local-only role password from supabase/seed.sql; never a real credential.
DATABASE_URL=postgres://reporting_service:local-dev-only-reporting@127.0.0.1:54322/postgres
SUPABASE_URL=http://127.0.0.1:54321
# Local-only dispatcher signing secret: the value supabase/seed.sql stores in Vault, which is
# whsec_ followed by base64("local-dev-only-reporting"). Print it with:
#   python -c "import base64; print('whsec_' + base64.b64encode(b'local-dev-only-reporting').decode())"
WEBHOOK_SECRET=<paste the printed value>
````

### A22. `services/reporting-service/README.md` (full file)

````md
# reporting-service

Read model of cross-service summaries, built only from events. Built with Python 3.13 and FastAPI (managed with uv), packaged as a container.

## Status

In progress: the service skeleton is in place. It covers health, JWT validation, webhook signature verification, own-schema migrations with the `inbox` table, the container image and CI. `POST /events`, `GET /reports/payments-per-day` and `POST /sandbox/reset` answer `501` after their checks until roadmap steps 4 and 5.

## Responsibilities

- Owns the `reporting` schema. Migrations are Alembic revisions under `migrations/`, applied on every start, with the version table (`alembic_version`) inside the `reporting` schema.
- Receives events only through signed webhooks: Standard Webhooks HMAC-SHA256, a timing-safe compare, and a 5-minute timestamp tolerance against replay. It is idempotent through the `inbox` table.
- Builds summaries such as payments per day from consumed events; never writes to other services.
- Parameterized SQL only.
- Never logs tokens, signatures, webhook bodies or email addresses.

## Data model

| Table | Holds |
|---|---|
| `inbox` | `event_id` (primary key), `event_type`, `received_at`: event ids already processed |

## API

The contract is [contracts/openapi/reporting.yaml](../../contracts/openapi/reporting.yaml).

| Endpoint | Authentication | Now |
|---|---|---|
| `GET /health` | none | `200` with `{"status":"ok"}` |
| `POST /events` | webhook signature | `401` for a missing, wrong or stale signature; `501` once verified (planned: consume the CloudEvent) |
| `GET /reports/payments-per-day` | bearer token | `501` (planned: payments per day and outcome) |
| `POST /sandbox/reset` | bearer token | `501` (planned: delete the caller's rows) |

Webhook signature (Standard Webhooks, the format the dispatcher in `supabase/` uses):
- headers `webhook-id`, `webhook-timestamp` (Unix seconds) and `webhook-signature` (one or more space-separated `v1,<base64>` values);
- the signature is HMAC-SHA256 over `<webhook-id>.<webhook-timestamp>.<raw body>`, keyed with the base64 key of the `whsec_` secret;
- the comparison is timing-safe, and timestamps more than 5 minutes away from now are rejected.

Tokens are Supabase Auth access tokens, validated with PyJWT (ADR 0007):
- the signature is checked with keys from `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`;
- only ES256 or RS256 are accepted, and the token's algorithm must match its key;
- `iss` must be `<SUPABASE_URL>/auth/v1`, and `aud` must be `authenticated`;
- `exp` and `sub` are required.

A missing or invalid token gets `401` with `WWW-Authenticate: Bearer`. Every error response is JSON. There is no interactive API documentation page; the contract file is the documentation.

## Events

- Publishes: none.
- Consumes: `payment.succeeded.v1`, `payment.failed.v1`, `ledger.entry-posted.v1` (consumer group `reporting`). Planned.

## Configuration

| Variable | Meaning |
|---|---|
| `PORT` | Listening port. Default `80`; the container image sets `8080`. |
| `DATABASE_URL` | `postgres://user:password@host:port/database?params` for the `reporting_service` role. URL-encode special characters in the password. `sslmode` may be `disable`, `require`, `verify-ca` or `verify-full`. |
| `SUPABASE_URL` | Supabase project URL, used for the JWKS endpoint and the expected issuer. |
| `WEBHOOK_SECRET` | The dispatcher's signing secret for this consumer group, in the `whsec_<base64>` form. |

[.env.example](.env.example) has local values. Copy it to `.env` for local runs; `.env` is gitignored.

Outbound calls and their timeouts:
- **JWKS fetch:** 5 seconds. Keys are cached for an hour, and an unknown key id triggers at most one fetch every 5 minutes.
- **Database:** a 30-second socket timeout for connecting and for each read, and a 30-second statement timeout.

## Local development

You need [uv](https://docs.astral.sh/uv/) (it provides Python 3.13 if missing), plus Docker for the local Supabase stack.

1. From the repository root, start Supabase: `npx -y supabase@3.2.0 start`. `supabase/seed.sql` sets the local `reporting_service` password and the local dispatcher secret.
2. Install and run from this folder:
   ```bash
   uv sync
   cp .env.example .env   # then fill in WEBHOOK_SECRET as the file explains
   uv run --env-file .env python -m reporting_service.main
   ```
3. Check it: `curl http://127.0.0.1:8085/health`.

Commands:
- `uv run ruff check .` and `uv run ruff format --check .` lint and check formatting.
- `uv run mypy` type-checks in strict mode.
- `uv run pytest` runs the unit and HTTP tests and skips the integration tests.
- `uv run alembic revision -m "<message>"` creates a new migration file under `migrations/versions/`.

To run the integration tests too, with the local stack running:
```bash
eval "$(npx -y supabase@3.2.0 status -o env)"
REPORTING_TEST_DATABASE_URL="postgres://reporting_service:local-dev-only-reporting@127.0.0.1:54322/postgres" \
REPORTING_TEST_SUPABASE_URL="$API_URL" REPORTING_TEST_SUPABASE_KEY="$PUBLISHABLE_KEY" \
  uv run pytest
```

Container: `docker build -t reporting-service .`, then run it with the four variables set.

## Owner setup (hosted)

These are owner actions. Agents never run them.

1. **Role password.** In the Supabase dashboard, open the SQL editor and set a strong password for the role:
   ```sql
   alter role reporting_service password '<strong-random-password>';
   ```
   Keep it only in Vercel.
2. **Webhook secret.** Use the same value you stored in Vault as `eventbus_webhook_secret_reporting` (`supabase/README.md`, "Hosted setup"). You can read it back in the SQL editor:
   ```sql
   select decrypted_secret from vault.decrypted_secrets where name = 'eventbus_webhook_secret_reporting';
   ```
3. **Vercel project.** Import the repository as a new project:
   - Root Directory: `services/reporting-service`;
   - framework: Container (`vercel.json` selects it).

   Add these Production environment variables:
   - `PORT` = `8080`;
   - `SUPABASE_URL` = `https://<project-ref>.supabase.co`;
   - `DATABASE_URL` = the **session pooler** URL (port 5432) with the role as user: `postgres://reporting_service.<project-ref>:<password>@<pooler-host>:5432/postgres?sslmode=require`;
   - `WEBHOOK_SECRET` = the value from step 2.

   Use session mode, not transaction mode (port 6543): each start runs the migrations in one session.
4. **Check.** After the deploy:
   - `https://<reporting-project>.vercel.app/health` returns `{"status":"ok"}`;
   - `POST /events` without a signature returns `401`;
   - `GET /reports/payments-per-day` and `POST /sandbox/reset` without a token return `401`.

The dispatcher's endpoint URL for the `reporting` consumer is set in roadmap step 4, when the service starts processing events.

## Related

- [ADR 0005: Events with pgmq and webhooks](../../architecture/adr/0005-kafka-like-events-with-pgmq-and-webhooks.md)
- [ADR 0004: Database per service via schema isolation](../../architecture/adr/0004-database-per-service-via-schema-isolation.md)
- [ADR 0003: Service per Vercel project as containers](../../architecture/adr/0003-service-per-vercel-project-as-containers.md)
- [ADR 0007: OAuth2/OIDC with Supabase Auth](../../architecture/adr/0007-oauth2-oidc-with-supabase-auth.md)
- [ADR 0010: Native observability charts via the BFF](../../architecture/adr/0010-native-observability-charts-via-bff.md)
- [ADR 0002: Polyglot services](../../architecture/adr/0002-polyglot-services.md)
````

### A23. `.github/workflows/reporting-service.yml` (full file)

````yaml
name: reporting-service

on:
  push:
    branches: [main]
    paths:
      - "services/reporting-service/**"
      - "contracts/openapi/reporting.yaml"
      - "supabase/config.toml"
      - "supabase/migrations/**"
      - "supabase/seed.sql"
      - ".github/workflows/reporting-service.yml"
  pull_request:
    paths:
      - "services/reporting-service/**"
      - "contracts/openapi/reporting.yaml"
      - "supabase/config.toml"
      - "supabase/migrations/**"
      - "supabase/seed.sql"
      - ".github/workflows/reporting-service.yml"

permissions:
  contents: read

jobs:
  reporting-service:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    defaults:
      run:
        working-directory: services/reporting-service
    env:
      # Dummy values so env() references in supabase/config.toml resolve. Not real credentials.
      SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: ci-dummy-client-id
      SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET: ci-dummy-secret
      SUPABASE_AUTH_CAPTCHA_SECRET: ci-dummy-captcha
      # Local-only role password from supabase/seed.sql. Not a real credential.
      LOCAL_DATABASE_URL: postgres://reporting_service:local-dev-only-reporting@127.0.0.1:54322/postgres
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0

      - uses: astral-sh/setup-uv@v10.3.3
        with:
          version: "0.13.9"
          python-version: "3.13"
          enable-cache: true
          cache-dependency-glob: services/reporting-service/uv.lock

      - run: uv sync --locked

      - name: Lint and format check
        run: |
          uv run ruff check .
          uv run ruff format --check .

      - name: Type check
        run: uv run mypy

      - name: Validate service specs
        run: npx -y @fission-ai/openspec@latest validate --all --strict

      - name: Check the API contract for breaking changes
        if: github.event_name == 'pull_request'
        working-directory: .
        run: |
          git show "origin/${{ github.base_ref }}:contracts/openapi/reporting.yaml" > "$RUNNER_TEMP/reporting-base.yaml"
          cp contracts/openapi/reporting.yaml "$RUNNER_TEMP/reporting-revision.yaml"
          docker run --rm -v "$RUNNER_TEMP:/specs:ro" tufin/oasdiff:v1.39.0 \
            breaking --fail-on ERR /specs/reporting-base.yaml /specs/reporting-revision.yaml

      - uses: supabase/setup-cli@v3
        with:
          version: 3.2.0

      - name: Generate an ephemeral JWT signing key
        working-directory: .
        run: |
          echo '[]' > supabase/signing_keys.json
          supabase gen signing-key --algorithm ES256 --append

      # Database, auth and gateway only.
      - name: Start the local Supabase stack
        working-directory: .
        run: supabase start -x realtime,storage-api,imgproxy,mailpit,studio,edge-runtime,logflare,vector,supavisor

      # Unit and HTTP tests, plus the integration tests against the local stack. The summary must
      # count all 19 tests as passed, so the integration tests cannot pass by being skipped.
      - name: Tests
        run: |
          eval "$(supabase status -o env)"
          REPORTING_TEST_DATABASE_URL="$LOCAL_DATABASE_URL" \
          REPORTING_TEST_SUPABASE_URL="$API_URL" \
          REPORTING_TEST_SUPABASE_KEY="$PUBLISHABLE_KEY" \
            uv run pytest 2>&1 | tee "$RUNNER_TEMP/reporting-tests.txt"
          grep -Eq "^=+ 19 passed in [0-9.]+s =+$" "$RUNNER_TEMP/reporting-tests.txt"

      - name: Build the container image
        run: docker build -t reporting-service:ci .

      - name: Smoke test the container
        run: |
          eval "$(supabase status -o env)"
          # The local dispatcher secret from supabase/seed.sql (not a real credential).
          webhook_secret="whsec_$(printf '%s' 'local-dev-only-reporting' | base64)"
          docker run -d --name reporting-service --network host \
            -e PORT=8085 -e DATABASE_URL="$LOCAL_DATABASE_URL" -e SUPABASE_URL="$API_URL" \
            -e WEBHOOK_SECRET="$webhook_secret" \
            reporting-service:ci
          for i in $(seq 1 60); do
            curl -fsS http://127.0.0.1:8085/health && break
            sleep 1
          done
          test "$(curl -s http://127.0.0.1:8085/health)" = '{"status":"ok"}'
          test "$(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:8085/sandbox/reset)" = 401
          test "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8085/reports/payments-per-day)" = 401
          test "$(curl -s -o /dev/null -w '%{http_code}' -X POST -d '{}' http://127.0.0.1:8085/events)" = 401
          docker logs reporting-service

      - name: Stop the local Supabase stack
        if: always()
        working-directory: .
        run: supabase stop --no-backup
````

### A24. `contracts/openapi/reporting.yaml` (full file; adds the three `501` responses)

````yaml
openapi: 3.1.0
x-status: planned
info:
  title: reporting-service API
  version: 0.1.0
servers: []
security:
  - bearerAuth: []
paths:
  /health:
    get:
      summary: Health check
      security: []
      responses:
        "200":
          description: Service is healthy.
          content:
            application/json:
              schema:
                type: object
                properties:
                  status:
                    const: ok
  /events:
    post:
      summary: Receive a signed CloudEvent from the dispatcher
      security: []
      responses:
        "2xx":
          description: Event accepted (processed or already seen).
        "401":
          description: Signature or timestamp check failed.
        "501":
          description: Not implemented yet (signature verified; processing is planned).
  /reports/payments-per-day:
    get:
      summary: Read-only payments per day summary
      responses:
        "200":
          description: Summary rows.
        "401":
          description: Missing or invalid bearer token.
        "501":
          description: Not implemented yet (planned endpoint).
  /sandbox/reset:
    post:
      summary: Delete the caller's reporting rows
      responses:
        "200":
          description: Caller's rows were deleted.
        "401":
          description: Missing or invalid bearer token.
        "501":
          description: Not implemented yet (planned endpoint).
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
````

### A25. `.github/dependabot.yml` (append)

Append these lines at the end of the file, after the last line of the existing notification-service `docker` entry. Keep the two-space indentation: each `- package-ecosystem` line starts with two spaces, at the same level as the existing entries. Change nothing else.

````yaml
  - package-ecosystem: uv
    directory: /services/reporting-service
    schedule:
      interval: weekly
  - package-ecosystem: docker
    directory: /services/reporting-service
    schedule:
      interval: weekly
````

### A26. `.gitignore` (one inserted line)

Insert this line directly after the existing line `.ruff_cache/` (in the `# Python` section). Change nothing else.

````text
.mypy_cache/
````
