# Spec Delta

## MODIFIED Requirements

### Requirement: Nightly global cleanup
The platform SHALL reset all sandbox data and remove stale guest users nightly. The reset SHALL be broadcast as one `platform.sandbox-nightly-reset.v1` event delivered to every service, and each service SHALL reset its own schema on receipt; the platform MUST NOT delete service rows itself.

#### Scenario: Nightly job runs
- **WHEN** the nightly job runs
- **THEN** sandbox data is reset globally and guests inactive for more than 30 days are removed

#### Scenario: Reset broadcast
- **WHEN** the nightly job runs
- **THEN** exactly one `platform.sandbox-nightly-reset.v1` event is enqueued for each of the five service consumer groups
