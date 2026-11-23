# service-baseline Specification

## Purpose
Requirements every gradi-playground service must meet, as defined by the system specs and the root guardrails. Applies to reporting-service.

## Requirements

### Requirement: Health endpoint
The service SHALL expose `GET /health` that returns `200` with `{"status": "ok"}` when it is ready to serve requests.

#### Scenario: Service is ready
- **WHEN** a client calls `GET /health` on a ready service
- **THEN** the response is `200` with body `{"status": "ok"}`

### Requirement: Resource server token validation
The service SHALL validate bearer JWTs by signature via JWKS and check `iss`, `aud` and `exp`, and MUST reject `alg: none`. It SHALL accept only asymmetric signatures (ES256, RS256), so shared-secret (HS256) tokens are rejected. A request without a valid token MUST receive `401` with a `WWW-Authenticate: Bearer` header.

#### Scenario: Expired token
- **WHEN** a request carries a JWT whose `exp` is in the past
- **THEN** the service responds `401`

#### Scenario: Missing token
- **WHEN** a request to a protected endpoint carries no `Authorization` header
- **THEN** the service responds `401` with a `WWW-Authenticate: Bearer` header

#### Scenario: Unsigned or shared-secret token
- **WHEN** a request carries a JWT with `alg: none` or `alg: HS256`
- **THEN** the service responds `401`

#### Scenario: Token from another issuer or audience
- **WHEN** a request carries a JWT whose `iss` is not the configured Supabase project or whose `aud` is not `authenticated`
- **THEN** the service responds `401`

#### Scenario: Supabase guest token
- **WHEN** a request carries an access token that Supabase Auth issued to an anonymous user
- **THEN** the service accepts it, using a signing key fetched from the project's JWKS endpoint

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

### Requirement: Service listens on the configured port
The service SHALL listen for HTTP on the port in the `PORT` environment variable, and on port 80 when `PORT` is unset. It MUST refuse to start when `DATABASE_URL`, `SUPABASE_URL` or `WEBHOOK_SECRET` is missing, or when `WEBHOOK_SECRET` is not in the `whsec_<base64>` form.

#### Scenario: Port is configured
- **WHEN** the service starts with `PORT=8085`
- **THEN** `GET /health` on port 8085 answers `200`

#### Scenario: Configuration is missing
- **WHEN** the service starts without `DATABASE_URL`
- **THEN** it exits with an error and serves no requests

### Requirement: Schema migrations apply on startup
Before serving requests, the service SHALL apply its pending migrations to its own schema, keeping the migration history in that schema. Applying them again SHALL change nothing. If migrations fail, the service MUST exit without serving.

#### Scenario: First start
- **WHEN** the service starts against a database where its schema is empty
- **THEN** its tables and its migration history table exist in its own schema before `/health` answers

#### Scenario: Restart
- **WHEN** the service starts again with no new migrations
- **THEN** no schema change is made and the service serves requests

### Requirement: Planned endpoints are authenticated and not implemented yet
Until it is implemented, `POST /sandbox/reset` SHALL require a valid bearer token and then answer `501` with `{"error": "not_implemented"}`. It accepts no fields and MUST NOT write any data, so a repeated request has no effect.

#### Scenario: Authenticated call to a planned endpoint
- **WHEN** a request with a valid token calls `POST /sandbox/reset`
- **THEN** the service responds `501` and no row is written or deleted

#### Scenario: Anonymous call to a planned endpoint
- **WHEN** a request without a token calls `POST /sandbox/reset`
- **THEN** the service responds `401`

### Requirement: Graceful shutdown
On `SIGTERM` the service SHALL stop accepting new connections and SHALL let in-flight requests finish for up to 20 seconds before exiting.

#### Scenario: Platform scales the service down
- **WHEN** the service receives `SIGTERM` while a request is in flight
- **THEN** that request completes and the process then exits
