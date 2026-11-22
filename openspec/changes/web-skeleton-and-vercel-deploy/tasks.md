# Tasks

Verification note: the web tasks are verified with `pnpm --filter web typecheck`, `pnpm --filter web test` and `pnpm --filter web build`, run from the repository root. The `web` CI workflow from task 1.4 is the authoritative check on the pull request. Run the gitleaks scan before every commit. Never run the `vercel` CLI: every Vercel step is an owner action.

## 1. Toolchain, workspace and CI

- [ ] 1.1 Make sure the local Node.js version is at least 24.15.0 and below 25 (Nuxt 4.6.4 requires `^24.15.0`). If `node --version` prints a lower version, run `winget upgrade --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements` and open a new shell. Make pnpm 12.21.0 available with `corepack enable` and `corepack prepare pnpm@12.21.0 --activate`; if corepack is unavailable, run `npm install -g pnpm@12.21.0`. Verify: `node --version` prints 24.15 or newer, and `pnpm --version` prints `12.21.0`.
- [ ] 1.2 Create the root `package.json` per design D1: `"name": "gradi-playground"`, `"private": true`, `"packageManager": "pnpm@12.21.0"` and `"engines": { "node": ">=24.15.0 <25" }`. Create `pnpm-workspace.yaml` with `packages: ["apps/*"]`. Verify: `pnpm -r list --depth -1` runs without an error.
- [ ] 1.3 Create `apps/web/package.json` per design D1 and the dependency table in design.md. Set `"name": "web"`, `"private": true`, `"type": "module"` and `"engines": { "node": "24.x" }`, with these scripts: `dev` (`nuxt dev`), `build` (`nuxt build`), `preview` (`nuxt preview`), `postinstall` (`nuxt prepare`), `typecheck` (`nuxt typecheck`) and `test` (`vitest run`). Use exact versions with no `^`:
  - dependencies `nuxt@4.6.4`, `vue@3.5.46` and `vue-router@5.5.1`;
  - devDependencies `@nuxt/test-utils@4.4.0`, `vitest@5.1.1`, `typescript@6.0.3` and `vue-tsc@3.3.14`.

  Add the Nuxt 4 default `apps/web/tsconfig.json`, which contains only project references to `./.nuxt/tsconfig.app.json`, `./.nuxt/tsconfig.server.json`, `./.nuxt/tsconfig.shared.json` and `./.nuxt/tsconfig.node.json`, plus `"files": []`. Then run `pnpm install` at the root. If pnpm reports ignored build scripts, add exactly the packages it lists to the allowlist setting it names, in `pnpm-workspace.yaml`, and install again. Verify: `pnpm install --frozen-lockfile` succeeds, `pnpm-lock.yaml` exists at the root, and none of the versions in `apps/web/package.json` starts with `^` or `~`.
- [ ] 1.4 Add `.github/workflows/web.yml` per design D5, mirroring the style of `.github/workflows/supabase.yml`. Use the same path filters for push to `main` and for `pull_request`, and add one job `web-build` with the 7 steps. Verify: the YAML parses (`node -e "require('fs').readFileSync('.github/workflows/web.yml','utf8')"` plus `npx -y yaml-lint@1.7.0 .github/workflows/web.yml`). The job only runs green after group 2, on the pull request.
- [ ] 1.5 Add an `npm` entry to `.github/dependabot.yml`: `directory: /`, weekly, `open-pull-requests-limit: 5`, and a group `nuxt` with the patterns `nuxt`, `vue`, `vue-router` and `@nuxt/*`. Keep the existing `github-actions` entry unchanged. Verify: `npx -y yaml-lint@1.7.0 .github/dependabot.yml` passes.

## 2. Nuxt application (specs: web-routing, web-hosting)

- [ ] 2.1 Create `apps/web/nuxt.config.ts` exactly per design D2: `compatibilityDate: '2026-11-21'`, `telemetry: false`, `devtools: { enabled: false }`, `css: ['~/assets/css/main.css']`, and the four `routeRules` with the shared `securityHeaders` object. Verify: `pnpm --filter web build` succeeds. It may need the files from task 2.2 to exist first; if so, create them and run the build after 2.2.
- [ ] 2.2 Create the app files per design D1 and D3:
  - `app/app.vue`: `useHead({ htmlAttrs: { lang: 'en' } })`, `<NuxtLayout><NuxtPage /></NuxtLayout>`.
  - `app/layouts/default.vue`: a header with the site name `gradi-playground` linking to `/` and a `Playground` link to `/playground`; a footer with the repository link `https://github.com/gradiputera/gradi-playground` and "MIT License".
  - `app/assets/css/main.css`: a system font stack, a readable max width, and light and dark colours through `prefers-color-scheme`. No web fonts and no external URLs.
  - `app/content/profile.ts`: an exported typed object with:
    - `name: 'gradiputera'`;
    - `headline: 'Engineering portfolio and playground'`;
    - `intro: 'Introduction coming soon.'`, with a `// TODO(owner): write your introduction` comment above it;
    - `demonstrates`: the "What this demonstrates" bullets from the root `README.md`, shortened;
    - `stack`: Java 25 / Vert.x, PHP 8.4 / Laravel, Go, Node.js 24 / Hono, Python 3.13 / FastAPI, Nuxt, Supabase, OpenTelemetry;
    - `links`: GitHub profile `https://github.com/gradiputera` and the repository URL;
    - `seo`: title `gradiputera · gradi-playground` and a one-sentence description.

    Do not invent any other personal detail.
  - `app/pages/index.vue`: an `<h1>` with the name, the headline and the intro, the "What this demonstrates" list, the stack list, the links, and a prominent `<NuxtLink to="/playground">Open the playground</NuxtLink>`. Call `useSeoMeta({ title, description })` from `profile.seo`. Render no dates, random values or browser-only APIs.
  - `app/pages/playground/index.vue`: a heading "Playground" and two large card links, `<NuxtLink to="/playground/payment">Payment</NuxtLink>` and `<NuxtLink to="/playground/dashboards">Dashboards</NuxtLink>`, each with a one-line description.
  - `app/pages/playground/payment.vue` and `app/pages/playground/dashboards.vue`: a heading, a "Coming soon" sentence describing the planned feature (from `apps/web/README.md`), and a link back to `/playground`.
  - `app/error.vue`: shows "Page not found" for status 404, or a generic message otherwise, with a link to `/` that calls `clearError({ redirect: '/' })`.

  Verify: `pnpm --filter web typecheck` and `pnpm --filter web build` succeed.
- [ ] 2.3 Create `apps/web/server/api/health.get.ts`, returning `{ status: 'ok' }` from `defineEventHandler`, and reading no config, environment or network. Verify: the build succeeds and the route appears in the build output.
- [ ] 2.4 Run `git status` after the build. If the build left untracked generated folders that are not ignored (for example `apps/web/.nitro/` or `apps/web/.cache/`), add them to the root `.gitignore`. Verify: after `pnpm --filter web build`, `git status --porcelain` shows only source files.

## 3. Tests (specs: web-routing, web-hosting)

- [ ] 3.1 Create `apps/web/vitest.config.ts` per design D4: `defineConfig` from `vitest/config`, `environment: 'node'`, `testTimeout: 60_000`, `hookTimeout: 300_000`, and `include: ['test/**/*.test.ts']`. Verify: `pnpm --filter web test` starts and finds the test files (after task 3.2).
- [ ] 3.2 Create `apps/web/test/e2e/rendering.test.ts`, `apps/web/test/e2e/hosting.test.ts` and `apps/web/test/e2e/not-found.test.ts`. Each file calls `await setup({ rootDir: fileURLToPath(new URL('../..', import.meta.url)), server: true, build: true })` from `@nuxt/test-utils/e2e` and uses its `fetch`. Cover every assertion listed in design D4: the SSR `/`, the CSR shell for the three playground routes, `X-Robots-Tag` present on the playground and absent on `/`, the title and meta description, 404 on `/does-not-exist`, the health body and `Cache-Control`, and the four security headers on `/`, `/playground` and `/api/health`. If the playground header test shows that headers are not merged, apply the fallback in design D2 (repeat `...securityHeaders` in the specific rules) and re-run. Verify: `pnpm --filter web test` passes.
- [ ] 3.3 Check the unknown-playground-path scenario by hand. Run `pnpm --filter web build`, then `pnpm --filter web preview` in the background, and open `http://localhost:3000/playground/does-not-exist` in the built-in browser. Stop the preview server afterwards. Verify: the page shows "Page not found" with a link to `/`. Also open `/` and `/playground` and confirm there are no hydration warnings in the browser console. Record the result in the PR description.

## 4. Documentation

- [ ] 4.1 Rewrite `apps/web/README.md`. Set Status to "In progress: skeleton deployed from this change; auth and BFF follow". Keep the route map, BFF responsibilities and data flow sections. Add these sections:
  - "Layout", the D1 tree;
  - "Local development": Node 24.15+ and pnpm 12.21.0, then the commands below, run from the repository root:
    ```powershell
    pnpm install
    pnpm --filter web dev
    pnpm --filter web test
    pnpm --filter web build
    ```
  - "Editing the main page": `app/content/profile.ts` and the `TODO(owner)` intro;
  - "Vercel setup (owner actions)", with the steps in design D6, including `ENABLE_EXPERIMENTAL_COREPACK=1`, the skip-unchanged setting and the three follow-up hosted settings (Supabase URL configuration with `https://<app>/auth/callback`, Google JavaScript origin, Turnstile hostname). Say that the agent never runs the Vercel CLI.

  Verify: every relative link in the file points to an existing file, and the documented commands are the ones used in the tasks above.
- [ ] 4.2 Update the root `README.md` roadmap table: item 1 "Done" and item 2 "In progress". Change the sentence above the table so it no longer says that nothing is implemented. Verify: the table renders, and its statuses match this sentence.

## 5. Integration check

- [ ] 5.1 From a clean state (delete `apps/web/.nuxt` and `apps/web/.output`), run `pnpm install --frozen-lockfile`, then `pnpm --filter web typecheck`, `pnpm --filter web test` and `pnpm --filter web build`, then the gitleaks scan, then `npx -y @fission-ai/openspec@latest validate --all --strict`. Verify: all of them exit 0, and `git ls-files` contains no `.env`, `node_modules`, `.nuxt` or `.output` path.

## Workflow follow-up

- Open one pull request for this change. After the `web-build`, `database-tests` (if triggered) and secret-scan checks pass, the owner merges it.
- Owner: create the Vercel project and finish the hosted settings as described in `apps/web/README.md`.
- Archive the change after the first successful production deploy.
