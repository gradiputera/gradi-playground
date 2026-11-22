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
