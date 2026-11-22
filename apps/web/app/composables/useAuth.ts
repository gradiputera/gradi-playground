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
