# general-ledger-report Specification

## Purpose
Defines the journal, general ledger and trial balance reports served by ledger-service.

## Requirements

### Requirement: Journal lists entries
The service SHALL serve `GET /ledger/journal` listing the caller's journal entries in posting order.

#### Scenario: Journal requested
- **WHEN** the caller requests the journal
- **THEN** the caller's entries are returned in posting order

### Requirement: General ledger shows running balance per account
The service SHALL serve `GET /ledger/general-ledger` with each account's lines and a running balance, filterable by date range and account.

#### Scenario: Filter by account and date
- **WHEN** the caller requests the general ledger for one account and a date range
- **THEN** only that account's lines in the range are returned with a running balance

### Requirement: Trial balance balances
The service SHALL serve `GET /ledger/trial-balance` where total debits equal total credits.

#### Scenario: Trial balance after postings
- **WHEN** the caller requests the trial balance
- **THEN** the sum of debits equals the sum of credits

### Requirement: Reports refresh after each transaction
The playground SHALL refresh the general ledger section after each transaction completes.

#### Scenario: Transaction completes
- **WHEN** a payment transaction completes
- **THEN** the general ledger section shows the newly posted entries
