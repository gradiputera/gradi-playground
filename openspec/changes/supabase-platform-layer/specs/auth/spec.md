# Spec Delta

## ADDED Requirements

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
