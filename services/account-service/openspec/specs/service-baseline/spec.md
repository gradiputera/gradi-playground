# service-baseline Specification

## Purpose
Requirements every gradi-playground service must meet, as defined by the system specs and the root guardrails. Applies to account-service.

## Requirements

### Requirement: Health endpoint
The service SHALL expose `GET /health` that returns `200` with `{"status": "ok"}` when it is ready to serve requests.

#### Scenario: Service is ready
- **WHEN** a client calls `GET /health` on a ready service
- **THEN** the response is `200` with body `{"status": "ok"}`

### Requirement: Resource server token validation
The service SHALL validate bearer JWTs by signature via JWKS and check `iss`, `aud` and `exp`, and MUST reject `alg: none`.

#### Scenario: Expired token
- **WHEN** a request carries a JWT whose `exp` is in the past
- **THEN** the service responds `401`

### Requirement: Guest rules from is_anonymous
The service SHALL read the `is_anonymous` claim and apply guest restrictions to anonymous users.

#### Scenario: Guest request
- **WHEN** a request is authenticated with a token whose `is_anonymous` is true
- **THEN** the guest restrictions are applied to the request

### Requirement: Site fault flag returns 503
A service toggled off for the requested site MUST respond `503` with a `Retry-After` header.

#### Scenario: Service off at DC
- **WHEN** a request with `site=DC` arrives and the service is toggled off at DC
- **THEN** the response is `503` with a `Retry-After` header

### Requirement: Site in telemetry
The service SHALL attach `deployment.site` to its telemetry, and MUST NOT put tokens, cookies or email addresses in logs.

#### Scenario: Request handled
- **WHEN** the service handles a request
- **THEN** its spans and metrics carry `deployment.site`

### Requirement: Sandbox reset scoped to caller
The service SHALL provide `POST /sandbox/reset` that deletes only the caller's rows in its own schema and re-applies its seed.

#### Scenario: Caller resets
- **WHEN** the caller invokes `POST /sandbox/reset`
- **THEN** only that caller's rows are deleted and the seed is re-applied

### Requirement: Own schema only and transactional events
The service SHALL access only its own database schema and MUST NOT reference other schemas. It SHALL write any event it publishes to its outbox in the same transaction as the change, and SHALL record each consumed event id in its inbox before applying side effects.

#### Scenario: Cross-schema query attempt
- **WHEN** the service attempts a query against another service's schema
- **THEN** the database role denies it
