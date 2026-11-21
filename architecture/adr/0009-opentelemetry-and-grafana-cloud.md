# 0009. OpenTelemetry and Grafana Cloud

- Status: Accepted
- Date: 2026-11-21

## Context

The playground must show metrics, logs and traces across five services, a web app and a dashboard. Most services run on scale-to-zero hosting, where a Prometheus scraper cannot reach them. Telemetry must not be stored in the business database, and the business KPIs shown in Grafana are a separate concern from operational telemetry.

## Decision

- Every service is instrumented with OpenTelemetry and **pushes** metrics, logs and traces over OTLP. Nothing is scraped.
- Cloud backend: Grafana Cloud Free (Prometheus-compatible metrics, Loki logs, Tempo traces). Free limits: 10k active series, 50 GB logs, 50 GB traces, 14-day retention. The OTLP endpoint and token exist only in Vercel environment variables.
- Local backend: the `grafana/otel-lgtm` container in Compose.
- Supabase stores **no** telemetry.
- Business KPIs (for example payments per day) are read from the `reporting` schema through a read-only Postgres role, configured as a Grafana data source. These are business numbers, not operational telemetry.
- Resource attributes on every signal: `service.name`, `deployment.environment`, `deployment.site` (DC or DRC).
- Logs and traces are correlated by `trace_id`; logs carry the same `trace_id` and `span_id` as the trace.
- Cardinality rules: no high-cardinality metric labels such as `user_id`, email or `trace_id`. Email addresses, JWTs and cookies never appear in logs, metrics or traces.
- Dashboards are code: JSON under `grafana/dashboards/`, provisioned from the repository. RED metrics per service, logs and traces correlation, and an SLO panel.

## Consequences

### Positive

- Works with scale-to-zero containers and with local Compose using the same code.
- Business KPIs and operational telemetry stay in separate stores with clear ownership.
- Free-tier limits are concrete enough to design sampling and retention against.

### Negative

- Free-tier series and retention limits require sampling and cardinality discipline.
- Grafana Cloud Free blocks iframe embedding, so the playground needs its own charts (ADR 0010).
- Two telemetry paths (cloud and local) must be kept equivalent.

## Alternatives considered

- **Prometheus scraping**: rejected, because scale-to-zero containers are not reliably reachable.
- **Telemetry in Postgres**: rejected, because it mixes operational data with business data and would load the shared free database.
- **Self-hosted Jaeger, Loki and Prometheus**: rejected for hosting weight on free tiers; the local `otel-lgtm` container covers development.
- **Datadog or New Relic**: rejected for cost and vendor lock-in on a portfolio project.
