# Tasks

Execution rules (read first):
- Work on branch `feat/payment-service-skeleton` in `D:\Git\Gradi\gradi-playground`. It already holds the proposal commit. Use Bash (Git Bash) syntax as written. Commands that start with `cd services/payment-service &&` run in the service folder; all others run from the repository root.
- Prefix **every** `go` command with `GOTOOLCHAIN=go1.27.4`, exactly as written below. The installed Go downloads the 1.27.4 toolchain by itself on first use.
- Copy files **exactly** from the Appendix of `services/payment-service/openspec/changes/service-skeleton/design.md` (A1 to A18). Appendix code blocks are fenced with four backticks; copy only the lines between the fences. Do not change versions, names or wording. Do not add files, dependencies or features that are not listed.
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
  - the `payment-service` check fails on the pull request.

## 1. Go module and service code (spec: service-baseline)

- [ ] 1.1 Check the tools and the branch:
  - `git branch --show-current` must print `feat/payment-service-skeleton`;
  - `GOTOOLCHAIN=go1.27.4 go version` must print `go version go1.27.4` followed by the platform;
  - `node --version` must start with `v26.`.

  Verify: all three outputs match.
- [ ] 1.2 Create these files from the Appendix:
  - `services/payment-service/go.mod` (A1);
  - `services/payment-service/main.go` (A2);
  - `services/payment-service/internal/auth/auth.go` (A3);
  - `services/payment-service/internal/auth/auth_test.go` (A4);
  - `services/payment-service/internal/httpapi/server.go` (A5);
  - `services/payment-service/internal/httpapi/server_test.go` (A6);
  - `services/payment-service/internal/migrations/migrations.go` (A7);
  - `services/payment-service/internal/migrations/sql/000001_create_payments.up.sql` (A8);
  - `services/payment-service/internal/migrations/sql/000001_create_payments.down.sql` (A9);
  - `services/payment-service/internal/integration/integration_test.go` (A10).

  Then generate `go.sum` and check that `go.mod` did not change:
  ```bash
  cp services/payment-service/go.mod "$TEMP/go.mod.a1"
  cd services/payment-service && GOTOOLCHAIN=go1.27.4 go mod tidy && cd ../.. && diff "$TEMP/go.mod.a1" services/payment-service/go.mod && echo GO_MOD_UNCHANGED
  ```
  Verify: the command prints `GO_MOD_UNCHANGED`, and `services/payment-service/go.sum` exists.
- [ ] 1.3 Check the code:
  ```bash
  cd services/payment-service && gofmt -l . && GOTOOLCHAIN=go1.27.4 go vet ./... && GOTOOLCHAIN=go1.27.4 go test ./...
  ```
  Verify:
  - `gofmt -l .` prints nothing and `go vet` prints nothing;
  - `go test` prints `ok` for `internal/auth`, `internal/httpapi` and `internal/integration` (the integration tests skip themselves without their environment), and `[no test files]` for the root package and `internal/migrations`.
- [ ] 1.4 Confirm that every outbound call has a timeout. Each of these commands must print exactly one line:
  ```bash
  grep -n "HTTPTimeout:               5 \* time.Second" services/payment-service/internal/auth/auth.go
  grep -n "context.WithTimeout(ctx, 30\*time.Second)" services/payment-service/main.go
  grep -n "Timeout: 10 \* time.Second" services/payment-service/internal/integration/integration_test.go
  ```
  Verify: three commands, one line each.
- [ ] 1.5 Commit group 1: run the secret scan, then `git add services/payment-service/go.mod services/payment-service/go.sum services/payment-service/main.go services/payment-service/internal services/payment-service/openspec/changes/service-skeleton/tasks.md`, and commit with message `feat(payment-service): Go skeleton with JWT validation and own-schema migrations`. Verify: `git status --porcelain` is empty.

## 2. Container and Vercel configuration

- [ ] 2.1 Create these files from the Appendix:
  - `services/payment-service/Dockerfile` (A11);
  - `services/payment-service/.dockerignore` (A12);
  - `services/payment-service/vercel.json` (A13).

  Verify:
  - `node -e "JSON.parse(require('fs').readFileSync('services/payment-service/vercel.json','utf8'))"` exits 0;
  - `cd services/payment-service && CGO_ENABLED=0 GOOS=linux GOTOOLCHAIN=go1.27.4 go build -trimpath -o "$TEMP/payment-service-linux" .` exits 0;
  - if `docker info` succeeds, `docker build -t payment-service:local services/payment-service` exits 0. If `docker info` fails, write down "local image build not run (Docker unavailable); CI is authoritative" for the PR.
- [ ] 2.2 Commit group 2: run the secret scan, then `git add services/payment-service/Dockerfile services/payment-service/.dockerignore services/payment-service/vercel.json services/payment-service/openspec/changes/service-skeleton/tasks.md`, and commit with message `build(payment-service): container image and Vercel config`. Verify: `git status --porcelain` is empty.

## 3. CI, contract and Dependabot

- [ ] 3.1 Create `.github/workflows/payment-service.yml` (A16). Replace `contracts/openapi/payment.yaml` with A17. Append A18 to `.github/dependabot.yml`. Verify:
  - `npx -y yaml-lint@1.7.0 .github/workflows/payment-service.yml contracts/openapi/payment.yaml .github/dependabot.yml` reports every file as valid;
  - `git diff --stat contracts/openapi/payment.yaml` shows `4 insertions(+)` and no deletions;
  - `git diff --stat .github/dependabot.yml` shows `8 insertions(+)` and no deletions;
  - `grep -c "package-ecosystem" .github/dependabot.yml` prints `4`.
- [ ] 3.2 Check the contract change for breaking changes:
  ```bash
  git show main:contracts/openapi/payment.yaml > "$TEMP/payment-base.yaml"
  GOTOOLCHAIN=go1.27.4 go run github.com/oasdiff/oasdiff@v1.39.0 breaking --fail-on ERR "$TEMP/payment-base.yaml" contracts/openapi/payment.yaml
  ```
  Verify: the command exits 0 and reports no breaking changes.
- [ ] 3.3 Commit group 3: run the secret scan, then `git add .github/workflows/payment-service.yml contracts/openapi/payment.yaml .github/dependabot.yml services/payment-service/openspec/changes/service-skeleton/tasks.md`, and commit with message `ci(payment-service): build, test and contract checks`. Verify: `git status --porcelain` is empty.

## 4. Documentation

- [ ] 4.1 Replace `services/payment-service/README.md` with A15 and create `services/payment-service/.env.example` (A14). Verify:
  - `git check-ignore -q services/payment-service/.env` exits 0 (ignored);
  - `git check-ignore -q services/payment-service/.env.example` exits 1 (not ignored);
  - every relative link in the README points to an existing file: `.env.example`, `../../contracts/openapi/payment.yaml`, and the six ADR files under `../../architecture/adr/`.
- [ ] 4.2 Commit group 4: run the secret scan, then `git add services/payment-service/README.md services/payment-service/.env.example services/payment-service/openspec/changes/service-skeleton/tasks.md`, and commit with message `docs(payment-service): configuration, local development and owner setup`. Verify: `git status --porcelain` is empty.

## 5. Integration check and pull request

- [ ] 5.1 Run the full check from a clean state:
  ```bash
  cd services/payment-service && GOTOOLCHAIN=go1.27.4 go clean -testcache && gofmt -l . && GOTOOLCHAIN=go1.27.4 go vet ./... && GOTOOLCHAIN=go1.27.4 go test ./... && GOTOOLCHAIN=go1.27.4 go build ./... && npx -y @fission-ai/openspec@latest validate --all --strict && cd ../.. && npx -y @fission-ai/openspec@latest validate --all --strict
  ```
  Then run the secret scan. Verify:
  - every command exits 0, and `gofmt -l .` prints nothing;
  - `git ls-files | grep -E "(^|/)(\.env|node_modules|\.nuxt|\.output)(/|$)"` prints nothing;
  - `git ls-files services/payment-service | grep -E "\.(exe|test)$"` prints nothing.
- [ ] 5.2 Mark this task `- [x]`, commit `services/payment-service/openspec/changes/service-skeleton/tasks.md` with message `docs(openspec): complete payment-service service-skeleton tasks` (after the secret scan), then run `git push -u origin feat/payment-service-skeleton`. Open the pull request with `gh pr create --base main --head feat/payment-service-skeleton --title "feat(payment-service): Go service skeleton" --body-file <file>`. Write the body file in the scratchpad or system temp directory, not in the repository. The body has:
  - `## Summary`: bullets for the Go module and HTTP server, JWT validation through JWKS, startup migrations and the `payments` table, the planned endpoints answering 501, the container image and `vercel.json`, the CI workflow, the contract change and Dependabot, and the docs;
  - `## Decisions`: links to ADR 0003, ADR 0004 and ADR 0007, and the OpenSpec change folder `services/payment-service/openspec/changes/service-skeleton/`;
  - `## Checks`: gofmt, vet, unit tests, the local image build result from task 2.1 (built, or "not run"), the oasdiff result, `openspec validate` (service and root), and the gitleaks result;
  - `## Owner actions`: "Set the payment_service role password, create the Vercel project and set PORT, SUPABASE_URL and DATABASE_URL, then check /health, as described in services/payment-service/README.md, section Owner setup (hosted).";
  - the PR attribution line your harness provides at the end.

  Then wait for the checks with `gh pr checks --watch --interval 30`. Do not merge the pull request. Verify: `gh pr checks` shows `payment-service` as `pass`. If it fails, stop and report the failing step's log (`gh run view <run-id> --log-failed`).

## Workflow follow-up

- The owner merges the pull request after `payment-service` and gitleaks pass.
- The owner completes the hosted setup in the README and checks `/health` on the Vercel deployment.
- Archive the change after the hosted check passes.
