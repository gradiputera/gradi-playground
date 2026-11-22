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
