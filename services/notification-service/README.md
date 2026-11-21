# notification-service

Consumes payment and ledger events through signed webhooks and sends real email. Built with Node.js 24, TypeScript and Hono, packaged as a container.

## Status

Planned

## Responsibilities

- Owns the `notification` schema. Migrations: Drizzle Kit with `migrations.schema='notification'`.
- Receives events at `POST /events` (HMAC-signed CloudEvents, idempotent via `inbox`).
- Sends email through Gmail SMTP for payment outcomes, under the rules in ADR 0014.

## Related

- [ADR 0014: Real email via Gmail SMTP](../../architecture/adr/0014-real-email-via-gmail-smtp.md)
- [Kafka-like events](../../architecture/adr/0005-kafka-like-events-with-pgmq-and-webhooks.md)
