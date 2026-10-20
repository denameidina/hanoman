import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SessionAsk } from "@hanoman/shared";
import {
  admitAsk, answerAsk, askSignature, dialogFits, __resetDetect, answerCount, failureCount, type DetectDeps,
} from "../src/services/lead/detect";
import { readDialogScreen } from "../src/services/tui-dialog";
import { __resetDeciding } from "../src/services/lead/deciding";

const LEAD = {
  enabled: true, paused: false, pausedProjects: [] as string[], everyMin: 5,
  maxAutoAnswers: 3, flowTtlMin: 60,
  requireGreenBeforeIntegrate: true, deliverTimeoutSec: 600, approvalTtlMin: 1440, rotateAfterEvents: 40, projects: {},
  engine: { enabled: false, agent: "claude", model: "m", effort: "high" },
} as never;

const DIALOG = [
  "☐ Basis",
  "Basis data mana?",
  "❯ 1. SQLite",
  "  2. Postgres",
  "  3. Type something.",
  "  4. Chat about this",
  "Enter to select · ↑/↓ to navigate · Esc to cancel",
].join("\n");

/** Layar rekap SPEC-474 — satu-satunya bentuk yang `submitPaneDialog` mau tekan. */
const REVIEW = [
  "←  ☒ Basis  ☒ Auth  ☒ Deploy  ✔ Submit  →", "", "Review your answers", "",
  "Ready to submit your answers?", "", "❯ 1. Submit answers", "  2. Cancel",
].join("\n");

/** Layar sesudah dialog benar-benar tertutup. */
const SELESAI = "⏺ User answered Claude's questions:\n\n❯\n  ⏵⏵ bypass permissions on";

/**
 * Panggung yang MAJU saat dijawab lalu BERAKHIR — bentuk yang sama dengan TUI sungguhan.
 *
 * Panggung yang tak pernah berakhir menyembunyikan dua hal sekaligus: dialog satu pertanyaan yang
 * menutup sendiri (dan karena itu tak boleh di-Submit) dan rantai yang berujung layar rekap.
 */
const dialogBerjudul = (title: string, opsi = ["SQLite", "Postgres"]): string => [
  "←  ☐ Basis  ☐ Auth  ☐ Deploy  ✔ Submit  →", "", title, "",
  ...opsi.map((o, i) => `${i ? " " : "❯"} ${i + 1}. ${o}`),
  `  ${opsi.length + 1}. Type something.`, `  ${opsi.length + 2}. Chat about this`, "",
  "Enter to select · Tab/Arrow keys to navigate · Esc to cancel",
].join("\n");

function panggung(
  total = 1, akhir: "rekap" | "tertutup" = total > 1 ? "rekap" : "tertutup",
  layar: (n: number) => [string, string[]?] = (n) => [`Pertanyaan ke-${n}?`],
) {
  let n = 0;
  return {
    jawab: () => { n++; },
    // JUDUL yang berganti, bukan suffix: `dialogKey` sengaja kebal terhadap kursor, spinner, dan
    // tab tercentang (ADR-0142 keputusan 2), jadi hanya judul yang benar-benar memajukan rantai.
    pane: () => (n < total
      ? (total > 1 ? dialogBerjudul(...layar(n)) : DIALOG)
      : akhir === "rekap" ? REVIEW : SELESAI),
  };
}

const ask = (over: Partial<SessionAsk> = {}): SessionAsk => ({
  sessionId: "s1", agent: "claude", source: "ask-tool", askId: "toolu_1",
  askedAt: new Date().toISOString(),
  questions: [{ header: "Basis", question: "Basis data mana?", multiSelect: false,
    options: [{ label: "SQLite" }, { label: "Postgres" }] }],
  message: "", at: 0, total: 1, state: "queued", flowId: null, step: null, ...over,
});

const CTX = { projectId: "p1", specId: "SPEC-1", decisionFile: "/m" };
const S = { id: "s1", specId: "SPEC-1", projectId: "p1" };

function deps(over: Partial<DetectDeps> = {}): DetectDeps {
  return {
    pane: () => DIALOG,
    exited: () => false,
    send: vi.fn(async () => true),
    clearMarker: vi.fn(),
    submit: vi.fn(async () => true),
    sleep: async () => {},
    closeChain: vi.fn(async () => {}),
    now: () => 1_000_000,
    decide: vi.fn(async () => ({ id: "d1", status: "berlaku", answer: "SQLite", flowId: "f1", step: 1 })),
    decideDeps: {},
    delivery: () => ({ decision: "Pakai SQLite", choices: [{ index: 1, option: "SQLite" }], refs: [], missing: [] }),
    optIn: async () => ["p1"],
    notify: vi.fn(async () => {}),
    cfg: async () => LEAD,
    ...over,
  } as unknown as DetectDeps;
}

beforeEach(() => { __resetDetect(); __resetDeciding(); });

describe("admitAsk — pagar lama, satu sesi per panggilan", () => {
  it("meloloskan sesi yang opt-in & lead aktif", async () => {
    expect(await admitAsk(S, deps())).toEqual({ ok: true });
  });

  it("menolak project yang tak opt-in", async () => {
    expect(await admitAsk(S, deps({ optIn: async () => [] })))
      .toEqual({ ok: false, reason: "project tak opt-in lead" });
  });

  it("menolak saat lead dijeda untuk project ini (AC-15/27)", async () => {
    const cfg = (async () => ({ ...(LEAD as object), pausedProjects: ["p1"] })) as never;
    expect(await admitAsk(S, deps({ cfg })))
      .toEqual({ ok: false, reason: "lead dijeda untuk project ini" });
  });

  it("menolak saat master switch mati (AC-30)", async () => {
    const cfg = (async () => ({ ...(LEAD as object), enabled: false })) as never;
    expect((await admitAsk(S, deps({ cfg }))).ok).toBe(false);
  });

  it("menolak pane mati (AC-10)", async () => {
    expect(await admitAsk(S, deps({ exited: () => true })))
      .toEqual({ ok: false, reason: "pane mati" });
  });

  it("menolak + menotifikasi SEKALI saat maxAutoAnswers tercapai (AC-11)", async () => {
    const d = deps();
    for (let i = 0; i < 3; i++) {
      const p = panggung();                       // satu event = satu dialog yang lahir dari awal
      d.pane = p.pane;
      d.send = async () => { p.jawab(); return true; };
      await answerAsk(ask({ askId: `t${i}` }), CTX, d);
    }
    expect(answerCount("s1")).toBe(3);
    const first = await admitAsk(S, d);
    const second = await admitAsk(S, d);
    expect(first).toEqual({ ok: false, reason: "batas jawaban otomatis tercapai" });
    expect(second.ok).toBe(false);
    expect(d.notify).toHaveBeenCalledTimes(1);
  });

  it("melepas failCapped sesudah FAIL_COOLDOWN_MS (SPEC-487)", async () => {
    const decide = (async () => ({ id: "d", status: "gagal", answer: "", flowId: null, step: null })) as never;
    const d = deps({ decide });
    for (let i = 0; i < 3; i++) await answerAsk(ask({ askId: `t${i}` }), CTX, d);
    expect(failureCount("s1")).toBe(3);
    expect((await admitAsk(S, d)).ok).toBe(false);
    expect(await admitAsk(S, deps({ now: () => 1_000_000 + 16 * 60_000 }))).toEqual({ ok: true });
  });
});

describe("answerAsk — rantai disuapi payload", () => {
  it("memakai pertanyaan & opsi DARI PAYLOAD, bukan dari layar", async () => {
    const d = deps();
    await answerAsk(ask(), CTX, d);
    const req = vi.mocked(d.decide).mock.calls[0]![0] as Record<string, unknown>;
    expect(req.question).toBe("Basis data mana?");
    expect(req.options).toEqual(["SQLite", "Postgres"]);
    expect(req.chain).toBe(true);
  });

  it("satu panggilan 3 pertanyaan = 3 decide dalam SATU alur, lalu Submit & marker dikosongkan", async () => {
    // Layar sungguhan MAJU antar-tab (judulnya berganti, jadi `dialogKey` ikut berganti — suffix
    // kosmetik tak pernah cukup, ADR-0142 keputusan 2) lalu BERAKHIR di layar rekap.
    // ADR-0223 · judul layar = teks pertanyaan payload, persis yang digambar TUI.
    const p = panggung(3, "rekap", (n) => [
      ["Basis?", "Auth?", "Deploy?"][n]!, [["SQLite"], ["Cookie"], ["VPS"]][n],
    ]);
    const d = deps({ pane: p.pane, send: vi.fn(async () => { p.jawab(); return true; }) });
    const three = ask({
      total: 3,
      questions: [
        { header: "Basis", question: "Basis?", multiSelect: false, options: [{ label: "SQLite" }] },
        { header: "Auth", question: "Auth?", multiSelect: true, options: [{ label: "Cookie" }] },
        { header: "Deploy", question: "Deploy?", multiSelect: false, options: [{ label: "VPS" }] },
      ],
    });
    const r = await answerAsk(three, CTX, d);
    const calls = vi.mocked(d.decide).mock.calls;
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => (c[0] as Record<string, unknown>).flowId)).toEqual([null, "f1", "f1"]);
    expect(d.submit).toHaveBeenCalledTimes(1);
    expect(d.clearMarker).toHaveBeenCalledWith("/m");
    expect(d.closeChain).toHaveBeenCalledWith("f1");
    expect(r.answered).toBe(true);
    expect(answerCount("s1")).toBe(1);       // satu PANGGILAN = satu jawaban otomatis
  });

  it("dialog SATU pertanyaan yang menutup sendiri tak pernah menekan Submit", async () => {
    // Regresi yang nyaris lolos: `submitPaneDialog` fail-closed untuk layar yang bukan rekap, dan
    // dialog satu pertanyaan claude memang tak punya layar rekap. Submit tanpa syarat membuat kasus
    // PALING UMUM dilaporkan `gagal` — marker tak dikosongkan, `failures` naik.
    let answered = false;
    const d = deps({
      pane: () => (answered ? SELESAI : DIALOG),
      send: vi.fn(async () => { answered = true; return true; }),
    });
    const r = await answerAsk(ask(), CTX, d);
    expect(d.submit).not.toHaveBeenCalled();
    expect(r.answered).toBe(true);
    expect(d.clearMarker).toHaveBeenCalledWith("/m");
    expect(failureCount("s1")).toBe(0);
  });

  it("layar yang tak kunjung tertutup: tak mengetik lagi, marker TETAP terisi", async () => {
    // Sesi itu memang masih menunggu. Mengosongkan markernya akan menghapusnya dari pil, notifikasi,
    // dan panel pet — dan tak ada yang akan menulisnya kembali (SPEC-474).
    const d = deps();
    const r = await answerAsk(ask(), CTX, d);
    expect(d.clearMarker).not.toHaveBeenCalled();
    expect(r.answered).toBe(false);
    expect(failureCount("s1")).toBe(0);   // bukan kegagalan lead: jawabannya mendarat
  });

  it("dialog tak pernah muncul → TIDAK mengetik apa pun (anti pesan liar SPEC-487)", async () => {
    const d = deps({ pane: () => "✻ Cooked for 40m 4s\n> " });
    const r = await answerAsk(ask(), CTX, d);
    expect(d.send).not.toHaveBeenCalled();
    expect(d.clearMarker).not.toHaveBeenCalled();
    expect(r.answered).toBe(false);
    expect(failureCount("s1")).toBe(1);
  });

  it("codex turn-end tanpa sinyal pertanyaan → diam (AC-9)", async () => {
    const d = deps({ pane: () => "> " });
    const r = await answerAsk(
      ask({ agent: "codex", source: "turn-end", questions: [], message: "Selesai. tokens used 8.180" }),
      CTX, d);
    expect(d.decide).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
    expect(r.answered).toBe(false);
  });

  it("codex turn-end DENGAN pertanyaan → prosa diketik ke kolom chat", async () => {
    const d = deps({ pane: () => "> " });
    const r = await answerAsk(
      ask({ agent: "codex", source: "turn-end", questions: [], message: "Pakai SQLite atau Postgres?" }),
      CTX, d);
    expect((vi.mocked(d.decide).mock.calls[0]![0] as Record<string, unknown>).question)
      .toBe("Pakai SQLite atau Postgres?");
    expect(d.send).toHaveBeenCalled();
    expect(r.answered).toBe(true);
  });
});

// ADR-0223 · payload dan layar wajib sepakat sebelum lead memutuskan maupun mengetik.
describe("dialogFits — layar vs payload", () => {
  const q = (question: string, labels: string[] = ["Ya", "Tidak"]) =>
    ({ header: "H", question, multiSelect: false, options: labels.map((label) => ({ label })) });
  const layar = (title: string, opsi: string[], strip = "☐ Port e…  ✔ Submit") => readDialogScreen([
    `←  ${strip}  →`, "", title, "",
    ...opsi.map((o, i) => `${i ? " " : "❯"} ${i + 1}. ${o}`), `  ${opsi.length + 1}. Type something.`, "",
    "Enter to select · Tab/Arrow keys to navigate · Esc to cancel",
  ].join("\n"))!;

  it("judul = baris pertama pertanyaan yang dilipat TUI → cocok", () => {
    const s = layar("Apakah port edge (Cloudflare D1, apps/edge/api", ["Ya (Recommended)", "Tidak"]);
    expect(dialogFits(s, q("Apakah port edge (Cloudflare D1, apps/edge/api oneinbox) ikut dalam SPEC-1457?",
      ["Ya (Recommended)", "Tidak"]), [q("x")])).toBe(true);
  });

  it("replay spec-1457: layar 'port edge', payload 'temperature' → TIDAK cocok walau opsinya mirip", () => {
    const s = layar("Apakah port edge (Cloudflare D1, apps/edge/api", ["Ya (Recommended)", "Tidak"]);
    expect(dialogFits(s, q("Apakah state filter temperature ikut mekanisme persistensi dan reset yang dipakai filter Branch?",
      ["Ya (Recommended)", "Tidak"]), [q("x")])).toBe(false);
  });

  it("jumlah tab ≠ jumlah pertanyaan payload → dialog lain", () => {
    const s = layar("Basis?", ["SQLite"], "☐ A  ☐ B  ☐ C  ☐ D  ✔ Submit");
    expect(dialogFits(s, q("Basis?", ["SQLite"]), [q("Basis?", ["SQLite"])])).toBe(false);
  });

  it("tak satu pun opsi sepakat → dialog lain", () => {
    expect(dialogFits(layar("Basis?", ["SQLite", "Postgres"]), q("Basis?", ["Cookie", "JWT"]), [q("x")])).toBe(false);
  });

  it("tangkapan pane claude ASLI (judul berbingkai `│`, dilipat TUI) dikenali dengan benar", () => {
    const pane = [
      "─".repeat(60),
      "←  ☒ WABA ADMIN  ☒ ai-runtime  ☒ Egress guard  ☐ Sisa  ✔ Submit  →",
      "",
      "│ Port SMTP yang diizinkan 25, 465, 587, 2525, dan hapus POST /api/v1/auth/register polos (backend+edge; rd-07 kriteria 110 jadi 'ditutup')? Serta akun terlanjur tereskalasi/baris audit lama",
      "│ dicatat sebagai tugas manusia saja?",
      "",
      "❯ 1. Setuju semua (Recommended)",
      "     Port 25/465/587/2525; hapus /register polos; remediasi data dicatat sebagai tugas manusia.",
      "  2. Ada koreksi",
      "     Jelaskan lewat Other.",
      "  3. Type something.",
      "─".repeat(60),
      "  4. Chat about this",
      "",
      "Enter to select · Tab/Arrow keys to navigate · Esc to cancel",
    ].join("\n");
    const s = readDialogScreen(pane)!;
    const asli = q("Port SMTP yang diizinkan 25, 465, 587, 2525, dan hapus POST /api/v1/auth/register polos (backend+edge; rd-07 kriteria 110 jadi 'ditutup')? Serta akun terlanjur tereskalasi/baris audit lama dicatat sebagai tugas manusia saja?",
      ["Setuju semua (Recommended)", "Ada koreksi"]);
    const empat = [q("a"), q("b"), q("c"), asli];
    expect(dialogFits(s, asli, empat)).toBe(true);
    expect(dialogFits(s, q("Apakah egress guard memakai allowlist domain?", ["Setuju semua (Recommended)", "Ada koreksi"]), empat)).toBe(false);
  });

  it("layar tanpa judul & opsi yang terbaca → fail-open seperti sebelum ADR-0223", () => {
    const s = { kind: "question", rows: [], freeIndex: null, notes: false, options: [], tabs: [], title: "",
      multi: false, submit: { present: false, focused: false } } as never;
    expect(dialogFits(s, q("Apa saja?"), [q("Apa saja?")])).toBe(true);
  });
});

describe("answerAsk — layar milik pertanyaan lain (ADR-0223)", () => {
  const LAIN = dialogBerjudul("Apakah port edge ikut?", ["Ya (Recommended)", "Tidak"]);

  it("tak memutuskan & tak mengetik; melapor mismatch tanpa dihitung kegagalan", async () => {
    const d = deps({ pane: () => LAIN });
    const r = await answerAsk(ask(), CTX, d);
    expect(d.decide).not.toHaveBeenCalled();
    expect(d.send).not.toHaveBeenCalled();
    expect(r).toMatchObject({ answered: false, mismatch: true });
    expect(failureCount("s1")).toBe(0);
  });

  it("dialog yang BERGANTI selagi lead memutuskan tak diketiki jawaban basi", async () => {
    let decided = false;
    const d = deps({
      pane: () => (decided ? LAIN : DIALOG),
      decide: vi.fn(async () => { decided = true; return { id: "d1", status: "berlaku", answer: "SQLite", flowId: "f1", step: 1 }; }) as never,
    });
    const r = await answerAsk(ask(), CTX, d);
    expect(d.decide).toHaveBeenCalledTimes(1);
    expect(d.send).not.toHaveBeenCalled();
    expect(r.answered).toBe(false);
    expect(failureCount("s1")).toBe(0);
  });
});

describe("AC-11 per pertanyaan (ADR-0223)", () => {
  const tanya = (question: string, id: string) => ask({ askId: id, questions: [
    { header: "Basis", question, multiSelect: false, options: [{ label: "SQLite" }, { label: "Postgres" }] }] });
  const layarnya = (question: string) => {
    let answered = false;
    return {
      pane: () => (answered ? SELESAI : DIALOG.replace("Basis data mana?", question)),
      send: vi.fn(async () => { answered = true; return true; }),
    };
  };

  it("sesi panjang dengan pertanyaan BERBEDA tak pernah kena pagar", async () => {
    const d = deps();
    for (let i = 0; i < 10; i++) {
      const question = `Basis data ke-${i} mana?`;
      Object.assign(d, layarnya(question));
      expect(await admitAsk({ ...S, sig: askSignature(tanya(question, `t${i}`)) }, d)).toEqual({ ok: true });
      expect((await answerAsk(tanya(question, `t${i}`), CTX, d)).answered).toBe(true);
    }
    expect(d.notify).not.toHaveBeenCalled();
  });

  it("pertanyaan yang SAMA terus kembali → pagar menggigit sesudah maxAutoAnswers", async () => {
    const d = deps();
    const question = "Basis data mana?";
    for (let i = 0; i < 3; i++) {
      Object.assign(d, layarnya(question));
      await answerAsk(tanya(question, `t${i}`), CTX, d);
    }
    expect(await admitAsk({ ...S, sig: askSignature(tanya(question, "t9")) }, d))
      .toEqual({ ok: false, reason: "batas jawaban otomatis tercapai" });
    // Pertanyaan lain tetap boleh — deretnya milik pertanyaan itu saja.
    expect(await admitAsk({ ...S, sig: "pertanyaan lain?" }, d)).toEqual({ ok: true });
  });
});
