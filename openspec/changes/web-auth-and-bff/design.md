# Design

## Context

- **Web app:** `apps/web` is live on Vercel with the SSR main page, the CSR playground shell and `GET /api/health`.
- **Hosted Supabase:** Google sign-in, anonymous sign-in, manual linking, Turnstile CAPTCHA and ES256 signing keys are enabled. The Site URL is the production domain.
- **Local Supabase (`supabase/config.toml`):**
  - anonymous sign-in and manual linking are on, and CAPTCHA is off;
  - Google is on and reads its client ID and secret through `env()`; CI uses dummy values.
- **Guidance:** ADR 0007 and `docs/security/auth.md` define the flows; the auth spec defines the requirements.

All appendix files were run on 2026-11-22 on a temporary branch (`proto/auth-bff`) in GitHub Actions, against the local Supabase stack started by the CI steps in A19. The type check, all 25 tests (14 auth and 11 routing) and the build passed. The same run answered three questions about Supabase Auth 3.2 behaviour (D3, D5, D7). The branch was deleted afterwards.

## Goals / Non-Goals

**Goals:**
- Tokens never reach browser JavaScript, and the browser never calls Supabase.
- Every auth behaviour in the specs is checked by an automated test against a real Supabase Auth server, except Google consent itself, which needs real Google credentials.
- The implementer copies files; there are no open design choices.

**Non-Goals:**
- No BFF-side rate limiting: Supabase Auth limits anonymous sign-ins per IP (30 per hour by default).
- No calls to services yet.
- No Content Security Policy yet.
- No preview-deployment auth: previews get no Supabase variables, so their auth endpoints answer 503.

## Decisions

### D1. Server-only Supabase client (A4)

`useServerSupabase(event)` builds a `@supabase/ssr` server client from runtime config, for every request. Its cookie adapter reads the request's cookies and writes every cookie that Supabase asks for with `httpOnly: true`, `secure: true`, `sameSite: 'lax'` and `path: '/'`. These override the library defaults, which are not `httpOnly`. Without `NUXT_SUPABASE_URL` and `NUXT_SUPABASE_KEY`, it throws HTTP 503, so a deployment without auth configuration still serves every other page.

`secure: true` is set everywhere. Browsers accept Secure cookies on `http://localhost`, and the tests send cookies by hand.

Alternatives:
- The `@nuxtjs/supabase` module is rejected: it gives the browser a Supabase client and JavaScript-readable session cookies.
- A hand-written PKCE and token client is rejected: `@supabase/ssr` already does PKCE, chunked cookies and refresh.

### D2. Identity returned to the browser (A4, A6)

`toIdentity(user)` maps a Supabase user to `{ kind: 'guest' | 'google', name }`. The name is `user_metadata.full_name`, then `name`, then `null`. No token, email or user id leaves the server.

`GET /api/auth/session` calls `getUser()`, which asks Supabase Auth instead of trusting the cookie. A logged-out (revoked) session therefore reads as signed out (verified: the old cookies stop working after logout). An expired access token is refreshed on the way, and the new cookies are written.

### D3. Google sign-in start: PKCE, `state`, link or sign in (A5, A9)

`GET /auth/google` works as follows:
- A Google user is sent back to `/playground`.
- Otherwise the BFF issues `state`: 24 random bytes (Web Crypto), in the `gp-oauth-state` cookie (`httpOnly`, path `/auth`, 10 minutes).
- It builds `redirectTo = <request origin>/auth/callback?state=<state>`.
- A guest goes through `linkIdentity`, which keeps the same user id (verified: it redirects straight to `accounts.google.com`).
- A visitor without a session goes through `signInWithOAuth` (verified: it redirects to `<supabase>/auth/v1/authorize` with an S256 `code_challenge`).
- In both cases `@supabase/ssr` stores the PKCE verifier in an httpOnly cookie through the adapter.

Redirect allow-list (verified in CI):
- Supabase Auth stores the `redirect_to` exactly, including `?state=`, when its host equals the Site URL's host (any port or path) or is a loopback address.
- For a foreign host it falls back to the Site URL.

So the hosted setting (Site URL `https://gradi-playground-app.vercel.app`) needs no wildcard entry for the production callback.

### D4. Callback (A10)

1. `consumeOAuthState` always deletes the cookie and compares in constant time. A mismatch redirects to `/playground?auth_error=state`.
2. `error_code=identity_already_exists` means a returning visitor on a new guest session: their Google account is already linked to their old user. The BFF signs the guest out (`scope: 'local'`) and redirects to `/auth/google`, which now runs a normal sign-in into the existing account. The new guest's sandbox data is dropped, which is acceptable for sandbox data.
3. Any other provider error leads to `auth_error=provider`, a missing code to `auth_error=code`, and a failed exchange to `auth_error=exchange`. No session is created in any of these cases.
4. A successful exchange redirects to `/playground`.

### D5. Guest sign-in and logout (A7, A8)

- `POST /api/auth/guest`:
  - it checks the `Origin` header first;
  - it reads an optional `captchaToken` (a string of at most 4096 characters);
  - it returns the existing identity with HTTP 200 if a session exists;
  - otherwise it calls `signInAnonymously({ options: { captchaToken } })` and returns HTTP 201;
  - on failure it answers 400, or 429 when Supabase rate-limits.
- `POST /api/auth/logout` checks the `Origin` header, calls `signOut({ scope: 'local' })`, which revokes this session at Supabase Auth and clears the cookies, and answers 204.

### D6. Cross-site protection and caching (A2, A4)

- `assertSameOrigin` compares the `Origin` header with `getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin`. Browsers always send `Origin` on `POST`, and `SameSite=Lax` is the second layer.
- `routeRules` add `Cache-Control: no-store` (and the security headers) to `/api/auth/**` and `/auth/**`.

### D7. Runtime configuration (A2)

`runtimeConfig.supabaseUrl`, `runtimeConfig.supabaseKey` and `runtimeConfig.public.turnstileSiteKey` come from `NUXT_SUPABASE_URL`, `NUXT_SUPABASE_KEY` and `NUXT_PUBLIC_TURNSTILE_SITE_KEY` at runtime, so no rebuild is needed when they change.

The key is the Supabase **publishable** key (`sb_publishable_…`). It is not secret, but it stays server-side anyway, because the browser has no use for it. A test checks it never appears in page HTML. The secret and service role keys are never used.

### D8. Playground shell (A11–A16)

- `useAuth()` keeps the identity in `useState` and calls the three API endpoints with `$fetch`. Same-origin `POST` requests carry `Origin` automatically.
- `layouts/playground.vue`, on mount:
  1. calls `refresh()`;
  2. without a session, renders `TurnstileWidget` if a site key is configured, and otherwise signs in as a guest directly (local development, where CAPTCHA is off);
  3. renders the page slot only once an identity exists, with a preparing message until then and an error message on failure;
  4. shows `?auth_error=` as a notice.
- The header shows `guest` with a plain link `<a href="/auth/google">` (a full navigation, so the server route runs), or the Google name with a "Sign out" button. Signing out navigates to `/`.
- `TurnstileWidget.vue` loads `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` only in the browser, renders the widget explicitly and emits the token. It adds no dependency.
- The three playground pages select the layout with `definePageMeta({ layout: 'playground' })`.

### D9. Tests and CI (A3, A18, A19)

`test/e2e/auth.test.ts` builds the app and runs its own server, like `web.test.ts`. It keeps a small cookie jar and sends requests with `redirect: 'manual'`.
- It reads the test server's origin lazily, because the server starts in a `beforeAll` hook.
- It throws, rather than skipping, when `NUXT_SUPABASE_URL` or `NUXT_SUPABASE_KEY` is missing.
- `vitest.config.ts` sets `fileParallelism: false`, so the two test files build one after the other.

The `web` workflow (A19) now starts the local Supabase stack, the same way `supabase.yml` does (dummy Google and CAPTCHA env values, an ephemeral ES256 signing key, unused containers excluded). It exports `API_URL` and `PUBLISHABLE_KEY` from `supabase status -o env` as the two `NUXT_SUPABASE_*` variables, and it also triggers on `supabase/config.toml`.

### Dependencies and licences

| Package | Version | Licence | Why |
|---|---|---|---|
| `@supabase/ssr` | 0.12.7 | MIT | Server-side Supabase client with PKCE, chunked cookies and refresh, behind our cookie adapter (D1) |
| `@supabase/supabase-js` | 2.119.2 | MIT | Peer dependency of `@supabase/ssr` (`^2.114.0`), and the `User` type |

They are installed with `pnpm add --filter web @supabase/ssr@0.12.7 @supabase/supabase-js@2.119.2 --save-exact`. No new build scripts need allowing; the prototype install passed pnpm's supply-chain policy check. Turnstile is loaded from Cloudflare at runtime and adds no package.

### Free-tier usage

- Supabase Free counts anonymous users as monthly active users (50,000 per month); portfolio traffic is far below that, and stale guests are deleted nightly.
- Each playground page load makes one `GET /api/auth/session` call to Supabase Auth.
- Vercel function invocations grow by a few per visit.
- The `web` CI job grows to about 4 minutes, which is free for public repositories.

## Risks / Trade-offs

- [Google consent and the `identity_already_exists` redirect cannot run in CI without real Google credentials] → The owner checks four flows by hand on production after setting the variables (README, "Authentication variables"). If Supabase reports the linking error in the URL fragment instead of the query, the callback answers `auth_error=code`. A follow-up change would then handle the fragment.
- [`getUser()` adds one Supabase Auth round trip per session check] → It runs once per playground page load, and it is what makes logout revocation effective (D2).
- [Dropping the new guest's data when a returning user signs in] → Accepted for sandbox data, and documented in `docs/security/auth.md`.
- [Supabase changes its redirect allow-list behaviour (D3)] → The callback would then land on the Site URL without `state` and fail with `auth_error=state`, which is safe. The fix is adding `https://<app>/auth/callback**` to the Supabase redirect URLs.
- [Local tests need Docker] → `web.test.ts` runs alone without Docker (README), and CI runs everything.

## Migration Plan

1. Merge the PR after `web-build` (now with local Supabase) and gitleaks pass.
2. The owner adds the three Vercel variables (README, "Authentication variables") and redeploys.
3. The owner runs the four manual checks on production.
4. Rollback: remove the Vercel variables, so the auth endpoints answer 503 and the playground shows its error notice, or revert the merge through a new PR. No data migration is involved; guest users are cleaned up nightly.

## Appendix: file contents

Copy each file exactly. Paths are relative to the repository root. A1 is what `pnpm add` produces; compare after installing.

### A1. `apps/web/package.json`

```json
{
  "name": "web",
  "private": true,
  "type": "module",
  "engines": {
    "node": "26.x"
  },
  "scripts": {
    "dev": "nuxt dev",
    "build": "nuxt build",
    "preview": "nuxt preview",
    "postinstall": "nuxt prepare",
    "typecheck": "nuxt typecheck",
    "test": "vitest run"
  },
  "dependencies": {
    "@supabase/ssr": "0.12.7",
    "@supabase/supabase-js": "2.119.2",
    "nuxt": "4.6.4",
    "vue": "3.5.46",
    "vue-router": "5.5.1"
  },
  "devDependencies": {
    "@nuxt/test-utils": "4.4.0",
    "typescript": "6.0.3",
    "vitest": "5.1.1",
    "vue-tsc": "3.3.14"
  }
}
```

### A2. `apps/web/nuxt.config.ts`

```ts
// Rendering per route (ADR 0008) and response headers (web-hosting spec).
// Every specific rule repeats the security headers, so they never depend on rule merging.
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
}

const playground = {
  ssr: false,
  headers: { ...securityHeaders, 'X-Robots-Tag': 'noindex' },
}

const noStore = { headers: { ...securityHeaders, 'Cache-Control': 'no-store' } }

export default defineNuxtConfig({
  compatibilityDate: '2026-11-21',
  telemetry: false,
  devtools: { enabled: false },
  css: ['~/assets/css/main.css'],
  // Server-only values come from NUXT_SUPABASE_URL and NUXT_SUPABASE_KEY at runtime.
  // Only the Turnstile site key (NUXT_PUBLIC_TURNSTILE_SITE_KEY) is sent to the browser.
  runtimeConfig: {
    supabaseUrl: '',
    supabaseKey: '',
    public: {
      turnstileSiteKey: '',
    },
  },
  routeRules: {
    '/**': { headers: securityHeaders },
    '/playground': playground,
    '/playground/**': playground,
    '/api/health': noStore,
    '/api/auth/**': noStore,
    '/auth/**': noStore,
  },
})
```

### A3. `apps/web/vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
})
```

### A4. `apps/web/server/utils/supabase.ts`

```ts
// Server-only Supabase client for the BFF (ADR 0007). The browser never talks to Supabase:
// every session cookie is written here, always httpOnly, Secure and SameSite=Lax.
import { createServerClient, parseCookieHeader } from '@supabase/ssr'
import type { User } from '@supabase/supabase-js'
import type { H3Event } from 'h3'

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
} as const

export function useServerSupabase(event: H3Event) {
  const config = useRuntimeConfig(event)
  if (!config.supabaseUrl || !config.supabaseKey) {
    throw createError({ statusCode: 503, statusMessage: 'Authentication is not configured' })
  }
  return createServerClient(config.supabaseUrl, config.supabaseKey, {
    cookies: {
      getAll() {
        return parseCookieHeader(getRequestHeader(event, 'cookie') ?? '').map(({ name, value }) => ({
          name,
          value: value ?? '',
        }))
      },
      setAll(cookies) {
        for (const { name, value, options } of cookies) {
          setCookie(event, name, value, { ...options, ...SESSION_COOKIE_OPTIONS })
        }
      },
    },
  })
}

// What the browser may know about the visitor: no tokens, no email, no user id.
export interface Identity {
  kind: 'guest' | 'google'
  name: string | null
}

export function toIdentity(user: User): Identity {
  if (user.is_anonymous) {
    return { kind: 'guest', name: null }
  }
  const metadata = user.user_metadata ?? {}
  const name = typeof metadata.full_name === 'string'
    ? metadata.full_name
    : typeof metadata.name === 'string' ? metadata.name : null
  return { kind: 'google', name }
}

// The public origin of this deployment, as seen by the browser.
export function siteOrigin(event: H3Event): string {
  return getRequestURL(event, { xForwardedHost: true, xForwardedProto: true }).origin
}

// State-changing endpoints accept only same-origin requests (browsers always send Origin on POST).
export function assertSameOrigin(event: H3Event): void {
  if (getRequestHeader(event, 'origin') !== siteOrigin(event)) {
    throw createError({ statusCode: 403, statusMessage: 'Cross-site request rejected' })
  }
}
```

### A5. `apps/web/server/utils/oauth-state.ts`

```ts
// OAuth `state` for login-CSRF protection: a random value in an httpOnly cookie that must come back
// unchanged on the callback URL. It is single-use: the callback always deletes it.
import type { H3Event } from 'h3'

const STATE_COOKIE = 'gp-oauth-state'
const STATE_COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: 'lax', path: '/auth' } as const

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false
  }
  let difference = 0
  for (let index = 0; index < a.length; index++) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }
  return difference === 0
}

export function issueOAuthState(event: H3Event): string {
  const state = randomState()
  setCookie(event, STATE_COOKIE, state, { ...STATE_COOKIE_OPTIONS, maxAge: 600 })
  return state
}

export function consumeOAuthState(event: H3Event, received: unknown): boolean {
  const expected = getCookie(event, STATE_COOKIE)
  deleteCookie(event, STATE_COOKIE, STATE_COOKIE_OPTIONS)
  return typeof expected === 'string' && typeof received === 'string' && constantTimeEqual(received, expected)
}
```

### A6. `apps/web/server/api/auth/session.get.ts`

```ts
// Who is the visitor? Asks Supabase Auth (not just the cookie), so a revoked session reads as signed out.
// Refreshes an expired access token on the way and rewrites the session cookies.
export default defineEventHandler(async (event) => {
  const supabase = useServerSupabase(event)
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) {
    return { authenticated: false }
  }
  return { authenticated: true, user: toIdentity(data.user) }
})
```

### A7. `apps/web/server/api/auth/guest.post.ts`

```ts
// Creates an anonymous (guest) user and session. Supabase Auth verifies the Turnstile token
// when CAPTCHA is enabled (hosted project); the local stack has CAPTCHA disabled.
export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const body = await readBody<{ captchaToken?: unknown } | undefined>(event).catch(() => undefined)
  const captchaToken = typeof body?.captchaToken === 'string' && body.captchaToken.length <= 4096
    ? body.captchaToken
    : undefined

  const supabase = useServerSupabase(event)
  const existing = await supabase.auth.getUser()
  if (existing.data.user) {
    return { authenticated: true, user: toIdentity(existing.data.user) }
  }

  const { data, error } = await supabase.auth.signInAnonymously({ options: { captchaToken } })
  if (error || !data.user) {
    throw createError({
      statusCode: error?.status === 429 ? 429 : 400,
      statusMessage: 'Guest sign-in failed',
    })
  }
  setResponseStatus(event, 201)
  return { authenticated: true, user: toIdentity(data.user) }
})
```

### A8. `apps/web/server/api/auth/logout.post.ts`

```ts
// Revokes this session at Supabase Auth and clears the session cookies.
export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const supabase = useServerSupabase(event)
  await supabase.auth.signOut({ scope: 'local' })
  setResponseStatus(event, 204)
  return null
})
```

### A9. `apps/web/server/routes/auth/google.get.ts`

```ts
// Starts Google sign-in (Authorization Code with PKCE). A guest links Google to the same user id;
// a visitor without a session signs in. The PKCE verifier and the state go into httpOnly cookies.
export default defineEventHandler(async (event) => {
  const supabase = useServerSupabase(event)
  const { data } = await supabase.auth.getUser()
  if (data.user && !data.user.is_anonymous) {
    return sendRedirect(event, '/playground', 302)
  }

  const state = issueOAuthState(event)
  const redirectTo = `${siteOrigin(event)}/auth/callback?state=${state}`
  const options = { redirectTo, skipBrowserRedirect: true }
  const result = data.user
    ? await supabase.auth.linkIdentity({ provider: 'google', options })
    : await supabase.auth.signInWithOAuth({ provider: 'google', options })

  if (result.error || !result.data.url) {
    return sendRedirect(event, '/playground?auth_error=start', 302)
  }
  return sendRedirect(event, result.data.url, 302)
})
```

### A10. `apps/web/server/routes/auth/callback.get.ts`

```ts
// OAuth callback: checks state, then exchanges the code and the PKCE verifier for a session.
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  if (!consumeOAuthState(event, query.state)) {
    return sendRedirect(event, '/playground?auth_error=state', 302)
  }

  if (query.error_code === 'identity_already_exists') {
    // The Google account already belongs to another user (a returning visitor on a new guest
    // session). End the guest session and sign in to the existing account instead.
    const supabase = useServerSupabase(event)
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

### A11. `apps/web/app/composables/useAuth.ts`

```ts
// Browser-side view of the visitor's identity. It never sees tokens: the BFF keeps them in
// httpOnly cookies and answers only "guest" or "google" plus a display name.
export interface Identity {
  kind: 'guest' | 'google'
  name: string | null
}

interface SessionResponse {
  authenticated: boolean
  user?: Identity
}

export function useAuth() {
  const identity = useState<Identity | null>('auth-identity', () => null)

  async function refresh(): Promise<Identity | null> {
    const response = await $fetch<SessionResponse>('/api/auth/session')
    identity.value = response.authenticated && response.user ? response.user : null
    return identity.value
  }

  async function signInAsGuest(captchaToken?: string): Promise<void> {
    const response = await $fetch<SessionResponse>('/api/auth/guest', {
      method: 'POST',
      body: { captchaToken },
    })
    identity.value = response.user ?? null
  }

  async function signOut(): Promise<void> {
    await $fetch('/api/auth/logout', { method: 'POST' })
    identity.value = null
  }

  return { identity, refresh, signInAsGuest, signOut }
}
```

### A12. `apps/web/app/components/TurnstileWidget.vue`

```vue
<script setup lang="ts">
// Cloudflare Turnstile, loaded only on the client when a site key is configured.
// The token goes to the BFF, which passes it to Supabase Auth for verification.
interface TurnstileApi {
  render: (element: HTMLElement, options: Record<string, unknown>) => string
}

const props = defineProps<{ siteKey: string }>()
const emit = defineEmits<{ token: [value: string], failed: [] }>()
const container = ref<HTMLElement | null>(null)

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

function turnstile(): TurnstileApi | undefined {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile
}

function loadScript(): Promise<void> {
  if (turnstile()) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Turnstile script failed to load'))
    document.head.appendChild(script)
  })
}

onMounted(async () => {
  try {
    await loadScript()
    const api = turnstile()
    if (!api || !container.value) {
      throw new Error('Turnstile is not available')
    }
    api.render(container.value, {
      'sitekey': props.siteKey,
      'callback': (token: string) => emit('token', token),
      'error-callback': () => emit('failed'),
    })
  }
  catch {
    emit('failed')
  }
})
</script>

<template>
  <div ref="container" class="turnstile" />
</template>
```

### A13. `apps/web/app/layouts/playground.vue`

```vue
<script setup lang="ts">
// Playground shell: makes sure the visitor has a session (guest by default, ADR 0007)
// and shows who they are in the header.
const { identity, refresh, signInAsGuest, signOut } = useAuth()
const config = useRuntimeConfig()
const route = useRoute()

const needsChallenge = ref(false)
const failed = ref(false)

const authError = computed(() =>
  typeof route.query.auth_error === 'string' ? route.query.auth_error : null,
)

async function startGuest(captchaToken?: string) {
  try {
    await signInAsGuest(captchaToken)
    needsChallenge.value = false
  }
  catch {
    failed.value = true
  }
}

onMounted(async () => {
  try {
    if (await refresh()) {
      return
    }
    if (config.public.turnstileSiteKey) {
      needsChallenge.value = true
    }
    else {
      await startGuest()
    }
  }
  catch {
    failed.value = true
  }
})

async function onSignOut() {
  await signOut()
  await navigateTo('/')
}
</script>

<template>
  <div class="shell">
    <header class="site-header">
      <NuxtLink to="/" class="brand">gradi-playground</NuxtLink>
      <div class="identity">
        <template v-if="identity?.kind === 'google'">
          <span>{{ identity.name ?? 'Google user' }}</span>
          <button type="button" class="link-button" @click="onSignOut">Sign out</button>
        </template>
        <template v-else-if="identity?.kind === 'guest'">
          <span>guest</span>
          <a href="/auth/google">Sign in with Google</a>
        </template>
      </div>
    </header>

    <p v-if="authError" class="notice">
      Sign-in did not complete ({{ authError }}). Please try again.
    </p>

    <TurnstileWidget
      v-if="needsChallenge"
      :site-key="config.public.turnstileSiteKey"
      @token="startGuest"
      @failed="failed = true"
    />

    <p v-if="failed" class="notice">
      Could not start a guest session. Reload the page to try again.
    </p>
    <slot v-if="identity" />
    <p v-else-if="!failed" class="page">Preparing your guest session…</p>

    <footer class="site-footer">
      <a href="https://github.com/gradiputera/gradi-playground">Source code</a>
      <span>MIT License</span>
    </footer>
  </div>
</template>
```

### A14. `apps/web/app/pages/playground/index.vue`

```vue
<script setup lang="ts">
definePageMeta({ layout: 'playground' })
useHead({ title: 'Playground · gradi-playground' })
</script>

<template>
  <main class="page">
    <h1>Playground</h1>
    <p>Try the system end to end. Choose a destination.</p>
    <div class="cards">
      <NuxtLink to="/playground/payment" class="card">
        <strong>Payment</strong>
        Simulate a payment and follow it through the services, the ledger and the event bus.
      </NuxtLink>
      <NuxtLink to="/playground/dashboards" class="card">
        <strong>Dashboards</strong>
        Request rates, errors, latency and logs for every service.
      </NuxtLink>
    </div>
  </main>
</template>
```

### A15. `apps/web/app/pages/playground/payment.vue`

```vue
<script setup lang="ts">
definePageMeta({ layout: 'playground' })
useHead({ title: 'Payment · gradi-playground' })
</script>

<template>
  <main class="page">
    <h1>Payment</h1>
    <p>
      Coming soon: a payment form with a live step timeline, the general ledger, the DC/DRC
      topology panel and a reset to the seed data.
    </p>
    <NuxtLink to="/playground">Back to the playground</NuxtLink>
  </main>
</template>
```

### A16. `apps/web/app/pages/playground/dashboards.vue`

```vue
<script setup lang="ts">
definePageMeta({ layout: 'playground' })
useHead({ title: 'Dashboards · gradi-playground' })
</script>

<template>
  <main class="page">
    <h1>Dashboards</h1>
    <p>
      Coming soon: request rate, error rate and latency per service, transactions by outcome,
      and a logs panel filterable by service, level and trace id.
    </p>
    <NuxtLink to="/playground">Back to the playground</NuxtLink>
  </main>
</template>
```

### A17. `apps/web/app/assets/css/main.css`

```css
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --fg: #1a1a1a;
  --muted: #5c5c5c;
  --border: #dddddd;
  --accent: #0b57d0;
  --card: #f6f7f9;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #111315;
    --fg: #ececec;
    --muted: #a3a3a3;
    --border: #2e3236;
    --accent: #8ab4f8;
    --card: #1a1d20;
  }
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  line-height: 1.6;
}

a {
  color: var(--accent);
}

.shell {
  max-width: 960px;
  margin: 0 auto;
  padding: 0 16px;
}

.site-header,
.site-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 16px 0;
}

.site-header {
  border-bottom: 1px solid var(--border);
}

.site-footer {
  border-top: 1px solid var(--border);
  margin-top: 48px;
  color: var(--muted);
  font-size: 0.9rem;
}

.brand {
  font-weight: 700;
  color: var(--fg);
  text-decoration: none;
}

.page {
  padding: 32px 0;
}

.headline {
  color: var(--muted);
  font-size: 1.2rem;
}

.cta {
  display: inline-block;
  margin-top: 8px;
  padding: 10px 18px;
  border-radius: 8px;
  background: var(--accent);
  color: var(--bg);
  font-weight: 600;
  text-decoration: none;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0;
  list-style: none;
}

.tags li {
  padding: 2px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
}

.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}

.card {
  display: block;
  padding: 24px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--card);
  color: var(--fg);
  text-decoration: none;
}

.card strong {
  display: block;
  font-size: 1.4rem;
  color: var(--accent);
}

.identity {
  display: flex;
  align-items: center;
  gap: 12px;
}

.link-button {
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.notice {
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--card);
}
```

### A18. `apps/web/test/e2e/auth.test.ts`

```ts
// Specs: auth (BFF session handling). Runs against a production build and the local Supabase stack.
// Needs NUXT_SUPABASE_URL and NUXT_SUPABASE_KEY (see apps/web/README.md, "Auth tests").
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { fetch, setup, url } from '@nuxt/test-utils/e2e'

const supabaseUrl = process.env.NUXT_SUPABASE_URL
const supabaseKey = process.env.NUXT_SUPABASE_KEY
if (!supabaseUrl || !supabaseKey) {
  throw new Error('Set NUXT_SUPABASE_URL and NUXT_SUPABASE_KEY from `supabase status` to run the auth tests.')
}

await setup({
  rootDir: fileURLToPath(new URL('../..', import.meta.url)),
  server: true,
  build: true,
})

type CookieJar = Map<string, string>

// Keeps cookies like a browser would: set, overwrite, and delete on Max-Age=0 or an empty value.
function storeCookies(jar: CookieJar, response: Response): void {
  for (const header of response.headers.getSetCookie()) {
    const [pair = '', ...attributes] = header.split(';')
    const separator = pair.indexOf('=')
    const name = pair.slice(0, separator).trim()
    const value = pair.slice(separator + 1).trim()
    const expired = value === '' || attributes.some(attribute => /^\s*max-age=0\s*$/i.test(attribute))
    if (expired) {
      jar.delete(name)
    }
    else {
      jar.set(name, value)
    }
  }
}

async function request(path: string, jar: CookieJar, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  if (jar.size > 0) {
    headers.set('cookie', [...jar].map(([name, value]) => `${name}=${value}`).join('; '))
  }
  const response = await fetch(path, { ...init, headers, redirect: 'manual' })
  storeCookies(jar, response)
  return response
}

// The test server starts in a beforeAll hook, so its address is read lazily.
function siteOrigin(): string {
  return new URL(url('/')).origin
}

function post(path: string, jar: CookieJar, body?: unknown): Promise<Response> {
  return request(path, jar, {
    method: 'POST',
    headers: { 'origin': siteOrigin(), 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
}

function sessionCookieNames(jar: CookieJar): string[] {
  return [...jar.keys()].filter(name => name.startsWith('sb-') && name.includes('-auth-token') && !name.endsWith('-code-verifier'))
}

async function newGuest(): Promise<CookieJar> {
  const jar: CookieJar = new Map()
  const response = await post('/api/auth/guest', jar)
  expect(response.status).toBe(201)
  return jar
}

describe('auth: guest sign-in', () => {
  it('creates an anonymous user and returns only its kind', async () => {
    const jar: CookieJar = new Map()
    const response = await post('/api/auth/guest', jar)
    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body).toEqual({ authenticated: true, user: { kind: 'guest', name: null } })
    expect(JSON.stringify(body)).not.toMatch(/token|email|"id"/i)
    expect(sessionCookieNames(jar).length).toBeGreaterThan(0)
  })

  it('sets the session cookies httpOnly, Secure and SameSite=Lax', async () => {
    const response = await post('/api/auth/guest', new Map())
    const sessionCookies = response.headers.getSetCookie().filter(header => /^sb-[^=]*-auth-token[^=]*=/.test(header))
    expect(sessionCookies.length).toBeGreaterThan(0)
    for (const header of sessionCookies) {
      expect(header).toMatch(/;\s*HttpOnly/i)
      expect(header).toMatch(/;\s*Secure/i)
      expect(header).toMatch(/;\s*SameSite=Lax/i)
    }
  })

  it('rejects a guest sign-in without a same-origin Origin header', async () => {
    const missing = await request('/api/auth/guest', new Map(), { method: 'POST' })
    expect(missing.status).toBe(403)
    const foreign = await request('/api/auth/guest', new Map(), {
      method: 'POST',
      headers: { origin: 'https://attacker.example' },
    })
    expect(foreign.status).toBe(403)
    expect(foreign.headers.getSetCookie().some(header => header.startsWith('sb-'))).toBe(false)
  })

  it('reuses an existing session instead of creating another guest', async () => {
    const jar = await newGuest()
    const again = await post('/api/auth/guest', jar)
    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ authenticated: true, user: { kind: 'guest', name: null } })
  })
})

describe('auth: session endpoint', () => {
  it('reports a visitor without cookies as signed out', async () => {
    const response = await request('/api/auth/session', new Map())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ authenticated: false })
  })

  it('reports a guest session as a guest', async () => {
    const jar = await newGuest()
    const response = await request('/api/auth/session', jar)
    expect(await response.json()).toEqual({ authenticated: true, user: { kind: 'guest', name: null } })
  })
})

describe('auth: Google sign-in start', () => {
  it('sends a visitor without a session to Supabase with a PKCE challenge and a state cookie', async () => {
    const jar: CookieJar = new Map()
    const response = await request('/auth/google', jar)
    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location') ?? '')
    expect(`${location.origin}${location.pathname}`).toBe(`${supabaseUrl}/auth/v1/authorize`)
    expect(location.searchParams.get('provider')).toBe('google')
    expect(location.searchParams.get('code_challenge')).toBeTruthy()
    expect(location.searchParams.get('code_challenge_method')).toBe('s256')
    const redirectTo = new URL(location.searchParams.get('redirect_to') ?? '')
    expect(redirectTo.pathname).toBe('/auth/callback')
    expect(redirectTo.searchParams.get('state')).toBe(jar.get('gp-oauth-state'))
    const stateCookie = response.headers.getSetCookie().find(header => header.startsWith('gp-oauth-state='))
    expect(stateCookie).toMatch(/;\s*HttpOnly/i)
  })

  it('links Google to the same user when the visitor is a guest', async () => {
    const jar = await newGuest()
    const response = await request('/auth/google', jar)
    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location') ?? '')
    expect(location.hostname).toBe('accounts.google.com')
  })
})

describe('auth: callback', () => {
  it('rejects a callback whose state does not match the cookie and creates no session', async () => {
    const jar: CookieJar = new Map()
    await request('/auth/google', jar)
    const response = await request('/auth/callback?code=forged&state=forged-state', jar)
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/playground?auth_error=state')
    expect(sessionCookieNames(jar)).toEqual([])
    expect(jar.has('gp-oauth-state')).toBe(false)
  })

  it('reports an invalid code without creating a session', async () => {
    const jar: CookieJar = new Map()
    await request('/auth/google', jar)
    const state = jar.get('gp-oauth-state') ?? ''
    const response = await request(`/auth/callback?code=not-a-real-code&state=${state}`, jar)
    expect(response.headers.get('location')).toBe('/playground?auth_error=exchange')
    expect(sessionCookieNames(jar)).toEqual([])
  })

  it('ends the guest session and restarts sign-in when Google already belongs to another user', async () => {
    const jar = await newGuest()
    await request('/auth/google', jar)
    const state = jar.get('gp-oauth-state') ?? ''
    const response = await request(
      `/auth/callback?error=server_error&error_code=identity_already_exists&state=${state}`,
      jar,
    )
    expect(response.headers.get('location')).toBe('/auth/google')
    expect(sessionCookieNames(jar)).toEqual([])
  })
})

describe('auth: logout', () => {
  it('revokes the session so the old cookies no longer work', async () => {
    const jar = await newGuest()
    const oldCookies = new Map(jar)
    const response = await post('/api/auth/logout', jar)
    expect(response.status).toBe(204)
    expect(sessionCookieNames(jar)).toEqual([])
    const replay = await request('/api/auth/session', oldCookies)
    expect(await replay.json()).toEqual({ authenticated: false })
  })

  it('rejects a logout without a same-origin Origin header', async () => {
    const jar = await newGuest()
    const response = await request('/api/auth/logout', jar, { method: 'POST' })
    expect(response.status).toBe(403)
    const session = await request('/api/auth/session', jar)
    expect(await session.json()).toEqual({ authenticated: true, user: { kind: 'guest', name: null } })
  })
})

describe('web-routing: server-only configuration', () => {
  it('never sends the Supabase key to the browser', async () => {
    for (const path of ['/', '/playground']) {
      const html = await (await fetch(path)).text()
      expect(html).not.toContain(supabaseKey)
    }
  })
})
```

### A19. `.github/workflows/web.yml`

```yaml
name: web

on:
  push:
    branches: [main]
    paths:
      - "apps/web/**"
      - "package.json"
      - "pnpm-lock.yaml"
      - "pnpm-workspace.yaml"
      - "supabase/config.toml"
      - ".github/workflows/web.yml"
  pull_request:
    paths:
      - "apps/web/**"
      - "package.json"
      - "pnpm-lock.yaml"
      - "pnpm-workspace.yaml"
      - "supabase/config.toml"
      - ".github/workflows/web.yml"

permissions:
  contents: read

jobs:
  web-build:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    env:
      # Dummy values so env() references in supabase/config.toml resolve. Not real credentials.
      SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID: ci-dummy-client-id
      SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET: ci-dummy-secret
      SUPABASE_AUTH_CAPTCHA_SECRET: ci-dummy-captcha
    steps:
      - uses: actions/checkout@v7

      - uses: supabase/setup-cli@v3
        with:
          version: 3.2.0

      - name: Generate an ephemeral JWT signing key
        run: |
          echo '[]' > supabase/signing_keys.json
          supabase gen signing-key --algorithm ES256 --append

      # The auth tests need a real Supabase Auth server: database, auth and gateway only.
      - name: Start the local Supabase stack
        run: supabase start -x realtime,storage-api,imgproxy,mailpit,studio,edge-runtime,logflare,vector,supavisor

      - name: Point the web app at the local stack
        run: |
          eval "$(supabase status -o env)"
          echo "NUXT_SUPABASE_URL=${API_URL}" >> "$GITHUB_ENV"
          echo "NUXT_SUPABASE_KEY=${PUBLISHABLE_KEY}" >> "$GITHUB_ENV"

      # Installs the pnpm version from packageManager in package.json.
      - uses: pnpm/action-setup@v6

      - uses: actions/setup-node@v7
        with:
          node-version: 26
          cache: pnpm

      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter web typecheck
      - run: pnpm --filter web test
      - run: pnpm --filter web build

      - name: Stop the local Supabase stack
        if: always()
        run: supabase stop --no-backup
```

### A20. `apps/web/.env.example`

```bash
# Copy to apps/web/.env for local development (gitignored). Never commit real values.
# Values for the local Supabase stack come from `npx -y supabase@3.2.0 status -o env`.

# Server only. API_URL from supabase status.
NUXT_SUPABASE_URL=http://127.0.0.1:54321
# Server only. PUBLISHABLE_KEY from supabase status (never the secret or service role key).
NUXT_SUPABASE_KEY=<publishable-key-from-supabase-status>
# Sent to the browser. Leave empty locally: the local stack has CAPTCHA off.
NUXT_PUBLIC_TURNSTILE_SITE_KEY=
```

### A21. `apps/web/README.md` (replace the whole file)

`````markdown
# apps/web

Nuxt web application: the public main page (SSR), the CSR playground, and the backend-for-frontend (BFF) that handles OAuth callbacks, site routing, observability proxying and sandbox reset fan-out. Deploys natively on Vercel.

## Status

In progress: the main page, the playground hub and placeholder pages, the health endpoint, and guest and Google sign-in through the BFF are implemented and tested. The payment and dashboards features follow in later roadmap steps.

## Layout

| Path | Purpose |
|---|---|
| `nuxt.config.ts` | Rendering per route, response headers and runtime configuration |
| `app/content/profile.ts` | Main page content, edited by the owner |
| `app/pages/` | `/` (SSR) and `/playground/**` (CSR) |
| `app/layouts/default.vue` | Header and footer of the main page |
| `app/layouts/playground.vue` | Playground shell: guest session, identity header |
| `app/composables/useAuth.ts` | Browser view of the identity (no tokens) |
| `app/components/TurnstileWidget.vue` | Cloudflare Turnstile check before guest sign-in |
| `app/error.vue` | Not-found and error page |
| `server/utils/` | Server-only Supabase client, cookie options, OAuth `state` |
| `server/api/` | BFF API routes: `GET /api/health` and `/api/auth/*` |
| `server/routes/auth/` | Browser navigations: `GET /auth/google` and `GET /auth/callback` |
| `test/e2e/` | Tests against a production build (`auth.test.ts` also needs local Supabase) |

## Authentication (BFF)

The browser never talks to Supabase. The BFF keeps the session in `httpOnly`, `Secure`, `SameSite=Lax` cookies and tells the browser only whether the visitor is a guest or a Google user. See [the auth model](../../docs/security/auth.md).

| Endpoint | Purpose |
|---|---|
| `GET /api/auth/session` | `{"authenticated": false}` or the identity kind and display name |
| `POST /api/auth/guest` | Create a guest (anonymous) session; same-origin only |
| `POST /api/auth/logout` | Revoke the session and clear the cookies; same-origin only |
| `GET /auth/google` | Start Google sign-in (PKCE and `state`); a guest links Google to the same user |
| `GET /auth/callback` | Check `state`, exchange the code, set the session |

## Environment variables

| Variable | Where it is used | Local value |
|---|---|---|
| `NUXT_SUPABASE_URL` | Server only | `http://127.0.0.1:54321` |
| `NUXT_SUPABASE_KEY` | Server only: the Supabase **publishable** key, never the secret or service role key | `PUBLISHABLE_KEY` from `supabase status -o env` |
| `NUXT_PUBLIC_TURNSTILE_SITE_KEY` | Browser: the Turnstile site key | empty (the local stack has CAPTCHA off) |

Copy `.env.example` to `.env` in this folder for `pnpm --filter web dev`. The file is gitignored.

## Local development

Prerequisites: Node.js 26 (the current LTS, for example through nvm), pnpm 12.21.0 (`npm install -g pnpm@12.21.0`), and Docker Desktop for the local Supabase stack. Run from the repository root:

```powershell
npx -y supabase@3.2.0 start
npx -y supabase@3.2.0 status -o env   # copy API_URL and PUBLISHABLE_KEY into apps/web/.env
pnpm install
pnpm --filter web dev                  # http://localhost:3000
pnpm --filter web typecheck
pnpm --filter web build
```

## Tests

`pnpm --filter web test` builds the app and runs both test files against the production server. `auth.test.ts` needs the local Supabase stack and the two server variables in the shell:

```powershell
$env:NUXT_SUPABASE_URL = "http://127.0.0.1:54321"
$env:NUXT_SUPABASE_KEY = "<PUBLISHABLE_KEY from supabase status -o env>"
pnpm --filter web test
```

Without Docker, run only the routing tests with `pnpm --filter web exec vitest run test/e2e/web.test.ts`; the `web` CI workflow always runs both against a local Supabase stack.

## Editing the main page

The main page text lives in `app/content/profile.ts`. Replace the `TODO(owner)` introduction and adjust the other fields; the layout picks them up.

## Vercel setup (owner actions)

The agent never runs the Vercel CLI. In the Vercel dashboard:

1. Add a new project and import the `gradi-playground` GitHub repository.
2. Set **Root Directory** to `apps/web`. The framework preset is detected as Nuxt.
3. Add the environment variable `ENABLE_EXPERIMENTAL_COREPACK` with value `1` (a build flag, not a secret), so the build uses pnpm 12.21.0 from `package.json`.
4. Deploy. The production branch is `main`; every pull request gets a preview deployment.
5. In Project Settings, enable "Skip deployments when there are no changes to the root directory or its dependencies".
6. Open `https://<app>/api/health` and check it returns `{"status":"ok"}`.

If the build log shows another pnpm version or an install error, set the Install Command to `npx -y pnpm@12.21.0 install --frozen-lockfile` and redeploy.

After the first production deploy, update the hosted settings with the app URL:

- Supabase, Authentication > URL Configuration: Site URL `https://<app>`, redirect URL `https://<app>/auth/callback`.
- Google Cloud, the OAuth client: add `https://<app>` to Authorized JavaScript origins.
- Cloudflare Turnstile, the widget: add the app hostname.

### Authentication variables (owner actions)

In Project Settings > Environment Variables, for the Production environment:

| Variable | Value |
|---|---|
| `NUXT_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `NUXT_SUPABASE_KEY` | The publishable key from Supabase, Project Settings > API Keys (starts with `sb_publishable_`) |
| `NUXT_PUBLIC_TURNSTILE_SITE_KEY` | The site key of the Turnstile widget in Cloudflare |

Redeploy, then check on the production URL:

1. Open `/playground` in a private window: the header shows "guest" after the Turnstile check.
2. Select "Sign in with Google" and finish consent: the header shows your Google name and "Sign out".
3. Select "Sign out": you return to the main page; opening `/playground` again starts a new guest session.
4. Open `/playground` in a new private window and sign in with Google again: you reach the same account (the returning-user path).

Preview deployments have no Supabase variables, so their auth endpoints answer 503; the rest of the site works.

## Route map

| Route | Rendering | Content |
|---|---|---|
| `/` | SSR | Main page about the owner, link to the playground |
| `/playground` | CSR | Hub: Payment and Dashboards |
| `/playground/payment` | CSR | Payment form, live timeline, general ledger, DC/DRC panel, reset to seed |
| `/playground/dashboards` | CSR | Native charts, logs panel, link to Grafana |

The rendering decision is in [ADR 0008](../../architecture/adr/0008-hybrid-rendering-ssr-and-csr.md).

## BFF responsibilities

- **Auth callback**: starts the PKCE sign-in, checks `state`, exchanges the code and sets session cookies. See [auth model](../../docs/security/auth.md).
- **Session**: refreshes tokens and handles logout. Tokens never reach browser JavaScript.
- **Site router**: sets the logical site (`DC` or `DRC`) and propagates it in W3C `baggage` together with `traceparent`.
- **Observability proxy**: `/api/observability/*` runs whitelisted PromQL and LogQL templates with validated parameters against Grafana Cloud, using a read-only token kept on the server.
- **Sandbox reset fan-out**: calls `POST /sandbox/reset` on every service in parallel and reports progress per service.

## Data flows

### Payment

1. The form sends the amount, currency, scenario and recipient email to the BFF.
2. The BFF calls payment-service with an idempotency key and the site.
3. The timeline is updated from the trace and the service responses: payment, ledger posting, outbox, pgmq, dispatcher, notification (email sent or bounced) and reporting.
4. The general ledger section refreshes after each transaction.

### Dashboards

1. The page requests a chart or a log query from `/api/observability/*`.
2. The BFF validates the parameters and runs the matching whitelisted template.
3. Results are cached briefly and returned as data; no Grafana iframe is used, because Grafana Cloud Free blocks embedding.

## Related

- [ADR 0008: Hybrid SSR and CSR rendering](../../architecture/adr/0008-hybrid-rendering-ssr-and-csr.md)
- [ADR 0007: OAuth2/OIDC with Supabase Auth](../../architecture/adr/0007-oauth2-oidc-with-supabase-auth.md)
- [ADR 0010: Native observability charts via BFF](../../architecture/adr/0010-native-observability-charts-via-bff.md)
- [ADR 0003: Service per Vercel project](../../architecture/adr/0003-service-per-vercel-project-as-containers.md)
`````

### A22. `docs/security/auth.md` (two edits)

1. Replace the body of `## Status` (the single line `Planned`) with:

```markdown
In progress: guest and Google sign-in, sessions and logout are implemented in the BFF (`apps/web`). Resource-server validation arrives with each service.
```

2. Insert this section directly above `## Related`, with one blank line before and after it:

```markdown
## BFF implementation

The flows above are implemented in `apps/web`; its README lists the endpoints.

- The BFF uses `@supabase/ssr` on the server only and writes every Supabase cookie itself, always `httpOnly`, `Secure` and `SameSite=Lax`: the session (`sb-<ref>-auth-token`, split into numbered chunks when large) and the PKCE verifier (`sb-<ref>-auth-token-code-verifier`).
- `state` lives in the `gp-oauth-state` cookie (path `/auth`, 10 minutes, single use) and travels inside the callback URL. Supabase Auth accepts any callback on the Site URL's host, so `?state=` needs no extra redirect allow-list entry.
- `POST` endpoints accept only requests whose `Origin` equals the site's own origin; `SameSite=Lax` is the second layer.
- The session endpoint asks Supabase Auth (`getUser`) instead of trusting the cookie, so a revoked session reads as signed out and an expired access token is refreshed on the way.
- A returning visitor on a new guest session cannot link a Google account that already belongs to their old user (`identity_already_exists`). The BFF ends the guest session and signs them in to the existing account; the new guest's sandbox data is dropped.
- The browser learns only `guest` or `google` and a display name: no tokens, email address or user id.
```
