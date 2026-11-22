# 0003. Service per Vercel project as containers

- Status: Accepted
- Date: 2026-11-21
- Amended: 2026-11-22 (service projects deploy from `main` only)

## Context

The services must run on free hosting, scale to zero when idle, and still look like real deployable units. Vercel Hobby is free and familiar, and its Container runtime (beta) accepts arbitrary Docker images. Each service should also run unchanged in local Docker Compose and in Kubernetes.

## Decision

- Each service is its own Vercel Hobby project, deployed from its own folder with the Vercel Container runtime.
- Service projects deploy from `main` only (`git.deploymentEnabled` in each service's `vercel.json`). Pull requests are verified by each service's CI workflow, which tests the service and builds and smoke-tests its image, instead of by preview deployments: previews would count toward the Hobby deployment limit and would have no hosted configuration.
- Each service listens on `$PORT` (default 80) and ships one Dockerfile. The same Dockerfile is used on Vercel, in Compose and in Kubernetes.
- `apps/web` (Nuxt) deploys natively on Vercel and is not containerized.
- Fallback host if the Container runtime (beta) misbehaves: a Render free web service, using the same Dockerfiles.

## Consequences

### Positive

- One artifact per service, reproducible across environments.
- Free hosting with per-service deployment history.

### Negative

- The Container runtime is beta; availability may change. The Render fallback limits the risk.
- Scale-to-zero means cold starts, which show up in latency dashboards.
- Hobby limits apply; they are listed in the guardrails and the project README.

## Alternatives considered

- **One Vercel project for a monorepo of all services**: rejected, because services would not deploy and scale independently.
- **Google Cloud Run or AWS**: rejected for cost and setup weight on a free-tier portfolio.
- **Render for everything**: kept as the fallback host, not the default.
