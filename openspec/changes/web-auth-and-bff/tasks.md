# Tasks

Execution rules (read first):
- Work on branch `feat/web-auth-and-bff` in `D:\Git\Gradi\gradi-playground`. It already holds the proposal commit. Run every command from the repository root unless a task says otherwise. Use Bash (Git Bash) syntax as written below.
- Copy files **exactly** from the Appendix of `design.md` (A1 to A22). Do not change versions, names or wording. Do not add files, dependencies or features that are not listed.
- After finishing each task, change its `- [ ]` to `- [x]` in this file.
- Secret scan before every commit:
  ```bash
  "/c/Users/vsiss/AppData/Local/Microsoft/WinGet/Packages/Gitleaks.Gitleaks_Microsoft.Winget.Source_8wekyb3d8bbwe/gitleaks.exe" detect --source . --no-git --redact
  ```
  It must print `no leaks found` and exit 0. The repository-local git identity is already configured; do not change git config.
- Every commit message ends with a blank line and the attribution line your harness provides; if it provides none, use `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Never run the `vercel` CLI, `supabase db push`, `supabase link`, `terraform`, a force push, or any command against a hosted service. Never read or create `.env` files (only `.env.example`). Never print keys other than the local publishable key.
- Stop and report (do not guess or work around) only if:
  - a command in a task fails twice after re-reading the task;
  - a test still fails after the files match the Appendix exactly;
  - the `web-build` check fails on the pull request.

## 1. Dependencies

- [x] 1.1 Check the toolchain and the branch. `node --version` must start with `v26.`, `pnpm --version` must print `12.21.0`, and `git branch --show-current` must print `feat/web-auth-and-bff`. Verify: all three outputs match.
- [x] 1.2 Run `pnpm add --filter web @supabase/ssr@0.12.7 @supabase/supabase-js@2.119.2 --save-exact`. Verify:
  - `apps/web/package.json` equals A1 exactly (compare line by line);
  - `pnpm install --frozen-lockfile` exits 0;
  - `git status --porcelain` lists only `apps/web/package.json` and `pnpm-lock.yaml`.
- [x] 1.3 Commit group 1: run the secret scan, then `git add apps/web/package.json pnpm-lock.yaml openspec/changes/web-auth-and-bff/tasks.md`, and commit with message `build(web): add Supabase server client dependencies`. Verify: `git status --porcelain` is empty.

## 2. BFF auth endpoints (spec: auth)

- [x] 2.1 Replace `apps/web/nuxt.config.ts` with A2. Create `apps/web/server/utils/supabase.ts` (A4) and `apps/web/server/utils/oauth-state.ts` (A5). Verify: `pnpm --filter web typecheck` exits 0.
- [x] 2.2 Create the endpoints:
  - `apps/web/server/api/auth/session.get.ts` (A6);
  - `apps/web/server/api/auth/guest.post.ts` (A7);
  - `apps/web/server/api/auth/logout.post.ts` (A8);
  - `apps/web/server/routes/auth/google.get.ts` (A9);
  - `apps/web/server/routes/auth/callback.get.ts` (A10).

  Verify: `pnpm --filter web typecheck` exits 0, and `pnpm --filter web build` ends with `Build complete`.
- [x] 2.3 Commit group 2: run the secret scan, then `git add apps/web/nuxt.config.ts apps/web/server openspec/changes/web-auth-and-bff/tasks.md`, and commit with message `feat(web): add BFF auth endpoints`. Verify: `git status --porcelain` is empty.

## 3. Playground shell (specs: auth, web-routing)

- [ ] 3.1 Create these files:
  - `apps/web/app/composables/useAuth.ts` (A11);
  - `apps/web/app/components/TurnstileWidget.vue` (A12);
  - `apps/web/app/layouts/playground.vue` (A13).

  Replace these files:
  - `apps/web/app/pages/playground/index.vue` (A14);
  - `apps/web/app/pages/playground/payment.vue` (A15);
  - `apps/web/app/pages/playground/dashboards.vue` (A16);
  - `apps/web/app/assets/css/main.css` (A17).

  Verify: `pnpm --filter web typecheck` exits 0, and `pnpm --filter web exec vitest run test/e2e/web.test.ts` prints `Tests  11 passed (11)`.
- [ ] 3.2 Commit group 3: run the secret scan, then `git add apps/web/app openspec/changes/web-auth-and-bff/tasks.md`, and commit with message `feat(web): guest session and identity header in the playground`. Verify: `git status --porcelain` is empty.

## 4. Auth tests and CI (specs: auth, web-routing)

- [ ] 4.1 Replace `apps/web/vitest.config.ts` with A3, create `apps/web/test/e2e/auth.test.ts` (A18), and replace `.github/workflows/web.yml` with A19. Verify: `npx -y yaml-lint@1.7.0 .github/workflows/web.yml` reports the file as valid.
- [ ] 4.2 Run the auth tests locally if Docker is available:
  1. Run `docker info`. If it fails, skip the remaining steps, write down "local auth tests not run (Docker unavailable); CI is authoritative" for the PR, and go to task 4.3.
  2. Run `npx -y supabase@3.2.0 status`. If it reports the stack is running, remember that, so you do not stop it afterwards.
  3. If the stack is not running, start it:
     ```bash
     SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID=ci-dummy-client-id SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET=ci-dummy-secret SUPABASE_AUTH_CAPTCHA_SECRET=ci-dummy-captcha npx -y supabase@3.2.0 start -x realtime,storage-api,imgproxy,mailpit,studio,edge-runtime,logflare,vector,supavisor
     ```
  4. Run the tests:
     ```bash
     eval "$(npx -y supabase@3.2.0 status -o env)"
     NUXT_SUPABASE_URL="$API_URL" NUXT_SUPABASE_KEY="$PUBLISHABLE_KEY" pnpm --filter web test
     ```
  5. If you started the stack in step 3, stop it with `npx -y supabase@3.2.0 stop`.

  Verify: the test run prints `Tests  25 passed (25)`, or the "not run" note is written down.
- [ ] 4.3 Commit group 4: run the secret scan, then `git add apps/web/vitest.config.ts apps/web/test .github/workflows/web.yml openspec/changes/web-auth-and-bff/tasks.md`, and commit with message `test(web): verify auth flows against local Supabase in CI`. Verify: `git status --porcelain` is empty.

## 5. Documentation

- [ ] 5.1 Make the documentation changes:
  - create `apps/web/.env.example` (A20);
  - replace `apps/web/README.md` with A21;
  - make the two edits to `docs/security/auth.md` described in A22.

  Verify:
  - `git check-ignore -q apps/web/.env` exits 0 (ignored);
  - `git check-ignore -q apps/web/.env.example` exits 1 (not ignored);
  - `grep -c "^## " docs/security/auth.md` prints `15`;
  - every relative link in both Markdown files points to an existing file.
- [ ] 5.2 Commit group 5: run the secret scan, then `git add apps/web/.env.example apps/web/README.md docs/security/auth.md openspec/changes/web-auth-and-bff/tasks.md`, and commit with message `docs(web): auth endpoints, environment and owner setup`. Verify: `git status --porcelain` is empty.

## 6. Integration check and pull request

- [ ] 6.1 Run the full check from a clean state:
  ```bash
  rm -rf apps/web/.nuxt apps/web/.output
  pnpm install --frozen-lockfile
  pnpm --filter web typecheck
  pnpm --filter web exec vitest run test/e2e/web.test.ts
  pnpm --filter web build
  npx -y @fission-ai/openspec@latest validate --all --strict
  ```
  Then run the secret scan. Verify: every command exits 0, and `git ls-files | grep -E "(^|/)(\.env|node_modules|\.nuxt|\.output)(/|$)"` prints nothing. `apps/web/.env.example` does not match this pattern.
- [ ] 6.2 Mark this task `- [x]`, commit `openspec/changes/web-auth-and-bff/tasks.md` with message `docs(openspec): complete web-auth-and-bff tasks` (after the secret scan), then run `git push -u origin feat/web-auth-and-bff`. Open the pull request with `gh pr create --base main --head feat/web-auth-and-bff --title "feat(web): guest and Google sign-in through the BFF" --body-file <file>`. Write the body file in the scratchpad or system temp directory, not in the repository. The body has:
  - `## Summary`: bullets for the server-only Supabase client, the five auth endpoints, the cross-site and caching rules, the playground shell and identity header, the auth tests, the CI change and the docs;
  - `## Decisions`: a link to ADR 0007 and the OpenSpec change folder;
  - `## Checks`: typecheck, the routing tests, the local auth test result from task 4.2 (`25 passed`, or "not run"), build, `openspec validate --all --strict`, and the gitleaks result;
  - `## Owner actions`: "Add the three Vercel variables and run the four manual checks described in apps/web/README.md, section Authentication variables";
  - the PR attribution line your harness provides at the end.

  Then wait for the checks with `gh pr checks --watch --interval 30`. Do not merge the pull request. Verify: `gh pr checks` shows `web-build` as `pass`. If it fails, stop and report the failing step's log (`gh run view <run-id> --log-failed`).

## Workflow follow-up

- The owner merges the pull request after `web-build` and gitleaks pass.
- The owner adds the Vercel variables and runs the manual checks.
- Archive the change after the manual checks pass on production.
