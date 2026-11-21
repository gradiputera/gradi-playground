# docs/security

Security documentation: authentication and authorization model, threat notes and secret handling.

## Status

Planned

## Documents

- [Authentication and authorization model](auth.md): OAuth2 roles, PKCE, `state`, token storage, guest model, resource server validation, threat notes.

## Responsibilities

- Threat notes for the public playground.
- Secret handling: no secrets in the repository; real values live in hosting dashboards and ignored local env files.

## Related

- [SECURITY.md](../../SECURITY.md)
- [ADR 0007: OAuth2/OIDC with Supabase Auth](../../architecture/adr/0007-oauth2-oidc-with-supabase-auth.md)
- [Authentication and authorization model](auth.md)
