# 0010. Native observability charts via BFF

- Status: Accepted
- Date: 2026-11-21

## Context

The dashboards page of the playground should show live charts for request rate, error rate and latency per service, split by site, and a filterable logs panel. Grafana Cloud Free blocks iframe embedding, so the full Grafana dashboards cannot be embedded. Grafana Cloud's HTTP APIs can still answer queries, but the query API needs a token that must never reach the browser.

## Decision

- The web app's BFF exposes `/api/observability/*` endpoints. Each endpoint runs a fixed, whitelisted PromQL or LogQL template with validated parameters (service, site, time range, `trace_id`).
- The BFF calls Grafana Cloud's HTTP APIs with a read-only token that lives only in server environment variables.
- Responses are cached for a short time, to protect the free-tier query quota.
- The browser renders native charts from the returned data (see the dataviz guidance for chart design).
- The page links to the full Grafana dashboard ("Open full dashboard") for deeper exploration.
- Local development may embed the `otel-lgtm` Grafana in an iframe, because it has no embedding restriction.

Rules:

- No free-form query text from the browser; only the whitelisted templates can run.
- Parameters are validated against an allow-list (for example, known services and sites; time ranges within limits).
- The read-only token is never sent to the browser, never logged, and rotated if it leaks.

## Consequences

### Positive

- Charts work in the hosted playground despite the embedding block.
- The whitelist keeps the BFF from becoming a general query proxy.
- The browser never sees credentials.

### Negative

- The BFF carries the rendering logic for each chart; more charts mean more templates to maintain.
- Cached results can be a few seconds stale.
- Native charts will not match Grafana's full feature set.

## Alternatives considered

- **Grafana iframe embedding**: rejected, because Grafana Cloud Free blocks it.
- **Browser calls Grafana directly with a token**: rejected, because the token would be exposed.
- **Free-form query builder in the browser**: rejected, because it allows arbitrary queries and cardinality abuse.
