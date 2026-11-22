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
