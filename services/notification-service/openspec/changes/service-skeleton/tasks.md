# Tasks

Execution rules (read first):
- Work on branch `feat/notification-service-skeleton` in `D:\Git\Gradi\gradi-playground`. It already holds the proposal commit. Use Bash (Git Bash) syntax as written. Commands that start with `cd services/notification-service &&` run in the service folder; all others run from the repository root.
- Copy files **exactly** from the Appendix of `services/notification-service/openspec/changes/service-skeleton/design.md` (A1 to A26). Appendix code blocks are fenced with four backticks; copy only the lines between the fences. Do not change versions, names or wording. Do not add files, dependencies or features that are not listed.
- `package-lock.json` is not in the Appendix: copy `services/notification-service/openspec/changes/service-skeleton/assets/package-lock.json` byte for byte with `cp`. Never run `npm install` (it would rewrite the lockfile); use `npm ci` only.
- `node_modules/` is gitignored; never `git add` it.
- npm prints `npm warn install-scripts` lines about esbuild. They are expected; ignore them.
- After finishing each task, change its `- [ ]` to `- [x]` in this file.
- Secret scan before every commit. Run it **after** `git add` and before `git commit`. It scans exactly what is staged:
  ```bash
  "/c/Users/vsiss/AppData/Local/Microsoft/WinGet/Packages/Gitleaks.Gitleaks_Microsoft.Winget.Source_8wekyb3d8bbwe/gitleaks.exe" git --staged --redact .
  ```
  It must print `no leaks found` and exit 0. The repository-local git identity is already configured; do not change git config.
- Every commit message ends with a blank line and the attribution line your harness provides; if it provides none, use `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Never run the `vercel` CLI, `supabase db push`, `supabase link`, `terraform`, a force push, oasdiff, or any command against a hosted service. Never read or create `.env` files (only `.env.example`). Never print keys other than the local publishable key.
- Stop and report (do not guess or work around) only if:
  - a command in a task fails twice after re-reading the task;
  - a command is denied by a permission check;
  - a test still fails after the files match the Appendix exactly;
  - the `notification-service` or `web-build` check fails on the pull request.

## 1. Express app and service code (specs: service-baseline, event-notifications)

- [x] 1.1 Check the tools and the branch:
  - `git branch --show-current` must print `feat/notification-service-skeleton`;
  - `node --version` must print a version of `v24.11.0` or newer (for example `v26.13.1`);
  - `npm --version` must print a version of `10` or newer.

  Verify: all three outputs match.
- [x] 1.2 Create these files from the Appendix. `N` stands for `services/notification-service`:
  - `N/package.json` (A1), `N/tsconfig.json` (A2), `N/drizzle.config.ts` (A3);
  - `N/src/main.ts` (A4), `N/src/log.ts` (A5), `N/src/auth/verifier.ts` (A6), `N/src/webhooks/signature.ts` (A7), `N/src/http/app.ts` (A8);
  - `N/src/db/schema.ts` (A9), `N/src/db/migrate.ts` (A10);
  - `N/drizzle/0000_create_inbox.sql` (A11), `N/drizzle/meta/_journal.json` (A12), `N/drizzle/meta/0000_snapshot.json` (A13);
  - `N/test/verifier.test.ts` (A14), `N/test/signature.test.ts` (A15), `N/test/app.test.ts` (A16), `N/test/integration.test.ts` (A17).

  Then copy the lockfile: `cp services/notification-service/openspec/changes/service-skeleton/assets/package-lock.json services/notification-service/package-lock.json`.

  Verify: `find services/notification-service -type f -not -path "*/openspec/*" -not -path "*/node_modules/*" | wc -l` prints `19` (17 Appendix files, `package-lock.json`, and the existing `README.md`).
- [x] 1.3 Install, typecheck and test:
  ```bash
  cd services/notification-service && npm ci --no-audit --no-fund && npm run typecheck && npm test
  ```
  Verify:
  - every command exits 0;
  - `diff services/notification-service/package-lock.json services/notification-service/openspec/changes/service-skeleton/assets/package-lock.json` prints nothing (the lockfile is unchanged);
  - the test summary contains `ℹ tests 14`, `ℹ pass 14` and `ℹ fail 0`. The integration suite is listed as skipped (`integration environment not set`), which is expected locally.
- [x] 1.4 Confirm that every outbound call has a timeout. Each command must print `1`:
  - `grep -c "timeoutDuration: 5_000" services/notification-service/src/auth/verifier.ts`;
  - `grep -c "connect_timeout: 10" services/notification-service/src/db/migrate.ts`;
  - `grep -c "statement_timeout: 30_000" services/notification-service/src/db/migrate.ts`;
  - `grep -c "AbortSignal.timeout(10_000)" services/notification-service/test/integration.test.ts`.

  Also confirm that nothing sends email: `grep -rn -i "smtp\|nodemailer\|sendmail" services/notification-service/src | wc -l` prints `0`.
- [x] 1.5 Commit group 1: `git add services/notification-service/package.json services/notification-service/package-lock.json services/notification-service/tsconfig.json services/notification-service/drizzle.config.ts services/notification-service/src services/notification-service/drizzle services/notification-service/test services/notification-service/openspec/changes/service-skeleton/tasks.md`, run the secret scan, and commit with message `feat(notification-service): Express skeleton with JWT, webhook signatures and inbox table`. Verify:
  - `git status --porcelain` is empty;
  - `git ls-files services/notification-service | grep -c "node_modules"` prints `0`.

## 2. Container and Vercel configuration

- [x] 2.1 Create these files from the Appendix:
  - `services/notification-service/Dockerfile` (A18);
  - `services/notification-service/.dockerignore` (A19);
  - `services/notification-service/vercel.json` (A20).

  Verify:
  - `node -e "JSON.parse(require('fs').readFileSync('services/notification-service/vercel.json','utf8'))"` exits 0;
  - if `docker info` succeeds, `docker build -t notification-service:local services/notification-service` exits 0. If `docker info` fails, write down "local image build not run (Docker unavailable); CI is authoritative" for the PR.
  - Result: `docker info` failed locally, so the image build was not run: local image build not run (Docker unavailable); CI is authoritative.
- [x] 2.2 Commit group 2: `git add services/notification-service/Dockerfile services/notification-service/.dockerignore services/notification-service/vercel.json services/notification-service/openspec/changes/service-skeleton/tasks.md`, run the secret scan, and commit with message `build(notification-service): container image and Vercel config`. Verify: `git status --porcelain` is empty.

## 3. CI, contract and Dependabot

- [x] 3.1 Create `.github/workflows/notification-service.yml` (A23). Replace `contracts/openapi/notification.yaml` with A24. Append A25 to `.github/dependabot.yml`. Verify:
  - `npx -y yaml-lint@1.7.0 .github/workflows/notification-service.yml contracts/openapi/notification.yaml .github/dependabot.yml` reports the files as valid;
  - `git diff --stat contracts/openapi/notification.yaml` shows `4 insertions(+)` and no deletions;
  - `git diff --stat .github/dependabot.yml` shows `8 insertions(+)` and no deletions;
  - `grep -c "package-ecosystem" .github/dependabot.yml` prints `10`.

  The breaking-change check for the contract (oasdiff) runs in CI on the pull request. Do not run it locally.
- [x] 3.2 Commit group 3: `git add .github/workflows/notification-service.yml contracts/openapi/notification.yaml .github/dependabot.yml services/notification-service/openspec/changes/service-skeleton/tasks.md`, run the secret scan, and commit with message `ci(notification-service): build, test and contract checks`. Verify: `git status --porcelain` is empty.

## 4. Framework switch: Hono to Express

- [x] 4.1 Apply the ten edits in A26: nine exact text replacements and one inserted line in ADR 0002. Verify:
  - `git grep -n -i "hono" -- CLAUDE.md README.md architecture openspec/config.yaml apps services/notification-service/openspec/config.yaml` prints exactly one line: the new `- Amended:` line in `architecture/adr/0002-polyglot-services.md`;
  - `git diff --stat` lists exactly these seven files, each with `1 insertion(+), 1 deletion(-)`, except `README.md` (`3 insertions(+), 3 deletions(-)`) and `architecture/adr/0002-polyglot-services.md` (`2 insertions(+), 1 deletion(-)`): `CLAUDE.md`, `README.md`, `apps/web/app/content/profile.ts`, `architecture/adr/0002-polyglot-services.md`, `architecture/c4/README.md`, `openspec/config.yaml`, `services/notification-service/openspec/config.yaml`.
- [x] 4.2 Commit group 4: `git add CLAUDE.md README.md apps/web/app/content/profile.ts architecture/adr/0002-polyglot-services.md architecture/c4/README.md openspec/config.yaml services/notification-service/openspec/config.yaml services/notification-service/openspec/changes/service-skeleton/tasks.md`, run the secret scan, and commit with message `docs: record Express for notification-service`. Verify: `git status --porcelain` is empty.

## 5. Documentation

- [ ] 5.1 Replace `services/notification-service/README.md` with A22 and create `services/notification-service/.env.example` (A21). Verify:
  - `git check-ignore -q services/notification-service/.env` exits 0 (ignored);
  - `git check-ignore -q services/notification-service/.env.example` exits 1 (not ignored);
  - `grep -c "whsec_bG9j" services/notification-service/.env.example` prints `0` (the local secret is never written out);
  - every relative link in the README points to an existing file: `.env.example`, `../../contracts/openapi/notification.yaml`, and the six ADR files under `../../architecture/adr/`.
- [ ] 5.2 Commit group 5: `git add services/notification-service/README.md services/notification-service/.env.example services/notification-service/openspec/changes/service-skeleton/tasks.md`, run the secret scan, and commit with message `docs(notification-service): configuration, local development and owner setup`. Verify: `git status --porcelain` is empty.

## 6. Integration check and pull request

- [ ] 6.1 Run the full check from a clean state:
  ```bash
  cd services/notification-service && rm -rf node_modules && npm ci --no-audit --no-fund && npm run typecheck && npm test && npx -y @fission-ai/openspec@latest validate --all --strict && cd ../.. && npx -y @fission-ai/openspec@latest validate --all --strict
  ```
  Then scan the branch's commits:
  ```bash
  "/c/Users/vsiss/AppData/Local/Microsoft/WinGet/Packages/Gitleaks.Gitleaks_Microsoft.Winget.Source_8wekyb3d8bbwe/gitleaks.exe" git --log-opts="main..HEAD" --redact .
  ```
  Verify:
  - every command exits 0, and the test summary contains `ℹ tests 14` and `ℹ pass 14`;
  - the gitleaks scan prints `no leaks found`;
  - `git status --porcelain` is empty;
  - `git ls-files | grep -E "(^|/)(\.env|node_modules|vendor|\.nuxt|\.output|target)(/|$)"` prints nothing.
- [ ] 6.2 Mark this task `- [x]`, `git add` `services/notification-service/openspec/changes/service-skeleton/tasks.md`, run the secret scan, and commit with message `docs(openspec): complete notification-service service-skeleton tasks`. Then run `git push -u origin feat/notification-service-skeleton`. Open the pull request with `gh pr create --base main --head feat/notification-service-skeleton --title "feat(notification-service): Express service skeleton" --body-file <file>`. Write the body file in the scratchpad or system temp directory, not in the repository. The body has:
  - `## Summary`: bullets for:
    - the Express 5 app (TypeScript run directly by Node 24);
    - JWT validation with jose and JWKS;
    - Standard Webhooks signature checks on `/events`;
    - startup migrations with the `inbox` table and the service's own migrator;
    - the 501 answers;
    - the container image and `vercel.json`;
    - the CI workflow, the contract change and Dependabot;
    - the switch from Hono to Express in the docs and on the main page;
    - the docs;
  - `## Decisions`: links to ADR 0002 (amended), ADR 0003, ADR 0005 and ADR 0007, and the OpenSpec change folder `services/notification-service/openspec/changes/service-skeleton/`;
  - `## Checks`: typecheck, 14 tests (integration skipped locally), the local image build result from task 2.1 (built, or "not run"), "oasdiff runs in CI", `openspec validate` (service and root), and the gitleaks result;
  - `## Owner actions`: "Set the notification_service role password, read the notification webhook secret from Vault, create the Vercel project and set PORT, SUPABASE_URL, DATABASE_URL and WEBHOOK_SECRET, then check /health, as described in services/notification-service/README.md, section Owner setup (hosted).";
  - the PR attribution line your harness provides at the end.

  Then wait for the checks with `gh pr checks --watch --interval 30`. Do not merge the pull request. Verify: `gh pr checks` shows both `notification-service` and `web-build` as `pass`. If one fails, stop and report the failing step's log (`gh run view <run-id> --log-failed`).

## Workflow follow-up

- The owner merges the pull request after `notification-service`, `web-build` and gitleaks pass.
- The owner completes the hosted setup in the README and checks `/health` on the Vercel deployment.
- Archive the change after the hosted check passes.
