# apps/web

Nuxt web application: the public main page (SSR), the CSR playground, and the backend-for-frontend (BFF) that handles OAuth callbacks, site routing, observability proxying and sandbox reset fan-out. Deploys natively on Vercel.

## Status

In progress: the skeleton (main page, playground hub, placeholder pages, health endpoint) is implemented and tested. Guest and Google sign-in and the BFF session follow in the next change.

## Layout

| Path | Purpose |
|---|---|
| `nuxt.config.ts` | Rendering per route and response headers |
| `app/content/profile.ts` | Main page content, edited by the owner |
| `app/pages/` | `/` (SSR) and `/playground/**` (CSR) |
| `app/layouts/default.vue` | Header and footer |
| `app/error.vue` | Not-found and error page |
| `server/api/` | BFF server routes (`GET /api/health` for now) |
| `test/e2e/` | Tests against a production build |

## Local development

Prerequisites: Node.js 26 (the current LTS, for example through nvm) and pnpm 12.21.0 (`npm install -g pnpm@12.21.0`). Run from the repository root:

```powershell
pnpm install
pnpm --filter web dev        # http://localhost:3000
pnpm --filter web typecheck
pnpm --filter web test       # builds the app and tests the production server
pnpm --filter web build
```

## Editing the main page

The main page text lives in `app/content/profile.ts`. Replace the `TODO(owner)` introduction and adjust the other fields; the layout picks them up.

## Vercel setup (owner actions)

The agent never runs the Vercel CLI. In the Vercel dashboard:

1. Add a new project and import the `gradi-playground` GitHub repository.
2. Set **Root Directory** to `apps/web`. The framework preset is detected as Nuxt.
3. Add the environment variable `ENABLE_EXPERIMENTAL_COREPACK` with value `1` (a build flag, not a secret), so the build uses pnpm 12.21.0 from `package.json`.
4. Deploy. The production branch is `main`; every pull request gets a preview deployment.
5. In Project Settings, enable "Skip deployments when there are no changes to the root directory or its dependencies".
6. Open `https://<app>/api/health` and check it returns `{"status":"ok"}`.

If the build log shows another pnpm version or an install error, set the Install Command to `npx -y pnpm@12.21.0 install --frozen-lockfile` and redeploy.

After the first production deploy, update the hosted settings with the app URL:

- Supabase, Authentication > URL Configuration: Site URL `https://<app>`, redirect URL `https://<app>/auth/callback`.
- Google Cloud, the OAuth client: add `https://<app>` to Authorized JavaScript origins.
- Cloudflare Turnstile, the widget: add the app hostname.

## Route map

| Route | Rendering | Content |
|---|---|---|
| `/` | SSR | Main page about the owner, link to the playground |
| `/playground` | CSR | Hub: Payment and Dashboards |
| `/playground/payment` | CSR | Payment form, live timeline, general ledger, DC/DRC panel, reset to seed |
| `/playground/dashboards` | CSR | Native charts, logs panel, link to Grafana |

The rendering decision is in [ADR 0008](../../architecture/adr/0008-hybrid-rendering-ssr-and-csr.md).

## BFF responsibilities

- **Auth callback**: starts the PKCE sign-in, checks `state`, exchanges the code and sets session cookies. See [auth model](../../docs/security/auth.md).
- **Session**: refreshes tokens and handles logout. Tokens never reach browser JavaScript.
- **Site router**: sets the logical site (`DC` or `DRC`) and propagates it in W3C `baggage` together with `traceparent`.
- **Observability proxy**: `/api/observability/*` runs whitelisted PromQL and LogQL templates with validated parameters against Grafana Cloud, using a read-only token kept on the server.
- **Sandbox reset fan-out**: calls `POST /sandbox/reset` on every service in parallel and reports progress per service.

## Data flows

### Payment

1. The form sends the amount, currency, scenario and recipient email to the BFF.
2. The BFF calls payment-service with an idempotency key and the site.
3. The timeline is updated from the trace and the service responses: payment, ledger posting, outbox, pgmq, dispatcher, notification (email sent or bounced) and reporting.
4. The general ledger section refreshes after each transaction.

### Dashboards

1. The page requests a chart or a log query from `/api/observability/*`.
2. The BFF validates the parameters and runs the matching whitelisted template.
3. Results are cached briefly and returned as data; no Grafana iframe is used, because Grafana Cloud Free blocks embedding.

## Related

- [ADR 0008: Hybrid SSR and CSR rendering](../../architecture/adr/0008-hybrid-rendering-ssr-and-csr.md)
- [ADR 0007: OAuth2/OIDC with Supabase Auth](../../architecture/adr/0007-oauth2-oidc-with-supabase-auth.md)
- [ADR 0010: Native observability charts via BFF](../../architecture/adr/0010-native-observability-charts-via-bff.md)
- [ADR 0003: Service per Vercel project](../../architecture/adr/0003-service-per-vercel-project-as-containers.md)
