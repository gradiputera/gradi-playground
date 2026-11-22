// Rendering per route (ADR 0008) and response headers (web-hosting spec).
// Every specific rule repeats the security headers, so they never depend on rule merging.
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
}

const playground = {
  ssr: false,
  headers: { ...securityHeaders, 'X-Robots-Tag': 'noindex' },
}

const noStore = { headers: { ...securityHeaders, 'Cache-Control': 'no-store' } }

export default defineNuxtConfig({
  compatibilityDate: '2026-11-21',
  telemetry: false,
  devtools: { enabled: false },
  css: ['~/assets/css/main.css'],
  // Server-only values come from NUXT_SUPABASE_URL and NUXT_SUPABASE_KEY at runtime.
  // Only the Turnstile site key (NUXT_PUBLIC_TURNSTILE_SITE_KEY) is sent to the browser.
  runtimeConfig: {
    supabaseUrl: '',
    supabaseKey: '',
    public: {
      turnstileSiteKey: '',
    },
  },
  routeRules: {
    '/**': { headers: securityHeaders },
    '/playground': playground,
    '/playground/**': playground,
    '/api/health': noStore,
    '/api/auth/**': noStore,
    '/auth/**': noStore,
  },
})
