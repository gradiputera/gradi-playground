# contracts/events

AsyncAPI and JSON Schema contracts for the events exchanged between services. Delivery is described in [ADR 0005](../../architecture/adr/0005-kafka-like-events-with-pgmq-and-webhooks.md).

## Status

Planned

## Event catalog

| Event type | Producer | Consumers | Schema |
|---|---|---|---|
| `payment.succeeded.v1` | payment-service | notification-service, reporting-service | [payment.succeeded.v1.json](payment.succeeded.v1.json) |
| `payment.failed.v1` | payment-service | notification-service, reporting-service | [payment.failed.v1.json](payment.failed.v1.json) |
| `ledger.entry-posted.v1` | ledger-service | reporting-service | [ledger.entry-posted.v1.json](ledger.entry-posted.v1.json) |
| `platform.sandbox-nightly-reset.v1` | platform scheduler (`supabase/`) | all five services | [platform.sandbox-nightly-reset.v1.json](platform.sandbox-nightly-reset.v1.json) |

## Envelope

Every event is a CloudEvents 1.0 structured JSON document with these attributes:

- `specversion` (`"1.0"`), `id` (unique per event, used by consumer `inbox` tables), `source`, `type`, `time`, `datacontenttype`;
- `traceparent`: W3C trace context;
- `site`: `DC` or `DRC`, the logical site that produced the event;
- `data`: the event-specific payload.

## Rules

- Event names are versioned (`.v1`). A breaking change to a payload creates a new version and an ADR.
- Money is an integer `amount_minor` or `*_minor` field with an ISO 4217 `currency`; never a float.
- Consumers must be idempotent and must not assume ordering across event types.
- `recipient_email` is personal data. It is consumed only by notification-service, is masked in telemetry, and is never logged in full.
- Producers write to their outbox in the same transaction as the business change.

## Files

- `asyncapi.yaml`: AsyncAPI 3.0 description of the channels and messages.
- `*.json`: JSON Schema 2020-12 for each event payload and envelope.

## Related

- [ADR 0005: Events with pgmq and webhooks](../../architecture/adr/0005-kafka-like-events-with-pgmq-and-webhooks.md)
- [ADR 0014: Real email via Gmail SMTP](../../architecture/adr/0014-real-email-via-gmail-smtp.md)
- [Contracts overview](../README.md)
