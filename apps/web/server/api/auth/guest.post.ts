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
