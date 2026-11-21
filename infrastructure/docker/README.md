# infrastructure/docker

Docker Compose setup for running the full stack locally, including the local observability backend (`grafana/otel-lgtm`).

## Status

Planned

## Responsibilities

- Compose file that starts all five services, the web app and the local observability stack.
- Each service's Dockerfile is the same one used by Vercel and Kubernetes (ADR 0003).

## Related

- [ADR 0003: Service per Vercel project as containers](../../architecture/adr/0003-service-per-vercel-project-as-containers.md)
- [Observability](../observability/README.md)
