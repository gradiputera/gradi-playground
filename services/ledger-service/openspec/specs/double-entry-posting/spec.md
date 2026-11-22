# double-entry-posting Specification

## Purpose
Defines how ledger-service posts double-entry journal entries from payment outcomes, following the posting rules in ADR 0006.

## Requirements

### Requirement: Successful payment posts settlement and fees
The service SHALL post a successful payment as a debit to 1100 Settlement Receivable and a credit to 2000 Customer Funds, plus fee lines debiting 5000 Processing Expense and crediting 4000 Fee Revenue.

#### Scenario: Successful payment with fee
- **WHEN** a payment with outcome succeeded and a fee is posted
- **THEN** the journal contains the settlement pair and the fee pair, and each pair balances

### Requirement: Declined and insufficient funds post nothing
The service MUST NOT post any journal entry for a payment whose scenario is declined or insufficient funds.

#### Scenario: Declined payment
- **WHEN** a payment with scenario declined is posted
- **THEN** no journal entry is created

### Requirement: Timeout posts then reverses
The service SHALL post a timed-out payment and then post a reversal of that entry.

#### Scenario: Timed-out payment
- **WHEN** a payment with scenario timeout is posted
- **THEN** a posting and its reversal are both recorded and the net effect is zero

### Requirement: Every entry balances in integer minor units
Every journal entry MUST have debits equal to credits, and amounts MUST be integer minor units with an ISO 4217 currency.

#### Scenario: Unbalanced entry submitted
- **WHEN** a posting request has debits not equal to credits
- **THEN** the service rejects it and records nothing

### Requirement: Postings are idempotent
The service MUST treat a posting request with a repeated idempotency key as already processed.

#### Scenario: Retried posting
- **WHEN** the same idempotency key is posted twice
- **THEN** only one journal entry exists

### Requirement: Storage rejects unbalanced entries
The ledger store MUST refuse to commit a journal entry that has fewer than two lines or whose debits do not equal its credits. Each line MUST be either a debit or a credit in positive integer minor units, and the entry carries one ISO 4217 currency for all its lines.

#### Scenario: Balanced entry
- **WHEN** an entry with a debit of 10000 to 1000 Cash and a credit of 10000 to 2000 Customer Funds is committed
- **THEN** it is stored, and its debits (10000) equal its credits (10000)

#### Scenario: Unbalanced entry
- **WHEN** an entry with a debit of 10000 and a credit of 9999 is committed
- **THEN** the commit fails, nothing is stored, and debits never differ from credits in the stored journal

#### Scenario: Single-line entry
- **WHEN** an entry with only one line is committed
- **THEN** the commit fails and nothing is stored

### Requirement: Journal entries are append-only
The ledger store MUST reject any update of a journal entry or journal line. Entries are removed only by sandbox reset, which deletes an entry together with its lines.

#### Scenario: Line amount is edited
- **WHEN** an update changes the debit of a stored line
- **THEN** the update fails, the line is unchanged, and the entry's debits still equal its credits
