# infrastructure/observability

Configuration for OpenTelemetry collection, Grafana Cloud and the local `grafana/otel-lgtm` stack. Expanded in a later pull request.

## Status

Planned

## Responsibilities

- Telemetry is pushed over OTLP from every service (ADR 0009); Supabase stores no telemetry.
- Dashboards as code under `grafana/dashboards/` once provisioned.

## Related

- [ADR 0009: OpenTelemetry and Grafana Cloud](../../architecture/adr/0009-opentelemetry-and-grafana-cloud.md)
- [SRE notes](../../docs/sre/README.md)
