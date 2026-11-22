# Spec Delta

## ADDED Requirements

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
When linking Google to a guest fails because the Google account already belongs to another user (`identity_already_exists`), the BFF SHALL end the guest session and restart Google sign-in, so the visitor reaches their existing account.

#### Scenario: Google account already linked elsewhere
- **WHEN** the callback for a guest's link attempt arrives with `error_code=identity_already_exists` and a valid `state`
- **THEN** the guest session cookies are cleared and the visitor is redirected to `/auth/google`

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
