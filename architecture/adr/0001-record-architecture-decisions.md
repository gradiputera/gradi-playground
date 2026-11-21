# 0001. Record architecture decisions

- Status: Accepted
- Date: 2026-11-21

## Context

This playground is built to demonstrate engineering decisions, not only code. Choices such as language per service, hosting, database isolation, eventing and auth shape the whole system. Without a written record, the reasons behind them are lost, and later changes are made without knowing which trade-offs were accepted.

## Decision

We will record architecture decisions that are significant, hard to reverse or cross-cutting as ADRs in `architecture/adr/`. Each ADR:

- is named `NNNN-slug.md` and follows [0000-template.md](0000-template.md);
- states its context, the decision, consequences (positive and negative) and the alternatives considered;
- is never rewritten to change history. A changed decision gets a new ADR that supersedes the old one, and the old one is marked `Superseded`.

Small, local choices go to the lightweight [decision log](../decisions/README.md) instead.

## Consequences

### Positive

- Decisions and their trade-offs are visible to readers and to future agents working in the repository.
- Superseding instead of rewriting keeps the history honest.

### Negative

- Writing an ADR costs time; it is reserved for decisions with lasting impact.

## Alternatives considered

- **Wiki pages outside the repository**: rejected, because they drift from the code and are not reviewed with changes.
- **Only commit messages**: rejected, because commit messages do not explain the alternatives or the consequences.
