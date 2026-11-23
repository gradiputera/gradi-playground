# Proposal

## Why

Every push to a pull request branch triggers a Vercel deployment in each of the five service projects, plus the web app's preview. On 2026-11-22 the account reached the Hobby limit of 100 deployments per day. Every Vercel check on PR #39 then failed with "Deployment rate limited — retry in 24 hours", although its code checks passed.

The service previews add nothing:
- each service's CI workflow already builds its image and smoke-tests it against a local Supabase stack;
- the owner sets service environment variables for Production only, so a preview container has no database or webhook secret and exits at startup.

Vercel's Ignored Build Step does not help here: "Canceled builds are counted as full deployments" (Vercel project settings docs). A build it skips still uses the daily allowance. The setting that stops deployments from being created is `git.deploymentEnabled` in `vercel.json`.

Owning scope: **root** (cross-service: one setting in each service's `vercel.json`, plus the hosting docs).

## What Changes

- **Service projects deploy from `main` only.** Each `services/<svc>/vercel.json` (account, ledger, payment, notification, reporting) gains:
  - `"git": { "deploymentEnabled": { "**": false, "main": true } }`;
  - Vercel matches branch names with minimatch, and a branch that matches any `true` rule deploys, so only `main` deploys. `**` (not `*`) is needed, because `*` does not match names with a slash such as `feat/...` or `dependabot/...`.
- **The web app is unchanged:** it keeps its preview per pull request, as the `web-hosting` spec requires.
- **ADR 0003** gets an "Amended" line and one Decision bullet recording that service projects deploy from `main` only and that pull requests are verified by CI.
- **Root `README.md`:** the Vercel Hobby line in the hosting notes says that services deploy from `main` only.

Out of scope:
- the web app's preview deployments, and skipping web previews for PRs that do not touch `apps/web` (a skipped build still counts toward the limit);
- Vercel's "skip unaffected projects" for monorepos, which needs every project in a JavaScript workspace;
- any Vercel dashboard change, and redeploying or retrying anything (owner actions);
- the service code, contracts and CI workflows.

The decision in ADR 0003 (one Vercel project per service) stands; this change records how those projects deploy, as an amendment.

## Capabilities

### New Capabilities
- `service-hosting`: how the five service projects are deployed on Vercel: production from `main` only, no preview deployments, and pull requests verified by each service's CI workflow.

### Modified Capabilities
None. The web app's `web-hosting` requirements are unchanged.

## Impact

- Changed: the five `services/<svc>/vercel.json` files, `architecture/adr/0003-service-per-vercel-project-as-containers.md`, `README.md`.
- New spec: `openspec/specs/service-hosting/spec.md` (on archive).
- Depends on PR #39 being merged first, because it adds `services/reporting-service/vercel.json`.
- Vercel usage: a pull request push creates one deployment (the web preview) instead of six. A merge to `main` still deploys all five services and the web app.
- No dependencies, contracts, events or data change.
- No owner action is needed for the setting itself. After merging, the owner can check that a new pull request shows only the web app's Vercel check.
