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
