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
The platform SHALL keep acknowledged messages in an archive for 7 days so that they can be replayed to a consumer group from a given point in time.

#### Scenario: Replay after a consumer fix
- **WHEN** an operator replays archived messages for a consumer group
- **THEN** the consumer receives them again and its inbox prevents duplicate side effects

#### Scenario: Replay window
- **WHEN** an operator replays from a time more than 7 days ago
- **THEN** only messages archived within the last 7 days are replayed

### Requirement: Services publish through a single platform entry point
The platform SHALL offer one publish operation that accepts a CloudEvents envelope and enqueues it for every consumer group subscribed to its `type`. Service roles MUST NOT have any other access to the queues.

#### Scenario: Service publishes a subscribed event
- **WHEN** `payment_service` publishes a `payment.succeeded.v1` event subscribed by two consumer groups
- **THEN** one message is enqueued for each of the two groups and the publish reports two deliveries

#### Scenario: Service reads a queue directly
- **WHEN** `payment_service` tries to read messages from a consumer group queue
- **THEN** the database raises a permission error

### Requirement: Invalid envelopes are rejected at publish time
The publish operation MUST reject an event that lacks any of `specversion`, `id`, `source` or `type`, and MUST enqueue nothing for it.

#### Scenario: Event without an id
- **WHEN** a service publishes an envelope without `id`
- **THEN** the publish fails with an error and no queue receives a message

### Requirement: Events without subscribers are accepted
The publish operation SHALL accept a valid event whose `type` has no subscribers and enqueue nothing.

#### Scenario: Unsubscribed event type
- **WHEN** a service publishes a valid event of a type no consumer group subscribes to
- **THEN** the publish succeeds and reports zero deliveries

### Requirement: Webhook signature format
Each delivery MUST carry `webhook-id`, `webhook-timestamp` and `webhook-signature` headers. The signature is `v1,` followed by the base64 HMAC-SHA256 of `<id>.<timestamp>.<body>`, keyed with a secret specific to the consumer group.

#### Scenario: Consumer verifies a delivery
- **WHEN** a consumer recomputes the HMAC over `<webhook-id>.<webhook-timestamp>.<raw body>` with its own secret
- **THEN** the result equals the value after `v1,` in `webhook-signature`

#### Scenario: Consumer group without a secret
- **WHEN** a consumer group has no signing secret configured
- **THEN** the dispatcher sends nothing to it and its messages stay queued

### Requirement: Deliveries are CloudEvents in structured mode with trace context
The dispatcher SHALL POST the event as `application/cloudevents+json`, and SHALL forward the event's `traceparent` and `site` as the `traceparent` and `baggage: site=<site>` headers.

#### Scenario: Event from DRC
- **WHEN** an event with `site` `DRC` and a `traceparent` is delivered
- **THEN** the request carries the same `traceparent` and `baggage: site=DRC`

### Requirement: Retries back off exponentially
After a failed or unanswered delivery the dispatcher SHALL make the message visible again after a delay that grows exponentially with the attempt number, capped at five minutes.

#### Scenario: Second failure
- **WHEN** a delivery fails for the second time
- **THEN** the message is not delivered again before the second backoff delay has passed

### Requirement: Deliveries time out
The dispatcher MUST treat a delivery with no response within 5 seconds as failed.

#### Scenario: Consumer cold start exceeds the timeout
- **WHEN** a consumer takes longer than 5 seconds to respond
- **THEN** the delivery counts as a failed attempt and is retried later

### Requirement: Dead-lettered messages can be redriven
The platform SHALL provide an operator action that moves all dead-lettered messages of a consumer group back to its queue with a fresh attempt count.

#### Scenario: Redrive after a consumer fix
- **WHEN** an operator redrives the dead-letter queue of `notification`
- **THEN** its dead-letter queue is empty and the messages are delivered again

### Requirement: Event bus housekeeping stays within the Free tier
The platform SHALL purge archived messages older than 7 days and scheduler run history older than 1 day, once per day.

#### Scenario: Daily purge
- **WHEN** the daily purge runs
- **THEN** no archived message older than 7 days and no scheduler run record older than 1 day remains
