# Proposal

## Why

Roadmap step 3 gives each of the five services a deployable skeleton, one pull request per service. payment-service goes first, and the four services that follow copy its pattern:
- a health endpoint;
- JWT validation through JWKS;
- migrations in the service's own schema;
- one Dockerfile;
- a CI workflow;
- a Vercel container project.

Go builds a small static image with fast cold starts, so this change is also the cheapest way to prove the Vercel Container runtime (beta, ADR 0003) before the heavier stacks.

Owning scope: **services/payment-service**.

## What Changes

- **Go module:** `services/payment-service` becomes a Go 1.27 module whose HTTP server uses only the standard library. It reads `PORT` (default 80), `DATABASE_URL` and `SUPABASE_URL` from the environment and logs JSON to stdout. On SIGTERM it shuts down gracefully, finishing in-flight requests within 20 seconds.
- **`GET /health`:** answers `{"status":"ok"}`, with no token needed.
- **Resource-server JWT validation:**
  - signing keys come from the Supabase JWKS endpoint, with a 5-second fetch timeout and an hourly refresh;
  - only ES256 and RS256 tokens are accepted, so `none` and HS256 are rejected;
  - `iss`, `aud` (`authenticated`), `exp` and `sub` are required;
  - a missing or invalid token gets 401 with `WWW-Authenticate: Bearer`.
- **Planned endpoints:** `POST /payments` and `POST /sandbox/reset` require a valid token and answer 501 until roadmap step 5 implements them. They write nothing. The `contracts/openapi/payment.yaml` contract gains the 501 response; the change is additive and checked with oasdiff.
- **Migrations:** golang-migrate runs migrations at startup into the `payment` schema, with the history table also in `payment`. Migration 1 creates `payments`:
  - amounts in integer minor units with an ISO 4217 currency;
  - the scenario and outcome from the event contracts;
  - an idempotency key, unique per user.
- **Container:** a multi-stage Dockerfile produces a distroless image that runs as a non-root user and listens on 8080. `vercel.json` selects the Container preset, and `.dockerignore` keeps tests, env files and specs out of the image.
- **Tests:**
  - unit tests (no network) for the router and the JWT rules;
  - integration tests against the local Supabase stack: migrations, the role being refused other schemas, and a real Supabase guest token accepted through JWKS.
- **CI:** a new `payment-service` workflow runs formatting, vet, unit tests, `openspec validate`, the oasdiff breaking-change check, the integration tests, a Docker build and a container smoke test.
- **Dependabot:** watches the Go module and the Dockerfile base images.
- **Docs:** `README.md` and `.env.example` for the service, including the owner's hosted setup.

Root files this change touches, because GitHub only reads them from the repository root:
- `.github/workflows/payment-service.yml`: the service's own workflow;
- `.github/dependabot.yml`: two update entries scoped to `/services/payment-service`.

Both are the service's own CI wiring. No other root file changes.

Out of scope:
- the payment simulation, ledger orchestration, outbox and events, and sandbox reset logic (roadmap steps 4 and 5);
- guest restrictions: there is nothing to restrict yet;
- the site fault flag (503) and OpenTelemetry with `deployment.site` (roadmap steps 5 and 6);
- the other four services;
- any hosted action: setting the role password, creating the Vercel project or setting its variables (owner actions).

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `service-baseline`:
  - token validation gains concrete rules (accepted algorithms, 401 with `WWW-Authenticate`);
  - adds requirements for the listening port, startup migrations, graceful shutdown, and authenticated 501 answers on planned endpoints.

## Impact

- New files under `services/payment-service/`:
  - `go.mod`, `go.sum` and `main.go`;
  - `internal/auth`, `internal/httpapi`, `internal/migrations` (with `sql/`) and `internal/integration`;
  - `Dockerfile`, `.dockerignore`, `vercel.json` and `.env.example`.
- Changed: `services/payment-service/README.md`, `contracts/openapi/payment.yaml`, `.github/dependabot.yml`.
- New: `.github/workflows/payment-service.yml`.
- New dependencies, pinned and justified in `design.md`:
  - golang-jwt v5.3.1;
  - keyfunc v3.9.2 and jwkset v0.12.0;
  - golang-migrate v4.20.1;
  - pgx v5.13.0;
  - x/time v0.15.0.
- Contract: additive 501 responses only (no new version). Events: none.
- Idempotency: no write endpoint is implemented yet; both planned endpoints write nothing. The `payments` table enforces one row per (user, idempotency key) for step 5.
- Owner actions to go live:
  1. set the `payment_service` role password on the hosted project;
  2. create the Vercel project (Root Directory `services/payment-service`) and set `PORT`, `SUPABASE_URL` and `DATABASE_URL`;
  3. check `/health`.
