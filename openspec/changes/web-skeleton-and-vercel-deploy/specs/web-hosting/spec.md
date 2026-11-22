# Spec Delta

## Purpose

Defines how the Nuxt web application is built, verified and served: its Vercel deployment model, the CI gate that protects `main`, its health endpoint and the security headers on every response.

## ADDED Requirements

### Requirement: Production deploys from main
The web application SHALL be deployed to production on Vercel from the `main` branch, with `apps/web` as the project root directory.

#### Scenario: A pull request is merged
- **WHEN** a pull request that changes the web application is merged into `main`
- **THEN** Vercel builds that commit and serves it on the production URL

### Requirement: Preview deploys per pull request
Every pull request that changes the web application SHALL get its own Vercel preview deployment, separate from production.

#### Scenario: A pull request is opened
- **WHEN** a pull request that changes `apps/web` is opened or updated
- **THEN** a preview deployment is built for its latest commit and production is unchanged

### Requirement: CI gate for the web application
The repository SHALL type-check, test and build the web application on every pull request and push to `main` that changes the web application or the workspace files, and the check SHALL fail if any of these steps fails.

#### Scenario: A change breaks the build
- **WHEN** a pull request introduces a type error, a failing test or a build error in the web application
- **THEN** the web CI check fails on that pull request

#### Scenario: A change outside the web application
- **WHEN** a pull request changes only files outside `apps/web`, the workspace files and the web workflow
- **THEN** the web CI check does not run

### Requirement: Health endpoint
The web application SHALL answer `GET /api/health` with HTTP 200, the JSON body `{"status":"ok"}` and `Cache-Control: no-store`, without calling any other system.

#### Scenario: Uptime check
- **WHEN** a client requests `GET /api/health`
- **THEN** the response is HTTP 200 with body `{"status":"ok"}` and the header `Cache-Control: no-store`

### Requirement: Baseline security headers
Every response of the web application SHALL include `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` and a `Permissions-Policy` that disables camera, microphone and geolocation.

#### Scenario: Main page headers
- **WHEN** a visitor requests `/`
- **THEN** the response carries all four headers with the values above

#### Scenario: Playground and API headers
- **WHEN** a client requests `/playground` or `/api/health`
- **THEN** the response carries all four headers with the values above
