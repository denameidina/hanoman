import { describe, it, expect } from "vitest";
import { setPhaseInvocations, __phaseInvocationsFor } from "../src/services/pty";
import type { PhaseInvocation } from "../src/services/session-phases";

// ADR-0164 · review Task 9: `setPhaseInvocations` dipanggil dari jalur hook (session-events)
// yang WAJIB non-blocking (SPEC-878) — ia tak boleh menyentuh tmux sama sekali, sinkron maupun
// async. Test ini sengaja TANPA tmux: sesi "tak-ditonton" tak pernah `attach()`, jadi bila
// implementasinya masih memanggil getSession/pollPhases, test ini akan gagal terhubung ke
// server tmux yang tak pernah dilahirkan alih-alih diam-diam lolos.

const row: PhaseInvocation = {
  phase: "Plan", runtimeInvocationId: "x1", status: "completed",
  startedAt: "2026-09-14T00:00:00.000Z", durationMs: 1_000,
  inputTokens: null, outputTokens: null, cachedTokens: null, resultExcerpt: null,
};

describe("setPhaseInvocations cache (ADR-0164, review Task 9)", () => {
  it("sesi yang tak ditonton (tak pernah attach) tidak disimpan ke cache", () => {
    setPhaseInvocations("tak-ditonton", [row]);
    expect(__phaseInvocationsFor("tak-ditonton")).toBeUndefined();
  });

  // Kasus "attached" (frame disiarkan ulang dalam ≤ 500 ms lewat tick poll) butuh sesi tmux
  // sungguhan (attach() memanggil getSession → tmux). Itu sudah ditutupi
  // `server/test/phase-agents.pty.test.ts` (roster/orkestrasi) dan `pty.test.ts` (siklus
  // attach/poll/broadcast) — menduplikasinya di sini hanya akan menambah satu lagi test tmux
  // nyata tanpa menambah cakupan baru.
});
