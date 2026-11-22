# Tasks

Execution rules (read first):
- Work on branch `feat/ledger-service-skeleton` in `D:\Git\Gradi\gradi-playground`. It already holds the proposal commit. Use Bash (Git Bash) syntax as written. Commands that start with `cd services/ledger-service &&` run in the service folder; all others run from the repository root.
- Every command that runs Java or Maven starts with this exact prefix (each Bash call is a new shell, so repeat it every time):
  ```bash
  export JAVA_HOME="/c/Program Files/Java/jdk-25.0.2" MVN="/c/Program Files/Java/apache-maven-3.9.6/bin/mvn" &&
  ```
  Below it is written as `<JAVA>`. Replace `<JAVA>` with the full prefix line above, and call Maven as `"$MVN"`.
- Copy files **exactly** from the Appendix of `services/ledger-service/openspec/changes/service-skeleton/design.md` (A1 to A22). Appendix code blocks are fenced with four backticks; copy only the lines between the fences. Do not change versions, names or wording. Do not add files, dependencies or features that are not listed.
- Maven prints `WARNING: A restricted method in java.lang.System has been called` and shade prints `overlapping resource` warnings. Both are expected; ignore them.
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
  - the `ledger-service` check fails on the pull request.

## 1. Maven project and service code (specs: service-baseline, double-entry-posting)

- [x] 1.1 Check the tools and the branch:
  - `git branch --show-current` must print `feat/ledger-service-skeleton`;
  - `<JAVA> "$JAVA_HOME/bin/java" -version 2>&1 | head -1` must print a line starting with `java version "25.`;
  - `<JAVA> "$MVN" -v 2>&1 | grep "Apache Maven"` must print a line starting with `Apache Maven 3.9.6`;
  - `node --version` must start with `v26.`.

  Verify: all four outputs match.
- [x] 1.2 Create these files from the Appendix. `J` stands for `services/ledger-service/src/main/java/io/github/gradiputera/ledger` and `T` for `services/ledger-service/src/test/java/io/github/gradiputera/ledger`:
  - `services/ledger-service/pom.xml` (A1);
  - `J/Main.java` (A2), `J/JsonLogFormatter.java` (A3);
  - `J/auth/Identity.java` (A4), `J/auth/TokenVerifier.java` (A5), `J/auth/JwksLoader.java` (A6);
  - `J/db/DatabaseUrl.java` (A7), `J/db/Migrations.java` (A8);
  - `J/http/HttpApi.java` (A9);
  - `services/ledger-service/src/main/resources/db/migration/V1__create_ledger.sql` (A10);
  - `T/auth/TokenVerifierTest.java` (A11), `T/db/DatabaseUrlTest.java` (A12), `T/http/HttpApiTest.java` (A13), `T/integration/LocalStackTest.java` (A14).

  Verify: `find services/ledger-service/src -type f | wc -l` prints `13`.
- [x] 1.3 Build and test:
  ```bash
  cd services/ledger-service && <JAVA> "$MVN" -B package 2>&1 | grep -E "Tests run: 18|BUILD"
  ```
  Verify:
  - the output contains `Tests run: 18, Failures: 0, Errors: 0, Skipped: 6` and `BUILD SUCCESS`. The 6 skipped tests are the integration tests, which skip themselves without their environment;
  - `services/ledger-service/target/ledger-service.jar` exists.
- [x] 1.4 Check that the jar refuses to start without configuration:
  ```bash
  cd services/ledger-service && <JAVA> "$JAVA_HOME/bin/java" -jar target/ledger-service.jar; echo "exit=$?"
  ```
  Verify: it prints one JSON line whose `msg` is `ledger-service stopped: DATABASE_URL and SUPABASE_URL must be set`, then `exit=1`.
- [x] 1.5 Confirm that every outbound call has a timeout. Each command must print the number shown:
  - `grep -c "FETCH_TIMEOUT_MS = 5_000" services/ledger-service/src/main/java/io/github/gradiputera/ledger/auth/JwksLoader.java` prints `1`;
  - `grep -c '"connectTimeout", "10"' services/ledger-service/src/main/java/io/github/gradiputera/ledger/db/Migrations.java` prints `1`;
  - `grep -c "statement_timeout=30000" services/ledger-service/src/main/java/io/github/gradiputera/ledger/db/Migrations.java` prints `1`;
  - `grep -c "Duration.ofSeconds(10)" services/ledger-service/src/test/java/io/github/gradiputera/ledger/integration/LocalStackTest.java` prints `2`.
- [x] 1.6 Commit group 1: run the secret scan, then `git add services/ledger-service/pom.xml services/ledger-service/src services/ledger-service/openspec/changes/service-skeleton/tasks.md`, and commit with message `feat(ledger-service): Vert.x skeleton with JWT validation and ledger migrations`. Verify:
  - `git status --porcelain` is empty;
  - `git ls-files services/ledger-service | grep -c "^services/ledger-service/target/"` prints `0`.

## 2. Container and Vercel configuration

- [x] 2.1 Create these files from the Appendix:
  - `services/ledger-service/Dockerfile` (A15);
  - `services/ledger-service/.dockerignore` (A16);
  - `services/ledger-service/vercel.json` (A17).

  Verify:
  - `node -e "JSON.parse(require('fs').readFileSync('services/ledger-service/vercel.json','utf8'))"` exits 0;
  - if `docker info` succeeds, `docker build -t ledger-service:local services/ledger-service` exits 0. If `docker info` fails, write down "local image build not run (Docker unavailable); CI is authoritative" for the PR.
- [x] 2.2 Commit group 2: run the secret scan, then `git add services/ledger-service/Dockerfile services/ledger-service/.dockerignore services/ledger-service/vercel.json services/ledger-service/openspec/changes/service-skeleton/tasks.md`, and commit with message `build(ledger-service): container image and Vercel config`. Verify: `git status --porcelain` is empty.

## 3. CI, contract and Dependabot

- [x] 3.1 Create `.github/workflows/ledger-service.yml` (A20). Replace `contracts/openapi/ledger.yaml` with A21. Append A22 to `.github/dependabot.yml`. Verify:
  - `npx -y yaml-lint@1.7.0 .github/workflows/ledger-service.yml contracts/openapi/ledger.yaml .github/dependabot.yml` reports the files as valid;
  - `git diff --stat contracts/openapi/ledger.yaml` shows `10 insertions(+)` and no deletions;
  - `git diff --stat .github/dependabot.yml` shows `8 insertions(+)` and no deletions;
  - `grep -c "package-ecosystem" .github/dependabot.yml` prints `6`.
- [x] 3.2 Check the contract change for breaking changes:
  ```bash
  git show main:contracts/openapi/ledger.yaml > "$TEMP/ledger-base.yaml"
  GOTOOLCHAIN=go1.27.4 go run github.com/oasdiff/oasdiff@v1.39.0 breaking --fail-on ERR "$TEMP/ledger-base.yaml" contracts/openapi/ledger.yaml
  ```
  Verify: the command exits 0 and reports no breaking changes.
- [x] 3.3 Commit group 3: run the secret scan, then `git add .github/workflows/ledger-service.yml contracts/openapi/ledger.yaml .github/dependabot.yml services/ledger-service/openspec/changes/service-skeleton/tasks.md`, and commit with message `ci(ledger-service): build, test and contract checks`. Verify: `git status --porcelain` is empty.

## 4. Documentation

- [ ] 4.1 Replace `services/ledger-service/README.md` with A19 and create `services/ledger-service/.env.example` (A18). Verify:
  - `git check-ignore -q services/ledger-service/.env` exits 0 (ignored);
  - `git check-ignore -q services/ledger-service/.env.example` exits 1 (not ignored);
  - every relative link in the README points to an existing file: `.env.example`, `../../contracts/openapi/ledger.yaml`, and the six ADR files under `../../architecture/adr/`.
- [ ] 4.2 Commit group 4: run the secret scan, then `git add services/ledger-service/README.md services/ledger-service/.env.example services/ledger-service/openspec/changes/service-skeleton/tasks.md`, and commit with message `docs(ledger-service): configuration, local development and owner setup`. Verify: `git status --porcelain` is empty.

## 5. Integration check and pull request

- [ ] 5.1 Run the full check from a clean state:
  ```bash
  cd services/ledger-service && <JAVA> "$MVN" -B clean package 2>&1 | grep -E "Tests run: 18|BUILD" && npx -y @fission-ai/openspec@latest validate --all --strict && cd ../.. && npx -y @fission-ai/openspec@latest validate --all --strict
  ```
  Then run the secret scan. Verify:
  - Maven prints `Tests run: 18, Failures: 0, Errors: 0, Skipped: 6` and `BUILD SUCCESS`;
  - both `validate` commands exit 0;
  - `git status --porcelain` is empty (the `target/` folder is gitignored);
  - `git ls-files | grep -E "(^|/)(\.env|node_modules|\.nuxt|\.output|target)(/|$)"` prints nothing.
- [ ] 5.2 Mark this task `- [x]`, commit `services/ledger-service/openspec/changes/service-skeleton/tasks.md` with message `docs(openspec): complete ledger-service service-skeleton tasks` (after the secret scan), then run `git push -u origin feat/ledger-service-skeleton`. Open the pull request with `gh pr create --base main --head feat/ledger-service-skeleton --title "feat(ledger-service): Vert.x service skeleton" --body-file <file>`. Write the body file in the scratchpad or system temp directory, not in the repository. The body has:
  - `## Summary`: bullets for:
    - the Maven project and Vert.x HTTP server;
    - JWT validation with Vert.x `JWTAuth` and JWKS;
    - startup Flyway migrations, with the chart of accounts and the journal tables;
    - the database-enforced balance and append-only rules;
    - the planned endpoints answering 501;
    - the container image and `vercel.json`;
    - the CI workflow, the contract change and Dependabot;
    - the docs;
  - `## Decisions`: links to ADR 0003, ADR 0004, ADR 0006 and ADR 0007, and the OpenSpec change folder `services/ledger-service/openspec/changes/service-skeleton/`;
  - `## Checks`: the Maven build (18 tests, 6 integration tests skipped locally), the jar start check, the local image build result from task 2.1 (built, or "not run"), the oasdiff result, `openspec validate` (service and root), and the gitleaks result;
  - `## Owner actions`: "Set the ledger_service role password, create the Vercel project and set PORT, SUPABASE_URL and DATABASE_URL, then check /health, as described in services/ledger-service/README.md, section Owner setup (hosted).";
  - the PR attribution line your harness provides at the end.

  Then wait for the checks with `gh pr checks --watch --interval 30`. Do not merge the pull request. Verify: `gh pr checks` shows `ledger-service` as `pass`. If it fails, stop and report the failing step's log (`gh run view <run-id> --log-failed`).

## Workflow follow-up

- The owner merges the pull request after `ledger-service` and gitleaks pass.
- The owner completes the hosted setup in the README and checks `/health` on the Vercel deployment.
- Archive the change after the hosted check passes.
