# 0006. Ledger service design

- Status: Accepted
- Date: 2026-11-21

## Context

The payment playground must show a real double-entry ledger: a journal, a general ledger per account with running balance, and a trial balance that balances. Money must be exact, and the ledger is the authoritative record of postings. Java with Vert.x suits a non-blocking, event-loop based service.

## Decision

- ledger-service is written in Java 25 with Vert.x 5 and Maven, and owns the `ledger` schema.
- It owns `GET /ledger/journal`, `GET /ledger/general-ledger` and `GET /ledger/trial-balance`, scoped by JWT to the caller's sandbox. The general ledger report belongs to ledger-service; reporting-service only builds cross-service summaries.
- It exposes `POST /ledger/postings` for payment-service to post entries. Each request carries an idempotency key.
- Chart of accounts (seed): 1000 Cash, 1100 Settlement Receivable, 2000 Customer Funds, 4000 Fee Revenue, 5000 Processing Expense, plus opening entries.
- Posting rules:
  - success: debit 1100 Settlement Receivable, credit 2000 Customer Funds; fee lines debit 5000 Processing Expense, credit 4000 Fee Revenue;
  - declined: no posting;
  - timeout: post, then reverse;
  - insufficient funds: no posting.
- Every entry balances (debits equal credits). Amounts are integer minor units with an ISO 4217 currency.
- The ledger is append-only. The only exception is sandbox reset (ADR 0011), which deletes the caller's rows.
- Never block the event loop: database work runs on worker verticles or with `executeBlocking`.
- Migrations use Flyway with `schemas=ledger`; applied migrations are never edited.
- It publishes `ledger.entry-posted.v1` through its outbox.

## Consequences

### Positive

- A realistic financial core that is easy to verify: balances, trial balance and reversals are testable invariants.
- Exact arithmetic with integers avoids floating-point errors.

### Negative

- Reversals and sandbox reset make "append-only" an explicit, documented exception.
- Java and Vert.x add a heavier build than the other services.

## Alternatives considered

- **General ledger inside reporting-service**: rejected, because the ledger is the source of truth for postings and reporting only reads events.
- **Spring Boot**: rejected for weight and startup time on scale-to-zero hosting.
- **Floating-point amounts**: rejected, because rounding errors break the balance invariant.
