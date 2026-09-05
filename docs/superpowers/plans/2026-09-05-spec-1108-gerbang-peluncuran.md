# SPEC-1108 Session launch admission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Track all steps with checkboxes.

**Goal:** Enforce cap and host load on all structured agent launches while keeping operator terminals usable.
**Architecture:** A pure injected admission gate serializes check→spawn. Production adapters read tmux asynchronously and Settings, and all structured launchers call this policy. No new DB registry or durable queue.
**Tech Stack:** TypeScript, Node os, Fastify, Zod, React, Vitest.
**Spec:** [SPEC-1108 design](../specs/2026-09-05-spec-1108-gerbang-peluncuran-design.md).

## Global Constraints

- ADR-0161 amended under operator approval; no new ADR, migration or dependency.
- Default load-per-core 2.5, enabled. Never use freemem. Windows reports null/unsupported.
- Reattach precedes admission; kill/worktree follows admission. Terminals/shell/SSH consoles exempt but counted.
- Tests scoped, serial server with unique TEST_DATABASE_URL and HANOMAN_TMUX_SOCKET; unset HANOMAN_CONTROL_ORIGINS and SSH_ASKPASS. Package typechecks sequential.
- Force is manual only; AgentToken requests supplying force receive 403 before launch effects. No automatic killing or worktree reaping.

### Task 1: Shared config and operator UI

Files: `shared/src/entities.ts`, `shared/src/dto.ts`, `shared/src/index.ts`, new `shared/src/session-admission.ts`; `src/src/screens/SchedulerScreen.tsx`, `src/src/App.tsx`, `src/src/api/client.ts`; related shared/UI tests.
Interfaces: export `LaunchStatus` with enabled/liveCount/liveAgentCount/maxConcurrent/loadPerCore/maxLoadPerCore/loadStatus; scheduler state has optional `admission`; errors contain `{error,kind,admission}`.

- [x] Write failing tests for old settings defaulting to enabled guard, positive finite threshold validation, and UI showing load unavailable/409 numbers with manual force.
- [x] Run the named shared/UI tests and verify red.
- [x] Implement schema and UI. Exact config addition:

```ts
launchGuard: z.object({
  enabled: z.boolean().default(true),
  maxLoadPerCore: z.number().finite().positive().default(2.5),
}).default({}),
```

Load status is `available|unsupported|unavailable`; null must be visibly unavailable, never rendered as 0. Project-flow POST variants accept optional force. The Start modal and manual project-flow retry dialogs present rejection metrics before offering force and preserve the original request context.
- [x] Run related tests; review task for spec and quality.

### Task 2: Shared admission and backlog launcher

Files: new `server/src/services/session-admission.ts`, `session-launch-gate.ts`; `session-launch.ts`, `pty.ts`, `app.ts`, scheduler `engine.ts`, `governor.ts`, `state.ts`; related tests.
Interfaces:

```ts
createLaunchGate(deps: LaunchGateDeps): {
  run<T>(opts: {id?: string; force?: boolean; exempt?: boolean}, start: () => Promise<T>, reuse: (pane: LaunchPane) => T): Promise<T>;
}
withSessionAdmission<T>(opts, start, reuse): Promise<T>;
createAgentSession(projectId: string, cwd: string, opts?: CreateOpts): Promise<SessionInfo & {reused?: true}>;
createOperatorSession(projectId: string, cwd: string, opts?: CreateOpts): Promise<SessionInfo>;
```

- [x] Extend the red baseline test plus unit cases: full cap with scheduler disabled, dead panes, load above/equal threshold, Windows, force/off, failed tmux, concurrent final slot, same-id reuse, failed start releases mutex.
- [x] Observe red before implementation.
- [x] Implement mutex covering list→config→check→await start, with `finally` release; reuse before checks. Pure snapshot builder computes `liveCount`, `liveAgentCount`, load status and thresholds. `LaunchAdmissionError` has kind capacity/host-load and snapshot.
- [x] Bind async tmux + os + Settings; wrap backlog before effects. Persist internal launchClass at end of tmux FMT with legacy fallback. Global Fastify error handler maps admission errors to 409 metrics and delegates other errors to existing behavior.
- [x] Make governor batching count async and keep temporary admission failures queued with note; stop the spec drain after a global admission denial to avoid repeating the same expensive reads for every queued item. Expose snapshot in scheduler state. Verify all targeted tests and task review.

### Task 3: Remaining structured launchers

Files: routes `terminal.ts`, `specs.ts`, `ide.ts`, `vps.ts`; scheduler `cron-session.ts`; Telegram `session.ts`, `bootstrap.ts`; related tests.
Consumes Task 2 adapters. Backlog route still calls `startSpecSession`, never calculates cap itself.

- [x] Add red routing/integration cases proving agent launch denial and shell/terminal exemption; include project reattach and cron before worktree.
- [x] Wrap entire project-flow and cron preparation in `withSessionAdmission({id,force}, async () => ..., pane => ...)`, replacing synchronous reattach reads. Wrap conflict/VPS agent births with `await createAgentSession(...)`; use `createOperatorSession` for human shell/console/plain terminal so their births share the mutex while remaining exempt from both checks.
- [x] Adapt Telegram port birth to async guarded adapter, preserving reattach/steer and error reporting; no force. Keep Git conflict worktrees intact on denial.
- [x] Run related tests; review task for spec and quality.

### Task 4: Contract docs, full changed-scope verification and delivery

Files: `internal/docs/architecture/api-contract.md`, relevant scheduler/runtime docs, ADR-0161 and indexes, this plan and audit.

- [x] Update permanent contract docs and links with config, error metrics, exemptions, Windows, initial threshold rationale, mutex scope and conflict recovery behavior.
- [x] Run related tests (ensure tests actually run), shared/server/frontend typechecks sequentially; broaden only for modified contracts and explain scope.
- [x] Boot isolated local app and curl impacted admission endpoint/status once; record actual status/body without starting real agents.
- [x] Run blast-radius and security reviewers; adjudicate findings and fix concrete gaps. Reverify affected checks.
- [x] Check docs index and git diff, complete final implementation review, and mark all implementation tasks checked.

After Execute is complete: append `Execute done`, commit docs and code together, push `origin HEAD:refs/heads/hanoman/spec-1108`, and verify the clean worktree and remote SHA.

## Execution record

Audit reproduction: 1 expected cap regression failure and 1 reattach control pass. Operator approved expanded scope and default 2.5. Existing detached linked worktree is retained. Task implementations may run independently; expensive verification is coordinated to avoid competing server suites.

Scoped verification passed: final core/structured HTTP 67/67, shared/UI config 115 unique tests, manual retry UI 121/121 (overlapping sets), Telegram 33/33, and affected server regressions with targeted fixture/environment corrections. Shared, server, and frontend typechecks passed sequentially. Isolated real HTTP/tmux smoke returned capacity 409, host-load 409, and exempt shell 201, with no worktree created by rejected launches. See the [audit record](../../../internal/docs/research/audit-spec-1108-gerbang-peluncuran-sesi.md) for scope and details.

Final whole-change review found no remaining correctness or contract defects. Security and blast-radius re-reviews also passed after their concrete findings were fixed.
