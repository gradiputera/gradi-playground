# docs/security

Security documentation: authentication and authorization model, threat notes and secret handling.

## Status

Planned

## Responsibilities

- Auth model (OAuth2/OIDC, guest users) and token handling.
- Threat notes for the public playground.
- Secret handling: no secrets in the repository; real values live in hosting dashboards and ignored local env files.

## Related

- [SECURITY.md](../../SECURITY.md)
- [ADR 0007: OAuth2/OIDC with Supabase Auth](../../architecture/adr/0007-oauth2-oidc-with-supabase-auth.md)
