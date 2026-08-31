# Custom Agent Effectiveness Implementation Plan

Status: selesai 2026-08-31; seluruh task diimplementasi dan diverifikasi sesuai bukti ADR-0159.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, superpowers:test-driven-development for every behavior change, and superpowers:verification-before-completion before claiming success.

**Goal:** Make Hanoman custom agents native in Claude and Codex, safe by default, selectively activated, operationally measurable, and backed by deterministic evaluations.

**Architecture:** Extend the synced `CustomAgent` contract with execution policy, select effective definitions once per session, and materialize runtime-native configurations in the session temp directory. Runtime lifecycle hooks feed a local-only `AgentInvocation` evidence store; cookie-admin APIs and the existing settings panel expose metrics and human disposition. Product renderers are reused by an opt-in eval harness so prompt quality can be measured without adding model calls to routine tests.

**Tech Stack:** TypeScript, Zod, Prisma/SQLite, Fastify, React, Vitest, Claude Code `--agents`, Codex custom-agent TOML and hooks.

**Spec:** `docs/superpowers/specs/2026-08-31-spec-950-custom-agent-effectiveness-design.md`

**Global constraints:**

- Work only in `.worktrees/custom-agent-effectiveness`; do not touch another session's worktree.
- Use hand-written Prisma migrations and regenerate the client after schema changes.
- Keep `AgentInvocation` local-only: do not add it to sync `FIELDS`, `SYNCED`, or Postgres migration order.
- Preserve byte-identical argv and prompt behavior when no agents are selected.
- Read-only policy must be enforced before mutation by a pure validator plus runtime hook; parent sandbox configuration is only defense in depth.
- Run server tests serially with a unique `TEST_DATABASE_URL` and unset `HANOMAN_CONTROL_ORIGINS`/`SSH_ASKPASS`.
- Do not run the full suite as routine verification. Run only touched tests and touched-package typechecks.
- Commit each independently green task with its docs when appropriate.

---

## Task 1: Add execution profiles and make builtin defaults safe

**Files:**

- Modify: `shared/src/custom-agent.ts`
- Modify: `shared/src/builtin-agents.ts`
- Modify: `shared/src/index.ts`
- Modify: `shared/test/builtin-agents.test.ts`
- Modify: `shared/src/custom-agent-runtime.test.ts`
- Modify: `server/prisma/schema.prisma`
- Add: `server/prisma/migrations/20260831120000_custom_agent_execution_profiles/migration.sql`
- Modify: `server/src/services/sync.ts`
- Modify: `server/src/routes/custom-agents.ts`
- Modify: `server/src/services/custom-agents.ts`
- Modify: `server/test/custom-agents.service.test.ts`
- Modify: `server/test/custom-agents.route.test.ts`
- Modify: `server/test/builtin-agents.test.ts`

### Step 1: Write failing shared contract tests

Assert that the create/update schemas accept and normalize:

```ts
{
  activation: "always" | "smart",
  effort: string | null,
  workspacePolicy: "inherit" | "read-only" | "isolated-worktree",
  maxTurns: number | null,
  timeoutSeconds: number | null,
}
```

Also assert rejection of `maxTurns` outside `1..200`, timeout outside `30..3600`, and `isolated-worktree` for a Codex-only definition. Assert that active builtin rows are `smart` + `read-only`, while `qa-verifier` is disabled and carries the isolated Claude profile.

Run:

```bash
pnpm vitest --run shared/src/custom-agent-runtime.test.ts shared/test/builtin-agents.test.ts --no-file-parallelism
```

Expected: FAIL because the policy fields do not exist and QA is still enabled.

### Step 2: Implement shared types and builtin policy

Add exported unions/constants and Zod fields. Preserve legacy custom-agent defaults (`always`, `inherit`, nullable limits). Add runtime-aware recommended model metadata without forcing a missing model into materialization. Rewrite QA instructions so relevance probes happen only inside a temporary worktree derived from `baseSha` and failure to isolate is reported as `belum terbukti`.

### Step 3: Write failing persistence and upgrade tests

Cover create/list/update round-trips for all five fields. Add two seed upgrade cases:

1. untouched `global:qa-verifier` fingerprint is disabled exactly once;
2. operator-edited instructions, tools, model, policy, or enabled state are preserved.

The fingerprint and policy marker must make subsequent boots idempotent.

Run:

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/profiles.test.db" env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS pnpm vitest --run server/test/custom-agents.service.test.ts server/test/custom-agents.route.test.ts server/test/builtin-agents.test.ts --no-file-parallelism
```

Expected: FAIL because the DB and service discard the new fields and no QA safety migration exists.

### Step 4: Add schema, hand-written migration, sync fields, route, and seed upgrade

Add the five `CustomAgent` columns. Put them in `FIELDS.customAgent`, including nullable/integer handling, but do not change unrelated sync contracts. Implement a narrowly scoped seed-policy marker and fingerprint comparison for QA. Return derived `available` and `availabilityReason` in views without persisting or syncing them.

Run:

```bash
pnpm db:generate
pnpm vitest --run shared/src/custom-agent-runtime.test.ts shared/test/builtin-agents.test.ts --no-file-parallelism
TEST_DATABASE_URL="file:$(mktemp -d)/profiles.test.db" env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS pnpm vitest --run server/test/custom-agents.service.test.ts server/test/custom-agents.route.test.ts server/test/builtin-agents.test.ts --no-file-parallelism
pnpm --filter @hanoman/shared typecheck
pnpm --filter ./server typecheck
```

Expected: PASS.

### Step 5: Commit

```bash
git add shared server
git commit -m "feat(custom-agents): add safe execution profiles"
```

---

## Task 2: Render native Claude/Codex agents with enforced read-only hooks

**Files:**

- Modify: `runner/src/custom-agents.ts`
- Add: `runner/src/agent-readonly.ts`
- Add: `runner/src/codex-agent-config.ts`
- Modify: `runner/src/index.ts`
- Modify: `runner/test/custom-agents.test.ts`
- Add: `runner/test/agent-readonly.test.ts`
- Add: `runner/test/codex-agent-config.test.ts`

### Step 1: Write failing renderer tests

Cover:

- Claude JSON emits `effort`, `maxTurns`, `isolation`, `permissionMode`, and hook configuration.
- Read-only definitions omit `Write`, `Edit`, delegation, `apply_patch`, and unknown MCP mutation tools.
- Codex TOML safely quotes multiline instructions, quotes dotted-key agent names in CLI overrides, uses `0600` config files, and emits `agents.enabled=true` plus concurrency `3` only when non-empty.
- Empty definitions return no argv additions and no delegation text.
- Parent prompt contains name/description/trigger only, never full developer instructions.

Run:

```bash
pnpm vitest --run runner/test/custom-agents.test.ts runner/test/codex-agent-config.test.ts --no-file-parallelism
```

Expected: FAIL because Codex only has an inline roster and Claude ignores execution policy.

### Step 2: Write failing pure validator and executable-hook tests

Test both Claude and Codex hook payload shapes. Allow only documented read-only shell forms (`rg`, read-only `git`, `sed`, `head`, `tail`, `wc`, `ls`). Reject `apply_patch`, redirects, command substitution, mutating git, chained commands, and pipelines into writers before any subprocess is run.

Run:

```bash
pnpm vitest --run runner/test/agent-readonly.test.ts --no-file-parallelism
```

Expected: FAIL because no validator exists.

### Step 3: Implement renderer and validator

Replace `agentRosterBlock()` with:

```ts
materializeCodexAgents(defs, tempDir): Promise<{
  args: string[];
  delegationClause: string;
  warnings: MaterializationWarning[];
}>
```

Use explicit TOML encoding, sanitized filenames independent from agent names, atomic temp writes, `0600` files, and per-definition fail-open warnings. Generate a self-contained JS hook command next to session configs so it has no dependency on global binaries. Preserve the existing Claude API name but extend its output deterministically.

### Step 4: Verify runner layer

```bash
pnpm vitest --run runner/test/custom-agents.test.ts runner/test/agent-readonly.test.ts runner/test/codex-agent-config.test.ts --no-file-parallelism
pnpm --filter ./runner typecheck
```

Expected: PASS.

### Step 5: Commit

```bash
git add runner
git commit -m "feat(runner): materialize native protected custom agents"
```

---

## Task 3: Select smart agents and integrate native materialization into PTY sessions

**Files:**

- Modify: `server/src/services/custom-agents.ts`
- Modify: `server/src/services/pty.ts`
- Modify: `server/test/custom-agents.pty.test.ts`
- Modify: `server/test/custom-agents.service.test.ts`
- Add: `server/test/custom-agent-selection.test.ts`

### Step 1: Write failing selection tests

Build table-driven tests for all eight builtin rules across flow, prompt, changed files, runtime, enabled state, and workspace policy. Include these controls:

- `always` custom agent remains selected;
- disabled agent never appears;
- dependency agent needs both opt-in and manifest/lockfile diff;
- security reviewer accepts explicit auth/route/filesystem prompt before diff exists;
- QA is unavailable for Codex and selected for eligible Claude Execute work only;
- failures collecting git changes become an empty list and do not abort session creation.

Run:

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/selection.test.db" env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS pnpm vitest --run server/test/custom-agent-selection.test.ts --no-file-parallelism
```

Expected: FAIL because `agentDefsFor` has no selection context.

### Step 2: Implement selection context and pure rules

Introduce `AgentSelectionContext`, a single changed-file collector, and pure predicates keyed by builtin name. Keep selection conservative and deterministic. Record why an enabled agent is unavailable instead of silently dropping it from catalog views.

### Step 3: Write failing PTY integration tests

Assert exact runtime behavior:

- Claude receives expanded `--agents` JSON and a concise clause.
- Codex receives native `-c agents."name".*` overrides and temp TOML paths.
- Codex prompt no longer includes the old roster instructions.
- empty selection leaves original argv/prompt byte-identical;
- one failed config write skips only that agent and records a warning;
- temp cleanup covers all generated files.

Run:

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/pty.test.db" env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS pnpm vitest --run server/test/custom-agents.pty.test.ts --no-file-parallelism
```

Expected: FAIL because PTY still passes Codex instructions inline.

### Step 4: Integrate into session creation

Resolve the effective definitions once from full context, materialize inside the existing session temp directory, append runtime-native arguments, and attach only the concise runtime-aware delegation clause. Do not create repo/home agent files. Thread warnings into the existing session logging/event path without making session creation fail.

### Step 5: Verify server integration

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/native-pty.test.db" env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS pnpm vitest --run server/test/custom-agent-selection.test.ts server/test/custom-agents.service.test.ts server/test/custom-agents.pty.test.ts --no-file-parallelism
pnpm --filter ./server typecheck
```

Expected: PASS.

### Step 6: Commit

```bash
git add server
git commit -m "feat(server): select and launch native custom agents"
```

---

## Task 4: Capture local invocation lifecycle and expose admin metrics

**Files:**

- Modify: `server/prisma/schema.prisma`
- Add: `server/prisma/migrations/20260831121000_agent_invocations/migration.sql`
- Add: `server/src/services/agent-invocations.ts`
- Modify: `server/src/routes/session-events.ts`
- Modify: `server/src/services/pty.ts`
- Modify: `server/src/app.ts`
- Modify: `server/src/services/agent-capabilities.ts`
- Add: `server/src/routes/custom-agent-metrics.ts`
- Modify: `server/test/session-events.route.test.ts`
- Add: `server/test/agent-invocations.service.test.ts`
- Add: `server/test/custom-agent-metrics.route.test.ts`
- Modify: `shared/src/custom-agent.ts`
- Modify: `shared/src/api.ts`

### Step 1: Write failing lifecycle service tests

Test idempotent start/stop, synthetic stop-without-start, duration calculation, status transitions, ANSI stripping, UTF-8-safe 4 KiB excerpt, SHA-256 result hash, null token fields for unknown transcript shapes, safe parsing below 10 MiB only, and `workspaceChanged` from status snapshot hashes. Test boot reconciliation changes orphaned `running` rows to `abandoned` without requiring foreign keys.

Run:

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/invocations.test.db" env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS pnpm vitest --run server/test/agent-invocations.service.test.ts --no-file-parallelism
```

Expected: FAIL because `AgentInvocation` does not exist.

### Step 2: Add the local-only model and service

Add the exact model and indexes from SPEC-950 in a hand-written migration. Regenerate Prisma. Keep it out of every sync/migration registry. Implement path allowlisting and stat-before-read for transcripts. Keep workspace snapshots in memory and record telemetry warnings on failed git probes.

### Step 3: Write failing hook-route tests

Use signed session headers to test:

- AskUserQuestion remains byte-compatible;
- duplicate `SubagentStart`/`SubagentStop` creates one row;
- roster mismatch and non-Hanoman builtin type are ignored;
- unknown events return `202 { ignored: true }`;
- body session identifiers cannot override the signed header identity.

Run:

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/events.test.db" env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS pnpm vitest --run server/test/session-events.route.test.ts --no-file-parallelism
```

Expected: FAIL because the route only handles AskUserQuestion.

### Step 4: Install lifecycle hooks and event handling

Extend Claude settings and Codex hook args with `SubagentStart`/`SubagentStop` using the existing signed sender. Store the effective session roster server-side so the route can validate `agent_type`. Keep hook delivery fail-open.

### Step 5: Write failing metrics/disposition API tests

Cover date/project filters, recent cap 100, median duration, available-token aggregation, exact precision formula, em dash semantics via nullable values, accepted/partial/rejected/false-positive validation, 500-character note limit, unknown id, and cookie-only authorization.

Run:

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/metrics.test.db" env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS pnpm vitest --run server/test/custom-agent-metrics.route.test.ts --no-file-parallelism
```

Expected: FAIL because no API exists.

### Step 6: Implement shared views and admin routes

Add `AgentInvocationView` and `AgentMetricView`, register:

```text
GET   /api/custom-agents/metrics
PATCH /api/custom-agents/invocations/:id
```

Keep both cookie-admin only and never serialize transcript paths. Make disposition updates recompute metrics from persisted evidence.

### Step 7: Verify telemetry layer

```bash
pnpm db:generate
TEST_DATABASE_URL="file:$(mktemp -d)/telemetry.test.db" env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS pnpm vitest --run server/test/agent-invocations.service.test.ts server/test/session-events.route.test.ts server/test/custom-agent-metrics.route.test.ts --no-file-parallelism
pnpm --filter @hanoman/shared typecheck
pnpm --filter ./server typecheck
```

Expected: PASS.

### Step 8: Commit

```bash
git add shared server
git commit -m "feat(custom-agents): record invocation effectiveness"
```

---

## Task 5: Add execution controls, metrics, and dispositions to the dashboard

**Files:**

- Modify: `src/src/api/client.ts`
- Modify: `src/src/screens/CustomAgentsPanel.tsx`
- Modify: `src/test/custom-agents-panel.test.tsx`

### Step 1: Write failing panel tests

Test editing and validation of activation, effort, workspace policy, max turns, and timeout. Test unavailable runtime reason, 30-day invocation count, duration/tokens with `—` for missing data, disposition totals, precision, workspace-change alert, five-row recent history, and successful disposition/note PATCH refresh.

Run:

```bash
pnpm vitest --run src/test/custom-agents-panel.test.tsx --no-file-parallelism
```

Expected: FAIL because the panel only edits the legacy fields.

### Step 2: Add API client methods and focused UI

Load catalog and metrics together. Keep execution controls inside the existing agent editor, metrics on each card, and recent evidence collapsible to avoid turning Settings into a monitoring dashboard. Disable invalid policy/runtime combinations client-side while retaining server validation. Use the existing toast/error conventions.

### Step 3: Verify UI

```bash
pnpm vitest --run src/test/custom-agents-panel.test.tsx --no-file-parallelism
pnpm --filter ./src typecheck
```

Expected: PASS.

### Step 4: Commit

```bash
git add src
git commit -m "feat(dashboard): show custom agent effectiveness"
```

---

## Task 6: Add deterministic evaluation fixtures and opt-in live harness

**Files:**

- Add: `evals/custom-agents/manifest.ts`
- Add: `evals/custom-agents/fixtures/{scout,blast-radius,security-reviewer,qa-verifier,root-causer,edge-case-hunter,spec-auditor,dep-auditor}-{positive,control}/**`
- Add: `evals/custom-agents/frozen-output/*.txt`
- Add: `runner/src/custom-agent-eval.ts`
- Add: `runner/test/custom-agent-eval.test.ts`
- Add: `scripts/agent-eval.ts`
- Modify: `package.json`

### Step 1: Write failing scorer tests

Create at least one positive and one negative control per builtin. Prove the pure scorer:

- gives 100% recall only when every expected finding matches;
- counts forbidden findings separately;
- fails missing findings and forbidden hits deterministically;
- rejects malformed manifests and fixture paths escaping the eval root.

Run:

```bash
pnpm vitest --run runner/test/custom-agent-eval.test.ts --no-file-parallelism
```

Expected: FAIL because no eval contract or scorer exists.

### Step 2: Implement manifest, fixtures, and scorer

Use small text repositories that encode the eight historical failure classes in SPEC-950. Keep expected/forbidden patterns specific enough to avoid matching boilerplate. Frozen outputs must include both passing and failing controls.

### Step 3: Write failing live-harness isolation tests

Stub runtime execution and assert the harness copies to `mktemp`, initializes git there, invokes the product renderer, writes reports outside the source tree, and leaves a pre/post source hash unchanged. Verify runtime and agent filters plus nonzero exit on scorer failure.

### Step 4: Implement the opt-in CLI

Expose:

```bash
pnpm agent:eval --runtime claude|codex [--agent name] [--output path]
```

Require the runtime flag, never call it from install/build/test/CI, and clean temp repositories in `finally`. Reuse the production Claude/Codex materializers rather than duplicating agent definitions.

### Step 5: Verify eval layer without live model calls

```bash
pnpm vitest --run runner/test/custom-agent-eval.test.ts --no-file-parallelism
pnpm --filter ./runner typecheck
```

Expected: PASS; no Claude/Codex process is launched by unit tests.

### Step 6: Commit

```bash
git add evals runner scripts package.json
git commit -m "test(custom-agents): add effectiveness evaluations"
```

---

## Task 7: Update Source of Truth and complete proportional verification

**Files:**

- Modify: `internal/docs/adr/0094-custom-agent-katalog-materialisasi-native.md`
- Modify: `internal/docs/adr/0136-agen-bawaan-sistem-seed-idempoten.md`
- Add: `internal/docs/adr/0159-custom-agent-native-terukur-terisolasi.md`
- Modify: `internal/docs/adr/README.md`
- Modify: `internal/docs/README.md`
- Modify: `internal/docs/architecture/data-model.md`
- Modify: `internal/docs/architecture/api-contract.md`
- Modify: `internal/docs/operations/agent-documentation-workflow.md`
- Modify if a durable gotcha was found: `internal/skills/hanoman/SKILL.md`, `AGENTS.md`, `CLAUDE.md`

### Step 1: Update decisions and contracts

Record ADR-0159 and explicitly supersede only the Codex-inline portion of ADR-0094 plus the untouched-QA exception to ADR-0136. Document execution fields, local-only invocation storage, admin API, smart activation, renderer behavior, eval command, and operational safety. Link every new document at both relevant indexes.

### Step 2: Validate docs

```bash
pnpm --filter ./cli exec tsx src/hanoman.ts docs index --check
pnpm --filter ./cli exec tsx src/hanoman.ts docs scan
```

If the repo script name differs, use the local CLI entrypoint documented by the package scripts; do not install or update a global package during this task.

Expected: index integrity passes and coverage is reported.

### Step 3: Run the touched test set serially

```bash
HANOMAN_SPEC950_DB="file:$(mktemp -d)/spec950.test.db"
TEST_DATABASE_URL="$HANOMAN_SPEC950_DB" env -u HANOMAN_CONTROL_ORIGINS -u SSH_ASKPASS pnpm vitest --run \
  shared/src/custom-agent-runtime.test.ts \
  shared/test/builtin-agents.test.ts \
  runner/test/custom-agents.test.ts \
  runner/test/agent-readonly.test.ts \
  runner/test/codex-agent-config.test.ts \
  runner/test/custom-agent-eval.test.ts \
  server/test/builtin-agents.test.ts \
  server/test/custom-agents.service.test.ts \
  server/test/custom-agents.route.test.ts \
  server/test/custom-agent-selection.test.ts \
  server/test/custom-agents.pty.test.ts \
  server/test/agent-invocations.service.test.ts \
  server/test/session-events.route.test.ts \
  server/test/custom-agent-metrics.route.test.ts \
  src/test/custom-agents-panel.test.tsx \
  --no-file-parallelism
```

Expected: PASS with a nonzero discovered test count.

### Step 4: Run touched-package typechecks

```bash
pnpm --filter @hanoman/shared typecheck
pnpm --filter ./runner typecheck
pnpm --filter ./server typecheck
pnpm --filter ./src typecheck
```

Expected: PASS.

### Step 5: Smoke the touched endpoints once

Boot the server on a session-specific port and DB, authenticate through the normal local admin flow, then use `curl` to verify catalog profile fields, metrics response, and one disposition PATCH. Resolve and stop only the exact server PID; never use `pkill -f` or `killall`.

Also create one disposable Claude session and one disposable Codex session through the actual PTY path. Verify from captured argv/log evidence that Claude receives expanded native JSON, Codex receives native temp TOML overrides, read-only mutation is rejected, and no config lands in the repo or operator home. If a locally installed runtime binary is broken, record the exact blocker and verify with the functioning installed binary without changing global installations.

### Step 6: Inspect the final diff and commit docs

```bash
git diff --check
git status --short
git diff --stat HEAD~7..HEAD
git add internal docs/superpowers
git commit -m "docs(custom-agents): record native effectiveness architecture"
```

Expected: no whitespace errors, only SPEC-950 files are changed, and all required docs are indexed.

### Step 7: Final evidence review

Map the test/smoke evidence back to all 13 acceptance criteria in the spec. Report any unavailable live-runtime evidence as a precise limitation; do not replace it with a unit-test claim. Confirm the primary working tree was never modified.
