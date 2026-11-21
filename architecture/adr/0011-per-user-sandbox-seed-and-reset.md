# 0011. Per-user sandbox seed and reset

- Status: Accepted
- Date: 2026-11-21

## Context

The playground is public and shares one database. Each visitor needs a sandbox with predictable starting data, and must be able to reset it without affecting anyone else. Ledger data is append-only in real accounting, so a reset is a deliberate exception that must be explicit.

## Decision

- **Seed on first visit**: the first playground visit for a user loads versioned fixtures in each service: the ledger chart of accounts (1000 Cash, 1100 Settlement Receivable, 2000 Customer Funds, 4000 Fee Revenue, 5000 Processing Expense) plus opening entries, and initial account and payment data for the other services.
- **Reset to seed**: the BFF calls `POST /sandbox/reset` on every service in parallel. The call is JWT-scoped.
- Each service deletes **only the caller's rows** in its own schema and re-applies its seed. The reset is idempotent, rate-limited and logged (without personal data).
- The UI shows progress per service.
- A reset also sets the DC and DRC toggles back to all-on with DC selected, and deletes the stored recipient emails for that user (ADR 0014).
- **Nightly global reset** of sandbox data, plus stale guest cleanup (ADR 0007).
- The ledger is append-only in production terms; sandbox reset is the documented exception.

## Consequences

### Positive

- Every visitor starts from the same known state, which makes the demo repeatable.
- Scoping by JWT means a reset cannot touch another user's rows.

### Negative

- A reset is a fan-out across five services; a partial failure leaves some services reset and others not, so the UI must show per-service results and allow a retry.
- Deleting ledger rows contradicts append-only accounting; the exception must stay limited to sandbox data.

## Alternatives considered

- **One database per visitor**: rejected, because it exceeds free-tier limits.
- **Reset by truncating whole schemas**: rejected, because it would affect every visitor.
- **Reversing entries instead of deleting them**: rejected for the sandbox, because it would grow the ledger without bound and complicate reporting.
