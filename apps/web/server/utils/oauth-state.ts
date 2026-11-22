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
