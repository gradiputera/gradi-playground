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

### Requirement: Only Google and anonymous sign-in are enabled
The authorization server SHALL allow sign-in only through Google and anonymous sign-in; email and phone sign-up MUST be disabled.

#### Scenario: Email sign-up attempt
- **WHEN** a client calls the email sign-up endpoint
- **THEN** the authorization server rejects the request and creates no user

### Requirement: Manual identity linking is enabled
The authorization server SHALL allow an authenticated user, including an anonymous user, to link a Google identity to the same user id.

#### Scenario: Linking request from a guest
- **WHEN** a guest session requests to link a Google identity
- **THEN** the authorization server starts the Google flow instead of rejecting the request

### Requirement: Access tokens are signed with asymmetric keys
The authorization server SHALL sign access tokens with an asymmetric key and publish the public keys at its JWKS endpoint, so services can validate tokens without a shared secret.

#### Scenario: Service fetches signing keys
- **WHEN** a service requests the JWKS endpoint
- **THEN** it receives the public key whose `kid` matches the header of issued access tokens

### Requirement: Stale guests are removed
The platform SHALL delete, once per night, anonymous users whose last activity (the latest of creation, sign-in and session refresh) is more than 30 days ago; non-anonymous users MUST NOT be deleted by this job.

#### Scenario: Nightly guest cleanup
- **WHEN** the nightly cleanup runs with one guest inactive for 31 days, one guest active yesterday and one Google user inactive for 90 days
- **THEN** only the 31-day inactive guest is deleted

### Requirement: Auth provider secrets come from the environment
The Google client secret and the CAPTCHA secret MUST be read from environment variables or the hosted dashboard and MUST NOT be committed.

#### Scenario: Local configuration
- **WHEN** the local auth configuration is read
- **THEN** it references environment variables for every provider secret and contains no secret value

### Requirement: Supabase Auth is reached only through the BFF
The browser SHALL NOT call Supabase Auth directly. Every sign-in, session check, refresh and logout SHALL go through BFF endpoints, and the Supabase URL and key SHALL be read only on the server.

#### Scenario: Page sources are inspected
- **WHEN** the HTML of `/` and `/playground` is fetched
- **THEN** it does not contain the Supabase key

### Requirement: Session endpoint reveals only the identity
`GET /api/auth/session` SHALL answer `{"authenticated": false}` for a visitor without a valid session. For a valid session it SHALL answer the identity kind (`guest` or `google`) and the display name only, and MUST NOT include tokens, email addresses or user ids. It SHALL ask Supabase Auth, so a revoked session reads as signed out.

#### Scenario: Visitor without cookies
- **WHEN** a client without session cookies requests `GET /api/auth/session`
- **THEN** the response is `{"authenticated": false}`

#### Scenario: Guest session
- **WHEN** a client with a guest session requests `GET /api/auth/session`
- **THEN** the response is `{"authenticated": true, "user": {"kind": "guest", "name": null}}`

### Requirement: State-changing auth endpoints reject cross-site requests
`POST /api/auth/guest` and `POST /api/auth/logout` MUST answer HTTP 403 and change no session when the request's `Origin` header is missing or differs from the site's own origin.

#### Scenario: Cross-site guest sign-in
- **WHEN** a request to `POST /api/auth/guest` carries `Origin: https://attacker.example`
- **THEN** the response is HTTP 403 and no session cookie is set

#### Scenario: Logout without Origin
- **WHEN** a request to `POST /api/auth/logout` carries session cookies but no `Origin` header
- **THEN** the response is HTTP 403 and the session stays valid

### Requirement: Guest sign-in is idempotent per visitor
`POST /api/auth/guest` SHALL return the existing identity with HTTP 200 when the visitor already has a valid session, and SHALL create a new anonymous user (HTTP 201) only when there is none.

#### Scenario: Repeated guest sign-in
- **WHEN** a visitor with a guest session calls `POST /api/auth/guest` again
- **THEN** the response is HTTP 200 with the same guest identity and no new user is created

### Requirement: Returning Google user signs in from a guest session
When linking Google to a guest fails because the Google account or its email address already belongs to another user (`identity_already_exists` or `email_exists`), the BFF SHALL end the guest session and restart Google sign-in, so the visitor reaches their existing account. When the visitor has no guest session, the BFF SHALL NOT restart sign-in and SHALL report the failure with `auth_error=provider`.

#### Scenario: Google account already linked elsewhere
- **WHEN** the callback for a guest's link attempt arrives with `error_code=identity_already_exists` and a valid `state`
- **THEN** the guest session cookies are cleared and the visitor is redirected to `/auth/google`

#### Scenario: Google email already registered
- **WHEN** the callback for a guest's link attempt arrives with `error_code=email_exists` and a valid `state`
- **THEN** the guest session cookies are cleared and the visitor is redirected to `/auth/google`

#### Scenario: Linking error without a guest session
- **WHEN** the callback arrives with `error_code=email_exists` and a valid `state` for a visitor without a session
- **THEN** no session cookie is set and the visitor is redirected to `/playground?auth_error=provider`

### Requirement: Failed sign-in leaves no session and is reported
When the callback has a mismatched `state`, a provider error, no code, or a code that cannot be exchanged, the BFF SHALL create no session. It SHALL redirect to `/playground?auth_error=<reason>`, where the reason is one of `state`, `provider`, `code` or `exchange`; a sign-in that cannot start redirects with `start`.

#### Scenario: Invalid code
- **WHEN** the callback arrives with a valid `state` and a code Supabase rejects
- **THEN** no session cookie is set and the visitor is redirected to `/playground?auth_error=exchange`

### Requirement: Auth responses are not cached
Every response under `/api/auth/` and `/auth/` SHALL carry `Cache-Control: no-store`.

#### Scenario: Session check
- **WHEN** a client requests `GET /api/auth/session`
- **THEN** the response carries `Cache-Control: no-store`
