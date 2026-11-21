# 0014. Real email via Gmail SMTP

- Status: Accepted
- Date: 2026-11-21

## Context

The payment playground has a recipient email field, and a visitor expects a real message when a simulated payment succeeds or fails. Sending real email from a public demo creates abuse risk (spam, cost, reputation) and privacy obligations. The free tier has no transactional email service, and Gmail allows a limited number of messages per day.

## Decision

- notification-service sends email through Gmail SMTP using an app password. The app password is supplied by the owner and stored only in Vercel or local environment variables.
- Triggers: only the signed event webhook, for `payment.succeeded.v1` and `payment.failed.v1`.
- IMAP is optional, used to read bounces so the timeline can show delivered or bounced. POP3 is not used.
- Abuse guards:
  - a fixed template; the user controls only the amount and currency;
  - Cloudflare Turnstile CAPTCHA on payments that include an email address;
  - per-user cap of 3 emails per day;
  - global cap of 100 emails per day, well under Gmail's daily limit of about 500;
  - a "sandbox demo" footer in every email;
  - an email failure never fails the payment.
- Privacy:
  - addresses are masked in telemetry, for example `j***@gmail.com`;
  - addresses are stored only in the `notification` schema;
  - addresses are deleted on sandbox reset and in the nightly cleanup.

## Consequences

### Positive

- Visitors receive a real message, which makes the event flow tangible.
- The guards keep the demo within Gmail limits and limit abuse.

### Negative

- Gmail is a shared sender; deliverability and daily limits are outside the project's control.
- Personal data is processed, so masking, retention and deletion rules must be tested.
- The app password is a long-lived credential; it must be rotated if it leaks.

## Alternatives considered

- **Transactional email providers (for example SendGrid, Resend, Postmark)**: rejected for this iteration to avoid an extra vendor and account; can be replaced behind the mail module later.
- **No real email (log or preview only)**: rejected, because a real message is the point of the demonstration.
- **Free-text message bodies**: rejected, because they would allow abuse of the sender.
