# docs/sre

Site reliability notes: service level indicators (SLIs), draft service level objectives (SLOs) and alerting intent.

## Status

Planned

## SLIs

| SLI | Definition |
|---|---|
| Availability | Share of successful (non-5xx) responses per service, per site |
| Latency | p95 request duration per service |
| Event delivery lag | Time from outbox insert to a 2xx acknowledgement by the consumer |
| DLQ size | Number of messages in the dead-letter queue per consumer group |

## Draft SLOs

These are targets for the playground, not commitments. They are reviewed once real traffic exists.

- Availability: 99.0% of requests over 30 days, per service.
- Latency: p95 under 500 ms for the payment endpoint, excluding cold starts.
- Event delivery lag: 95% of events acknowledged within 60 seconds.
- DLQ size: zero messages older than 24 hours.

Cold starts from scale-to-zero hosting are reported separately and excluded from the latency SLO.

## Alerting intent

- Page the owner only for sustained availability burn, and for DLQ growth.
- Notify (not page) for latency and event delivery lag.
- Dashboards show all SLIs; alerts are configured in Grafana Cloud and kept as code once provisioned.

## Incident handling

Incidents are written up with the blameless template in [postmortems](../postmortems/README.md).

## Related

- [ADR 0009: OpenTelemetry and Grafana Cloud](../../architecture/adr/0009-opentelemetry-and-grafana-cloud.md)
- [Observability](../../infrastructure/observability/README.md)
- [Postmortem template](../postmortems/TEMPLATE.md)
