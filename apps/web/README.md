# apps/web

Nuxt web application: the public main page (SSR), the CSR playground, and the backend-for-frontend (BFF) that handles OAuth callbacks, site routing, observability proxying and sandbox reset fan-out. Deploys natively on Vercel.

## Status

In progress: the main page, the playground hub and placeholder pages, the health endpoint, and guest and Google sign-in through the BFF are implemented and tested. The payment and dashboards features follow in later roadmap steps.

## Layout

| Path | Purpose |
|---|---|
| `nuxt.config.ts` | Rendering per route, response headers and runtime configuration |
| `app/content/profile.ts` | Main page content, edited by the owner |
| `app/pages/` | `/` (SSR) and `/playground/**` (CSR) |
| `app/layouts/default.vue` | Header and footer of the main page |
| `app/layouts/playground.vue` | Playground shell: guest session, identity header |
| `app/composables/useAuth.ts` | Browser view of the identity (no tokens) |
| `app/components/TurnstileWidget.vue` | Cloudflare Turnstile check before guest sign-in |
| `app/error.vue` | Not-found and error page |
| `server/utils/` | Server-only Supabase client, cookie options, OAuth `state` |
| `server/api/` | BFF API routes: `GET /api/health` and `/api/auth/*` |
| `server/routes/auth/` | Browser navigations: `GET /auth/google` and `GET /auth/callback` |
| `test/e2e/` | Tests against a production build (`auth.test.ts` also needs local Supabase) |

## Authentication (BFF)

The browser never talks to Supabase. The BFF keeps the session in `httpOnly`, `Secure`, `SameSite=Lax` cookies and tells the browser only whether the visitor is a guest or a Google user. See [the auth model](../../docs/security/auth.md).

| Endpoint | Purpose |
|---|---|
| `GET /api/auth/session` | `{"authenticated": false}` or the identity kind and display name |
| `POST /api/auth/guest` | Create a guest (anonymous) session; same-origin only |
| `POST /api/auth/logout` | Revoke the session and clear the cookies; same-origin only |
| `GET /auth/google` | Start Google sign-in (PKCE and `state`); a guest links Google to the same user |
| `GET /auth/callback` | Check `state`, exchange the code, set the session |

## Environment variables

| Variable | Where it is used | Local value |
|---|---|---|
| `NUXT_SUPABASE_URL` | Server only | `http://127.0.0.1:54321` |
| `NUXT_SUPABASE_KEY` | Server only: the Supabase **publishable** key, never the secret or service role key | `PUBLISHABLE_KEY` from `supabase status -o env` |
| `NUXT_PUBLIC_TURNSTILE_SITE_KEY` | Browser: the Turnstile site key | empty (the local stack has CAPTCHA off) |

Copy `.env.example` to `.env` in this folder for `pnpm --filter web dev`. The file is gitignored.

## Local development

Prerequisites: Node.js 26 (the current LTS, for example through nvm), pnpm 12.21.0 (`npm install -g pnpm@12.21.0`), and Docker Desktop for the local Supabase stack. Run from the repository root:

```powershell
npx -y supabase@3.2.0 start
npx -y supabase@3.2.0 status -o env   # copy API_URL and PUBLISHABLE_KEY into apps/web/.env
pnpm install
pnpm --filter web dev                  # http://localhost:3000
pnpm --filter web typecheck
pnpm --filter web build
```

## Tests

`pnpm --filter web test` builds the app and runs both test files against the production server. `auth.test.ts` needs the local Supabase stack and the two server variables in the shell:

```powershell
$env:NUXT_SUPABASE_URL = "http://127.0.0.1:54321"
$env:NUXT_SUPABASE_KEY = "<PUBLISHABLE_KEY from supabase status -o env>"
pnpm --filter web test
```

Without Docker, run only the routing tests with `pnpm --filter web exec vitest run test/e2e/web.test.ts`; the `web` CI workflow always runs both against a local Supabase stack.

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

### Authentication variables (owner actions)

In Project Settings > Environment Variables, for the Production environment:

| Variable | Value |
|---|---|
| `NUXT_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `NUXT_SUPABASE_KEY` | The publishable key from Supabase, Project Settings > API Keys (starts with `sb_publishable_`) |
| `NUXT_PUBLIC_TURNSTILE_SITE_KEY` | The site key of the Turnstile widget in Cloudflare |

Redeploy, then check on the production URL:

1. Open `/playground` in a private window: the header shows "guest" after the Turnstile check.
2. Select "Sign in with Google" and finish consent: the header shows your Google name and "Sign out".
3. Select "Sign out": you return to the main page; opening `/playground` again starts a new guest session.
4. Open `/playground` in a new private window and sign in with Google again: you reach the same account (the returning-user path).

Preview deployments have no Supabase variables, so their auth endpoints answer 503; the rest of the site works.

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
