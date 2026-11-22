// Content of the main page. The owner edits this file; the page layout lives in pages/index.vue.
// Every value is taken from facts already public in this repository. Nothing personal is invented.

export interface ProfileLink {
  label: string
  href: string
}

export interface Profile {
  name: string
  headline: string
  intro: string
  demonstrates: string[]
  stack: string[]
  links: ProfileLink[]
  seo: { title: string, description: string }
}

export const profile: Profile = {
  name: 'gradiputera',
  headline: 'Engineering portfolio and playground',
  // TODO(owner): write your introduction.
  intro: 'Introduction coming soon.',
  demonstrates: [
    'Five services in five runtimes, each with its own language, framework and migration tool.',
    'Database per service through schema isolation on one free Postgres project.',
    'Event-driven integration: transactional outbox, queues, signed webhooks, retries and replay.',
    'OAuth2 and OpenID Connect with Google, PKCE, a server-side BFF and guest users.',
    'Hybrid rendering: this page is server-rendered, the playground is client-rendered.',
    'Observability with OpenTelemetry and Grafana Cloud.',
    'A double-entry ledger with a general ledger report and a trial balance.',
    'Simulated DC/DRC failover and per-user sandbox reset.',
    'Spec-driven development with OpenSpec and guardrails for AI coding agents.',
  ],
  stack: [
    'Java 25 / Vert.x',
    'PHP 8.4 / Laravel',
    'Go',
    'Node.js / Hono',
    'Python 3.13 / FastAPI',
    'Nuxt',
    'Supabase',
    'OpenTelemetry',
  ],
  links: [
    { label: 'GitHub', href: 'https://github.com/gradiputera' },
    { label: 'Source code of this site', href: 'https://github.com/gradiputera/gradi-playground' },
  ],
  seo: {
    title: 'gradiputera · gradi-playground',
    description:
      'Engineering portfolio of gradiputera: polyglot microservices, OAuth2, hybrid rendering, event-driven design and observability, with a live playground.',
  },
}
