# payment-service

Simulated payments, orchestration of ledger posting and payment event emission. Built with Go and packaged as a container.

## Status

In progress: the service skeleton is in place. This covers health, JWT validation, own-schema migrations, the container image and CI. The payment endpoints answer `501` until roadmap step 5.

## Responsibilities

- Owns the `payment` schema. Migrations use golang-migrate, with the history table (`schema_migrations`) inside the `payment` schema, applied on every start.
- Simulates payment scenarios: success, declined, timeout, insufficient funds.
- Orchestrates posting to the ledger and writes payment events to the outbox.
- Idempotency key on every write; context timeouts on all outbound calls; never retries non-idempotent calls.

## API

The contract is [contracts/openapi/payment.yaml](../../contracts/openapi/payment.yaml).

| Endpoint | Token | Now |
|---|---|---|
| `GET /health` | none | `200` with `{"status":"ok"}` |
| `POST /payments` | required | `501` (planned: simulates a payment; requires an idempotency key) |
| `POST /sandbox/reset` | required | `501` (planned: deletes the caller's rows in `payment` and re-applies the seed) |

A missing or invalid token gets `401` with `WWW-Authenticate: Bearer`.

Tokens are Supabase Auth access tokens, validated by the service itself (ADR 0007):
- the signature is checked with keys from `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`;
- only ES256 or RS256 are accepted;
- `iss` must be `<SUPABASE_URL>/auth/v1`, and `aud` must be `authenticated`;
- `exp` and `sub` are required.

## Events

- Publishes: `payment.succeeded.v1`, `payment.failed.v1` (through the outbox, in the same transaction as the payment change). Planned.
- Consumes: none.

## Configuration

| Variable | Meaning |
|---|---|
| `PORT` | Listening port. Default `80`; the container image sets `8080`. |
| `DATABASE_URL` | Postgres URL for the `payment_service` role. |
| `SUPABASE_URL` | Supabase project URL, used for the JWKS endpoint and the expected issuer. |

[.env.example](.env.example) has local values. Copy it to `.env` for local runs; `.env` is gitignored.

Outbound calls and their timeouts:
- **JWKS fetch:** 5 seconds per request; hourly refresh, plus at most one extra fetch every 5 minutes for an unknown key id.
- **Database connection and migrations at startup:** 30 seconds.

## Local development

You need Go 1.27, plus Docker for the local Supabase stack.

1. From the repository root, start Supabase: `npx -y supabase@3.2.0 start`. `supabase/seed.sql` sets the local `payment_service` password.
2. Run the service from this folder:
   ```bash
   set -a; . ./.env; set +a
   go run .
   ```
3. Check it: `curl http://127.0.0.1:8083/health`.

Tests:
- `go test ./...` runs the unit tests and skips the integration tests.
- To run the integration tests too, with the local stack running:
  ```bash
  eval "$(npx -y supabase@3.2.0 status -o env)"
  PAYMENT_TEST_DATABASE_URL="postgres://payment_service:local-dev-only-payment@127.0.0.1:54322/postgres" \
  PAYMENT_TEST_SUPABASE_URL="$API_URL" PAYMENT_TEST_SUPABASE_KEY="$PUBLISHABLE_KEY" \
    go test -count=1 ./...
  ```

Container: `docker build -t payment-service .`, then run it with the three variables set.

## Owner setup (hosted)

These are owner actions. Agents never run them.

1. **Role password.** In the Supabase dashboard, open the SQL editor and set a strong password for the role:
   ```sql
   alter role payment_service password '<strong-random-password>';
   ```
   Keep it only in Vercel.
2. **Vercel project.** Import the repository as a new project:
   - Root Directory: `services/payment-service`;
   - framework: Container (`vercel.json` selects it).

   Add these Production environment variables:
   - `PORT` = `8080`;
   - `SUPABASE_URL` = `https://<project-ref>.supabase.co`;
   - `DATABASE_URL` = the **session pooler** URL (port 5432) with the role as user: `postgres://payment_service.<project-ref>:<password>@<pooler-host>:5432/postgres?sslmode=require`. Copy `<pooler-host>` from the Supabase dashboard, under Connect > Session pooler.

   Use session mode, not transaction mode (port 6543): migrations need a session-level advisory lock.
3. **Check.** After the deploy:
   - `https://<payment-project>.vercel.app/health` returns `{"status":"ok"}`;
   - `POST /payments` without a token returns `401`.

## Related

- [Polyglot services](../../architecture/adr/0002-polyglot-services.md)
- [ADR 0003: Service per Vercel project as containers](../../architecture/adr/0003-service-per-vercel-project-as-containers.md)
- [ADR 0004: Database per service via schema isolation](../../architecture/adr/0004-database-per-service-via-schema-isolation.md)
- [ADR 0005: Events with pgmq and webhooks](../../architecture/adr/0005-kafka-like-events-with-pgmq-and-webhooks.md)
- [ADR 0007: OAuth2/OIDC with Supabase Auth](../../architecture/adr/0007-oauth2-oidc-with-supabase-auth.md)
- [ADR 0012: Simulated DC/DRC failover](../../architecture/adr/0012-simulated-dc-drc-failover.md)
