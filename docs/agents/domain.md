# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root (doesn't exist yet — that's fine, see below).
- **`internal/docs/adr/`** — read ADRs that touch the area you're about to work in. This repo keeps every ADR here (ADR-0001 onwards), not in `docs/adr/`.
- **`internal/docs/README.md`** — the Source of Truth index. It lists every doc under `internal/docs/**`; use it to find the right doc before reading further.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

This repo is **single-context**: one `CONTEXT.md` at the root, and one shared ADR directory — even though it is a pnpm workspace (`shared`, `server`, `src`, `cli`, `runner`). Don't create per-package `CONTEXT.md` or per-package `docs/adr/`.

```
/
├── CONTEXT.md
├── internal/
│   └── docs/
│       ├── README.md                  ← Source of Truth index
│       └── adr/
│           ├── 0001-docs-as-source-of-truth.md
│           └── 0002-git-worktree-isolation.md
├── shared/  server/  src/  cli/  runner/
```

## Writing a new ADR

Follow the repo's existing conventions:

- Number sequentially after the highest existing ADR in `internal/docs/adr/`. Numbers collide easily — enumerate across **all** branches and `git worktree list` before claiming one.
- Link the new ADR from **both** `internal/docs/README.md` **and** `internal/docs/adr/README.md` (SPEC-386).
- Update any touched doc under `internal/docs/**` in the **same commit** as the code change.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
