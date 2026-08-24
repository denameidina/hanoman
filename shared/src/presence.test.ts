import { describe, it, expect } from "vitest";
import {
  zPresenceFrame, presenceSignature, MAX_PRESENCE_SESSIONS, PRESENCE_PROTOCOL,
  type PresenceSession,
} from "./presence";

const s = (over: Partial<PresenceSession> = {}): PresenceSession => ({
  sessionId: "spec-919", projectId: "hanoman", agent: "claude",
  status: "working", startedAt: "2026-08-24T01:00:00.000Z", ...over,
});
const frame = (sessions: PresenceSession[]) => ({ t: "presence", v: PRESENCE_PROTOCOL, sessions });

describe("kontrak wire presence", () => {
  it("menerima frame minimal", () => {
    expect(zPresenceFrame.safeParse(frame([s()])).success).toBe(true);
  });

  // Ini BUKTI "tak ada isi terminal": kunci di luar kontrak ditolak, bukan diabaikan.
  it("menolak field asing di sesi (scrollback tak bisa diselundupkan)", () => {
    const r = zPresenceFrame.safeParse(frame([{ ...s(), scrollback: "rahasia" } as PresenceSession]));
    expect(r.success).toBe(false);
  });

  it("menolak field asing di amplop", () => {
    expect(zPresenceFrame.safeParse({ ...frame([]), cwd: "/home/dena" }).success).toBe(false);
  });

  it("menolak versi protokol lain", () => {
    expect(zPresenceFrame.safeParse({ ...frame([]), v: 2 }).success).toBe(false);
  });

  it("menolak daftar sesi melewati plafon", () => {
    const many = Array.from({ length: MAX_PRESENCE_SESSIONS + 1 }, (_, i) => s({ sessionId: `s${i}` }));
    expect(zPresenceFrame.safeParse(frame(many)).success).toBe(false);
  });

  it("menolak status di luar kosakata", () => {
    expect(zPresenceFrame.safeParse(frame([s({ status: "idle" as never })])).success).toBe(false);
  });

  // Dedup pengirim: urutan pane dari tmux tak stabil, jadi signature harus buta terhadapnya.
  it("signature buta terhadap urutan", () => {
    const a = [s({ sessionId: "a" }), s({ sessionId: "b" })];
    expect(presenceSignature(a)).toBe(presenceSignature([...a].reverse()));
  });

  it("signature berubah saat status berubah", () => {
    expect(presenceSignature([s()])).not.toBe(presenceSignature([s({ status: "waiting" })]));
  });
});
