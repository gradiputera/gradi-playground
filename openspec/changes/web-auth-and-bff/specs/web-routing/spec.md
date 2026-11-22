# Spec Delta

## MODIFIED Requirements

### Requirement: Header shows the current identity
The system SHALL show "guest" or the signed-in Google user in the header of `/playground/**`, together with a "Sign in with Google" action when the visitor is a guest and a "Sign out" action when the visitor is signed in with Google.

#### Scenario: Guest visits the playground
- **WHEN** a visitor without Google sign-in opens `/playground`
- **THEN** the header shows "guest" and a "Sign in with Google" action

#### Scenario: Google user visits the playground
- **WHEN** a visitor signed in with Google opens `/playground`
- **THEN** the header shows their Google name and a "Sign out" action

## ADDED Requirements

### Requirement: Playground content waits for a session
Pages under `/playground` SHALL show their content only once the visitor has a session. While the guest session is being created they SHALL show a preparing message, and if it cannot be created they SHALL show an error message instead of the content.

#### Scenario: First visit
- **WHEN** a visitor without a session opens `/playground`
- **THEN** a preparing message is shown until the guest session exists, and then the hub content is shown
