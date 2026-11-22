# Spec Delta

## ADDED Requirements

### Requirement: Account storage per user and currency
The service SHALL store at most one sandbox account per user and currency. The currency MUST match the ISO 4217 code format (three uppercase letters), and the balance MUST be stored as a 64-bit integer number of minor units, defaulting to 0.

#### Scenario: Account stored
- **WHEN** an account for a user in `USD` with a balance of 12345 minor units is saved
- **THEN** reading it back returns the integer 12345 and the currency `USD`

#### Scenario: Invalid currency code
- **WHEN** an account with the currency `usd` is inserted
- **THEN** the database rejects the row

### Requirement: Account accepts only currency as mass-assignable input
The `Account` model SHALL accept only the field `currency` through mass assignment. The fields `id`, `user_id` and `balance_minor` MUST NOT be settable from request input; `user_id` comes from the verified token.

#### Scenario: Input tries to set owner and balance
- **WHEN** an account is filled with `currency`, `user_id`, `balance_minor` and `id` from input
- **THEN** only `currency` is set and the other fields stay empty
