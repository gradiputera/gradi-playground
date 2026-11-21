# infrastructure/terraform

Terraform configuration for hosted resources, using the `vercel/vercel` and `supabase/supabase` providers.

## Status

Planned

## Responsibilities

- Describes Vercel projects and Supabase settings as code.
- The coding agent never runs `terraform apply` or `terraform destroy`; these are owner actions.
- State files and `*.tfvars` with values are never committed (only `*.tfvars.example`).

## Related

- [Project guardrails](../../CLAUDE.md)
- [ADR 0013: Spec-driven development with OpenSpec](../../architecture/adr/0013-spec-driven-development-with-openspec.md)
