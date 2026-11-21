# site-routing Specification

## Purpose
Defines how the simulated DC and DRC sites are selected, propagated and enforced across services, as decided in ADR 0012.

## Requirements

### Requirement: Router selects the site per user
The system SHALL let each user select a router site (DC or DRC), and the BFF SHALL set `site` accordingly on every request it makes for that user.

#### Scenario: User switches the router to DRC
- **WHEN** a user switches the router to DRC
- **THEN** subsequent transactions carry `site=DRC`

### Requirement: Site is propagated in baggage
The system SHALL propagate `site` in W3C `baggage` together with `traceparent` on every service-to-service call.

#### Scenario: Payment calls ledger
- **WHEN** payment-service calls ledger-service for a transaction routed to DC
- **THEN** the outbound request carries `baggage` with `site=DC` and a `traceparent` header

### Requirement: Same-site affinity
The system SHALL call downstream services at the same site as the caller.

#### Scenario: Payment at DC
- **WHEN** a payment is processed at DC
- **THEN** every downstream call for that payment is made to the DC-affine nodes

### Requirement: Toggled-off service returns 503
A service toggled off for the requested site MUST return `503` with a `Retry-After` header and MUST NOT perform the requested work.

#### Scenario: Ledger off at DC
- **WHEN** ledger-service is toggled off at DC and receives a posting request with `site=DC`
- **THEN** it responds `503` with `Retry-After` and posts nothing

### Requirement: Failover by router switch
The system SHALL allow a transaction that failed at a site to succeed when the router is switched to a site whose nodes are on.

#### Scenario: Retry at DRC
- **WHEN** a payment failed at DC because the ledger was off and the user switches the router to DRC and repeats the payment
- **THEN** the payment succeeds through the DRC nodes

### Requirement: Telemetry carries the site
Every service SHALL attach `deployment.site` to its telemetry.

#### Scenario: Trace inspection
- **WHEN** a trace for a request routed to DRC is inspected
- **THEN** each span carries `deployment.site=DRC`
