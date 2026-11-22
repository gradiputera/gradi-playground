# account-service

Customer sandbox accounts and balances. Built with PHP 8.4 and Laravel 13, served by FrankenPHP and packaged as a container.

## Status

In progress: the service skeleton is in place. It covers health, JWT validation, own-schema migrations, the `accounts` table and model, the container image and CI. `POST /sandbox/reset` answers `501` until roadmap step 5.

## Responsibilities

- Owns the `account` schema in the shared Supabase Postgres project. Migrations use Laravel migrations, with the history table (`migrations`) inside the `account` schema, applied on every start.
- Manages per-user sandbox accounts and balances in integer minor units with an ISO 4217 currency.
- Models are pinned to the `account` schema: they use the `pgsql` connection, whose `search_path` is `account`.
- No unguarded mass assignment: on `Account`, only `currency` is fillable. `user_id` comes from the verified token, and `balance_minor` changes only through domain operations.

## Data model

| Table | Holds |
|---|---|
| `accounts` | `id` (uuid), `user_id` (uuid), `currency` (ISO 4217, checked), `balance_minor` (bigint), timestamps; unique per (user, currency) |

## API

The contract is [contracts/openapi/account.yaml](../../contracts/openapi/account.yaml).

| Endpoint | Token | Now |
|---|---|---|
| `GET /health` | none | `200` with `{"status":"ok"}` |
| `POST /sandbox/reset` | required | `501` (planned: deletes the caller's rows in `account` and re-applies the seed) |

A missing or invalid token gets `401` with `WWW-Authenticate: Bearer`. Every error response is JSON, never an HTML page or a stack trace.

Tokens are Supabase Auth access tokens, validated by the service with `firebase/php-jwt` (ADR 0007):
- the signature is checked with keys from `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`;
- only ES256 or RS256 are accepted;
- `iss` must be `<SUPABASE_URL>/auth/v1`, and `aud` must be `authenticated`;
- `exp` and `sub` are required.

## Events

- Publishes: none.
- Consumes: none.

## Configuration

| Variable | Meaning |
|---|---|
| `PORT` | Listening port. Default `80`; the container image sets `8080`. |
| `DATABASE_URL` | `postgres://user:password@host:port/database?params` for the `account_service` role. URL-encode special characters in the password. |
| `SUPABASE_URL` | Supabase project URL, used for the JWKS endpoint and the expected issuer. |
| `APP_DEBUG` | Always `false` outside your own machine; the image sets it to `false`. |

[.env.example](.env.example) has local values. Copy it to `.env` for local runs; `.env` is gitignored.

Outbound calls and their timeouts:
- **JWKS fetch:** 5 seconds (connect and response), cached for an hour. After a rejected token it is fetched again at most once every 5 minutes.
- **Database connection:** 10-second connect timeout.

## Local development

You need PHP 8.4 with `pdo_pgsql` and Composer 2, plus Docker for the local Supabase stack.

1. From the repository root, start Supabase: `npx -y supabase@3.2.0 start`. `supabase/seed.sql` sets the local `account_service` password.
2. Install and run from this folder:
   ```bash
   composer install
   cp .env.example .env
   php artisan migrate
   php artisan serve --port 8081
   ```
3. Check it: `curl http://127.0.0.1:8081/health`.

Tests:
- `vendor/bin/phpunit` runs the unit and feature tests and skips the integration tests. On Windows, set `OPENSSL_CONF` to your PHP's `extras/ssl/openssl.cnf` so the tests can generate keys.
- To run the integration tests too, with the local stack running:
  ```bash
  eval "$(npx -y supabase@3.2.0 status -o env)"
  ACCOUNT_TEST_DATABASE_URL="postgres://account_service:local-dev-only-account@127.0.0.1:54322/postgres" \
  ACCOUNT_TEST_SUPABASE_URL="$API_URL" ACCOUNT_TEST_SUPABASE_KEY="$PUBLISHABLE_KEY" \
    vendor/bin/phpunit
  ```

Container: `docker build -t account-service .`, then run it with the three variables set. On start it:
1. caches the configuration;
2. applies migrations;
3. starts FrankenPHP.

## Owner setup (hosted)

These are owner actions. Agents never run them.

1. **Role password.** In the Supabase dashboard, open the SQL editor and set a strong password for the role:
   ```sql
   alter role account_service password '<strong-random-password>';
   ```
   Keep it only in Vercel.
2. **Vercel project.** Import the repository as a new project:
   - Root Directory: `services/account-service`;
   - framework: Container (`vercel.json` selects it).

   Add these Production environment variables:
   - `PORT` = `8080`;
   - `SUPABASE_URL` = `https://<project-ref>.supabase.co`;
   - `DATABASE_URL` = the **session pooler** URL (port 5432) with the role as user: `postgres://account_service.<project-ref>:<password>@<pooler-host>:5432/postgres?sslmode=require`.

   Use session mode, not transaction mode (port 6543), the same as the other services.
3. **Check.** After the deploy:
   - `https://<account-project>.vercel.app/health` returns `{"status":"ok"}`;
   - `POST /sandbox/reset` without a token returns `401`.

## Related

- [ADR 0004: Database per service](../../architecture/adr/0004-database-per-service-via-schema-isolation.md)
- [ADR 0003: Service per Vercel project as containers](../../architecture/adr/0003-service-per-vercel-project-as-containers.md)
- [ADR 0007: OAuth2/OIDC with Supabase Auth](../../architecture/adr/0007-oauth2-oidc-with-supabase-auth.md)
- [ADR 0011: Per-user sandbox seed and reset](../../architecture/adr/0011-per-user-sandbox-seed-and-reset.md)
- [Polyglot services](../../architecture/adr/0002-polyglot-services.md)
