# platform-database Specification

## Purpose

Defines how the shared Supabase database is provisioned for the services: one schema and one login role per service, the isolation guarantees between them, and the boundary that keeps service tables out of the platform layer (ADR 0004).

## Requirements

### Requirement: One schema per service
The platform SHALL provision exactly one schema for each service: `account`, `ledger`, `payment`, `notification` and `reporting`.

#### Scenario: Fresh database
- **WHEN** the platform migrations are applied to an empty database
- **THEN** the five service schemas exist

### Requirement: One login role per service owns its schema
The platform SHALL provision a login role `<svc>_service` for each service, which owns its own schema and whose default `search_path` is that schema.

#### Scenario: Service role connects
- **WHEN** `ledger_service` connects and creates a table without a schema prefix
- **THEN** the table is created in the `ledger` schema and is owned by `ledger_service`

### Requirement: Service roles cannot reach other service schemas
A service role MUST NOT be able to read, write or create objects in another service's schema.

#### Scenario: Cross-schema read
- **WHEN** `payment_service` selects from a table in the `ledger` schema
- **THEN** the database raises a permission error

### Requirement: Client roles cannot reach service schemas
The roles used by browser clients (`anon` and `authenticated`) MUST NOT have access to any service schema or to the platform event-bus schema, and those schemas MUST NOT be exposed through the Data API.

#### Scenario: Browser client queries a service schema
- **WHEN** a request authenticated as `authenticated` tries to read from the `account` schema
- **THEN** the request is rejected and no rows are returned

### Requirement: Role passwords are never committed
Service role passwords MUST NOT appear in the repository for any hosted environment; they SHALL be set by the owner out of band.

#### Scenario: Repository scan
- **WHEN** the repository is scanned for secrets
- **THEN** no hosted role password is found and the scan passes

### Requirement: The platform layer holds no service tables
The platform migrations MUST NOT create tables in any service schema; each service creates its own tables with its own migration tool.

#### Scenario: Platform migrations applied
- **WHEN** only the platform migrations have been applied
- **THEN** every service schema contains no tables

### Requirement: Platform isolation is tested automatically
The isolation requirements SHALL be verified by automated database tests that run in CI against a local database.

#### Scenario: Pull request changes the platform layer
- **WHEN** a pull request changes files under `supabase/`
- **THEN** CI starts a local database, applies the migrations and runs the database tests, and the check fails if any test fails
