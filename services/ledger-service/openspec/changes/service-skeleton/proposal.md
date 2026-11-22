# Proposal

## Why

Roadmap step 3, second service. payment-service set the skeleton pattern and runs on Vercel. ledger-service now needs the same skeleton in Java 25 and Vert.x 5 (ADR 0006), so roadmap step 5 can post real payments into a ledger. The ledger's core invariants belong in the skeleton's first migration:
- every journal entry balances;
- the journal is append-only.

Owning scope: **services/ledger-service**.

## What Changes

- **Maven project:** `services/ledger-service` becomes a Maven project (Java 25, Vert.x 5.2.3) that builds a shaded jar. An enforcer rule requires JDK 25 and Maven 3.9.6 or newer.
- **Service runtime:** it reads `PORT` (default 80), `DATABASE_URL` and `SUPABASE_URL`, using the same `postgres://` URL format as payment-service. It logs one JSON object per line to stdout. On SIGTERM it shuts down gracefully, finishing in-flight requests within 20 seconds.
- **`GET /health`:** answers `{"status":"ok"}`, with no token needed.
- **Resource-server JWT validation with Vert.x `JWTAuth`:**
  - signing keys come from the Supabase JWKS endpoint, fetched with the non-blocking web client (5-second timeout) at startup, then hourly, plus at most every 5 minutes after a rejected token;
  - only ES256 and RS256 are accepted;
  - `iss`, `aud` (`authenticated`), `exp` and `sub` are required;
  - a missing or invalid token gets 401 with `WWW-Authenticate: Bearer`.
- **Planned endpoints:** `POST /ledger/postings`, `GET /ledger/journal`, `GET /ledger/general-ledger`, `GET /ledger/trial-balance` and `POST /sandbox/reset` require a valid token and answer 501 until roadmap step 5. They write nothing. `contracts/openapi/ledger.yaml` gains the 501 responses; the change is additive and checked with oasdiff.
- **Flyway migrations at startup:** they run on the main thread before Vert.x starts, into `ledger`, with `flyway_schema_history` also in `ledger`. Migration V1 creates:
  - `accounts`, seeded with the ADR 0006 chart of accounts;
  - `journal_entries`, with an idempotency key unique per user and a kind of opening, payment or reversal;
  - `journal_lines`, in integer minor units, each line a debit or a credit;
  - a deferred constraint trigger that rejects, at commit, any entry with fewer than two lines or unequal debits and credits;
  - triggers that reject any update of entries or lines.
- **Container:** a multi-stage Dockerfile (Maven build, then a distroless Java 25 runtime). It runs as a non-root user on port 8080, with JVM flags tuned for fast cold starts. `vercel.json` selects the Container preset, and `.dockerignore` keeps tests, env files and specs out.
- **Tests:**
  - unit tests with no network: the router, the JWT rules (ES256 and RS256 accepted; none, HS256, a wrong key, issuer, audience, expiry and subject rejected) and the `DATABASE_URL` conversion;
  - integration tests against local Supabase: migrations, the seeded chart, balanced entries committing, unbalanced and single-line entries rejected, updates rejected, the role refused other schemas, and a real Supabase guest token accepted.
- **CI:** a new `ledger-service` workflow runs `openspec validate`, oasdiff (PRs), `mvn verify` with the integration tests against the local stack (and a check that they really ran), a Docker build and a container smoke test.
- **Dependabot:** watches Maven and the Dockerfile base images for the service.
- **Docs:** `README.md` and `.env.example`, including the owner's hosted setup.

As for payment-service, two root files are the service's own CI wiring, which GitHub only reads from the root:
- `.github/workflows/ledger-service.yml`;
- two `.github/dependabot.yml` entries scoped to `/services/ledger-service`.

No other root file changes.

Out of scope:
- posting logic, reports, opening entries per user, sandbox reset, outbox and events (roadmap steps 4 and 5);
- guest restrictions, the site fault flag and telemetry (roadmap steps 5 and 6);
- the other three services;
- any hosted action (owner actions).

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `service-baseline`:
  - token validation gains concrete rules;
  - adds requirements for the listening port, startup migrations, graceful shutdown, and authenticated 501 answers on the planned endpoints.
- `double-entry-posting`: adds the storage-level guarantees. Unbalanced or single-line entries can never be committed, and entries and lines are never updated. The posting rules themselves do not change.

## Impact

- New files under `services/ledger-service/`:
  - `pom.xml`;
  - `src/main/java/...`: `Main`, `JsonLogFormatter`, the `auth`, `db` and `http` packages;
  - `src/main/resources/db/migration/V1__create_ledger.sql`;
  - `src/test/java/...`: four test classes;
  - `Dockerfile`, `.dockerignore`, `vercel.json` and `.env.example`.
- Changed: `services/ledger-service/README.md`, `contracts/openapi/ledger.yaml`, `.github/dependabot.yml`.
- New: `.github/workflows/ledger-service.yml`.
- New dependencies, pinned and justified in `design.md`:
  - Vert.x 5.2.3 (`vertx-web`, `vertx-web-client`, `vertx-auth-jwt`);
  - Flyway 13.13.0 (`flyway-core`, `flyway-database-postgresql`);
  - the PostgreSQL JDBC driver 42.7.14;
  - JUnit 5.14.4 (tests only).
- Contract: additive 501 responses only. Events: none.
- Idempotency: no write endpoint is implemented yet. `journal_entries` enforces one entry per (user, idempotency key) for step 5.
- Owner actions to go live, the same as payment-service:
  1. set the `ledger_service` role password;
  2. create the Vercel project (Root Directory `services/ledger-service`) and set `PORT`, `SUPABASE_URL` and `DATABASE_URL`;
  3. check `/health`.
