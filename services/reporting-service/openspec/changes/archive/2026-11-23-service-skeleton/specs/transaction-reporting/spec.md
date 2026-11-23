# Spec Delta

## ADDED Requirements

### Requirement: Standard Webhooks signature format
The service SHALL accept events only at `POST /events`, verified with the Standard Webhooks scheme the dispatcher uses. The `webhook-signature` header MUST carry a `v1,` value that equals the base64 HMAC-SHA256 of `<webhook-id>.<webhook-timestamp>.<raw body>`, keyed with the base64 key of the configured `whsec_` secret and compared in constant time. A missing header or any other value MUST receive `401` and MUST NOT change the read model.

#### Scenario: Correctly signed event
- **WHEN** the dispatcher posts an event with the three `webhook-*` headers and a matching `v1,` signature
- **THEN** the signature check passes

#### Scenario: Body changed after signing
- **WHEN** a signed event's body differs by one character from what was signed
- **THEN** the service responds `401` and changes nothing

### Requirement: Replay tolerance is five minutes
The service MUST reject with `401` a signed event whose `webhook-timestamp` is more than 5 minutes before or after the service's current time, or is not a whole number of seconds.

#### Scenario: Replayed event
- **WHEN** a correctly signed event carries a timestamp 6 minutes older than the service's clock
- **THEN** the service responds `401` and changes nothing

### Requirement: Verified events are not processed yet
Until event processing is implemented, a correctly signed `payment.succeeded.v1`, `payment.failed.v1` or `ledger.entry-posted.v1` event (or any other event) SHALL receive `501` and MUST NOT write to the inbox or the read model, so the dispatcher keeps it for redelivery.

#### Scenario: Verified event before processing exists
- **WHEN** a correctly signed `payment.succeeded.v1` event arrives at `POST /events`
- **THEN** the service responds `501` and records nothing

### Requirement: Payments per day is authenticated and not implemented yet
Until the summary is built from `payment.succeeded.v1` and `payment.failed.v1` events, `GET /reports/payments-per-day` SHALL require a valid bearer token and then answer `501` with `{"error": "not_implemented"}`. It MUST NOT query or write any data.

#### Scenario: Authenticated request before the summary exists
- **WHEN** a request with a valid token calls `GET /reports/payments-per-day`
- **THEN** the service responds `501`

#### Scenario: Anonymous request
- **WHEN** a request without a token calls `GET /reports/payments-per-day`
- **THEN** the service responds `401` with a `WWW-Authenticate: Bearer` header
