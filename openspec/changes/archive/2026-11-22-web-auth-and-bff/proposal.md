# Proposal

## Why

The web skeleton is live, but the playground has no identity yet. Every later playground feature (payments, the ledger section, sandbox reset, dashboards) acts on behalf of a user and calls services with that user's token. This change completes roadmap step 2:
- guests by default;
- Google sign-in through the BFF;
- session cookies the browser cannot read;
- the identity header.

ADR 0007 and `docs/security/auth.md` already describe this; the hosted Supabase project and Google are configured.

Owning scope: **root** (`apps/web/`, `.github/workflows/web.yml`, `docs/security/auth.md`). The web app is not one of the five services.

## What Changes

- Add a server-only Supabase client to the BFF. The browser never calls Supabase. Every session cookie is written by the BFF with `httpOnly`, `Secure` and `SameSite=Lax`.
- Add the BFF auth endpoints:
  - `GET /api/auth/session`: returns only "guest" or "google" and a display name, never tokens, email or user id;
  - `POST /api/auth/guest`: anonymous sign-in with the Turnstile token;
  - `POST /api/auth/logout`: revokes the session and clears the cookies;
  - `GET /auth/google`: starts Google sign-in with PKCE and a `state` cookie, and links Google to the same user when the visitor is a guest;
  - `GET /auth/callback`: verifies `state`, exchanges the code, and handles provider errors.
- Handle the returning visitor: when the Google account is already linked to another user, end the new guest session and sign in to the existing account.
- Reject cross-site requests to the state-changing endpoints with an `Origin` check, and send `Cache-Control: no-store` on every auth response.
- Add a playground layout:
  - it creates the guest session automatically, with Cloudflare Turnstile when a site key is configured;
  - its header shows "guest" with "Sign in with Google", or the Google name with "Sign out";
  - it shows playground content only once a session exists.
- Read the Supabase URL, the Supabase key and the Turnstile site key from runtime environment variables. Only the Turnstile site key reaches the browser.
- Add auth tests that run against a production build and the local Supabase stack. Extend the `web` CI workflow to start that stack.
- Document the environment variables, local auth testing and the owner actions in `apps/web/README.md` and `apps/web/.env.example`. Update `docs/security/auth.md` with the implemented endpoints.

Out of scope:
- calling services with the access token (each service change);
- the incremental Google scope and the Google API call from ADR 0007 (later roadmap);
- rate limiting in the BFF (Supabase Auth already limits anonymous sign-ins per IP);
- a Content Security Policy (tracked as its own change once the playground's script sources are final);
- any action against the hosted Supabase project, Google Cloud, Cloudflare or Vercel (owner actions).

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `auth`: adds requirements for:
  - the identity-only session endpoint;
  - the same-origin check on state-changing endpoints;
  - the returning-user path when Google is already linked;
  - the reporting of failed sign-ins;
  - uncached auth responses;
  - reaching Supabase Auth only through the BFF.
- `web-routing`: the identity header now also covers the signed-in state (name and "Sign out"); the playground shows its content only once a session exists.

## Impact

- New files:
  - `apps/web/server/utils/supabase.ts` and `apps/web/server/utils/oauth-state.ts`;
  - `apps/web/server/api/auth/*`;
  - `apps/web/server/routes/auth/*`;
  - `apps/web/app/composables/useAuth.ts`;
  - `apps/web/app/components/TurnstileWidget.vue`;
  - `apps/web/app/layouts/playground.vue`;
  - `apps/web/test/e2e/auth.test.ts`;
  - `apps/web/.env.example`.
- Changed files:
  - `apps/web/nuxt.config.ts`, `apps/web/package.json` and `pnpm-lock.yaml`;
  - `apps/web/vitest.config.ts`;
  - the three playground pages and `apps/web/app/assets/css/main.css`;
  - `.github/workflows/web.yml`;
  - `apps/web/README.md` and `docs/security/auth.md`.
- New dependencies, pinned and MIT: `@supabase/ssr` 0.12.7 and `@supabase/supabase-js` 2.119.2.
- CI: the `web` workflow starts the local Supabase stack (database, auth and gateway only). That adds about 2 minutes per web pull request.
- No ADR change is needed: the change implements ADR 0007 as written. Using the request origin for the OAuth redirect and handling `identity_already_exists` are refinements, recorded in `design.md`.
- Owner actions to go live:
  - set three environment variables in Vercel;
  - check the Supabase redirect settings;
  - run one manual Google sign-in on production.
