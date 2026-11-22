// Specs: web-routing and web-hosting. Runs against a production build served by the real Nitro server.
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { fetch, setup } from '@nuxt/test-utils/e2e'

await setup({
  rootDir: fileURLToPath(new URL('../..', import.meta.url)),
  server: true,
  build: true,
})

const securityHeaders: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
}

describe('web-routing: main page', () => {
  it('is server-rendered with the introduction and a link to the playground', async () => {
    const response = await fetch('/')
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toMatch(/<h1[^>]*>gradiputera<\/h1>/)
    expect(html).toContain('Open the playground')
    expect(html).toContain('href="/playground"')
  })

  it('has a title and a meta description', async () => {
    const html = await (await fetch('/')).text()
    expect(html).toMatch(/<title>[^<]+<\/title>/)
    expect(html).toMatch(/<meta name="description" content="[^"]+">/)
  })

  it('does not send X-Robots-Tag', async () => {
    const response = await fetch('/')
    expect(response.headers.get('x-robots-tag')).toBeNull()
  })
})

describe('web-routing: playground', () => {
  for (const path of ['/playground', '/playground/payment', '/playground/dashboards']) {
    it(`${path} is an empty client-rendered shell and is not indexed`, async () => {
      const response = await fetch(path)
      expect(response.status).toBe(200)
      const html = await response.text()
      expect(html).toContain('<div id="__nuxt"></div>')
      expect(html).not.toContain('href="/playground/payment"')
      expect(response.headers.get('x-robots-tag')).toBe('noindex')
    })
  }
})

describe('web-routing: unknown routes', () => {
  it('answers an unknown path outside the playground with 404 and a link to /', async () => {
    // A browser asks for HTML; without this header the server answers errors as JSON.
    const response = await fetch('/does-not-exist', { headers: { accept: 'text/html' } })
    expect(response.status).toBe(404)
    const html = await response.text()
    expect(html).toContain('Page not found')
    expect(html).toContain('href="/"')
  })
})

describe('web-hosting: health endpoint', () => {
  it('returns ok without caching', async () => {
    const response = await fetch('/api/health')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ status: 'ok' })
  })
})

describe('web-hosting: security headers', () => {
  for (const path of ['/', '/playground', '/api/health']) {
    it(`${path} carries the baseline security headers`, async () => {
      const response = await fetch(path)
      for (const [name, value] of Object.entries(securityHeaders)) {
        expect(response.headers.get(name), name).toBe(value)
      }
    })
  }
})
