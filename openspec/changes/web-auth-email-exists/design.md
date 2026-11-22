# Design

## Context

`apps/web/server/routes/auth/callback.get.ts` (from `web-auth-and-bff`) checks `state` first. It then treats only `error_code=identity_already_exists` as the returning-user case: it signs the guest out with `scope: 'local'` and redirects to `/auth/google`. Any other `error` or `error_code` becomes `/playground?auth_error=provider`.

On production, Supabase Auth refused a guest's Google link with `error_code=email_exists`. The callback received the error in its query string (the visitor landed on `auth_error=provider`, not `auth_error=code`), so the BFF can see it.

The local Supabase stack in CI has no real Google credentials. The tests therefore call the callback directly with a crafted `error_code` and a valid `state`, as the existing `identity_already_exists` test already does.

## Goals / Non-Goals

**Goals:**
- A guest whose Google account, or its email address, already belongs to another user reaches that account.
- No redirect loop, whatever Supabase returns.

**Non-Goals:**
- Choosing between several existing accounts or merging users. Supabase's automatic identity linking decides which account a normal Google sign-in reaches.
- Keeping the new guest's sandbox data. It is dropped, as before.

## Decisions

### D1. Treat both codes as one "account already exists" case
`identity_already_exists` and `email_exists` lead to the same handling: sign the guest out and restart Google sign-in. The restarted flow runs `signInWithOAuth` (no session, so no linking). Supabase then signs in to the user who owns the Google identity, or links Google to the user with the same verified email (automatic identity linking).

Alternative considered: show the visitor a message asking them to sign out and sign in again. Rejected, because it is the same outcome with an extra manual step.

### D2. Restart only for a guest session
The callback calls `getUser()` and restarts sign-in only when the current user is anonymous. Otherwise it answers `auth_error=provider`.

Reasons:
- Without a guest session, the error did not come from linking. A restart could then end in the same error and loop between `/auth/google` and `/auth/callback`.
- A signed-in Google user never starts a link (`/auth/google` sends them to `/playground`), so they never reach this branch legitimately.

`getUser()` asks Supabase Auth, as the session endpoint does, so a revoked or expired guest session counts as no session.

### D3. Tests
Add two tests next to the existing `identity_already_exists` test in `apps/web/test/e2e/auth.test.ts`:
- guest + `email_exists` → redirected to `/auth/google`, and no session cookies remain;
- visitor without a session + `email_exists` → redirected to `/playground?auth_error=provider`, and no session cookies.

The existing `identity_already_exists` test still passes unchanged, because its visitor is a guest. The suite grows from 25 to 27 tests (11 routing, 16 auth).

### D4. Dependencies and quotas
No new dependencies. The extra `getUser()` call happens only on a failed link, so the Supabase Auth request volume does not change measurably. Free-tier usage is unchanged.

## Risks / Trade-offs

- [The existing user has an unconfirmed email and no Google identity] → Supabase may not link automatically, and the restarted sign-in can fail. The callback then sees no guest session and answers `auth_error=provider` (D2): no loop, and the owner sees the reason in the URL. Resolving such a user in the Supabase dashboard is an owner action.
- [Archive order] → `openspec validate` reports that archiving would refuse this delta today: the modified requirement reaches the main `auth` spec only when `web-auth-and-bff` is archived. Archive `web-auth-and-bff` first.
- [Real Google cannot run in CI] → The owner repeats the Google sign-in check on production after the merge.

## Appendix

### A1. `apps/web/server/routes/auth/callback.get.ts` (full file)

```ts
// OAuth callback: checks state, then exchanges the code and the PKCE verifier for a session.

// Errors Supabase Auth returns when linking Google to a guest finds an existing account: the Google
// identity (identity_already_exists) or its email address (email_exists) belongs to another user.
const EXISTING_ACCOUNT_CODES = new Set(['identity_already_exists', 'email_exists'])

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  if (!consumeOAuthState(event, query.state)) {
    return sendRedirect(event, '/playground?auth_error=state', 302)
  }

  if (typeof query.error_code === 'string' && EXISTING_ACCOUNT_CODES.has(query.error_code)) {
    // A returning visitor on a new guest session. End the guest session and sign in to the existing
    // account instead. Without a guest session there was no link attempt, and restarting could loop.
    const supabase = useServerSupabase(event)
    const { data } = await supabase.auth.getUser()
    if (data.user?.is_anonymous !== true) {
      return sendRedirect(event, '/playground?auth_error=provider', 302)
    }
    const { error } = await supabase.auth.signOut({ scope: 'local' })
    return sendRedirect(event, error ? '/playground?auth_error=provider' : '/auth/google', 302)
  }
  if (query.error !== undefined || query.error_code !== undefined) {
    return sendRedirect(event, '/playground?auth_error=provider', 302)
  }

  if (typeof query.code !== 'string' || query.code.length === 0) {
    return sendRedirect(event, '/playground?auth_error=code', 302)
  }
  const supabase = useServerSupabase(event)
  const { error } = await supabase.auth.exchangeCodeForSession(query.code)
  if (error) {
    return sendRedirect(event, '/playground?auth_error=exchange', 302)
  }
  return sendRedirect(event, '/playground', 302)
})
```

### A2. `apps/web/test/e2e/auth.test.ts` (insert two tests)

Insert the block below directly after the test named `ends the guest session and restarts sign-in when Google already belongs to another user`. That is, after its closing `  })` line and before the `})` line that closes `describe('auth: Google sign-in', ...)`. Keep the two-space indentation exactly. Change nothing else in the file.

```ts

  it('ends the guest session and restarts sign-in when the Google email is already registered', async () => {
    const jar = await newGuest()
    await request('/auth/google', jar)
    const state = jar.get('gp-oauth-state') ?? ''
    const response = await request(
      `/auth/callback?error=invalid_request&error_code=email_exists&state=${state}`,
      jar,
    )
    expect(response.headers.get('location')).toBe('/auth/google')
    expect(sessionCookieNames(jar)).toEqual([])
  })

  it('reports an existing-account error without a guest session instead of restarting sign-in', async () => {
    const jar: CookieJar = new Map()
    await request('/auth/google', jar)
    const state = jar.get('gp-oauth-state') ?? ''
    const response = await request(
      `/auth/callback?error=invalid_request&error_code=email_exists&state=${state}`,
      jar,
    )
    expect(response.headers.get('location')).toBe('/playground?auth_error=provider')
    expect(sessionCookieNames(jar)).toEqual([])
  })
```

### A3. `docs/security/auth.md` (replace one line)

In the section `## BFF implementation`, replace the line that starts with `- A returning visitor on a new guest session cannot link a Google account` with this line:

```md
- A returning visitor on a new guest session cannot link a Google account whose identity or email address already belongs to their old user (`identity_already_exists` or `email_exists`). The BFF ends the guest session and signs them in to the existing account; the new guest's sandbox data is dropped. Without a guest session, the BFF does not restart sign-in and reports `auth_error=provider`.
```
