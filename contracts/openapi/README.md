# contracts/openapi

OpenAPI 3.1 documents for the HTTP API of each service.

## Status

Planned

## Files

| File | Service | Paths in the stub |
|---|---|---|
| `account.yaml` | account-service | `GET /health`, `POST /sandbox/reset` |
| `ledger.yaml` | ledger-service | `GET /health`, `POST /ledger/postings`, `GET /ledger/journal`, `GET /ledger/general-ledger`, `GET /ledger/trial-balance`, `POST /sandbox/reset` |
| `payment.yaml` | payment-service | `GET /health`, `POST /payments`, `POST /sandbox/reset` |
| `notification.yaml` | notification-service | `GET /health`, `POST /events`, `POST /sandbox/reset` |
| `reporting.yaml` | reporting-service | `GET /health`, `POST /events`, `GET /reports/payments-per-day`, `POST /sandbox/reset` |

Every stub has `x-status: planned`, `servers: []`, a bearer JWT security scheme, and only paths, summaries and responses. Detailed schemas are added when a service is implemented.

## Rules

- Breaking changes need a new version and an ADR.
- Every service exposes `GET /health` and `POST /sandbox/reset` (scoped to the caller).
- Money fields are integer minor units with an ISO 4217 currency.

## Related

- [Contracts overview](../README.md)
- [Event contracts](../events/README.md)
- [ADR 0006: Ledger service design](../../architecture/adr/0006-ledger-service-design.md)
