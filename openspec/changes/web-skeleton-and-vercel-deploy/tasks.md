# Tasks

Execution rules (read first):
- Work on branch `feat/web-skeleton-and-vercel-deploy` in `D:\Git\Gradi\gradi-playground`. It already holds the proposal commit. Run every command from the repository root unless a task says otherwise. Bash (Git Bash) and PowerShell both work; the commands below are written for Bash.
- Copy files **exactly** from the Appendix of `design.md` (A1 to A20). Do not change versions, names or wording. Do not add files, dependencies or features that are not listed.
- After finishing each task, change its `- [ ]` to `- [x]` in this file.
- Secret scan before every commit:
  ```bash
  "/c/Users/vsiss/AppData/Local/Microsoft/WinGet/Packages/Gitleaks.Gitleaks_Microsoft.Winget.Source_8wekyb3d8bbwe/gitleaks.exe" detect --source . --no-git --redact
  ```
  It must print `no leaks found` and exit 0. The repository-local git identity is already configured; do not change git config.
- Every commit message ends with a blank line and the attribution line your harness provides; if it provides none, use `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Never run the `vercel` CLI, `supabase db push`, `terraform`, a force push, or any command against a hosted service. Never read `.env` files.
- Stop and report (do not guess or work around) only if:
  - a command in a task fails twice after re-reading the task;
  - a test still fails after the files match the Appendix exactly;
  - `node --version` is not v26 and `nvm use` fails.

## 1. Toolchain, workspace and CI

- [x] 1.1 Check the toolchain. Run `node --version`; it must start with `v26.`. If it does not, run `nvm install 26.13.1` and then `nvm use 26.13.1`, and open a new shell. If `nvm use` fails (for example, it needs an administrator shell), stop and report that the owner must run it. Then run `pnpm --version`; if it does not print `12.21.0`, run `npm install -g pnpm@12.21.0` and check again. Verify: `node --version` starts with `v26.` and `pnpm --version` prints `12.21.0`.
- [x] 1.2 Create `package.json` (A1), `pnpm-workspace.yaml` (A2), `apps/web/package.json` (A3), `apps/web/tsconfig.json` (A4), `apps/web/nuxt.config.ts` (A5) and `apps/web/vitest.config.ts` (A6), each copied exactly from design.md. Verify: `git status --porcelain` lists these 6 new files, and `grep -E '"[~^][0-9]' apps/web/package.json` prints nothing.
- [x] 1.3 Run `pnpm install`. It ends with `Done` and runs `nuxt prepare`. Verify: `pnpm install --frozen-lockfile` exits 0, `pnpm-lock.yaml` exists at the root and starts with `lockfileVersion: '9.0'`, and `git status --porcelain` does not list `node_modules` or `apps/web/.nuxt` (both are already ignored by `.gitignore`).
- [x] 1.4 Create `.github/workflows/web.yml` (A18) exactly. Append the Dependabot entry (A19) to `.github/dependabot.yml`, after the existing `github-actions` entry, and keep that entry unchanged. Verify: `npx -y yaml-lint@1.7.0 .github/workflows/web.yml .github/dependabot.yml` reports both files as valid.
- [x] 1.5 Commit group 1: run the secret scan, then
  ```bash
  git add package.json pnpm-workspace.yaml pnpm-lock.yaml apps/web/package.json apps/web/tsconfig.json apps/web/nuxt.config.ts apps/web/vitest.config.ts .github/workflows/web.yml .github/dependabot.yml openspec/changes/web-skeleton-and-vercel-deploy/tasks.md
  ```
  and commit with message `build(web): add pnpm workspace, Nuxt manifest and web CI`. Verify: `git status --porcelain` is empty, and `git log --oneline -1` shows the commit.

## 2. Nuxt application (specs: web-routing, web-hosting)

- [x] 2.1 Create the application files exactly from design.md:
  - `apps/web/app/app.vue` (A7);
  - `apps/web/app/layouts/default.vue` (A8);
  - `apps/web/app/assets/css/main.css` (A9);
  - `apps/web/app/content/profile.ts` (A10);
  - `apps/web/app/pages/index.vue` (A11);
  - `apps/web/app/pages/playground/index.vue` (A12);
  - `apps/web/app/pages/playground/payment.vue` (A13);
  - `apps/web/app/pages/playground/dashboards.vue` (A14);
  - `apps/web/app/error.vue` (A15).

  Verify: `pnpm --filter web typecheck` exits 0.
- [x] 2.2 Create `apps/web/server/api/health.get.ts` (A16). Verify: `pnpm --filter web build` ends with `Build complete`, its file list includes `.output/server/chunks/routes/api/health.get.mjs`, and `git status --porcelain` afterwards does not list `apps/web/.output`.
- [x] 2.3 Commit group 2: run the secret scan, then `git add apps/web/app apps/web/server openspec/changes/web-skeleton-and-vercel-deploy/tasks.md`, and commit with message `feat(web): add SSR main page, CSR playground and health endpoint`. Verify: `git status --porcelain` is empty.

## 3. Tests (specs: web-routing, web-hosting)

- [ ] 3.1 Create `apps/web/test/e2e/web.test.ts` (A17) exactly. Verify: `pnpm --filter web test` prints `Tests  11 passed (11)` and exits 0. If a test fails, compare the files with the Appendix character by character and fix any difference. Do not change the test to make it pass.
- [ ] 3.2 Check the unknown-playground-path scenario by hand:
  1. Run `pnpm --filter web build`.
  2. Start the server in the background with `node apps/web/.output/server/index.mjs`. It listens on `http://localhost:3000`.
  3. Open `http://localhost:3000/playground/does-not-exist` in a browser tool, if you have one (for example the built-in browser pane). Confirm the page shows "Page not found" with a "Back to the main page" link.
  4. Open `http://localhost:3000/` and `http://localhost:3000/playground`, and confirm the browser console shows no hydration warning.
  5. Stop the server.

  If no browser tool is available, skip steps 3 and 4 and note "manual browser check not run" for the PR description. Verify: the result (passed, or not run) is written down for task 5.2.
- [ ] 3.3 Commit group 3: run the secret scan, then `git add apps/web/test openspec/changes/web-skeleton-and-vercel-deploy/tasks.md`, and commit with message `test(web): verify rendering, headers and health against a production build`. Verify: `git status --porcelain` is empty.

## 4. Documentation

- [ ] 4.1 Update `apps/web/README.md` as described in A20: replace the Status body, insert the four new sections between `## Status` and `## Route map`, and add the ADR 0003 line to `## Related`. Leave all other sections unchanged. Verify: `grep -c "^## " apps/web/README.md` prints `9`, and every relative link in the file points to an existing file.
- [ ] 4.2 Update the root `README.md` roadmap:
  - replace the line `All items are planned; none is implemented yet.` with `Items are delivered one OpenSpec change at a time.`;
  - in the table, change the status of row 1 from `Planned` to `Done`;
  - change the status of row 2 from `Planned` to `In progress`.

  Verify: `grep -n "| 1 |" README.md` ends with `| Done |`, and `grep -n "| 2 |" README.md` ends with `| In progress |`.
- [ ] 4.3 Commit group 4: run the secret scan, then `git add apps/web/README.md README.md openspec/changes/web-skeleton-and-vercel-deploy/tasks.md`, and commit with message `docs(web): document local development and Vercel setup`. Verify: `git status --porcelain` is empty.

## 5. Integration check and pull request

- [ ] 5.1 Run the full check from a clean state:
  ```bash
  rm -rf apps/web/.nuxt apps/web/.output
  pnpm install --frozen-lockfile
  pnpm --filter web typecheck
  pnpm --filter web test
  pnpm --filter web build
  npx -y @fission-ai/openspec@latest validate --all --strict
  ```
  Then run the secret scan. Verify: every command exits 0, and `git ls-files | grep -E "(^|/)(\.env|node_modules|\.nuxt|\.output)(/|$)"` prints nothing.
- [ ] 5.2 Mark this task `- [x]`, commit `openspec/changes/web-skeleton-and-vercel-deploy/tasks.md` with message `docs(openspec): complete web-skeleton-and-vercel-deploy tasks` (after the secret scan), then run `git push -u origin feat/web-skeleton-and-vercel-deploy`. Open the pull request with `gh pr create --base main --head feat/web-skeleton-and-vercel-deploy --title "feat(web): Nuxt skeleton and Vercel deploy" --body-file <file>`. Write the body file in the scratchpad or system temp directory, not in the repository. The body has:
  - `## Summary`: bullets for the workspace, the SSR main page, the CSR playground hub and placeholders, the health endpoint, the headers, the tests, CI and the docs;
  - `## Decisions`: links to ADR 0003 and ADR 0008, plus the OpenSpec change folder;
  - `## Checks`: typecheck, `Tests 11 passed`, build, `openspec validate --all --strict`, the gitleaks result, and the manual browser check result from task 3.2;
  - `## Owner actions`: "Create the Vercel project as described in apps/web/README.md, then update the Supabase URL configuration, Google JavaScript origin and Turnstile hostname";
  - the PR attribution line your harness provides at the end.

  Do not merge the pull request. Verify: `gh pr view --json url,state` prints the URL with state `OPEN`, and `gh pr checks` lists `web-build`.

## Workflow follow-up

- The owner merges the pull request after the `web-build` and gitleaks checks pass.
- The owner creates the Vercel project and finishes the hosted settings as described in `apps/web/README.md`.
- Archive the change after the first successful production deploy.
