# Tasks

Execution rules (read first):
- Work on branch `feat/reporting-service-skeleton` in `D:\Git\Gradi\gradi-playground`. It already holds the proposal commit. Use Bash (Git Bash) syntax as written. Commands that start with `cd services/reporting-service &&` run in the service folder; all others run from the repository root.
- uv is installed but not on the shell's PATH. Start **every** command that runs `uv` with:
  ```bash
  export PATH="/c/Users/vsiss/AppData/Local/Microsoft/WinGet/Packages/astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe:$PATH" &&
  ```
  The commands below write this prefix as `UVPATH &&`; replace `UVPATH` with the `export PATH=...` text above.
- Copy files **exactly** from the Appendix of `services/reporting-service/openspec/changes/service-skeleton/design.md` (A1 to A26). Appendix code blocks are fenced with four backticks; copy only the lines between the fences. Do not change versions, names or wording. Do not add files, dependencies or features that are not listed.
- `uv.lock` is not in the Appendix: copy `services/reporting-service/openspec/changes/service-skeleton/assets/uv.lock` byte for byte with `cp`. Never run `uv lock`, `uv add` or `uv sync` without `--locked`.
- `.venv/`, `__pycache__/` and the tool caches are gitignored; never `git add` them.
- After finishing each task, change its `- [ ]` to `- [x]` in this file.
- Secret scan before every commit. Run it **after** `git add` and before `git commit`. It scans exactly what is staged:
  ```bash
  "/c/Users/vsiss/AppData/Local/Microsoft/WinGet/Packages/Gitleaks.Gitleaks_Microsoft.Winget.Source_8wekyb3d8bbwe/gitleaks.exe" git --staged --redact .
  ```
  It must print `no leaks found` and exit 0. Check the exit code; do not pipe the scan into another command. The repository-local git identity is already configured; do not change git config.
- Every commit message ends with a blank line and the attribution line your harness provides; if it provides none, use `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Never run the `vercel` CLI, `supabase db push`, `supabase link`, `terraform`, a force push, oasdiff, or any command against a hosted service. Never read or create `.env` files (only `.env.example`). Never print keys other than the local publishable key.
- Stop and report (do not guess or work around) only if:
  - a command in a task fails twice after re-reading the task;
  - a command is denied by a permission check;
  - a test, lint or type check still fails after the files match the Appendix exactly;
  - the `reporting-service` or `gitleaks` check fails on the pull request.

## 1. FastAPI app and service code (specs: service-baseline, transaction-reporting)

- [x] 1.1 Check the tools and the branch:
  - `git branch --show-current` must print `feat/reporting-service-skeleton`;
  - `UVPATH && uv --version` must print `uv 0.13.9` or newer;
  - `UVPATH && uv python find 3.13` must print a path to a Python 3.13 interpreter.

  Verify: all three outputs match.
- [x] 1.2 Create these files from the Appendix. `R` stands for `services/reporting-service`:
  - `R/pyproject.toml` (A1), `R/.python-version` (A2), `R/alembic.ini` (A3);
  - `R/reporting_service/__init__.py` (A4), `R/reporting_service/main.py` (A5), `R/reporting_service/log.py` (A6), `R/reporting_service/auth.py` (A7), `R/reporting_service/webhooks.py` (A8), `R/reporting_service/app.py` (A9), `R/reporting_service/db.py` (A10);
  - `R/migrations/env.py` (A11), `R/migrations/script.py.mako` (A12), `R/migrations/versions/0001_create_inbox.py` (A13);
  - `R/tests/test_auth.py` (A14), `R/tests/test_webhooks.py` (A15), `R/tests/test_app.py` (A16), `R/tests/test_integration.py` (A17).

  Then copy the lockfile: `cp services/reporting-service/openspec/changes/service-skeleton/assets/uv.lock services/reporting-service/uv.lock`. Then apply A26 to `.gitignore` (insert `.mypy_cache/` after `.ruff_cache/`).

  Verify:
  - `find services/reporting-service -type f -not -path "*/openspec/*" -not -path "*/.venv/*" -not -path "*/__pycache__/*" | wc -l` prints `19` (17 Appendix files, `uv.lock`, and the existing `README.md`);
  - `git diff --stat .gitignore` shows `1 insertion(+)` and no deletions.
- [x] 1.3 Install, lint, typecheck and test:
  ```bash
  UVPATH && cd services/reporting-service && uv sync --locked && uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest
  ```
  Verify:
  - every command exits 0; `ruff check` prints `All checks passed!`, `ruff format --check` reports every file as already formatted, and mypy prints `Success: no issues found in 13 source files`;
  - `diff services/reporting-service/uv.lock services/reporting-service/openspec/changes/service-skeleton/assets/uv.lock` prints nothing (the lockfile is unchanged);
  - the pytest summary line reads `16 passed, 3 skipped`. The 3 integration tests are skipped (`integration environment not set`), which is expected locally.
- [x] 1.4 Confirm that every outbound call has a timeout. Each command must print `1`:
  - `grep -c "^FETCH_TIMEOUT_SECONDS = 5$" services/reporting-service/reporting_service/auth.py`;
  - `grep -c "^SOCKET_TIMEOUT_SECONDS = 30$" services/reporting-service/reporting_service/db.py`;
  - `grep -c "^STATEMENT_TIMEOUT_MS = 30_000$" services/reporting-service/reporting_service/db.py`;
  - `grep -c "timeout=10," services/reporting-service/tests/test_integration.py`.

  Also confirm the schema boundary: `grep -rhn "schema=" services/reporting-service/migrations/versions` prints exactly two lines, both with `schema="reporting"`.
- [x] 1.5 Commit group 1: `git add .gitignore services/reporting-service/pyproject.toml services/reporting-service/uv.lock services/reporting-service/.python-version services/reporting-service/alembic.ini services/reporting-service/reporting_service services/reporting-service/migrations services/reporting-service/tests services/reporting-service/openspec/changes/service-skeleton/tasks.md`, run the secret scan, and commit with message `feat(reporting-service): FastAPI skeleton with JWT, webhook signatures and inbox table`. Verify:
  - `git status --porcelain` is empty;
  - `git ls-files services/reporting-service | grep -cE "(\.venv|__pycache__|_cache)/"` prints `0`.

## 2. Container and Vercel configuration

- [ ] 2.1 Create these files from the Appendix:
  - `services/reporting-service/Dockerfile` (A18);
  - `services/reporting-service/.dockerignore` (A19);
  - `services/reporting-service/vercel.json` (A20).

  Verify:
  - `node -e "JSON.parse(require('fs').readFileSync('services/reporting-service/vercel.json','utf8'))"` exits 0;
  - if `docker info` succeeds, `docker build -t reporting-service:local services/reporting-service` exits 0. If `docker info` fails, add a sub-bullet under this task: "local image build not run (Docker unavailable); CI is authoritative".
- [ ] 2.2 Commit group 2: `git add services/reporting-service/Dockerfile services/reporting-service/.dockerignore services/reporting-service/vercel.json services/reporting-service/openspec/changes/service-skeleton/tasks.md`, run the secret scan, and commit with message `build(reporting-service): container image and Vercel config`. Verify: `git status --porcelain` is empty.

## 3. CI, contract and Dependabot

- [ ] 3.1 Create `.github/workflows/reporting-service.yml` (A23). Replace `contracts/openapi/reporting.yaml` with A24. Append A25 to `.github/dependabot.yml`. Verify:
  - `npx -y yaml-lint@1.7.0 .github/workflows/reporting-service.yml contracts/openapi/reporting.yaml .github/dependabot.yml` reports the files as valid;
  - `git diff --stat contracts/openapi/reporting.yaml` shows `6 insertions(+)` and no deletions;
  - `git diff --stat .github/dependabot.yml` shows `8 insertions(+)` and no deletions;
  - `grep -c "package-ecosystem" .github/dependabot.yml` prints `12`.

  The breaking-change check for the contract (oasdiff) runs in CI on the pull request. Do not run it locally.
- [ ] 3.2 Commit group 3: `git add .github/workflows/reporting-service.yml contracts/openapi/reporting.yaml .github/dependabot.yml services/reporting-service/openspec/changes/service-skeleton/tasks.md`, run the secret scan, and commit with message `ci(reporting-service): build, test and contract checks`. Verify: `git status --porcelain` is empty.

## 4. Documentation

- [ ] 4.1 Replace `services/reporting-service/README.md` with A22 and create `services/reporting-service/.env.example` (A21). Verify:
  - `git check-ignore -q services/reporting-service/.env` exits 0 (ignored);
  - `git check-ignore -q services/reporting-service/.env.example` exits 1 (not ignored);
  - `grep -c "whsec_bG9j" services/reporting-service/.env.example` prints `0` (the local secret is never written out);
  - every relative link in the README points to an existing file: `.env.example`, `../../contracts/openapi/reporting.yaml`, and the six ADR files under `../../architecture/adr/`.
- [ ] 4.2 Commit group 4: `git add services/reporting-service/README.md services/reporting-service/.env.example services/reporting-service/openspec/changes/service-skeleton/tasks.md`, run the secret scan, and commit with message `docs(reporting-service): configuration, local development and owner setup`. Verify: `git status --porcelain` is empty.

## 5. Integration check and pull request

- [ ] 5.1 Run the full check from a clean state:
  ```bash
  UVPATH && cd services/reporting-service && rm -rf .venv && uv sync --locked && uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest && npx -y @fission-ai/openspec@latest validate --all --strict && cd ../.. && npx -y @fission-ai/openspec@latest validate --all --strict
  ```
  Then scan the branch's commits:
  ```bash
  "/c/Users/vsiss/AppData/Local/Microsoft/WinGet/Packages/Gitleaks.Gitleaks_Microsoft.Winget.Source_8wekyb3d8bbwe/gitleaks.exe" git --log-opts="main..HEAD" --redact .
  ```
  Verify:
  - every command exits 0, and the pytest summary line reads `16 passed, 3 skipped`;
  - the gitleaks scan prints `no leaks found`;
  - `git status --porcelain` is empty;
  - `git ls-files | grep -E "(^|/)(\.env|\.venv|node_modules|vendor|\.nuxt|\.output|target|__pycache__)(/|$)"` prints nothing.
- [ ] 5.2 Mark this task `- [x]`, `git add` `services/reporting-service/openspec/changes/service-skeleton/tasks.md`, run the secret scan, and commit with message `docs(openspec): complete reporting-service service-skeleton tasks`. Then run `git push -u origin feat/reporting-service-skeleton`. Open the pull request with `gh pr create --base main --head feat/reporting-service-skeleton --title "feat(reporting-service): FastAPI service skeleton" --body-file <file>`. Write the body file in the scratchpad or system temp directory, not in the repository. The body has:
  - `## Summary`: bullets for:
    - the FastAPI app on Python 3.13, managed with uv;
    - JWT validation with PyJWT and a JWKS cache with a refetch cooldown;
    - Standard Webhooks signature checks on `/events`;
    - startup migrations with Alembic and the `inbox` table, using the pg8000 driver;
    - the 501 answers;
    - the container image and `vercel.json`;
    - the CI workflow, the contract change, Dependabot and the `.gitignore` line;
    - the docs;
  - `## Decisions`: links to ADR 0002, ADR 0003, ADR 0004, ADR 0005 and ADR 0007, and the OpenSpec change folder `services/reporting-service/openspec/changes/service-skeleton/`;
  - `## Checks`: Ruff, mypy, 16 tests (integration skipped locally), the local image build result from task 2.1 (built, or "not run"), "oasdiff runs in CI", `openspec validate` (service and root), and the gitleaks result;
  - `## Owner actions`: "Set the reporting_service role password, read the reporting webhook secret from Vault, create the Vercel project and set PORT, SUPABASE_URL, DATABASE_URL and WEBHOOK_SECRET, then check /health, as described in services/reporting-service/README.md, section Owner setup (hosted).";
  - the PR attribution line your harness provides at the end.

  Then wait for the checks with `gh pr checks --watch --interval 30`. Do not merge the pull request. Verify: `gh pr checks` shows `reporting-service` and `gitleaks` as `pass`. The `Vercel – …` checks are preview deployments of other projects and are not part of this gate; report their state but do not act on them. If `reporting-service` or `gitleaks` fails, stop and report the failing step's log (`gh run view <run-id> --log-failed`).

## Workflow follow-up

- The owner merges the pull request after `reporting-service` and gitleaks pass.
- The owner completes the hosted setup in the README and checks `/health` on the Vercel deployment.
- Archive the change after the hosted check passes.
