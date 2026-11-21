# transaction-reporting Specification

## Purpose
Defines the read model of cross-service summaries that reporting-service builds from events.

## Requirements

### Requirement: Read model built only from events
The service SHALL build its read model only from consumed events and MUST NOT query other services' data.

#### Scenario: Summary built
- **WHEN** a payment event is consumed
- **THEN** the summary is updated from the event payload only

### Requirement: Payments per day summary
The service SHALL serve `GET /reports/payments-per-day` with the number of payments per day and outcome.

#### Scenario: Summary requested
- **WHEN** a client requests payments per day for a date range
- **THEN** the response lists each day with counts by outcome

### Requirement: Parameterized SQL only
The service MUST use parameterized SQL for every query.

#### Scenario: Date filter supplied
- **WHEN** a request supplies a date filter
- **THEN** the filter is passed as a parameter and never concatenated into SQL

### Requirement: No writes to other services
The service MUST NOT write to any schema other than `reporting`.

#### Scenario: Write attempt outside schema
- **WHEN** the service attempts a write outside the `reporting` schema
- **THEN** the database role denies it
