# eventing Specification

## Purpose
Defines how services publish and consume events: outbox, pgmq queues, the signed-webhook dispatcher, retries, dead-letter queues and replay, as decided in ADR 0005.

## Requirements

### Requirement: Events are written to an outbox in the same transaction
A producer SHALL write each event to its own `outbox` table in the same database transaction as the business change that caused it.

#### Scenario: Payment succeeds
- **WHEN** a payment is marked succeeded
- **THEN** the `payment.succeeded.v1` event is inserted into the outbox in the same transaction

### Requirement: One queue per consumer group
The platform SHALL publish each outbox row to one pgmq queue per consumer group.

#### Scenario: Event with two consumers
- **WHEN** `payment.succeeded.v1` is published and two consumer groups subscribe to it
- **THEN** a message is enqueued for each consumer group queue

### Requirement: Webhook delivery is signed
The dispatcher MUST POST each event as an HMAC-signed CloudEvents document, and consumers MUST verify the signature with a timing-safe comparison and a timestamp tolerance.

#### Scenario: Forged event
- **WHEN** a consumer receives an event whose signature does not match
- **THEN** it responds `401` and processes nothing

### Requirement: Failed deliveries are retried then dead-lettered
The dispatcher SHALL retry a failed delivery with backoff and SHALL move the message to a dead-letter queue after N attempts.

#### Scenario: Consumer keeps failing
- **WHEN** a consumer fails delivery N times
- **THEN** the message is moved to the dead-letter queue

### Requirement: Consumers are idempotent
A consumer MUST record each processed event id in its `inbox` table and MUST treat a redelivered event id as already processed.

#### Scenario: Redelivery
- **WHEN** a consumer receives an event id it has already recorded
- **THEN** it acknowledges the event without repeating its side effects

### Requirement: Archived messages can be replayed
The platform SHALL keep acknowledged messages in an archive so that they can be replayed to a consumer.

#### Scenario: Replay after a consumer fix
- **WHEN** an operator replays archived messages for a consumer group
- **THEN** the consumer receives them again and its inbox prevents duplicate side effects
