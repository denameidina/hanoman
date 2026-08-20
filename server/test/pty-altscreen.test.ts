import { describe, it, expect, afterEach } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attach, createSession, killAll, writeTo } from "../src/services/pty";

// SPEC-863 · tmux TIDAK PERNAH meneruskan `\x1b[?1049h/l` milik program di dalam pane ke klien
// luar — terukur pada tmux 3.4, 3.5a, dan 3.7b (audit SPEC-863 §Temuan 2). Satu-satunya yang
// sampai ke klien adalah `?1049h` milik handshake attach tmux sendiri, tanpa pasangan `l` selama
// sambungan hidup. Karena itu keadaan alternate screen pane wajib datang dari tmux (`#{alternate_on}`),
// bukan dari aliran byte. Test ini memakai tmux SUNGGUHAN: fixture-nya benar-benar menulis sekuens
// itu ke pty, dan yang dipagari adalah frame yang lahir dari sisi server.
const TOGGLE = fileURLToPath(new URL("./fixtures/alt-screen-toggle.mjs", import.meta.url));

type Frame = { t: string; d?: string; on?: boolean };
function fakeClient() {
  const frames: Frame[] = [];
  return {
    frames,
    alts: () => frames.filter((f) => f.t === "alt").map((f) => f.on),
    data: () => frames.filter((f) => f.t === "data").map((f) => f.d ?? "").join(""),
    send: (m: string) => { frames.push(JSON.parse(m) as Frame); },
    close: () => { /* test tak peduli */ },
  };
}
const waitFor = async (ok: () => boolean, ms = 8000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > deadline) throw new Error("timeout menunggu kondisi");
    await new Promise((r) => setTimeout(r, 20));
  }
};

afterEach(() => { killAll(); });

describe("alternate screen pane disiarkan ke klien", () => {
  it("mengikuti pane masuk lalu keluar alternate screen", { timeout: 20_000 }, async () => {
    const s = createSession("alt1", mkdtempSync(join(tmpdir(), "hanoman-alt-")),
      { command: [process.execPath, TOGGLE] });
    const c = fakeClient();
    attach(s.id, c);
    await waitFor(() => c.data().includes("SIAP"));
    expect(c.alts()).toEqual([false]);

    writeTo(s.id, "A");
    await waitFor(() => c.alts().at(-1) === true);

    writeTo(s.id, "B");
    await waitFor(() => c.alts().at(-1) === false);
  });

  it("memberi klien baru keadaan yang sedang berlaku, tanpa menunggu perubahan", { timeout: 20_000 }, async () => {
    const s = createSession("alt2", mkdtempSync(join(tmpdir(), "hanoman-alt-")),
      { command: [process.execPath, TOGGLE] });
    const first = fakeClient();
    attach(s.id, first);
    await waitFor(() => first.data().includes("SIAP"));
    writeTo(s.id, "A");
    await waitFor(() => first.alts().at(-1) === true);

    const second = fakeClient();
    attach(s.id, second);
    expect(second.alts()).toEqual([true]);
  });

  // Kontrol negatif — inti SPEC-863: byte `?1049h` yang benar-benar ditulis program ke pty tak
  // pernah muncul di aliran klien, jadi klien tak punya cara lain selain frame `alt`.
  it("tak pernah membocorkan ?1049 milik pane ke aliran data klien", { timeout: 20_000 }, async () => {
    const s = createSession("alt3", mkdtempSync(join(tmpdir(), "hanoman-alt-")),
      { command: [process.execPath, TOGGLE] });
    const c = fakeClient();
    attach(s.id, c);
    await waitFor(() => c.data().includes("SIAP"));
    writeTo(s.id, "A");
    await waitFor(() => c.alts().at(-1) === true);
    expect(c.data().split("\x1b[?1049h").length - 1).toBeLessThanOrEqual(1);
    expect(c.data()).not.toContain("\x1b[?1049l");
  });
});
