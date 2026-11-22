# Proposal

## Why

The first manual Google sign-in on production failed. A guest chose "Sign in with Google", and Supabase refused to link Google to the guest with `error_code=email_exists` ("A user with this email address has already been registered"). The callback only treats `identity_already_exists` as the returning-user case, so it sent the visitor to `/playground?auth_error=provider`. The visitor could not reach their existing account.

Supabase reports an existing account in two ways when a guest links Google:
- `identity_already_exists`: the Google identity is already linked to another user;
- `email_exists`: another user already has the email address of the Google account.

Both mean the visitor already has an account. The BFF should handle both the same way: end the guest session and sign in to the existing account. CI could not catch this, because it has no real Google credentials. The error arrives in the callback's query string, which the BFF already reads.

Owning scope: **root** (`apps/web/`, `docs/security/auth.md`). The web app is not one of the five services.

## What Changes

- `GET /auth/callback` treats `error_code=email_exists` like `identity_already_exists`: it signs the guest out and redirects to `/auth/google`, which then runs a normal Google sign-in into the existing account.
- The callback restarts sign-in only when the visitor currently has a guest session. Without one, it redirects to `/playground?auth_error=provider`. This prevents a redirect loop if Supabase ever reports the same error for a plain sign-in.
- Two new auth tests:
  - a guest whose link attempt ends with `email_exists` is signed out and sent to `/auth/google`;
  - a visitor without a session who receives `email_exists` gets `auth_error=provider`.
- `docs/security/auth.md` names both error codes.

Out of scope:
- any change to the hosted Supabase project, such as deleting or merging existing users (owner actions);
- handling linking errors that arrive in the URL fragment;
- the archive of `web-auth-and-bff`. It happens first, in its own pull request, after the owner's manual checks pass.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `auth`: the requirement "Returning Google user signs in from a guest session" now also covers `email_exists`, and only applies while the visitor has a guest session.

## Impact

- Changed files:
  - `apps/web/server/routes/auth/callback.get.ts`;
  - `apps/web/test/e2e/auth.test.ts`;
  - `docs/security/auth.md`.
- No new dependencies, no configuration change, no contract change, and no ADR change: this refines the ADR 0007 linking flow that `web-auth-and-bff` implemented.
- Ordering: the modified requirement is added to the main `auth` spec when `web-auth-and-bff` is archived. Archive `web-auth-and-bff` before archiving this change.
- Owner action after merge: Vercel deploys `main`. Then repeat the Google sign-in check from a guest session.
