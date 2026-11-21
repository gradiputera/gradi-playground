# sandbox Specification

## Purpose
Defines the per-user sandbox: seed on first visit, reset to seed, nightly cleanup and the append-only exception, as decided in ADR 0011 and ADR 0014.

## Requirements

### Requirement: First visit seeds the sandbox
The system SHALL seed a user's sandbox from versioned fixtures in each service on the user's first playground visit.

#### Scenario: New visitor
- **WHEN** a user visits the playground for the first time
- **THEN** each service creates its seed data for that user and the ledger chart of accounts is present

### Requirement: Reset is scoped to the caller
Each service's `POST /sandbox/reset` MUST delete only the caller's rows in its own schema and MUST NOT affect other users.

#### Scenario: Two users, one resets
- **WHEN** user A resets the sandbox
- **THEN** user B's rows are unchanged

### Requirement: Reset re-applies the seed
Each service SHALL re-apply its seed after deleting the caller's rows.

#### Scenario: Reset completes
- **WHEN** a reset finishes successfully
- **THEN** the caller's data equals the seed data

### Requirement: Reset is idempotent and rate-limited
A reset MUST be idempotent and rate-limited, and the BFF SHALL report progress per service.

#### Scenario: Reset requested twice quickly
- **WHEN** a user requests two resets in quick succession
- **THEN** the second request is rate-limited or yields the same seeded state, and the UI shows per-service progress

### Requirement: Reset clears routing state and stored emails
A reset SHALL set the DC and DRC toggles back to all-on with DC selected, and SHALL delete the stored recipient emails for the caller.

#### Scenario: Reset after a failover test
- **WHEN** a user resets after switching a service off
- **THEN** all toggles are on, DC is selected, and stored recipient emails are deleted

### Requirement: Ledger is append-only except for sandbox reset
The ledger SHALL be append-only, and the only permitted deletion SHALL be the sandbox reset of the caller's rows.

#### Scenario: Attempt to edit a posted entry
- **WHEN** a client attempts to update a posted journal entry
- **THEN** the ledger rejects the request

### Requirement: Nightly global cleanup
The platform SHALL reset all sandbox data and remove stale guest users nightly.

#### Scenario: Nightly job runs
- **WHEN** the nightly job runs
- **THEN** sandbox data is reset globally and guests inactive for more than 30 days are removed
