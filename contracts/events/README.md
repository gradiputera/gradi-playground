# contracts/events

AsyncAPI and JSON Schema contracts for events exchanged between services.

## Status

Planned

## Responsibilities

- `asyncapi.yaml` describes the channels and messages.
- One JSON Schema per event type, describing a CloudEvents 1.0 envelope.
- Event names are versioned (`payment.succeeded.v1`).

## Related

- [ADR 0005: Events with pgmq and webhooks](../../architecture/adr/0005-kafka-like-events-with-pgmq-and-webhooks.md)
- [Contracts overview](../README.md)
