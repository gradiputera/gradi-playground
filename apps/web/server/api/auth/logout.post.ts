// Revokes this session at Supabase Auth and clears the session cookies.
export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  const supabase = useServerSupabase(event)
  await supabase.auth.signOut({ scope: 'local' })
  setResponseStatus(event, 204)
  return null
})
