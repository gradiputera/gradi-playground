# email-delivery Specification

## Purpose
Defines how notification-service sends payment outcome email through Gmail SMTP, with the template, caps, masking and bounce reading described in ADR 0014.

## Requirements

### Requirement: Fixed template only
The service SHALL send email only from its fixed templates for `payment.succeeded.v1` and `payment.failed.v1`, where the user controls only the amount and currency.

#### Scenario: Payment succeeded
- **WHEN** a `payment.succeeded.v1` event is consumed
- **THEN** the service sends the fixed success template with the amount and currency and a "sandbox demo" footer

### Requirement: Daily caps
The service MUST enforce a cap of 3 emails per user per day and a global cap of 100 emails per day, and MUST refuse to send when a cap is reached.

#### Scenario: Fourth email for one user
- **WHEN** a user has already received 3 emails today and another event arrives
- **THEN** the service sends nothing and records the refusal

### Requirement: Email failure never fails the payment
The service SHALL treat an email failure as its own failure and MUST NOT change the outcome of the payment.

#### Scenario: SMTP unavailable
- **WHEN** Gmail SMTP is unavailable during sending
- **THEN** the payment outcome is unchanged and the failure is recorded

### Requirement: Addresses are masked and deleted on schedule
The service MUST mask addresses in telemetry and MUST delete stored addresses on sandbox reset and in the nightly cleanup.

#### Scenario: Nightly cleanup
- **WHEN** the nightly cleanup runs
- **THEN** stored recipient addresses are deleted

### Requirement: Bounces are read optionally
The service MAY read bounce notifications over IMAP and SHALL show delivered or bounced status in the timeline when this is enabled.

#### Scenario: Bounce received
- **WHEN** a bounce notification for a sent email is read
- **THEN** the email status is shown as bounced
