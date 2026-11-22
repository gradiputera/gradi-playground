# accounts-and-balances Specification

## Purpose
Defines customer sandbox accounts and their balances in account-service. Balances are integer minor units with an ISO 4217 currency.

## Requirements

### Requirement: Sandbox account per user
The service SHALL provide each user with one or more sandbox accounts, each with an ISO 4217 currency.

#### Scenario: First visit creates an account
- **WHEN** a user's first playground visit seeds the sandbox
- **THEN** the user has at least one sandbox account in the account's currency

### Requirement: Balances are integer minor units
The service MUST store and return balances as integer minor units and MUST NOT use floating-point values.

#### Scenario: Balance returned
- **WHEN** a client reads an account balance
- **THEN** the amount is an integer number of minor units with a currency code

### Requirement: Mass assignment is guarded
The service MUST NOT allow unguarded mass assignment of account and balance fields.

#### Scenario: Request sets a balance directly
- **WHEN** a client submits a balance field that is not an allowed input
- **THEN** the field is ignored or the request is rejected

### Requirement: Accounts are scoped to the caller
The service SHALL return and modify only accounts that belong to the caller.

#### Scenario: Read another user's account
- **WHEN** a user requests an account owned by another user
- **THEN** the service responds `404`

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
