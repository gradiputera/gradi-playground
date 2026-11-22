# 0002. Polyglot services

- Status: Accepted
- Date: 2026-11-21
- Amended: 2026-11-22. notification-service uses Express 5 instead of Hono (owner preference). It is a standalone npm project with its own lockfile, because each service's container builds from its own folder. Recorded in the notification-service `service-skeleton` change (design D1 and D2).

## Context

The playground exists to show engineering breadth across services. A single language would hide the operational differences between runtimes, frameworks and migration tools, and would not show how a shared contract works across stacks.

## Decision

Each service uses exactly one language and framework, chosen for the service's responsibility:

| Service | Language / framework | Schema | Migration tool |
|---|---|---|---|
| account-service | PHP 8.4 / Laravel | `account` | Laravel migrations |
| ledger-service | Java 25 / Vert.x 5 (Maven) | `ledger` | Flyway (`schemas=ledger`) |
| payment-service | Go | `payment` | golang-migrate (`x-migrations-table` in `payment`) |
| notification-service | Node.js 24 / TypeScript + Express | `notification` | Drizzle Kit (`migrations.schema='notification'`) |
| reporting-service | Python 3.13 / FastAPI (uv) | `reporting` | Alembic (`version_table_schema='reporting'`) |

Services integrate only through HTTP APIs and events, described by the contracts in `contracts/`, so language choice does not leak across boundaries.

Tooling stays simple: no Turborepo or Nx. A pnpm workspace is added only when the Node projects are actually built.

## Consequences

### Positive

- Demonstrates five runtimes, their test and migration tooling, and their observability setup.
- Contracts (OpenAPI, AsyncAPI) are the only coupling, which keeps services replaceable.

### Negative

- Five toolchains to maintain, update and secure; Dependabot and CI cover each one as it is added.
- Shared conventions (health, JWT validation, telemetry, sandbox reset) must be enforced by specs and guardrails, not by a shared library.

## Alternatives considered

- **Single language across all services**: rejected, because it would not demonstrate the polyglot integration this project is about.
- **Turborepo or Nx for build orchestration**: rejected for now; the repository has no build graph worth the overhead.
