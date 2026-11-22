# Design

## Context

`apps/web/` contains only a README. No Node project exists in the repository yet, so there is no workspace, lockfile or Node CI. The Supabase platform layer is applied to the hosted project. Its auth settings are done, except the URL configuration, which waits for the deployed URL (see proposal.md, Why).

Constraints that shape the approach:
- ADR 0003: the web app deploys natively on Vercel. It is not containerized.
- ADR 0008: `/` is SSR, `/playground/**` is CSR, and both modes come from Nuxt `routeRules`.
- ADR 0002: no Turborepo or Nx; the pnpm workspace is added now because this is the first Node project.
- The local machine runs Node 24.13.0, while Nuxt 4.6.4 requires `^24.15.0` (see Risks).

## Goals / Non-Goals

**Goals:**
- A production build that Vercel can deploy without configuration beyond the root directory.
- The rendering contract (SSR versus CSR), the headers and the health endpoint verified by automated tests against a real production build, not only by reading the config.
- A layout the auth change can extend: BFF routes under `server/`, and page content separated from markup.

**Non-Goals:**
- Visual design beyond a clean, readable baseline. There is no UI framework and no web fonts.
- Any runtime configuration or environment variables. The app reads none in this change.
- End-to-end browser tests. Playwright arrives with the interactive playground features.

## Decisions

### D1. Workspace layout

```
package.json            private root: packageManager pnpm@12.21.0, engines node >=24.15.0 <25
pnpm-workspace.yaml     packages: [apps/*] (+ build-script allowlist if pnpm asks for one)
pnpm-lock.yaml
apps/web/
  package.json          name "web", private, type module, engines node 24.x, exact pins
  nuxt.config.ts
  tsconfig.json         Nuxt 4 default (project references to .nuxt/tsconfig.*.json)
  vitest.config.ts
  app/
    app.vue             <html lang="en">, <NuxtLayout><NuxtPage/></NuxtLayout>
    error.vue           not-found and generic error page, link to "/"
    layouts/default.vue header (site name -> "/", "Playground" -> "/playground") and footer
    assets/css/main.css system font stack, light and dark via prefers-color-scheme
    content/profile.ts  owner-editable main page content (typed object, TODO(owner) markers)
    pages/index.vue                     SSR main page
    pages/playground/index.vue          hub
    pages/playground/payment.vue        placeholder
    pages/playground/dashboards.vue     placeholder
  server/api/health.get.ts              { status: "ok" }
  test/e2e/*.test.ts
```

Why `content/profile.ts`: the owner edits data, not markup. Every value in it is derived from facts already in the repository (the GitHub handle `gradiputera`, the repository link, the stack and what the project demonstrates). The introduction text is a visible placeholder ("Introduction coming soon.") marked `TODO(owner)`. Nothing personal is invented.

Alternatives: Nuxt Content (a Markdown CMS) is rejected as a heavy dependency for one page. Keeping the content inline in `index.vue` is rejected because it mixes the owner's text with layout.

### D2. Rendering and headers through `routeRules`

```ts
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
}
routeRules: {
  '/**':            { headers: securityHeaders },
  '/playground':    { ssr: false, headers: { 'X-Robots-Tag': 'noindex' } },
  '/playground/**': { ssr: false, headers: { 'X-Robots-Tag': 'noindex' } },
  '/api/health':    { headers: { 'Cache-Control': 'no-store' } },
}
```

`/playground` is listed next to `/playground/**` so the rule never depends on whether `**` matches zero segments. Nitro merges matching rules, so `/playground` gets both the security headers and `X-Robots-Tag`; the e2e tests check that. If they show that the headers are not merged, repeat `...securityHeaders` inside the specific rules. On Vercel, the Nitro `vercel` preset (detected automatically) turns these rules into Vercel route headers, so static assets carry them too.

Other settings: `compatibilityDate: '2026-11-21'`, `telemetry: false` (no prompt, nothing sent), `devtools: { enabled: false }`, `css: ['~/assets/css/main.css']`.

Not-found: Nuxt answers an unmatched SSR route with a 404 error and renders `app/error.vue`. Under `/playground/**` the server returns the SPA shell (HTTP 200), and the client router renders the same `error.vue`. The web-routing delta spells out this difference.

Alternatives: a `server/middleware` that sets headers is rejected, because route rules reach the Vercel CDN layer as well and stay declarative. `nuxt-security` is rejected for now: it is a full module with a CSP generator, and the CSP waits for the auth change.

### D3. Main page metadata and hydration

`index.vue` calls `useSeoMeta({ title, description })` from `profile.ts` values. The page renders only static data: no `Date.now()`, no randomness and no browser-only APIs during render, so hydration cannot mismatch (an ADR 0008 risk).

### D4. Tests: `@nuxt/test-utils` e2e against a production build

`test/e2e/*.test.ts` use `setup({ rootDir, server: true, build: true })` and `fetch`/`$fetch` from `@nuxt/test-utils/e2e`. This builds the app once and starts the real Nitro server, so the tests see the same output Vercel deploys. The assertions map one to one onto the spec scenarios:
- `/`: status 200; the HTML contains the introduction heading and `href="/playground"`; it has a non-empty `<title>` and meta description; there is no `X-Robots-Tag`.
- `/playground`, `/playground/payment`, `/playground/dashboards`: status 200; the HTML contains the empty mount point `<div id="__nuxt"></div>` and does not contain `href="/playground/payment"`, which proves the hub is not server-rendered; `X-Robots-Tag: noindex` is present.
- `/does-not-exist`: status 404.
- `/api/health`: status 200, body `{"status":"ok"}`, `Cache-Control: no-store`.
- The four security headers on `/`, `/playground` and `/api/health`.

The unknown-playground-path scenario renders only in a browser. It is checked by hand in the browser preview (tasks), not automated in this change.

Vitest config: `environment: 'node'`, `testTimeout: 60_000`, `hookTimeout: 300_000` (the build runs in `beforeAll`).

### D5. CI workflow `.github/workflows/web.yml`

It triggers on `push` to `main` and on `pull_request`, with paths `apps/web/**`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` and `.github/workflows/web.yml`. There is one job, `web-build`, on `ubuntu-latest` with a 15-minute timeout and `permissions: contents: read`:
1. `actions/checkout@v7`.
2. `pnpm/action-setup@v6`, which reads the version from `packageManager`.
3. `actions/setup-node@v7` with `node-version: 24` and `cache: pnpm`.
4. `pnpm install --frozen-lockfile`.
5. `pnpm --filter web typecheck`.
6. `pnpm --filter web test`.
7. `pnpm --filter web build`.

The action majors are the latest releases at the time of writing (checkout v7.0.1, setup-node v7.1.0, pnpm/action-setup v6.1.1). They match the major versions the existing workflows use.

### D6. Vercel (owner actions, documented in `apps/web/README.md`)

- Import the GitHub repository as a new Vercel Hobby project.
- Root Directory: `apps/web`. Vercel detects the Nuxt preset and installs from the workspace root lockfile.
- Production branch: `main`. Preview deployments come from pull requests, which is Vercel's default.
- Node.js version: 24.x. `apps/web/package.json` sets `engines.node` to `24.x`, which Vercel honours.
- Environment variable `ENABLE_EXPERIMENTAL_COREPACK=1`, so Vercel uses the exact pnpm version from `packageManager` (see Risks). It is a build flag, not a secret.
- Enable "Skip deployments when there are no changes to the root directory or its dependencies", so pull requests that touch only services or docs don't spend builds.
- After the first production deploy, the owner:
  - sets the Supabase Site URL and the redirect URL `https://<app>/auth/callback`;
  - adds the app origin to the Google client's JavaScript origins;
  - adds the hostname to the Turnstile widget.

The agent never runs the `vercel` CLI.

### Dependencies and licences

All versions are exact (no `^` or `~`):

| Package | Version | Licence | Why |
|---|---|---|---|
| `nuxt` | 4.6.4 | MIT | Framework chosen in ADR 0008 (SSR and CSR per route, Nitro server routes for the BFF) |
| `vue` | 3.5.46 | MIT | Nuxt runtime, pinned explicitly as the Nuxt starter does |
| `vue-router` | 5.5.1 | MIT | Nuxt router (Nuxt 4.6 requires `^5.4.0`) |
| `@nuxt/test-utils` (dev) | 4.4.0 | MIT | Builds and serves the app in tests (D4) |
| `vitest` (dev) | 5.1.1 | MIT | Test runner required by `@nuxt/test-utils` |
| `typescript` (dev) | 6.0.3 | Apache-2.0 | Needed by `nuxt typecheck`; 6.x, not 7.x (see Risks) |
| `vue-tsc` (dev) | 3.3.14 | MIT | Type-checks `.vue` files for `nuxt typecheck` |
| `pnpm` (packageManager) | 12.21.0 | MIT | Workspace package manager (ADR 0002) |

Transitive dependencies come with Nuxt. No UI library and no web fonts are added.

### Free-tier usage

On Vercel Hobby, `/` is a single server-rendered page and `/playground/**` is a static shell. Expected traffic is portfolio-scale, far below Hobby's bandwidth and function-invocation limits. Builds run only when `apps/web` or the workspace changes (D6). CI uses about 3 to 5 minutes of GitHub Actions per web pull request, which is free for public repositories. Supabase and Grafana are not touched.

## Risks / Trade-offs

- [Local Node 24.13 is below the `^24.15.0` that Nuxt 4.6 requires] → The first task upgrades Node with `winget upgrade --id OpenJS.NodeJS.LTS -e` and checks `node --version` is at least 24.15. CI and Vercel use the latest 24.x.
- [TypeScript 7 is the native (Go) compiler, and `vue-tsc` uses the JavaScript language-service API, so `nuxt typecheck` may not work with 7.x] → Pin `typescript@6.0.3`. If `nuxt typecheck` still fails for a reason the error ties to TypeScript, pin `5.9.3` and record that in the PR.
- [pnpm blocks dependency install scripts unless they are allowlisted, so Nuxt's native dependencies may not build] → Run `pnpm install`. If it reports ignored build scripts, add exactly those packages to the allowlist setting it names in `pnpm-workspace.yaml` (for example `onlyBuiltDependencies`), and install again.
- [Vercel may pick a different pnpm major from the lockfile version] → `ENABLE_EXPERIMENTAL_COREPACK=1` makes Vercel use `packageManager`. If the build log still shows a version mismatch, the owner removes the variable and sets the install command to `npx -y pnpm@12.21.0 install --frozen-lockfile`.
- [Nitro may not merge headers from overlapping route rules] → The e2e tests check every header on `/playground`. D2 gives the fallback (repeat the security headers in the specific rules).
- [Dependabot may not parse a pnpm 12 lockfile] → It only fails inside the Dependabot tab. CI and deploys are unaffected, and the version pins stay manual until it can.
- [The placeholder introduction is visible on the live site until the owner writes it] → It is one clearly marked string in `app/content/profile.ts`, and the README tells the owner where it is.

## Migration Plan

1. Merge the PR. The `web` check must pass, along with the existing secret scan.
2. The owner creates the Vercel project (D6), and its first production deploy builds `main`.
3. The owner checks `https://<app>/api/health`, then sets the Supabase URL configuration, the Google JavaScript origin and the Turnstile hostname.
4. Rollback: use Vercel's "Instant Rollback" to the previous deployment, or revert the merge commit through a new PR. Nothing else depends on the web app yet.
