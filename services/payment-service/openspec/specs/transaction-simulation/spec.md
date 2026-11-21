# transaction-simulation Specification

## Purpose
Defines how payment-service simulates payments, orchestrates ledger posting and emits payment events.

## Requirements

### Requirement: Simulated scenarios
The service SHALL simulate a payment with one of the scenarios success, declined, timeout or insufficient funds.

#### Scenario: Each scenario is accepted
- **WHEN** a payment request names one of the four scenarios
- **THEN** the service simulates that outcome

### Requirement: Idempotency key on every write
The service MUST require an idempotency key on every write request and MUST return the original result for a repeated key.

#### Scenario: Repeated request
- **WHEN** a payment request is sent twice with the same idempotency key
- **THEN** the second request returns the original result and creates no second payment

### Requirement: Orchestration posts to ledger
The service SHALL call ledger-service to post the payment outcome and MUST NOT retry non-idempotent calls.

#### Scenario: Ledger call fails
- **WHEN** the call to ledger-service fails with a non-idempotent request
- **THEN** the service does not retry it and records the failure

### Requirement: Context timeouts on outbound calls
The service MUST apply a context timeout to every outbound call.

#### Scenario: Slow downstream
- **WHEN** a downstream call exceeds its timeout
- **THEN** the call is cancelled and the payment outcome reflects the timeout scenario

### Requirement: Payment events through the outbox
The service SHALL publish `payment.succeeded.v1` or `payment.failed.v1` through its outbox in the same transaction as the payment change.

#### Scenario: Payment fails
- **WHEN** a payment ends with a failed outcome
- **THEN** `payment.failed.v1` is written to the outbox in the same transaction
