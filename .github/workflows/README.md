# .github/workflows

GitHub Actions workflows for the repository.

## Status

Planned

## Workflows

- `secret-scan.yml`: gitleaks secret scan on every push and pull request.

Later workflows (planned, added with the code they check): per-service build and test, `openspec validate --strict`, the schema-boundary check, `oasdiff` for breaking OpenAPI changes, and the event-schema check.

## Related

- [ADR 0013: Spec-driven development with OpenSpec](../../architecture/adr/0013-spec-driven-development-with-openspec.md)
- [Security policy](../../SECURITY.md)
