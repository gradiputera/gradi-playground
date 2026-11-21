# Authentication and authorization model

This note describes how authentication and authorization work in gradi-playground. The decision and its trade-offs are recorded in [ADR 0007](../../architecture/adr/0007-oauth2-oidc-with-supabase-auth.md).

## Status

Planned

## OAuth2 roles in this system

| OAuth2 role | Component |
|---|---|
| Resource owner | The visitor (guest or Google user) |
| Client | The Nuxt BFF (`apps/web`) |
| Authorization server | Supabase Auth |
| Identity provider | Google (OpenID Connect) |
| Resource servers | account, ledger, payment, notification and reporting services |

The BFF is a confidential client in practice: it holds the code exchange and the refresh token on the server.

## Why PKCE

The Authorization Code flow with PKCE protects the code exchange. The BFF creates a random `code_verifier`, sends its hash as `code_challenge`, and presents the verifier when it exchanges the code. A stolen authorization code is useless without the verifier.

## Why not the implicit flow

The implicit flow returns tokens in the browser URL. It cannot protect tokens from script access, and it is no longer recommended. This project keeps tokens on the server side and in `httpOnly` cookies.

## `state` and CSRF

- The BFF creates a random `state` at sign-in and stores it in an `httpOnly` cookie.
- The callback is accepted only when the `state` in the query matches the cookie; otherwise the request is rejected.
- The verifier cookie is cleared after a successful exchange.

## Token storage

- Access and refresh tokens are never stored in `localStorage` or `sessionStorage`.
- Session cookies are `httpOnly`, `Secure` and `SameSite`.
- The Supabase service key never reaches the browser.

## Refresh and logout

- The BFF refreshes the access token before it expires, using the refresh token stored server-side or in the session cookie.
- Logout revokes the session at Supabase Auth and clears the cookies.

## OIDC versus OAuth2

OAuth2 authorizes access to resources; OpenID Connect adds an identity layer (the `id_token` and `sub` claim). Google provides OpenID Connect; Supabase Auth issues the project's JWTs for the services.

## Guest model and limits

- A visitor without a session gets an anonymous user (`is_anonymous: true`). The UI shows "guest".
- Anonymous sign-in requires a Cloudflare Turnstile check.
- Guest data is linked, not copied, when the visitor signs in with Google (`linkIdentity`).
- Limits: guests are rate-limited; inactive guests (more than 30 days) are removed nightly; guests cannot access the Google-only roadmap features.

## Resource server validation

Every service:

- fetches the JWKS from Supabase Auth and caches it;
- verifies the signature and the `iss`, `aud` and `exp` claims;
- rejects `alg: none` and any algorithm not on its allow-list;
- reads `is_anonymous` to apply guest rules;
- never accepts a token from a query string.

## JWT libraries planned per language

| Service | Planned library |
|---|---|
| ledger-service (Java, Vert.x) | Vert.x `JWTAuth` |
| account-service (PHP, Laravel) | `firebase/php-jwt` |
| payment-service (Go) | `golang-jwt` with `keyfunc` |
| notification-service (Node.js) | `jose` |
| reporting-service (Python) | `PyJWT[crypto]` |

Each dependency is added only through an OpenSpec change that justifies it in `design.md`, and is pinned.

## Service-to-service calls

Calls between services are planned to use the OAuth2 client credentials pattern: each caller obtains a short-lived token for the target audience. Until that is implemented, the BFF forwards the caller's access token and the service checks its audience. Sandbox reset fan-out also uses this path.

## Threat notes

- **Token theft from the browser**: mitigated by server-side token handling and `httpOnly` cookies.
- **Authorization code interception**: mitigated by PKCE.
- **Login CSRF**: mitigated by `state`.
- **Algorithm confusion**: mitigated by pinning the allowed algorithms and rejecting `none`.
- **Guest abuse**: mitigated by Turnstile, rate limits and nightly cleanup.
- **Replay of signed events**: handled in the webhook layer (timestamp tolerance), not here.

## Related

- [ADR 0007: OAuth2/OIDC with Supabase Auth](../../architecture/adr/0007-oauth2-oidc-with-supabase-auth.md)
- [Security overview](README.md)
- [Supabase platform layer](../../supabase/README.md)
