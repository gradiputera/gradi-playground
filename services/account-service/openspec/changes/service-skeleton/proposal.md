# Proposal

## Why

Roadmap step 3, third service. payment-service (Go) and ledger-service (Java) run on Vercel with the shared skeleton pattern. account-service gets the same skeleton in PHP 8.4 and Laravel (ADR 0002, D1), plus its first table, so roadmap step 5 can seed and show sandbox balances.

Owning scope: **services/account-service**.

## What Changes

- **Laravel app:** `services/account-service` becomes a minimal Laravel 13 application (PHP 8.4). It has an API-only routing file, JSON-only errors, stdout JSON logs, a file cache for the JWKS, and no sessions or cookies. It reads `PORT` (default 80), `DATABASE_URL` and `SUPABASE_URL`, in the same `postgres://` URL format as the other services. `APP_DEBUG` is `false` everywhere outside a developer's machine.
- **`GET /health`:** answers `{"status":"ok"}`, with no token needed.
- **Resource-server JWT validation with `firebase/php-jwt`:**
  - the JWKS is fetched with a 5-second timeout and cached for an hour; after a rejected token it is refreshed at most once every 5 minutes;
  - only ES256 and RS256 are accepted;
  - `iss`, `aud` (`authenticated`), `exp` and `sub` are required;
  - a missing or invalid token gets 401 with `WWW-Authenticate: Bearer`.
- **Planned endpoint:** `POST /sandbox/reset` requires a valid token and answers 501 until roadmap step 5. It writes nothing. `contracts/openapi/account.yaml` gains the 501 response; the change is additive and checked with oasdiff.
- **Laravel migrations at startup:** they run into `account`, with the `migrations` history table also in `account`. The first migration creates `accounts`:
  - `id` (uuid), `user_id` (uuid), `currency` (`char(3)`, checked against ISO 4217 format), `balance_minor` (`bigint`, default 0) and timestamps;
  - unique per (user, currency).
- **Model `App\Models\Account`:** pinned to the `pgsql` connection (`search_path = account`) and the `accounts` table. Its only fillable field is `currency`. `user_id`, `balance_minor` and `id` cannot be mass-assigned.
- **Container:** FrankenPHP 1.14 on PHP 8.4.28, as one process. It runs as a non-root user on port 8080, with OPcache and production `php.ini` settings. The entrypoint:
  1. refuses to start without configuration;
  2. caches the configuration;
  3. applies migrations;
  4. starts FrankenPHP, which drains requests for up to 20 seconds on SIGTERM.

  `vercel.json` selects the Container preset.
- **Tests:**
  - unit and feature tests with no network: the routes, 401, 501, 404, 405, JSON errors, the JWT rules and mass-assignment guarding;
  - integration tests against local Supabase: migrations and the history table in `account`, integer minor units and the currency check, the role refused other schemas, and a real Supabase guest token accepted.
- **CI:** a new `account-service` workflow runs:
  - `composer validate` and `openspec validate`;
  - oasdiff (PRs);
  - PHPUnit with the integration tests against the local stack, plus a check that they really ran;
  - a Docker build and a container smoke test.
- **Dependabot:** watches Composer and the Dockerfile base images.
- **Docs:** `README.md` and `.env.example`, including the owner's hosted setup.

As for the other services, two root files are the service's own CI wiring:
- `.github/workflows/account-service.yml`;
- two `.github/dependabot.yml` entries scoped to `/services/account-service`.

Out of scope:
- seeding accounts, balance endpoints, sandbox reset logic, guest restrictions, the site fault flag and telemetry (roadmap steps 5 and 6);
- the other two services;
- any hosted action (owner actions).

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `service-baseline`:
  - token validation gains concrete rules;
  - adds requirements for the listening port, startup migrations, graceful shutdown, the authenticated 501 on sandbox reset, and JSON-only errors without debug output.
- `accounts-and-balances`: adds the storage rules for accounts:
  - one account per user and currency;
  - an ISO 4217 format check;
  - integer minor units.

  Mass-assignment guarding is now concrete: `Account` accepts only `currency`.

## Impact

- **Models and fillable fields:** `App\Models\Account`, fillable `currency` only.
- **New files** under `services/account-service/`:
  - `composer.json` and `composer.lock`, `artisan`, `phpunit.xml`;
  - `bootstrap/app.php`, `public/index.php`, `routes/api.php`;
  - `config/` (database, logging, cache, session, services);
  - `app/` (Auth, Http, Models);
  - `database/migrations/`;
  - `tests/` (Unit, Feature, Integration);
  - `docker/` (Caddyfile, php.ini, entrypoint);
  - `Dockerfile`, `.dockerignore`, `vercel.json`, `.env.example`;
  - `.gitignore` placeholders under `bootstrap/cache` and `storage`.
- **Changed:** `services/account-service/README.md`, `contracts/openapi/account.yaml`, `.github/dependabot.yml`.
- **New:** `.github/workflows/account-service.yml`.
- **New dependencies, pinned and justified in `design.md`:**
  - Laravel framework 13.43.0;
  - firebase/php-jwt 7.2.2;
  - PHPUnit 13.4.8 (dev only);
  - the FrankenPHP 1.14.0 and Composer 2.11.2 images.
- **Contract:** additive 501 response only. **Events:** none.
- **Write endpoints:** none implemented yet. The accepted input fields come in step 5. The model already limits them to `currency`.
- **Owner actions to go live,** the same as the other services:
  1. set the `account_service` role password;
  2. create the Vercel project (Root Directory `services/account-service`) and set `PORT`, `SUPABASE_URL` and `DATABASE_URL`;
  3. check `/health`.
