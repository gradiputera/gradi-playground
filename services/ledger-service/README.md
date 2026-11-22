# ledger-service

Double-entry journal, general ledger report and trial balance. Built with Java 25 and Vert.x 5 (Maven), and packaged as a container.

## Status

In progress: the service skeleton is in place. It covers health, JWT validation, own-schema migrations with the balance and append-only rules, the container image and CI. The ledger endpoints answer `501` until roadmap step 5.

## Responsibilities

- Owns the `ledger` schema. Migrations use Flyway (`schemas=ledger`), with the history table (`flyway_schema_history`) inside the `ledger` schema, applied on every start.
- Posts double-entry journal entries from payment outcomes. The database enforces two rules:
  - every entry balances: at least two lines, and debits equal credits, checked at commit;
  - entries and lines are never updated (append-only). Sandbox reset deletes instead.
- Serves the general ledger report, the journal and the trial balance.
- Never blocks the event loop. Migrations run on the main thread before Vert.x starts. Later database work uses `executeBlocking` or worker verticles.

## Data model

| Table | Holds |
|---|---|
| `accounts` | Chart of accounts (seeded): 1000 Cash, 1100 Settlement Receivable, 2000 Customer Funds, 4000 Fee Revenue, 5000 Processing Expense |
| `journal_entries` | One row per entry: user, idempotency key (unique per user), kind (`opening`, `payment`, `reversal`), currency (ISO 4217) |
| `journal_lines` | Lines of an entry: account, `debit_minor` or `credit_minor` (integer minor units, exactly one of them positive) |

## API

The contract is [contracts/openapi/ledger.yaml](../../contracts/openapi/ledger.yaml).

| Endpoint | Token | Now |
|---|---|---|
| `GET /health` | none | `200` with `{"status":"ok"}` |
| `POST /ledger/postings` | required | `501` (planned: posts entries for a payment outcome; idempotency key required) |
| `GET /ledger/journal` | required | `501` (planned: the caller's journal entries) |
| `GET /ledger/general-ledger` | required | `501` (planned: per-account running balance, filtered by date range and account) |
| `GET /ledger/trial-balance` | required | `501` (planned: debits equal credits) |
| `POST /sandbox/reset` | required | `501` (planned: deletes the caller's rows and re-applies the opening entries) |

A missing or invalid token gets `401` with `WWW-Authenticate: Bearer`.

Tokens are Supabase Auth access tokens, validated by the service with Vert.x `JWTAuth` (ADR 0007):
- the signature is checked with keys from `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`;
- only ES256 or RS256 are accepted;
- `iss` must be `<SUPABASE_URL>/auth/v1`, and `aud` must be `authenticated`;
- `exp` and `sub` are required.

## Events

- Publishes: `ledger.entry-posted.v1` (through the outbox, in the same transaction as the posting). Planned.
- Consumes: none.

## Configuration

| Variable | Meaning |
|---|---|
| `PORT` | Listening port. Default `80`; the container image sets `8080`. |
| `DATABASE_URL` | `postgres://user:password@host:port/database?params` for the `ledger_service` role. URL-encode special characters in the password. |
| `SUPABASE_URL` | Supabase project URL, used for the JWKS endpoint and the expected issuer. |

[.env.example](.env.example) has local values. Copy it to `.env` for local runs; `.env` is gitignored.

Outbound calls and their timeouts:
- **JWKS fetch:** 5 seconds (connect and response). It runs at startup and hourly, plus at most one extra fetch every 5 minutes after a rejected token.
- **Database at startup:** 10-second connect timeout and 30-second statement timeout.

## Local development

You need JDK 25 and Maven 3.9.6 or newer, plus Docker for the local Supabase stack.

1. From the repository root, start Supabase: `npx -y supabase@3.2.0 start`. `supabase/seed.sql` sets the local `ledger_service` password.
2. Build and run from this folder:
   ```bash
   mvn -B -DskipTests package
   set -a; . ./.env; set +a
   java -jar target/ledger-service.jar
   ```
3. Check it: `curl http://127.0.0.1:8082/health`.

Tests:
- `mvn -B test` runs the unit tests and skips the integration tests.
- To run the integration tests too, with the local stack running:
  ```bash
  eval "$(npx -y supabase@3.2.0 status -o env)"
  LEDGER_TEST_DATABASE_URL="postgres://ledger_service:local-dev-only-ledger@127.0.0.1:54322/postgres" \
  LEDGER_TEST_SUPABASE_URL="$API_URL" LEDGER_TEST_SUPABASE_KEY="$PUBLISHABLE_KEY" \
    mvn -B verify
  ```

Container: `docker build -t ledger-service .`, then run it with the three variables set.

## Owner setup (hosted)

These are owner actions. Agents never run them.

1. **Role password.** In the Supabase dashboard, open the SQL editor and set a strong password for the role:
   ```sql
   alter role ledger_service password '<strong-random-password>';
   ```
   Keep it only in Vercel.
2. **Vercel project.** Import the repository as a new project:
   - Root Directory: `services/ledger-service`;
   - framework: Container (`vercel.json` selects it).

   Add these Production environment variables:
   - `PORT` = `8080`;
   - `SUPABASE_URL` = `https://<project-ref>.supabase.co`;
   - `DATABASE_URL` = the **session pooler** URL (port 5432) with the role as user: `postgres://ledger_service.<project-ref>:<password>@<pooler-host>:5432/postgres?sslmode=require`.

   Use session mode, not transaction mode (port 6543): Flyway needs a session-level advisory lock.
3. **Check.** After the deploy:
   - `https://<ledger-project>.vercel.app/health` returns `{"status":"ok"}`;
   - `POST /ledger/postings` without a token returns `401`.

## Related

- [ADR 0006: Ledger service design](../../architecture/adr/0006-ledger-service-design.md)
- [ADR 0003: Service per Vercel project as containers](../../architecture/adr/0003-service-per-vercel-project-as-containers.md)
- [ADR 0004: Database per service via schema isolation](../../architecture/adr/0004-database-per-service-via-schema-isolation.md)
- [ADR 0007: OAuth2/OIDC with Supabase Auth](../../architecture/adr/0007-oauth2-oidc-with-supabase-auth.md)
- [ADR 0011: Per-user sandbox seed and reset](../../architecture/adr/0011-per-user-sandbox-seed-and-reset.md)
- [Polyglot services](../../architecture/adr/0002-polyglot-services.md)
