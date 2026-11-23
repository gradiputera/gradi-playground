# Proposal

## Why

Roadmap step 3, fifth and last service. payment (Go), ledger (Java), account (PHP) and notification (Node.js) run on Vercel with the shared skeleton pattern. reporting-service now gets the same skeleton in Python 3.13 with FastAPI, managed with uv. Like notification-service, it consumes events, so it also gets real webhook signature checks before roadmap step 4 connects the dispatcher.

Owning scope: **services/reporting-service**, plus the service's CI wiring at the root (see below).

## What Changes

- **FastAPI app:** `services/reporting-service` becomes a FastAPI app on Python 3.13, served by uvicorn, with dependencies locked by uv in `uv.lock`. The service:
  - reads `PORT` (default 80), `DATABASE_URL`, `SUPABASE_URL` and `WEBHOOK_SECRET`, and refuses to start without them;
  - logs one JSON object per line;
  - drains requests for up to 20 seconds on SIGTERM;
  - serves no interactive API documentation (`/docs`, `/openapi.json`); the contract file is the documentation.
- **`GET /health`:** answers `{"status":"ok"}`, with no token needed.
- **Resource-server JWT validation with PyJWT:**
  - keys come from the Supabase JWKS with a 5-second timeout, cached for an hour, with at most one refetch every 5 minutes for an unknown key;
  - only ES256 and RS256 are accepted, and the token's algorithm must match its key;
  - `iss`, `aud` (`authenticated`), `exp` and `sub` are required;
  - a missing or invalid token gets 401 with `WWW-Authenticate: Bearer`.
- **`POST /events` (webhook signature):** verifies Standard Webhooks signatures, the scheme the platform dispatcher uses (`eventbus.sign`): HMAC-SHA256 over `id.timestamp.raw-body` with the `whsec_` key, a constant-time comparison, and a 5-minute timestamp tolerance against replay. Failures get 401. Verified events (`payment.succeeded.v1`, `payment.failed.v1`, `ledger.entry-posted.v1`) get 501 until roadmap step 4 processes them; nothing is written, so the dispatcher redelivers later.
- **`GET /reports/payments-per-day`:** requires a valid token and answers 501 until step 4 builds the summary from `payment.succeeded.v1` and `payment.failed.v1`. It runs no query.
- **`POST /sandbox/reset`:** requires a valid token and answers 501 until roadmap step 5. It writes nothing.
- **Contract:** `contracts/openapi/reporting.yaml` gains the three 501 responses. The change is additive and checked with oasdiff.
- **Migrations:** Alembic revisions under `migrations/`, applied at startup in one transaction under an advisory lock, with the version table in `reporting.alembic_version`. Revision 0001 creates `reporting.inbox`: the event ids already processed, for idempotent consumption in step 4.
- **Database driver:** pg8000 (pure Python, BSD-3-Clause) through SQLAlchemy. The service maps the `sslmode` of the shared `postgres://` URL format onto pg8000's TLS settings.
- **Container:** `python:3.13.18-slim-trixie` with uv 0.13.9 installs the locked runtime dependencies; the same Python base runs them as a non-root user on port 8080. `vercel.json` selects the Container preset.
- **Tests:** pytest:
  - unit and HTTP tests with no network: the JWT rules, the JWKS cache, the webhook signature rules, the routes, 401, 404, 405, 413 and 501;
  - integration tests against local Supabase: migrations and the version table in `reporting`, a no-op rerun, the role refused other schemas, and a real Supabase guest token accepted.
- **Quality gates:** Ruff (lint and format) and mypy in strict mode.
- **CI:** a new `reporting-service` workflow runs:
  - `uv sync --locked`, Ruff, mypy and `openspec validate`;
  - oasdiff (PRs);
  - all 19 tests against the local stack, with a check that none were skipped;
  - a Docker build and a container smoke test, including an unsigned webhook answering 401.
- **Dependabot:** watches uv and the Dockerfile base images for the service.
- **Docs:** `README.md` and `.env.example`, including the owner's hosted setup and the webhook secret.

Files outside the service folder, all the service's own wiring:
- `.github/workflows/reporting-service.yml` (new) and two `.github/dependabot.yml` entries, because GitHub reads both only from the root;
- one `.gitignore` line for `.mypy_cache/`, mypy's local cache.

Out of scope:
- consuming events (inbox and read-model writes), the payments-per-day query, sandbox reset logic, guest restrictions, the site fault flag and telemetry (roadmap steps 4 to 6);
- setting the dispatcher's endpoint URL for the reporting consumer (step 4);
- the Grafana read-only KPI role (step 6);
- any hosted action (owner actions).

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `service-baseline`:
  - token validation gains concrete rules;
  - adds requirements for the listening port and required configuration (including `WEBHOOK_SECRET`), startup migrations, graceful shutdown, and the authenticated 501 on sandbox reset.
- `transaction-reporting`: adds the signed-webhook rules for `POST /events` (Standard Webhooks, 5-minute replay tolerance), the 501 for verified `payment.succeeded.v1`, `payment.failed.v1` and `ledger.entry-posted.v1` events before processing exists, and the authenticated 501 on `GET /reports/payments-per-day` before its summary exists.

## Impact

- New files under `services/reporting-service/`:
  - `pyproject.toml`, `uv.lock`, `.python-version`, `alembic.ini`;
  - `reporting_service/` (main, log, auth, webhooks, app, db);
  - `migrations/` (environment, template and revision 0001);
  - `tests/` (4 files);
  - `Dockerfile`, `.dockerignore`, `vercel.json` and `.env.example`.
- Changed: `services/reporting-service/README.md`, `contracts/openapi/reporting.yaml`, `.github/dependabot.yml`, `.gitignore`.
- New: `.github/workflows/reporting-service.yml`.
- New dependencies, pinned and justified in `design.md`:
  - FastAPI 0.165.0, uvicorn 0.54.0, PyJWT 2.15.1 (with `cryptography`), SQLAlchemy 2.1.9, Alembic 1.20.1, pg8000 1.31.6;
  - dev: pytest 9.2.0, httpx2 2.16.2, Ruff 0.17.6, mypy 2.4.1.
- Contract: additive 501 responses only. Events: none published; consumption arrives in step 4.
- Owner actions to go live:
  1. set the `reporting_service` role password;
  2. read the reporting consumer's webhook secret from Vault;
  3. create the Vercel project (Root Directory `services/reporting-service`) and set `PORT`, `SUPABASE_URL`, `DATABASE_URL` and `WEBHOOK_SECRET`;
  4. check `/health`, plus the 401s.
