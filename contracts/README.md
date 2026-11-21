# contracts

Machine-readable contracts shared between services and clients: HTTP APIs as OpenAPI documents and asynchronous events as AsyncAPI plus JSON Schema.

## Status

Planned

## Responsibilities

- `openapi/`: one OpenAPI 3.1 document per service.
- `events/`: AsyncAPI 3.0 document, JSON Schema per event type, CloudEvents envelope.
- Versioned names (`payment.succeeded.v1`). Breaking changes need a new version and an ADR.

## Related

- [OpenAPI contracts](openapi/README.md)
- [Event contracts](events/README.md)
