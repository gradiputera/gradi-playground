# 0008. Hybrid SSR and CSR rendering

- Status: Accepted
- Date: 2026-11-21

## Context

The public main page should load fast and be indexable, so it benefits from server-side rendering (SSR). The playground is interactive: it has forms, live timelines, charts and real-time state, so it is better as a client-side application (CSR). One framework should serve both, and the two modes should be configurable per route.

## Decision

Nuxt `routeRules` select the rendering mode per route:

| Route | Rendering | Content |
|---|---|---|
| `/` | SSR (hydrates into SPA navigation) | Main page about the owner, with a prominent link to `/playground` |
| `/playground` | CSR (`ssr: false`) | Hub with two large links, Payment and Dashboards; header shows "guest" or the Google user and "Sign in with Google" |
| `/playground/payment` | CSR | Payment form, live step timeline, general ledger section, DC/DRC topology panel, reset to seed |
| `/playground/dashboards` | CSR | Native charts, logs panel, link to the full Grafana dashboard |

Rules:

- `/` stays SSR and `/playground/**` stays CSR.
- Server-only data (service keys, Grafana tokens) is read only in BFF server routes and never reaches the browser.
- The main page is server-rendered with no playground state, so it can be cached.

## Consequences

### Positive

- Fast first render and good indexing for the main page.
- Interactive playground without server round trips for every interaction.
- One codebase and one deployment for both modes.

### Negative

- Hydration mismatches are a risk on `/` and must be avoided.
- CSR pages show a loading state before data arrives, and cannot be indexed.
- Two rendering modes need two sets of performance checks.

## Alternatives considered

- **Pure SPA**: rejected, because the main page would not be indexable or fast on first load.
- **Pure SSR for everything**: rejected, because live timelines and charts are a poor fit for request-per-interaction rendering.
- **Separate frontends (static site plus SPA)**: rejected, because two codebases would duplicate the auth and BFF logic.
