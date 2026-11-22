# Design

## Context

- Five service projects (account, ledger, payment, notification, reporting) are connected to this repository on Vercel Hobby, each with its own Root Directory and a `vercel.json` that holds only `$schema` and `"framework": "container"`. reporting-service's file arrives with PR #39.
- The web app (`apps/web`) is a sixth project, configured in the dashboard, with no `vercel.json`. Its `web-hosting` spec requires a preview per pull request.
- Vercel deploys every pushed commit in every connected project unless that project's configuration says otherwise. A pull request push therefore costs six deployments against the Hobby limit of 100 per day (Vercel limits docs: "Deployments Created per Day", Hobby 100).
- Facts from Vercel's documentation, checked for this change:
  - `ignoreCommand` (Ignored Build Step) runs in the Root Directory, and exit 0 cancels the build. But "Canceled builds are counted as full deployments as they execute a build command" (project settings docs), so it does not save allowance.
  - `git.deploymentEnabled` takes `false`, or an object of branch globs to booleans. Globs use minimatch, and "if a branch matches several rules and one is true, it deploys" (Git configuration docs).
  - "Skipping unaffected projects", whose skipped builds no longer count, requires npm, Yarn, pnpm or Bun workspaces that contain every project; the services are Go, Java, PHP and Python containers outside the pnpm workspace.

## Goals / Non-Goals

**Goals:**
- No deployments of service projects from any branch except `main`.
- Record the rule in ADR 0003, the root README and a `service-hosting` spec.

**Non-Goals:**
- Changing the web app's previews, or adding a `vercel.json` to `apps/web`.
- Skipping unchanged services on `main` (an Ignored Build Step still counts and needs system variables exposed in the dashboard).
- Any dashboard change or redeploy.

## Decisions

### D1. `git.deploymentEnabled` with `"**": false` and `"main": true`
Each service `vercel.json` becomes (A1):
- `"**": false` matches every branch name, including names with slashes;
- `"main": true` matches `main`, and one matching `true` rule is enough to deploy.

Checked with minimatch 10 before writing this design:

| Branch | Matches `*` | Matches `**` | Deploys |
|---|---|---|---|
| `main` | yes | yes | yes (`main` is true) |
| `feat/reporting-service-skeleton` | no | yes | no |
| `dependabot/npm_and_yarn/x-1.2` | no | yes | no |
| `main-old` | yes | yes | no |
| `chore/main` | no | yes | no |

`"*": false` would have been wrong: branches with a slash would match no rule and deploy by default.

Alternatives rejected:
- **`ignoreCommand`:** builds it skips still count as deployments.
- **`"deploymentEnabled": false`:** would stop production deployments too.
- **Dashboard settings per project:** owner-only, invisible in review, and not versioned. The file setting is reviewed, versioned and applies to every project the same way.

### D2. Verification
Vercel behaviour cannot be exercised in CI. The checks are:
- each file parses as JSON and has exactly the A1 content (`diff` against the appendix);
- every service workflow runs on this pull request (each `vercel.json` is under `services/<svc>/**`), proving the files do not affect the builds;
- on this pull request itself Vercel reads the branch's `vercel.json`, so the service projects should create no deployment and post no check, which the owner can see on the PR. Only the web app's preview remains.

### D3. Documentation
- **ADR 0003:** an `Amended: 2026-11-22` line under the date, and a Decision bullet (A2). The decision itself (one project per service) is unchanged, so no new ADR.
- **`README.md`:** the Vercel Hobby bullet in the hosting notes gains one sentence (A3).

Free-tier usage: a pull request push goes from six deployments to one (the web preview). A merge to `main` still deploys six projects; at 100 deployments per day that leaves room for about 16 merges per day with no PR previews from services.

## Risks / Trade-offs

- [No service preview to try a change on Vercel's runtime before merging] → CI builds and smoke-tests the same Dockerfile. A Vercel-specific problem shows up on the production deployment, where the previous deployment stays available for instant rollback.
- [Vercel's matching differs from minimatch's defaults] → The docs name minimatch and give the "any true wins" rule. If a branch still deploys, the PR's Vercel checks show it at once, and the setting can be corrected in a follow-up change.
- [A merge to `main` still deploys all five services, even unchanged ones] → Accepted for now; skipping unchanged services would still count toward the limit.

## Appendix

Copy every block exactly. Code blocks are fenced with four backticks; copy only the lines between the fences.

### A1. `services/<svc>/vercel.json` (full file, identical for all five services)

For `<svc>` in `account-service`, `ledger-service`, `payment-service`, `notification-service` and `reporting-service`, replace the whole file with:

````json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "container",
  "git": {
    "deploymentEnabled": {
      "**": false,
      "main": true
    }
  }
}
````

### A2. `architecture/adr/0003-service-per-vercel-project-as-containers.md` (two insertions)

1. Insert this line directly after the line `- Date: 2026-11-21`:

````md
- Amended: 2026-11-22 (service projects deploy from `main` only)
````

2. Insert this line directly after the line `- Each service is its own Vercel Hobby project, deployed from its own folder with the Vercel Container runtime.`:

````md
- Service projects deploy from `main` only (`git.deploymentEnabled` in each service's `vercel.json`). Pull requests are verified by each service's CI workflow, which tests the service and builds and smoke-tests its image, instead of by preview deployments: previews would count toward the Hobby deployment limit and would have no hosted configuration.
````

Change nothing else.

### A3. `README.md` (one replaced line)

Replace this line:

````md
- **Vercel Hobby**: one project per service using the Container runtime (beta), and the Nuxt app natively. Fallback host: Render free web service.
````

with:

````md
- **Vercel Hobby**: one project per service using the Container runtime (beta), and the Nuxt app natively. Service projects deploy from `main` only; the Nuxt app also gets a preview per pull request. Fallback host: Render free web service.
````

Change nothing else.
