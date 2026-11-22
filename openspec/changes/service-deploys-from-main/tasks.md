# Tasks

Execution rules (read first):
- Work on branch `chore/service-deploys-from-main` in `D:\Git\Gradi\gradi-playground`. It already holds the proposal commit. Use Bash (Git Bash) syntax as written; all commands run from the repository root.
- Copy every block **exactly** from the Appendix of `openspec/changes/service-deploys-from-main/design.md` (A1 to A3). Appendix code blocks are fenced with four backticks; copy only the lines between the fences. Change nothing else.
- After finishing each task, change its `- [ ]` to `- [x]` in this file.
- Secret scan before every commit. Run it **after** `git add` and before `git commit`. It scans exactly what is staged:
  ```bash
  "/c/Users/vsiss/AppData/Local/Microsoft/WinGet/Packages/Gitleaks.Gitleaks_Microsoft.Winget.Source_8wekyb3d8bbwe/gitleaks.exe" git --staged --redact .
  ```
  It must print `no leaks found` and exit 0. Check the exit code; do not pipe the scan into another command. The repository-local git identity is already configured; do not change git config.
- Every commit message ends with a blank line and the attribution line your harness provides; if it provides none, use `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Never run the `vercel` CLI, change a Vercel or Supabase dashboard, redeploy anything, force-push, or rebase. Never read or create `.env` files.
- Stop and report (do not guess or work around) only if:
  - a command in a task fails twice after re-reading the task;
  - a command is denied by a permission check;
  - task 1.1 finds that PR #39 is not merged;
  - a service workflow or gitleaks fails on the pull request.

## 1. Service Vercel configuration (spec: service-hosting)

- [x] 1.1 Bring in `main`, which must already contain reporting-service:
  - `gh pr view 39 --json state -q .state` must print `MERGED`. If it prints anything else, stop and report.
  - Run `git fetch origin && git merge --no-edit origin/main`.

  Verify: `git branch --show-current` prints `chore/service-deploys-from-main`, and `ls services/*/vercel.json | wc -l` prints `5`.
- [x] 1.2 Replace each of the five `services/<svc>/vercel.json` files with A1. Verify, for each of the five files:
  - `node -e "JSON.parse(require('fs').readFileSync('<file>','utf8'))"` exits 0;
  - `grep -c '"\*\*": false' <file>` prints `1` and `grep -c '"main": true' <file>` prints `1`;
  - the five files are identical: `md5sum services/*/vercel.json | awk '{print $1}' | sort -u | wc -l` prints `1`;
  - `git diff --stat -- services` lists exactly the five files, each with `7 insertions(+), 1 deletion(-)`.
- [x] 1.3 Commit group 1: `git add services/account-service/vercel.json services/ledger-service/vercel.json services/payment-service/vercel.json services/notification-service/vercel.json services/reporting-service/vercel.json openspec/changes/service-deploys-from-main/tasks.md`, run the secret scan, and commit with message `build(services): deploy service projects from main only`. Verify: `git status --porcelain` is empty.

## 2. Documentation

- [x] 2.1 Apply A2 to `architecture/adr/0003-service-per-vercel-project-as-containers.md` and A3 to `README.md`. Verify:
  - `git diff --stat` lists `architecture/adr/0003-service-per-vercel-project-as-containers.md` with `2 insertions(+)` and no deletions, and `README.md` with `1 insertion(+), 1 deletion(-)`;
  - `grep -c "Amended: 2026-11-22" architecture/adr/0003-service-per-vercel-project-as-containers.md` prints `1`;
  - `grep -c "Service projects deploy from \`main\` only" README.md` prints `1`.
- [x] 2.2 Commit group 2: `git add architecture/adr/0003-service-per-vercel-project-as-containers.md README.md openspec/changes/service-deploys-from-main/tasks.md`, run the secret scan, and commit with message `docs: record that service projects deploy from main only`. Verify: `git status --porcelain` is empty.

## 3. Checks and pull request

- [x] 3.1 Run `npx -y @fission-ai/openspec@latest validate --all --strict` (it must pass) and scan the branch: `"/c/Users/vsiss/AppData/Local/Microsoft/WinGet/Packages/Gitleaks.Gitleaks_Microsoft.Winget.Source_8wekyb3d8bbwe/gitleaks.exe" git --log-opts="origin/main..HEAD" --redact .` (it must print `no leaks found`).
- [x] 3.2 Mark this task `- [x]`, `git add openspec/changes/service-deploys-from-main/tasks.md`, run the secret scan, and commit with message `docs(openspec): complete service-deploys-from-main tasks`. Push with `git push -u origin chore/service-deploys-from-main`. Open the pull request with `gh pr create --base main --head chore/service-deploys-from-main --title "build(services): deploy service projects from main only" --body-file <file>`. Write the body file in the scratchpad or system temp directory, not in the repository. The body has:
  - `## Summary`: the five `vercel.json` files gain `git.deploymentEnabled` (`"**": false`, `"main": true`), so service projects no longer create preview deployments; the web app keeps its previews; ADR 0003 amended; README hosting note;
  - `## Why`: PR #39's Vercel checks all failed with the Hobby daily deployment limit; builds skipped by `ignoreCommand` still count, so the setting must stop the deployments from being created;
  - `## Decisions`: links to ADR 0003 and the OpenSpec change folder `openspec/changes/service-deploys-from-main/`;
  - `## Checks`: JSON parse and identical files, `openspec validate`, gitleaks;
  - `## Owner check`: "On this PR, Vercel should show only the web app's check and no service checks.";
  - the PR attribution line your harness provides at the end.

  Then wait with `gh pr checks --watch --interval 30`. Do not merge. Verify: the five service workflows (`account-service`, `ledger-service`, `payment-service`, `notification-service`, `reporting-service`) and `gitleaks` show `pass`. Report the full `gh pr checks` output, including any `Vercel – …` lines, without acting on them.

## Workflow follow-up

- The owner confirms that the PR shows no service Vercel checks, then merges it.
- Archive the change after the merge.
