# Proposal

## Why

The Supabase platform layer is live, but there is no web app yet. Several hosted settings wait for a real URL: the Supabase URL configuration, the Google JavaScript origin and the Turnstile hostname. Roadmap step 2 is split into two changes. This first change ships the Nuxt app skeleton with the route map from ADR 0008 and makes it deployable on Vercel, so the owner gets a live URL early. The auth flow and the BFF follow in the next change, on top of a working deployment.

Owning scope: **root** (`apps/web/`, the root pnpm workspace files, `.github/`). The web app is not one of the five services and has no `services/<svc>/` folder, so its changes live in the root `openspec/`.

## What Changes

- Add a pnpm workspace at the repository root, which ADR 0002 reserved for when the Node projects are actually built. It consists of `package.json` (private, with the pinned pnpm version and the Node engine range), `pnpm-workspace.yaml` (`apps/*`) and `pnpm-lock.yaml`.
- Add a Nuxt 4 application in `apps/web/`:
  - `/` is server-rendered: the owner's main page, with placeholder content the owner fills in and a prominent link to `/playground`;
  - `/playground` is client-rendered (`ssr: false`): the hub with two large links, Payment and Dashboards;
  - `/playground/payment` and `/playground/dashboards` are client-rendered placeholder pages that say the feature is coming and link back to the hub;
  - a not-found page that returns HTTP 404;
  - `GET /api/health`, which returns `{"status":"ok"}` as a first BFF server route;
  - baseline security headers on every response, and `X-Robots-Tag: noindex` on `/playground/**`.
- Add tests that check the rendering contract against a production build: `/` arrives server-rendered, `/playground/**` arrives as an empty application shell, and the health check, 404 and headers behave as specified.
- Add a CI workflow `.github/workflows/web.yml` that runs type checking, tests and a production build on every pull request that touches the web app or the workspace files.
- Add an `npm` entry to `.github/dependabot.yml` for the workspace.
- Expand `apps/web/README.md` with local development instructions and the **owner actions** for Vercel: creating the project with root directory `apps/web`, the production branch, preview deployments, and the follow-up hosted settings once the URL exists.

Out of scope:
- guest sign-in, Google sign-in, session cookies, `linkIdentity` and the identity header (the next change, "auth and BFF");
- any Supabase client, environment variables or runtime secrets (none are needed yet);
- the payment form, timeline, general ledger, DC/DRC panel and dashboards content (roadmap step 5 and the observability step);
- a Content Security Policy (it needs the final set of script sources, so it comes with the auth change);
- the owner's real biography, which only the owner writes;
- any Vercel or other cloud action: creating the Vercel project and production deploys are owner actions.

## Capabilities

### New Capabilities
- `web-hosting`: how the web app is built, verified and served: the Vercel deployment model (production from `main`, a preview per pull request), the CI gate, the health endpoint and the baseline security headers.

### Modified Capabilities
- `web-routing`: adds requirements for the not-found response and for keeping `/playground/**` out of search indexes. The existing route and rendering requirements stay unchanged; this change is their first implementation. The "Header shows the current identity" requirement is implemented by the next change.

## Impact

- New files:
  - `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` at the repository root;
  - `apps/web/` with the Nuxt app, its tests and `package.json`;
  - `.github/workflows/web.yml`.
- Changed files: `apps/web/README.md`, `.github/dependabot.yml`, and the roadmap status in the project `README.md`. `.gitignore` already covers `node_modules/`, `.nuxt/` and `.output/`.
- New dependencies, all pinned and MIT or Apache-2.0: Nuxt and its Vue runtime, plus the development tools Vitest, `@nuxt/test-utils`, `vue-tsc` and TypeScript. Each one is justified in `design.md`.
- Runtime: Node.js 26 LTS everywhere (local through nvm, CI, and Vercel, where it is generally available and the default). pnpm 12.21.0 is installed separately, because Node 26 no longer bundles Corepack.
- No ADR change is needed: the change implements ADR 0003 (Nuxt deploys natively on Vercel) and ADR 0008 (route rendering) as written.
- Owner actions are required to go live: create the Vercel project and connect the repository. After the first production deploy, update the Supabase URL configuration, the Google JavaScript origin and the Turnstile hostname.
