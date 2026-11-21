# infrastructure/observability

Configuration for OpenTelemetry collection, Grafana Cloud and the local `grafana/otel-lgtm` stack.

## Status

Planned

## Resource attributes

Every signal carries:

- `service.name`: one of `account-service`, `ledger-service`, `payment-service`, `notification-service`, `reporting-service`, `web`.
- `deployment.environment`: `local` or `cloud`.
- `deployment.site`: `DC` or `DRC`.

## Logs and traces

- Logs include `trace_id` and `span_id`, so a log line links to its trace in Tempo or `otel-lgtm`.
- The playground's dashboards page filters logs by service, level, time range and `trace_id`.
- Email addresses, JWTs, cookies and SMTP credentials never appear in any log line (ADR 0009).

## OTLP targets

| Environment | Backend | Endpoint and token |
|---|---|---|
| Local | `grafana/otel-lgtm` in Compose | local OTLP endpoint, no token |
| Cloud | Grafana Cloud Free | OTLP endpoint and token in Vercel environment variables only |

## Dashboards as code

- Dashboards are JSON files under `grafana/dashboards/`, provisioned from the repository.
- Panels: RED metrics per service (rate, errors, duration), logs and traces correlation, and an SLO panel.
- The read-only Postgres data source for business KPIs uses a dedicated read-only role on the `reporting` schema.

## Cardinality rules

- No labels with unbounded values: no `user_id`, email, `trace_id` or raw URL path with ids.
- Use route templates instead of raw paths.
- Keep the active series count within the Grafana Cloud Free limit of 10k.

## Related

- [ADR 0009: OpenTelemetry and Grafana Cloud](../../architecture/adr/0009-opentelemetry-and-grafana-cloud.md)
- [ADR 0010: Native observability charts via BFF](../../architecture/adr/0010-native-observability-charts-via-bff.md)
- [SRE notes](../../docs/sre/README.md)
