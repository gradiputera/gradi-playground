# 0013. Spec-driven development with OpenSpec

- Status: Accepted
- Date: 2026-11-21

## Context

The playground is developed largely with AI coding agents. Without explicit structure, an agent can write code without a spec, extend scope silently, touch other services, or run dangerous commands. The project needs a repeatable change lifecycle and guardrails that work in documentation (soft) and in tool configuration (hard).

## Decision

### Layout (D12)

- OpenSpec (Fission-AI) is used through `npx -y @fission-ai/openspec@latest`. It is never a committed dependency.
- The root `openspec/` holds system-level capabilities (`web-routing`, `auth`, `site-routing`, `eventing`, `observability`, `sandbox`) and cross-service changes.
- `services/<svc>/openspec/` holds each service's own specs and changes.
- Agent tooling is generated for Claude Code only.

### Change lifecycle

Every feature starts as an OpenSpec change: proposal, then apply (implement only the tasks), then archive. One pull request per change.

### Guardrails (D13)

- **Soft layer**: `openspec/config.yaml` and each service's `config.yaml` carry the guardrail text as context and per-artifact rules; `CLAUDE.md` repeats the root rules.
- **Hard layer**: `.claude/settings.json` denies the most dangerous commands and reads: real `.env` files, force pushes, `terraform apply` and `destroy`, `supabase db push`, remote `supabase db reset`, and `vercel --prod`.
- **Planned**: CI checks (schema-boundary check, `openspec validate --strict`, `oasdiff` for breaking API changes) and a PreToolUse hook that restricts edits to the active service folder. These arrive with the code.

## Consequences

### Positive

- Every change is traceable from a proposal to archived specs.
- Guardrails exist both as instructions and as enforced deny rules.
- Work stays within one service unless a root change is approved.

### Negative

- Specs are extra work for small changes; the lifecycle is deliberately heavier than ad-hoc coding.
- Soft guardrails depend on the agent following instructions; only the deny rules are enforced, and CI enforcement is still planned.
- Generated tooling must be reviewed when OpenSpec is upgraded.

## Alternatives considered

- **Ad-hoc prompts with no specs**: rejected, because decisions and scope would be lost between sessions.
- **A committed OpenSpec dependency**: rejected, because the CLI is a development tool, not a runtime dependency.
- **Guardrails only in documentation**: rejected, because documentation alone cannot stop a dangerous command.
- **Guardrails only in tool settings**: rejected, because the rationale would not be visible to readers and future agents.
