# observability Specification

## Purpose
Defines telemetry export, correlation, cardinality rules and native charts for the playground, as decided in ADR 0009 and ADR 0010.

## Requirements

### Requirement: Telemetry is pushed over OTLP
Every service SHALL push metrics, logs and traces over OTLP; services MUST NOT depend on being scraped.

#### Scenario: Scale-to-zero service
- **WHEN** a service is idle and scaled to zero
- **THEN** its telemetry is still exported when it handles a request

### Requirement: Logs and traces are correlated
Every log line emitted during a request SHALL include the request's `trace_id` and `span_id`.

#### Scenario: Log line from a traced request
- **WHEN** a log line is written while handling a traced request
- **THEN** it carries the same `trace_id` as the trace

### Requirement: No personal data in telemetry
Telemetry MUST NOT contain JWTs, cookies, full email addresses or SMTP credentials; email addresses MUST be masked.

#### Scenario: Notification logged
- **WHEN** notification-service logs a sent email
- **THEN** the recipient appears masked (for example `j***@gmail.com`)

### Requirement: No unbounded metric labels
Metric labels MUST NOT use unbounded values such as `user_id`, email or `trace_id`.

#### Scenario: Request metric recorded
- **WHEN** a request metric is recorded
- **THEN** its labels use route templates and the site, not user identifiers

### Requirement: Charts are served by whitelisted queries
The BFF SHALL run only whitelisted PromQL and LogQL templates with validated parameters for the playground charts, and MUST NOT expose the Grafana token to the browser.

#### Scenario: Browser requests an arbitrary query
- **WHEN** a browser sends a query that is not in the whitelist
- **THEN** the BFF rejects it and runs nothing

### Requirement: Business KPIs use a read-only role
Grafana SHALL read business KPIs from Postgres only through a read-only role on the `reporting` schema.

#### Scenario: KPI panel query
- **WHEN** a KPI panel queries payments per day
- **THEN** the query runs under the read-only reporting role
