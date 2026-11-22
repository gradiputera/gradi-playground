# event-notifications Specification

## Purpose
Defines how notification-service consumes payment events through signed webhooks, as described in ADR 0005 and ADR 0014.

## Requirements

### Requirement: Only signed webhooks trigger work
The service SHALL act only on events delivered to `POST /events` with a valid HMAC signature, and MUST NOT expose any endpoint that sends email on request.

#### Scenario: Unsigned request
- **WHEN** a request to `POST /events` has no valid signature
- **THEN** the service responds `401` and sends nothing

### Requirement: Timestamp tolerance against replay
The service MUST reject a signed event whose timestamp is outside the configured tolerance.

#### Scenario: Old event replayed
- **WHEN** a correctly signed event carries a timestamp older than the tolerance
- **THEN** the service responds `401` and processes nothing

### Requirement: Timing-safe signature comparison
The service MUST compare signatures with a timing-safe comparison.

#### Scenario: Signature compared
- **WHEN** the service verifies a signature
- **THEN** the comparison takes constant time with respect to the signature content

### Requirement: Idempotent consumption
The service SHALL record each processed event id in its inbox and MUST NOT repeat side effects for an event id already recorded.

#### Scenario: Duplicate delivery
- **WHEN** the same event id is delivered twice
- **THEN** the second delivery is acknowledged without sending a second email

### Requirement: Addresses and credentials never appear in full in logs
The service MUST NOT log full email addresses or SMTP credentials.

#### Scenario: Email sent
- **WHEN** the service logs a sent email
- **THEN** the recipient is masked

### Requirement: Standard Webhooks signature format
The service SHALL verify `POST /events` with the Standard Webhooks scheme the dispatcher uses. The `webhook-signature` header MUST carry a `v1,` value that equals the base64 HMAC-SHA256 of `<webhook-id>.<webhook-timestamp>.<raw body>`, keyed with the base64 key of the configured `whsec_` secret. Any other value is a failed signature.

#### Scenario: Correctly signed event
- **WHEN** the dispatcher posts an event with the three `webhook-*` headers and a matching `v1,` signature
- **THEN** the signature check passes

#### Scenario: Body changed after signing
- **WHEN** a signed event's body differs by one character from what was signed
- **THEN** the service responds `401` and processes nothing

### Requirement: Replay tolerance is five minutes
The service MUST reject a signed event whose `webhook-timestamp` is more than 5 minutes before or after the service's current time, and MUST reject a timestamp that is not a whole number of seconds.

#### Scenario: Event from the future
- **WHEN** a correctly signed event carries a timestamp 6 minutes ahead of the service's clock
- **THEN** the service responds `401` and processes nothing

### Requirement: Verified events are not processed yet
Until event processing is implemented, a correctly signed event SHALL receive `501` and MUST NOT write to the inbox or send email, so the dispatcher keeps it for redelivery.

#### Scenario: Verified event before processing exists
- **WHEN** a correctly signed event arrives at `POST /events`
- **THEN** the service responds `501`, records nothing and sends nothing
