# Tasks

Verification note: the SQL tasks are verified with `supabase test db`. Run it locally when Docker is available (`npx -y supabase@3.2.0 start`, then `npx -y supabase@3.2.0 test db`); otherwise the CI workflow from task 1.4 is the authoritative check on the pull request. Run the gitleaks scan before every commit.

## 1. Project scaffold and CI

- [x] 1.1 Run `npx -y supabase@3.2.0 init` at the repository root. Keep `supabase/config.toml` and the generated `supabase/.gitignore`, and delete any generated editor or Deno settings that are not needed. Verify: `supabase/config.toml` exists and `[api].schemas` is `["public", "graphql_public"]`.
- [x] 1.2 Edit `supabase/config.toml` per design D8: auth URLs, anonymous sign-ins, manual linking, refresh token rotation, `signing_keys_path`, email and SMS sign-up disabled, Google via `env()`, captcha disabled with a comment. Verify: the file contains no secret value, and `grep -n "env(" supabase/config.toml` lists both Google variables.
- [x] 1.3 Add `supabase/.env.example` with `<placeholder>` values for `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`. Add `supabase/signing_keys.json` and `supabase/.env` to the root `.gitignore`. Verify: `git check-ignore supabase/signing_keys.json supabase/.env` prints both paths.
- [ ] 1.4 Add `.github/workflows/supabase.yml` per design D10, with `actions/checkout@v7` and the latest `supabase/setup-cli` major (check its README), pinned to CLI `3.2.0`, an ephemeral signing key generated before start, dummy Google env values, `supabase start` with the unused services excluded, `supabase db lint --fail-on error` and `supabase test db`. Verify: the workflow parses (`npx -y yaml-lint .github/workflows/supabase.yml` or an equivalent YAML parse) and the job runs green on the pull request.

## 2. Service schemas and roles (spec: platform-database)

- [x] 2.1 Write `supabase/migrations/20261121000100_service_schemas_and_roles.sql` per design D2: five roles, five schemas owned by their role, `search_path`, and the revokes for `public`, `anon`, `authenticated` and `service_role`. Verify: it applies on `supabase db reset` (locally or in CI).
- [x] 2.2 Write `supabase/tests/001_platform_database.test.sql`, covering: the five schemas exist; the owner is the matching role; a table created by `ledger_service` lands in `ledger`; cross-schema select and create raise permission errors; `anon` and `authenticated` have no usage; and no tables exist in service schemas after the platform migrations. Verify: `supabase test db` passes.

## 3. Event bus publish (spec: eventing)

- [ ] 3.1 Write `supabase/migrations/20261121000200_eventbus.sql` per design D3: the extensions `pgmq`, `pg_net` and `pgcrypto` (`create extension if not exists`); schema `eventbus`; tables `consumers` and `subscriptions` with the seeded topology; queues `evt_<group>` and `evt_<group>_dlq`; `eventbus.publish(jsonb)`; and the function privilege revokes and grants. Verify: it applies.
- [ ] 3.2 Write `supabase/tests/002_eventbus_publish.test.sql`, covering: `payment.succeeded.v1` enqueues to `notification` and `reporting` and returns 2; a missing `id` raises and enqueues nothing; an unsubscribed type returns 0; a service role cannot read a queue directly; `anon` and `authenticated` cannot execute `publish`. Verify: `supabase test db` passes.

## 4. Dispatcher, signature and operator functions (spec: eventing)

- [ ] 4.1 Write `supabase/migrations/20261121000300_eventbus_dispatcher.sql` per design D4 to D6: the `deliveries` table, the backoff function, the signing function (Standard Webhooks, Vault secret per group), `dispatch_tick()` with an advisory lock and the settle and send phases, `replay()`, `redrive_dlq()` and the `delivery_status` view, all executable by `postgres` only. Verify: it applies and `supabase db lint --fail-on error` passes.
- [ ] 4.2 Write `supabase/tests/003_eventbus_dispatcher.test.sql`. Each test creates its own Vault secret and endpoint inside the test transaction. It covers:
  - the signature equals a vector computed independently in the test from `hmac(...)` over `id.ts.body`;
  - the queued `net.http_request_queue` body equals `event::text` and the headers include `content-type`, `traceparent`, `baggage: site=DRC` and the three `webhook-*` headers;
  - the timeout is 5000 ms;
  - after a send, the message `vt` matches `backoff(read_ct)`;
  - a message with `read_ct > max_attempts` moves to the DLQ;
  - a group without a secret or endpoint sends nothing;
  - a 2xx response row archives the message on the next settle, and a 500 does not;
  - `redrive_dlq` empties the DLQ;
  - `replay` ignores archive rows older than 7 days.
  Verify: `supabase test db` passes.

## 5. Scheduled jobs and nightly reset event (specs: sandbox, auth, eventing)

- [ ] 5.1 Add `contracts/events/platform.sandbox-nightly-reset.v1.json`: JSON Schema 2020-12, the same CloudEvents envelope as the existing schemas, and `data` with `reset_date` (date) only. Add the channel and operation to `contracts/events/asyncapi.yaml` and a row to the catalog in `contracts/events/README.md`. Verify: `python -c "import json;json.load(open('contracts/events/platform.sandbox-nightly-reset.v1.json'))"` succeeds and the AsyncAPI document still parses as YAML.
- [ ] 5.2 Write `supabase/migrations/20261121000400_scheduled_jobs.sql` per design D7: the `pg_cron` extension; the `platform` schema with `publish_nightly_reset()`, `delete_stale_guests()` and `housekeeping()`; and `cron.schedule` for the four jobs. Verify: it applies.
- [ ] 5.3 Write `supabase/tests/004_scheduled_jobs.test.sql`, covering: the four jobs exist with the schedules from D7; `publish_nightly_reset()` enqueues exactly one event to each of the five groups and the event has every envelope attribute required by the contract; `delete_stale_guests()` deletes only the 31-day inactive anonymous user among the three fixtures from the auth spec scenario; `housekeeping()` removes archive rows older than 7 days and run details older than 1 day, and keeps newer ones. Verify: `supabase test db` passes.

## 6. Local seed and documentation

- [ ] 6.1 Write `supabase/seed.sql` per design D9: local consumer endpoints on ports 8081-8085, local Vault secrets `local-dev-only-<group>` and local role passwords `local-dev-only-<svc>`. Verify: `supabase db reset` succeeds locally or in CI, and the gitleaks scan exits 0.
- [ ] 6.2 Rewrite `supabase/README.md`:
  - status: In progress;
  - layout;
  - local quick start: Docker Desktop, `npx -y supabase@3.2.0 start`, signing key generation, `.env` from `.env.example`, `test db`;
  - local port convention;
  - event bus operations: replay, redrive, `delivery_status`;
  - a **Hosted setup (owner actions)** checklist from the design's Migration Plan, including the Supavisor user format, the Turnstile and asymmetric-key dashboard steps, and the inactivity pause note.
  Verify: every relative link in the README resolves.

## 7. Integration checks

- [ ] 7.1 Run `npx -y @fission-ai/openspec@latest validate supabase-platform-layer --strict` and `validate --all --strict`. Verify: both pass.
- [ ] 7.2 Open the pull request (title `feat(supabase): platform layer`) using the PR template. Verify: the `supabase` and `secret-scan` checks are green. If the `supabase` check fails, fix it within this change's tasks and push again.

## Workflow follow-up

- Owner actions after merge (never agent tasks): `supabase link`, `supabase db push --dry-run` then `supabase db push`, role passwords, Vault secrets, Google, Turnstile and signing-key dashboard settings, hosted consumer endpoints.
- Archive the change after the pull request is merged (`openspec archive supabase-platform-layer`), in a follow-up commit or PR.
