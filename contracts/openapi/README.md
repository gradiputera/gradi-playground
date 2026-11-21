# contracts/openapi

OpenAPI 3.1 documents for the HTTP API of each service.

## Status

Planned

## Responsibilities

- One file per service: `account.yaml`, `ledger.yaml`, `payment.yaml`, `notification.yaml`, `reporting.yaml`.
- Each file starts as a stub (`x-status: planned`) and is expanded when the service is implemented.
- Breaking changes need a new version and an ADR.

## Related

- [Contracts overview](../README.md)
- [Project README](../../README.md)
