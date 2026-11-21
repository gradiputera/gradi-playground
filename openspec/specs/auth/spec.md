# auth Specification

## Purpose
Defines the OAuth2/OIDC sign-in, guest model and session handling of the playground, as decided in ADR 0007 and documented in `docs/security/auth.md`.

## Requirements

### Requirement: Google sign-in uses Authorization Code with PKCE
The system SHALL sign visitors in with Google using the Authorization Code flow with PKCE, with the code exchanged on the server (BFF).

#### Scenario: Successful Google sign-in
- **WHEN** a visitor completes Google consent and the callback contains a valid code and matching state
- **THEN** the BFF exchanges the code and verifier for tokens and sets session cookies

### Requirement: Callback state is verified
The system MUST reject an authorization callback whose `state` does not match the value stored in the BFF cookie.

#### Scenario: Forged callback
- **WHEN** a callback arrives with a `state` that does not match the cookie
- **THEN** the BFF rejects the request and creates no session

### Requirement: Tokens are kept out of browser storage
The system MUST NOT store access or refresh tokens in `localStorage` or `sessionStorage`; session cookies MUST be `httpOnly`, `Secure` and `SameSite`.

#### Scenario: Session cookies are set
- **WHEN** a session is created
- **THEN** the session cookies carry the `httpOnly`, `Secure` and `SameSite` attributes

### Requirement: Visitors start as guests
The system SHALL create a per-visitor anonymous user (`is_anonymous: true`) for a visitor without a session, protected by a Turnstile check.

#### Scenario: First visit without a session
- **WHEN** a visitor without a session opens the playground and passes the Turnstile check
- **THEN** an anonymous user and a guest session are created and the header shows "guest"

### Requirement: Guest data survives Google sign-in
The system SHALL link a Google identity to an existing guest user with `linkIdentity`, keeping the same user id.

#### Scenario: Guest signs in with Google
- **WHEN** a guest completes Google sign-in
- **THEN** the same user id now has a Google identity and its sandbox data is unchanged

### Requirement: Services validate tokens themselves
Every service SHALL validate access tokens by signature via JWKS and check `iss`, `aud` and `exp`, and MUST reject tokens with `alg: none`.

#### Scenario: Token with alg none
- **WHEN** a service receives a token whose header declares `alg: none`
- **THEN** the service responds `401` and processes no request

### Requirement: Logout revokes the session
The system SHALL revoke the Supabase session and clear the session cookies on logout.

#### Scenario: Visitor logs out
- **WHEN** a signed-in visitor logs out
- **THEN** the session is revoked and subsequent requests with the old cookies are rejected
