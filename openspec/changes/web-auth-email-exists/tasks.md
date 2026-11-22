# Tasks

Execution rules (read first):
- Work on branch `feat/web-auth-email-exists` in `D:\Git\Gradi\gradi-playground`. It already holds the proposal commit. Run every command from the repository root. Use Bash (Git Bash) syntax as written below.
- Copy code and text **exactly** from the Appendix of `design.md` (A1 to A3). Do not change wording, names or other files. Do not add files, dependencies or features that are not listed.
- After finishing each task, change its `- [ ]` to `- [x]` in this file.
- Secret scan before every commit:
  ```bash
  "/c/Users/vsiss/AppData/Local/Microsoft/WinGet/Packages/Gitleaks.Gitleaks_Microsoft.Winget.Source_8wekyb3d8bbwe/gitleaks.exe" detect --source . --no-git --redact
  ```
  It must print `no leaks found` and exit 0. The repository-local git identity is already configured; do not change git config.
- Every commit message ends with a blank line and the attribution line your harness provides; if it provides none, use `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Never run the `vercel` CLI, `supabase db push`, `supabase link`, `terraform`, a force push, or any command against a hosted service. Never read or create `.env` files. Never print keys other than the local publishable key.
- Stop and report (do not guess or work around) only if:
  - a command in a task fails twice after re-reading the task;
  - a test still fails after the files match the Appendix exactly;
  - the `web-build` check fails on the pull request.

## 1. Callback fix and tests (spec: auth)

- [x] 1.1 Check the toolchain and the branch. `node --version` must start with `v26.`, `pnpm --version` must print `12.21.0`, and `git branch --show-current` must print `feat/web-auth-email-exists`. Then run `pnpm install --frozen-lockfile`. Verify: all three outputs match and the install exits 0.
- [x] 1.2 Replace `apps/web/server/routes/auth/callback.get.ts` with A1. Verify: `pnpm --filter web typecheck` exits 0.
- [x] 1.3 Insert the two tests from A2 into `apps/web/test/e2e/auth.test.ts`. Verify:
  - `grep -c "^  it(" apps/web/test/e2e/auth.test.ts` prints `16`;
  - `grep -c "error_code=email_exists" apps/web/test/e2e/auth.test.ts` prints `2`;
  - `git diff --stat apps/web/test/e2e/auth.test.ts` shows only insertions (no `-` lines);
  - `pnpm --filter web typecheck` exits 0.
- [x] 1.4 Run the tests locally if Docker is available:
  1. Run `docker info`. If it fails, skip the remaining steps, write down "local auth tests not run (Docker unavailable); CI is authoritative" for the PR, and go to task 1.5.
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

  Verify: the test run prints `Tests  27 passed (27)`, or the "not run" note is written down.
- [x] 1.5 Commit group 1: run the secret scan, then `git add apps/web/server/routes/auth/callback.get.ts apps/web/test/e2e/auth.test.ts openspec/changes/web-auth-email-exists/tasks.md`, and commit with message `fix(web): sign in to the existing account when the Google email is already registered`. Verify: `git status --porcelain` is empty.

## 2. Documentation

- [ ] 2.1 Apply A3 to `docs/security/auth.md`. Verify:
  - `grep -c "email_exists" docs/security/auth.md` prints `1`;
  - `grep -c "^## " docs/security/auth.md` prints `15`;
  - `git diff --stat docs/security/auth.md` shows `1 insertion(+), 1 deletion(-)`.
- [ ] 2.2 Commit group 2: run the secret scan, then `git add docs/security/auth.md openspec/changes/web-auth-email-exists/tasks.md`, and commit with message `docs(security): handle email_exists when a guest links Google`. Verify: `git status --porcelain` is empty.

## 3. Integration check and pull request

- [ ] 3.1 Run the full check from a clean state:
  ```bash
  rm -rf apps/web/.nuxt apps/web/.output
  pnpm install --frozen-lockfile
  pnpm --filter web typecheck
  pnpm --filter web exec vitest run test/e2e/web.test.ts
  pnpm --filter web build
  npx -y @fission-ai/openspec@latest validate --all --strict
  ```
  Then run the secret scan. Verify:
  - every command exits 0, and the routing tests print `Tests  11 passed (11)`;
  - `validate` may print an `[INFO]` line saying archive would refuse the `web-auth-email-exists` delta. That is expected (see `design.md`, Risks) and is not a failure;
  - `git ls-files | grep -E "(^|/)(\.env|node_modules|\.nuxt|\.output)(/|$)"` prints nothing.
- [ ] 3.2 Mark this task `- [x]`, commit `openspec/changes/web-auth-email-exists/tasks.md` with message `docs(openspec): complete web-auth-email-exists tasks` (after the secret scan), then run `git push -u origin feat/web-auth-email-exists`. Open the pull request with `gh pr create --base main --head feat/web-auth-email-exists --title "fix(web): sign in to the existing account when the Google email is already registered" --body-file <file>`. Write the body file in the scratchpad or system temp directory, not in the repository. The body has:
  - `## Summary`: bullets for the callback change (both error codes, guest-only restart), the two new tests and the docs line;
  - `## Decisions`: a link to ADR 0007 and the OpenSpec change folder;
  - `## Checks`: typecheck, the routing tests, the local auth test result from task 1.4 (`27 passed`, or "not run"), build, `openspec validate --all --strict`, and the gitleaks result;
  - `## Owner actions`: "After the merge and the Vercel deploy, repeat the Google sign-in check from a guest session (apps/web/README.md, section Authentication variables). Archive web-auth-and-bff before archiving this change.";
  - the PR attribution line your harness provides at the end.

  Then wait for the checks with `gh pr checks --watch --interval 30`. Do not merge the pull request. Verify: `gh pr checks` shows `web-build` as `pass`. If it fails, stop and report the failing step's log (`gh run view <run-id> --log-failed`).

## Workflow follow-up

- The owner merges the pull request after `web-build` and gitleaks pass.
- The owner repeats the Google sign-in, sign-out and returning-user checks on production.
- Archive `web-auth-and-bff` first, then this change.
