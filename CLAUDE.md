# CLAUDE.md

Guidance for coding agents working in gradi-playground. Read this file first, then the ADRs that cover the area you change.

## Repository map

| Path | Purpose |
|---|---|
| `apps/web` | Nuxt web app: SSR main page, CSR playground, BFF |
| `services/account-service` | PHP 8.4 / Laravel, `account` schema |
| `services/ledger-service` | Java 25 / Vert.x 5, `ledger` schema |
| `services/payment-service` | Go, `payment` schema |
| `services/notification-service` | Node.js 24 / Hono, `notification` schema |
| `services/reporting-service` | Python 3.13 / FastAPI, `reporting` schema |
| `supabase/` | Platform layer: auth, schemas and roles, queues, cron |
| `contracts/` | OpenAPI (per service) and AsyncAPI plus JSON Schema (events) |
| `openspec/` | System-level specs and cross-service changes |
| `services/<svc>/openspec/` | Service-level specs and changes |
| `architecture/adr/` | Architecture decision records (0001-0014) |
| `architecture/c4/` | C4 context and container diagrams |
| `infrastructure/` | Docker/Compose, Kubernetes, Terraform, Ansible (reserved), observability |
| `docs/` | API, database, security, SRE and postmortems |
| `load-tests/` | k6 scenarios (planned) |

## Key decisions

- Polyglot services, one language each ([ADR 0002](architecture/adr/0002-polyglot-services.md)).
- Each service is a container on its own Vercel Hobby project ([ADR 0003](architecture/adr/0003-service-per-vercel-project-as-containers.md)).
- Database per service through schema isolation on one Supabase Free project ([ADR 0004](architecture/adr/0004-database-per-service-via-schema-isolation.md)).
- Events via outbox, pgmq and signed webhooks; at-least-once delivery with idempotent consumers ([ADR 0005](architecture/adr/0005-kafka-like-events-with-pgmq-and-webhooks.md)).
- Ledger design and posting rules ([ADR 0006](architecture/adr/0006-ledger-service-design.md)).
- OAuth2/OIDC with Supabase Auth, Google PKCE, guest users ([ADR 0007](architecture/adr/0007-oauth2-oidc-with-supabase-auth.md)).
- Hybrid SSR and CSR rendering ([ADR 0008](architecture/adr/0008-hybrid-rendering-ssr-and-csr.md)).
- OpenTelemetry pushed to Grafana Cloud; native charts through the BFF ([ADR 0009](architecture/adr/0009-opentelemetry-and-grafana-cloud.md), [ADR 0010](architecture/adr/0010-native-observability-charts-via-bff.md)).
- Per-user sandbox seed and reset ([ADR 0011](architecture/adr/0011-per-user-sandbox-seed-and-reset.md)).
- Simulated DC/DRC failover ([ADR 0012](architecture/adr/0012-simulated-dc-drc-failover.md)).
- Spec-driven development with OpenSpec ([ADR 0013](architecture/adr/0013-spec-driven-development-with-openspec.md)).
- Real email via Gmail SMTP ([ADR 0014](architecture/adr/0014-real-email-via-gmail-smtp.md)).

## Workflow

1. Every feature starts as an OpenSpec change: proposal, then apply, then archive.
2. Put the change in the owning service's `openspec/`, or in the root `openspec/` for cross-cutting work.
3. Implement only the tasks in `tasks.md`. Scope creep becomes a new proposal.
4. Architectural changes need an ADR.
5. One pull request per change.

## Commit and PR conventions

- Conventional Commits: `type(scope): summary`, with an optional body.
- Never commit directly to `main` except the bootstrap; never force-push or rewrite history.
- Pull requests use the template in `.github/pull_request_template.md`.
- Before every commit, run the secret scan (gitleaks) and make sure it exits 0.

## Guardrails (root, verbatim)

- Never commit secrets, real credentials or personal data; only `.env.example` with placeholders.
- Never read real `.env` files or print tokens or keys.
- Never put JWTs, cookies, email addresses or other PII in logs, metrics or traces; no high-cardinality metric labels such as `user_id`.
- Spec-first: no code without an OpenSpec change; implement only tasks in `tasks.md`; scope creep becomes a new proposal; architectural changes need an ADR.
- No direct commits to `main` (except the bootstrap), no force-push, no history rewrite.
- A service change touches only `services/<svc>/` and its own contract file; cross-service work only via root changes.
- No breaking OpenAPI or event-schema change without a new version and an ADR.
- Never run `terraform apply` or `destroy`, `supabase db push`, remote `supabase db reset`, `vercel --prod`, or change cloud dashboards; these are owner actions.
- Never edit an applied migration; destructive schema changes only via expand/contract.
- Never delete, skip or weaken tests, or disable lint, hooks or CI, without owner approval.
- New dependencies are justified in `design.md`, pinned, and MIT-compatible.
- Stay within free-tier quotas (Vercel Hobby, Supabase Free, Grafana Cloud Free, Gmail limits).
- Web: no tokens in localStorage; the Supabase service key never reaches the browser; only whitelisted PromQL and LogQL; `/` stays SSR and `/playground/**` stays CSR.

## Hard guardrails

`.claude/settings.json` denies the most dangerous actions: reading real `.env` files, force pushes, `terraform apply` and `destroy`, `supabase db push`, remote `supabase db reset`, and `vercel --prod` or `vercel deploy --prod`. Do not work around these rules.

## Status

The project is in the documentation and specification phase. No application code exists yet; application code arrives through OpenSpec changes, as listed in the project README roadmap.
