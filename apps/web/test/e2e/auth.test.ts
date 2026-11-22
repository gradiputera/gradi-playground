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
