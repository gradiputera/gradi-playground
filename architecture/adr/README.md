# Architecture Decision Records

Architecture Decision Records (ADRs) capture significant architectural decisions: the context, the decision, its consequences and the alternatives that were rejected. They explain why the system is the way it is, so that future changes can be made deliberately.

ADR files are named `NNNN-slug.md` (four-digit sequence number, lowercase kebab-case slug) and use the template in [0000-template.md](0000-template.md).

## Status

Accepted

## Statuses

- **Proposed**: under discussion, not yet in force.
- **Accepted**: in force; the current decision.
- **Superseded**: replaced by a later ADR, which is linked from the record. Superseded ADRs are kept for history.

## Index

| # | Title | Status | File |
|---|---|---|---|
| 0001 | Record architecture decisions | Accepted | [0001-record-architecture-decisions.md](0001-record-architecture-decisions.md) |
| 0002 | Polyglot services | Accepted | [0002-polyglot-services.md](0002-polyglot-services.md) |
| 0003 | Service per Vercel project as containers | Accepted | [0003-service-per-vercel-project-as-containers.md](0003-service-per-vercel-project-as-containers.md) |
| 0004 | Database per service via schema isolation | Accepted | [0004-database-per-service-via-schema-isolation.md](0004-database-per-service-via-schema-isolation.md) |
| 0005 | Kafka-like events with pgmq and webhooks | Accepted | [0005-kafka-like-events-with-pgmq-and-webhooks.md](0005-kafka-like-events-with-pgmq-and-webhooks.md) |
| 0006 | Ledger service design | Accepted | [0006-ledger-service-design.md](0006-ledger-service-design.md) |
| 0007 | OAuth2/OIDC with Supabase Auth | Accepted | [0007-oauth2-oidc-with-supabase-auth.md](0007-oauth2-oidc-with-supabase-auth.md) |
| 0008 | Hybrid SSR and CSR rendering | Accepted | [0008-hybrid-rendering-ssr-and-csr.md](0008-hybrid-rendering-ssr-and-csr.md) |
| 0009 | OpenTelemetry and Grafana Cloud | Accepted | [0009-opentelemetry-and-grafana-cloud.md](0009-opentelemetry-and-grafana-cloud.md) |
| 0010 | Native observability charts via BFF | Accepted | [0010-native-observability-charts-via-bff.md](0010-native-observability-charts-via-bff.md) |
| 0011 | Per-user sandbox seed and reset | Accepted | [0011-per-user-sandbox-seed-and-reset.md](0011-per-user-sandbox-seed-and-reset.md) |
| 0012 | Simulated DC/DRC failover | Accepted | [0012-simulated-dc-drc-failover.md](0012-simulated-dc-drc-failover.md) |
| 0013 | Spec-driven development with OpenSpec | Accepted | [0013-spec-driven-development-with-openspec.md](0013-spec-driven-development-with-openspec.md) |
| 0014 | Real email via Gmail SMTP | Accepted | [0014-real-email-via-gmail-smtp.md](0014-real-email-via-gmail-smtp.md) |

Rows for ADRs that do not exist yet are filled in by the pull request that adds them.

## Related

- [Decision log for small choices](../decisions/README.md)
- [C4 diagrams](../c4/README.md)
- [Project README](../../README.md)
