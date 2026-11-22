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
