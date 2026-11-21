# infrastructure/kubernetes

Kubernetes manifests for running the services on a local kind cluster, built from the same Dockerfiles as Vercel and Compose.

## Status

Planned

## Responsibilities

- kind cluster manifests for the five services, the web app and their configuration.
- No secrets in manifests; secrets are created from local, uncommitted sources.

## Related

- [ADR 0003: Service per Vercel project as containers](../../architecture/adr/0003-service-per-vercel-project-as-containers.md)
- [Docker](../docker/README.md)
