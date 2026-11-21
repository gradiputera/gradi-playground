# notification-service

Consumes payment and ledger events through signed webhooks and sends real email. Built with Node.js 24, TypeScript and Hono, packaged as a container.

## Status

Planned

## Responsibilities

- Owns the `notification` schema. Migrations: Drizzle Kit with `migrations.schema='notification'`.
- Receives events only through signed webhooks (timing-safe HMAC compare, timestamp tolerance against replay); idempotent through an `inbox` table.
- Sends email through Gmail SMTP for payment outcomes, under the rules in ADR 0014.
- Never logs full email addresses or SMTP credentials; no SMS.

## API

- `GET /health`: returns `{"status": "ok"}`.
- `POST /events`: webhook endpoint for CloudEvents from the dispatcher (2xx acknowledges the event).
- `POST /sandbox/reset`: deletes the caller's rows and stored addresses in `notification`.

## Events

- Publishes: none.
- Consumes: `payment.succeeded.v1`, `payment.failed.v1` (queue `payment.events.notification`).

## Mail module

- Triggered only by consumed events; there is no endpoint that sends mail on request.
- Fixed templates. The user controls only the amount and currency; no free-text bodies.
- Every email has a "sandbox demo" footer.
- Caps: 3 emails per user per day; 100 emails globally per day. The module refuses to send when a cap is reached, and the payment is unaffected.
- Failures are logged without the address and never fail the payment.
- Optional IMAP polling reads bounces so the timeline shows delivered or bounced.

## Masking and retention

- Telemetry shows masked addresses only, for example `j***@gmail.com`.
- Addresses are stored only in the `notification` schema.
- Addresses are deleted on sandbox reset and in the nightly cleanup.

## Related

- [ADR 0014: Real email via Gmail SMTP](../../architecture/adr/0014-real-email-via-gmail-smtp.md)
- [ADR 0005: Events with pgmq and webhooks](../../architecture/adr/0005-kafka-like-events-with-pgmq-and-webhooks.md)
- [Event contracts](../../contracts/events/README.md)
