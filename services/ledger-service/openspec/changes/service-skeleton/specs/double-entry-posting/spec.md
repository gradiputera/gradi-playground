# Spec Delta

## ADDED Requirements

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
