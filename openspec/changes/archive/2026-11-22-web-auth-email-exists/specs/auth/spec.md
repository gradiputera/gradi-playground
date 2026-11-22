# Spec Delta

## MODIFIED Requirements

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
