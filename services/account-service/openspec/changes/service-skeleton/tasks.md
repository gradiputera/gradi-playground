# Tasks

Execution rules (read first):
- Work on branch `feat/account-service-skeleton` in `D:\Git\Gradi\gradi-playground`. It already holds the proposal commit. Use Bash (Git Bash) syntax as written. Commands that start with `cd services/account-service &&` run in the service folder; all others run from the repository root.
- Every command that runs PHP or Composer starts with this exact prefix (each Bash call is a new shell, so repeat it every time):
  ```bash
  export PHP="/c/laragon/bin/php/php-8.4-nts-Win32-vs17-x64-latest/php.exe" COMPOSER_PHAR="/c/laragon/bin/composer/composer.phar" OPENSSL_CONF="C:/laragon/bin/php/php-8.4-nts-Win32-vs17-x64-latest/extras/ssl/openssl.cnf" &&
  ```
  Below it is written as `<PHP>`. Replace `<PHP>` with the full prefix line above. Run PHP as `"$PHP"` and Composer as `"$PHP" "$COMPOSER_PHAR"`.
- Copy files **exactly** from the Appendix of `services/account-service/openspec/changes/service-skeleton/design.md` (A1 to A40). Appendix code blocks are fenced with four backticks; copy only the lines between the fences. Do not change versions, names or wording. Do not add files, dependencies or features that are not listed.
- `composer.lock` is not in the Appendix: copy `services/account-service/openspec/changes/service-skeleton/assets/composer.lock` byte for byte with `cp`.
- `vendor/` is gitignored; never `git add` it.
- After finishing each task, change its `- [ ]` to `- [x]` in this file.
- Secret scan before every commit. Run it **after** `git add` and before `git commit`. It scans exactly what is staged (see `design.md`, D7, for why this scan, not a scan of the whole folder):
  ```bash
  "/c/Users/vsiss/AppData/Local/Microsoft/WinGet/Packages/Gitleaks.Gitleaks_Microsoft.Winget.Source_8wekyb3d8bbwe/gitleaks.exe" git --staged --redact .
  ```
  It must print `no leaks found` and exit 0. The repository-local git identity is already configured; do not change git config.
- Every commit message ends with a blank line and the attribution line your harness provides; if it provides none, use `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Never run the `vercel` CLI, `supabase db push`, `supabase link`, `terraform`, a force push, or any command against a hosted service. Never read or create `.env` files (only `.env.example`). Never print keys other than the local publishable key. Never set `APP_DEBUG` to `true` in any file.
- Stop and report (do not guess or work around) only if:
  - a command in a task fails twice after re-reading the task;
  - a test still fails after the files match the Appendix exactly;
  - the `account-service` check fails on the pull request.

## 1. Laravel app and service code (specs: service-baseline, accounts-and-balances)

- [x] 1.1 Check the tools and the branch:
  - `git branch --show-current` must print `feat/account-service-skeleton`;
  - `<PHP> "$PHP" -v | head -1` must start with `PHP 8.4.`;
  - `<PHP> "$PHP" "$COMPOSER_PHAR" --version` must start with `Composer version 2.`;
  - `node --version` must start with `v26.`.

  Verify: all four outputs match.
- [x] 1.2 Create these files from the Appendix. `S` stands for `services/account-service`:
  - `S/composer.json` (A1), `S/artisan` (A2), `S/phpunit.xml` (A3);
  - `S/bootstrap/app.php` (A4), `S/bootstrap/cache/.gitignore` (A5), `S/public/index.php` (A6), `S/routes/api.php` (A7);
  - `S/config/database.php` (A8), `S/config/logging.php` (A9), `S/config/cache.php` (A10), `S/config/session.php` (A11), `S/config/services.php` (A12);
  - `S/app/Auth/Identity.php` (A13), `S/app/Auth/InvalidToken.php` (A14), `S/app/Auth/TokenVerifier.php` (A15), `S/app/Auth/JwksTokenVerifier.php` (A16);
  - `S/app/Http/Middleware/AuthenticateSupabase.php` (A17), `S/app/Http/Middleware/LogRequest.php` (A18);
  - `S/app/Http/Controllers/HealthController.php` (A19), `S/app/Http/Controllers/NotImplementedController.php` (A20);
  - `S/app/Models/Account.php` (A21), `S/database/migrations/2026_11_22_000001_create_accounts_table.php` (A22);
  - `S/storage/framework/cache/data/.gitignore` (A23), `S/storage/logs/.gitignore` (A24);
  - `S/tests/TestCase.php` (A25), `S/tests/Unit/TokenVerifierTest.php` (A26), `S/tests/Unit/AccountTest.php` (A27), `S/tests/Feature/HttpApiTest.php` (A28), `S/tests/Integration/LocalStackTest.php` (A29).

  Then copy the lockfile: `cp services/account-service/openspec/changes/service-skeleton/assets/composer.lock services/account-service/composer.lock`.

  Verify: `find services/account-service -type f -not -path "*/openspec/*" -not -path "*/vendor/*" | wc -l` prints `31` (29 Appendix files, `composer.lock`, and the existing `README.md`).
- [x] 1.3 Install and test:
  ```bash
  cd services/account-service && <PHP> "$PHP" "$COMPOSER_PHAR" install --no-interaction --no-progress && "$PHP" vendor/bin/phpunit --no-progress
  ```
  Verify:
  - `composer install` ends with `Generating optimized autoload files`;
  - `diff services/account-service/composer.lock services/account-service/openspec/changes/service-skeleton/assets/composer.lock` prints nothing: the lockfile is unchanged;
  - PHPUnit ends with `OK, but some tests were skipped!` and `Tests: 21, Assertions: 36, Skipped: 4.` The 4 skipped tests are the integration tests, which skip themselves without their environment.
- [x] 1.4 Check the package and configuration:
  - `cd services/account-service && <PHP> "$PHP" "$COMPOSER_PHAR" validate --no-check-publish` exits 0. It may print warnings about exact version constraints; they are expected (`design.md`, D6);
  - `grep -rn -i "APP_DEBUG.\{0,3\}true" services/account-service --include="*.php" --include="*.xml" --include="*.example" --include="Dockerfile" -l | wc -l` prints `0`.
- [x] 1.5 Confirm that every outbound call has a timeout. Each command must print `1`:
  - `grep -c "connectTimeout(5)->timeout(5)" services/account-service/app/Auth/JwksTokenVerifier.php`;
  - `grep -c "PDO::ATTR_TIMEOUT => 10" services/account-service/config/database.php`;
  - `grep -c "connectTimeout(10)" services/account-service/tests/Integration/LocalStackTest.php`.
- [x] 1.6 Commit group 1: `git add services/account-service/composer.json services/account-service/composer.lock services/account-service/artisan services/account-service/phpunit.xml services/account-service/bootstrap services/account-service/public services/account-service/routes services/account-service/config services/account-service/app services/account-service/database services/account-service/storage services/account-service/tests services/account-service/openspec/changes/service-skeleton/tasks.md`, run the secret scan, and commit with message `feat(account-service): Laravel skeleton with JWT validation and accounts table`. Verify:
  - `git status --porcelain` is empty;
  - `git ls-files services/account-service | grep -c "/vendor/"` prints `0`.

## 2. Container and Vercel configuration

- [x] 2.1 Create these files from the Appendix:
  - `services/account-service/docker/Caddyfile` (A30), `services/account-service/docker/php.ini` (A31), `services/account-service/docker/entrypoint.sh` (A32);
  - `services/account-service/Dockerfile` (A33), `services/account-service/.dockerignore` (A34), `services/account-service/vercel.json` (A35).

  Verify:
  - `node -e "JSON.parse(require('fs').readFileSync('services/account-service/vercel.json','utf8'))"` exits 0;
  - `sh -n services/account-service/docker/entrypoint.sh` exits 0 (shell syntax);
  - if `docker info` succeeds, `docker build -t account-service:local services/account-service` exits 0. If `docker info` fails, write down "local image build not run (Docker unavailable); CI is authoritative" for the PR.
- [x] 2.2 Commit group 2: `git add services/account-service/docker services/account-service/Dockerfile services/account-service/.dockerignore services/account-service/vercel.json services/account-service/openspec/changes/service-skeleton/tasks.md`, run the secret scan, and commit with message `build(account-service): FrankenPHP container image and Vercel config`. Verify: `git status --porcelain` is empty.

## 3. CI, contract and Dependabot

- [x] 3.1 Create `.github/workflows/account-service.yml` (A38). Replace `contracts/openapi/account.yaml` with A39. Append A40 to `.github/dependabot.yml`. Verify:
  - `npx -y yaml-lint@1.7.0 .github/workflows/account-service.yml contracts/openapi/account.yaml .github/dependabot.yml` reports the files as valid;
  - `git diff --stat contracts/openapi/account.yaml` shows `2 insertions(+)` and no deletions;
  - `git diff --stat .github/dependabot.yml` shows `8 insertions(+)` and no deletions;
  - `grep -c "package-ecosystem" .github/dependabot.yml` prints `8`.

  The breaking-change check for the contract (oasdiff) runs in the `account-service` CI workflow on the pull request. Do not run oasdiff locally.
- [x] 3.2 Commit group 3: `git add .github/workflows/account-service.yml contracts/openapi/account.yaml .github/dependabot.yml services/account-service/openspec/changes/service-skeleton/tasks.md`, run the secret scan, and commit with message `ci(account-service): build, test and contract checks`. Verify: `git status --porcelain` is empty.

## 4. Documentation

- [x] 4.1 Replace `services/account-service/README.md` with A37 and create `services/account-service/.env.example` (A36). Verify:
  - `git check-ignore -q services/account-service/.env` exits 0 (ignored);
  - `git check-ignore -q services/account-service/.env.example` exits 1 (not ignored);
  - every relative link in the README points to an existing file: `.env.example`, `../../contracts/openapi/account.yaml`, and the five ADR files under `../../architecture/adr/`.
- [x] 4.2 Commit group 4: `git add services/account-service/README.md services/account-service/.env.example services/account-service/openspec/changes/service-skeleton/tasks.md`, run the secret scan, and commit with message `docs(account-service): configuration, local development and owner setup`. Verify: `git status --porcelain` is empty.

## 5. Integration check and pull request

- [ ] 5.1 Run the full check from a clean state:
  ```bash
  cd services/account-service && rm -rf vendor && <PHP> "$PHP" "$COMPOSER_PHAR" install --no-interaction --no-progress && "$PHP" vendor/bin/phpunit --no-progress && "$PHP" "$COMPOSER_PHAR" validate --no-check-publish && npx -y @fission-ai/openspec@latest validate --all --strict && cd ../.. && npx -y @fission-ai/openspec@latest validate --all --strict
  ```
  Then scan the branch's commits:
  ```bash
  "/c/Users/vsiss/AppData/Local/Microsoft/WinGet/Packages/Gitleaks.Gitleaks_Microsoft.Winget.Source_8wekyb3d8bbwe/gitleaks.exe" git --log-opts="main..HEAD" --redact .
  ```
  Verify:
  - every command exits 0, and PHPUnit prints `Tests: 21, Assertions: 36, Skipped: 4.`;
  - the gitleaks scan prints `no leaks found`;
  - `git status --porcelain` is empty;
  - `git ls-files | grep -E "(^|/)(\.env|node_modules|vendor|\.nuxt|\.output|target)(/|$)"` prints nothing.
- [ ] 5.2 Mark this task `- [x]`, `git add` `services/account-service/openspec/changes/service-skeleton/tasks.md`, run the secret scan, and commit with message `docs(openspec): complete account-service service-skeleton tasks`. Then run `git push -u origin feat/account-service-skeleton`. Open the pull request with `gh pr create --base main --head feat/account-service-skeleton --title "feat(account-service): Laravel service skeleton" --body-file <file>`. Write the body file in the scratchpad or system temp directory, not in the repository. The body has:
  - `## Summary`: bullets for:
    - the minimal Laravel 13 app with JSON-only errors;
    - JWT validation with firebase/php-jwt and JWKS;
    - startup migrations and the `accounts` table;
    - the `Account` model, with only `currency` fillable;
    - `POST /sandbox/reset` answering 501;
    - the FrankenPHP container and `vercel.json`;
    - the CI workflow, the contract change and Dependabot;
    - the docs;
  - `## Decisions`: links to ADR 0003, ADR 0004, ADR 0007 and ADR 0011, and the OpenSpec change folder `services/account-service/openspec/changes/service-skeleton/`;
  - `## Checks`: PHPUnit (21 tests, 4 integration tests skipped locally), `composer validate`, the local image build result from task 2.1 (built, or "not run"), "oasdiff runs in CI", `openspec validate` (service and root), and the gitleaks result;
  - `## Owner actions`: "Set the account_service role password, create the Vercel project and set PORT, SUPABASE_URL and DATABASE_URL, then check /health, as described in services/account-service/README.md, section Owner setup (hosted).";
  - the PR attribution line your harness provides at the end.

  Then wait for the checks with `gh pr checks --watch --interval 30`. Do not merge the pull request. Verify: `gh pr checks` shows `account-service` as `pass`. If it fails, stop and report the failing step's log (`gh run view <run-id> --log-failed`).

## Workflow follow-up

- The owner merges the pull request after `account-service` and gitleaks pass.
- The owner completes the hosted setup in the README and checks `/health` on the Vercel deployment.
- Archive the change after the hosted check passes.
