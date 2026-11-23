# Spec Delta

## Purpose
Defines how the five service projects (account, ledger, payment, notification, reporting) are deployed on Vercel and how their changes are verified before they reach production.

## ADDED Requirements

### Requirement: Services deploy to production from main only
Each service's Vercel project SHALL create a deployment only for commits on the `main` branch. A push to any other branch, including pull request and Dependabot branches, MUST NOT create a deployment of a service project.

#### Scenario: A pull request branch is pushed
- **WHEN** a commit is pushed to a branch such as `feat/reporting-service-skeleton` or `dependabot/npm_and_yarn/x`
- **THEN** no service project creates a deployment, and the pull request shows no Vercel check for any service

#### Scenario: A pull request is merged
- **WHEN** a pull request is merged into `main`
- **THEN** each service project deploys that commit to production

### Requirement: Pull requests are verified by CI, not previews
Every pull request that changes a service SHALL be verified by that service's CI workflow, which tests the service and builds and smoke-tests its container image, instead of by a preview deployment.

#### Scenario: A service change is proposed
- **WHEN** a pull request changes files under `services/<svc>/`
- **THEN** the `<svc>` workflow runs the service's tests, builds its image and smoke-tests the container
