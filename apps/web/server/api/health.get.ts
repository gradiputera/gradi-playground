// Liveness check for uptime monitors (web-hosting spec). It reads no config and calls no other system.
export default defineEventHandler(() => ({ status: 'ok' }))
