import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../src/db";
import { LEAD_DEFAULTS, type Lead, type LeadDelivery, type SessionAsk } from "@hanoman/shared";
import type { LeadDecision } from "@prisma/client";
import {
  admitAsk, answerAsk, __resetDetect, resetSession, answerCount, failureCount, FAIL_COOLDOWN_MS,
  type AskCtx, type DetectDeps,
} from "../src/services/lead/detect";
import { recordDecision } from "../src/services/lead/trail";
import { LeadBusyError } from "../src/services/lead/gate";

// SPEC-409 · ADR-0091 · pintu #2 (deteksi otomatis). Semua deps disuntik: nol tmux, nol agen.
//
// SPEC-909 · ADR-0146 · berkas ini dulu menguji `scanAndAnswer`, si PEMINDAI: satu denyut menyapu
// semua sesi hidup, membaca marker, lalu men-`capture-pane` untuk menebak apa yang ditanyakan.
// Penggantinya dua fungsi PER SESI yang disuapi payload hook (`admitAsk` + `answerAsk`), dan
// sekelas kasus di sini kehilangan artinya bersama pemindainya — dihapus, bukan dilonggarkan:
//
// - gerbang `live`/`filled`/`agentOf`: marker & daftar sesi bukan lagi pemicu. Pagar yang MASIH
//   menggigit (master switch, jeda per-project, opt-in, pane mati, codex selesai wajar) sudah
//   diuji di `lead-detect-event.test.ts`; menyalinnya ke sini melahirkan dua definisi.
// - "dialog di layar adalah kunci kedua" & "rantai tuntas harus dibuktikan" (SPEC-487): layar tak
//   lagi memicu apa pun, dan berapa langkah satu rantai kini DIKETAHUI dari payload — itulah yang
//   mencabut `CHAIN_END_TRIES`/`settledPane` yang dua describe itu kunci.
// - "banyak sesi menunggu bersamaan" (SPEC-479): batas konkurensi pindah ke `lead/ask.ts`. Satu
//   kasusnya TETAP di sini, di describe SPEC-472 — "gerbang penuh bukan kegagalan lead" mengukur
//   penghitung `failures` milik `runChain`, bukan konkurensinya.
// - kasus ber-`sweep()` ("melupakan penghitung begitu sesinya tak ada lagi", "sesi yang sudah tak
//   ada melepas ingatan alurnya"): penyapunya dicabut; pemangkasan sesi mati jadi urusan `ask.ts`.

const clean = async () => {
  await prisma.leadDecision.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(async () => { await clean(); __resetDetect(); });
afterAll(clean);

const cfg = (over: Partial<Lead> = {}): Lead => ({ ...LEAD_DEFAULTS, enabled: true, ...over });

/** Sesi yang dinilai `admitAsk` — cermin baris `Session` yang dipegang pekerja `lead/ask.ts`. */
const S = { id: "s1", specId: "spec-1", projectId: "demo" };
/** Konteks satu tanya: project, backlog, dan marker yang dikosongkan di ujung rantai. */
const CTX: AskCtx = { projectId: "demo", specId: "spec-1", decisionFile: "/marker" };

/**
 * SPEC-909 · payload hook apa adanya. Pertanyaan & opsinya datang DARI SINI sekarang, bukan dari
 * `capture-pane`; layar tinggal dipakai untuk dua hal, keduanya di dalam satu rantai yang sudah
 * dipicu event: membuktikan dialognya sudah tergambar, dan membuktikan ia BERGANTI antar-pertanyaan.
 */
const ask = (over: Partial<SessionAsk> = {}): SessionAsk => ({
  sessionId: "s1", agent: "claude", source: "ask-tool", askId: "toolu_1",
  askedAt: "2026-01-01T00:00:00.000Z",
  questions: [{
    header: "Cache", question: "Mana yang kamu mau?", multiSelect: false,
    options: [{ label: "In-memory" }, { label: "Redis" }, { label: "Tanpa cache" }],
  }],
  message: "", at: 0, total: 1, state: "queued", flowId: null, step: null, ...over,
});

/** Payload DUA pertanyaan dalam satu panggilan — bentuk rantai SPEC-474 sesudah SPEC-909. */
const rantai = (over: Partial<SessionAsk> = {}): SessionAsk => ask({
  total: 2,
  questions: [
    { header: "Warna", question: "Pilih warna tema?", multiSelect: false,
      options: [{ label: "Merah" }, { label: "Biru" }] },
    { header: "Ukuran", question: "Pilih ukuran font?", multiSelect: false,
      options: [{ label: "Kecil" }, { label: "Besar" }] },
  ],
  ...over,
});

/** Giliran codex yang benar-benar bertanya — gerbangnya `readCodexTurn(ask.message)`, bukan layar. */
const codex = (message: string): SessionAsk =>
  ask({ agent: "codex", source: "turn-end", questions: [], message });

// Layar dialog satu pertanyaan (tanpa tab strip): bentuk yang ditunggu `waitDialog` sebelum satu
// huruf pun diketik. Sesudah SPEC-909 ia bukan lagi SUMBER pertanyaannya — cuma buktinya.
const ASKQ_PANE = `
Mau pakai strategi cache yang mana?

❯ 1. In-memory
  2. Redis
  3. Tanpa cache
  4. Type something.
  5. Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel
`;

/** Satu layar dialog berantai; JUDUL-nya yang membedakan satu tangkapan dari tangkapan berikutnya. */
const dialogPane = (title: string): string => [
  "←  ☐ Warna  ☐ Ukuran  ✔ Submit  →", "", title, "",
  "❯ 1. Merah", "  2. Biru", "  3. Type something.", "  4. Chat about this", "",
  "Enter to select · Tab/Arrow keys to navigate · Esc to cancel",
].join("\n");

/**
 * Pane yang benar-benar MAJU: tiap pembacaan mengganti judul dialognya.
 *
 * `waitScreenChange` menuntut `dialogKey` berganti, dan `dialogKey` sengaja kebal terhadap kursor,
 * spinner, tab yang tercentang, dan label kolom bebas yang berubah begitu prosa lead mendarat
 * (ADR-0142 keputusan 2) — jadi suffix kosmetik tak pernah cukup memajukan rantai, di test maupun
 * di produksi. Yang menggerakkannya cuma judul yang berganti, layar rekap, atau layar yang berhenti
 * jadi dialog.
 */
const paneMaju = (): (() => string) => {
  let n = 0;
  return () => dialogPane(`Pertanyaan ke-${n++}?`);
};

/** Layar rekap SPEC-474: bentuk yang dituntut `submitPaneDialog` (`kind === "review"`). */
const REVIEW_PANE = [
  "←  ☒ Warna  ☒ Ukuran  ✔ Submit  →", "", "Review your answers", "",
  "Ready to submit your answers?", "", "❯ 1. Submit answers", "  2. Cancel",
].join("\n");

/** Layar sesudah dialog benar-benar tertutup — bukan dialog lagi. */
const SELESAI_PANE = "⏺ User answered Claude's questions:\n\n❯\n  ⏵⏵ bypass permissions on";

/**
 * Panggung yang meniru TUI sungguhan: dialognya MAJU saat dijawab, lalu BERAKHIR.
 *
 * Akhirnya penting, bukan detail fixture. `submitPaneDialog` fail-closed untuk layar yang bukan
 * rekap, dan dialog SATU pertanyaan claude tak pernah menampilkan layar rekap sama sekali — jadi
 * panggung yang tak pernah berakhir akan membuat kasus paling umum terbaca "gagal" di test
 * sekaligus menyembunyikan kalau produksi benar-benar menekan Submit di layar yang salah.
 */
type Panggung = {
  total?: number;
  akhir?: "rekap" | "tertutup" | "macet";
  /** Gerbang "dialognya sudah tergambar di pane". Palsu = event yang tak berujung jawaban. */
  tergambar?: () => boolean;
};
function panggung(o: Panggung = {}): { pane: () => string; jawab: () => void; mulai: () => void } {
  const total = o.total ?? 1;
  const akhir = o.akhir ?? (total > 1 ? "rekap" : "tertutup");
  let n = 0;
  return {
    jawab: () => { n++; },
    mulai: () => { n = 0; },
    pane: () => {
      // `PreToolUse` menembak SEBELUM tool-nya jalan, jadi ada jendela nyata di mana dialognya
      // belum ada di layar sama sekali — dan `waitDialog` menolak mengetik apa pun di sana.
      if (o.tergambar && !o.tergambar()) return "✻ Cooked for 40m 4s\n> ";
      if (n < total) return total > 1 ? dialogPane(`Pertanyaan ke-${n}?`) : ASKQ_PANE;
      if (akhir === "rekap") return REVIEW_PANE;
      if (akhir === "tertutup") return SELESAI_PANE;
      return dialogPane("Layar yang tak kunjung menutup?");
    },
  };
}

type Harness = {
  deps: DetectDeps;
  sent: { id: string; text: string }[];
  asked: string[];
  notes: string[];
  submits: string[];
  /** Setel ulang panggung: satu EVENT = satu dialog yang lahir dari awal. */
  mulai: () => void;
};

function harness(over: Partial<DetectDeps> = {}, conf: Lead = cfg(), stage: Panggung = {}): Harness {
  const sent: { id: string; text: string }[] = [];
  const asked: string[] = [];
  const notes: string[] = [];
  const submits: string[] = [];
  const p = panggung(stage);
  const deps: DetectDeps = {
    pane: p.pane,
    exited: () => false,
    send: async (id, text) => { sent.push({ id, text }); p.jawab(); return true; },
    clearMarker: () => {},
    decide: (async (req: { question: string; projectId: string; specId?: string | null; sessionId?: string | null }) => {
      asked.push(req.question);
      return recordDecision({
        projectId: req.projectId, specId: req.specId, sessionId: req.sessionId,
        gate: "detected", kind: "answer", question: req.question,
        answer: "opsi 1", reason: "r", refs: [], confidence: "tinggi", action: "none",
      });
    }) as unknown as DetectDeps["decide"],
    decideDeps: {} as DetectDeps["decideDeps"],
    // SPEC-480 · default harness: saluran pengiriman kosong → jatuh ke `row.answer`, yaitu
    // perilaku persis sebelum spec ini. Test yang memang menguji perakitan teks menimpanya.
    delivery: () => null,
    optIn: async () => ["demo"],
    notify: async (_id, title) => { notes.push(title); },
    cfg: async () => conf,
    // SPEC-474 · menekan `Submit answers` adalah langkah mekanis; `sleep` disuntik supaya rantai
    // bisa diuji tanpa waktu nyata.
    submit: async (id) => { submits.push(id); return true; },
    sleep: async () => {},
    // SPEC-487 · rantai deteksi hidup di dalam satu `LeadFlow`; penutupnya disuntik supaya bisa
    // diperiksa tanpa menyentuh DB.
    closeChain: async () => {},
    now: () => Date.now(),
    ...over,
  };
  return { deps, sent, asked, notes, submits, mulai: p.mulai };
}

/**
 * Urutan yang dipakai pekerja `lead/ask.ts`: pagar dulu (`admitAsk`), baru rantainya (`answerAsk`).
 *
 * Test pagar beruntun butuh KEDUANYA — `answerAsk` sendirian melewati setiap pagar, sementara yang
 * diukur SPEC-472/AC-11 justru "agennya tak lagi dipanggil sama sekali".
 */
async function layani(h: Harness, a: SessionAsk = ask()): Promise<{ answered: boolean; reason: string }> {
  h.mulai();          // satu event = satu dialog baru; panggung tak boleh membawa sisa event lalu
  const gate = await admitAsk(S, h.deps);
  if (!gate.ok) return { answered: false, reason: gate.reason };
  const r = await answerAsk(a, CTX, h.deps);
  return { answered: r.answered, reason: r.reason };
}

describe("answerAsk · menjawab (AC-7/AC-8)", () => {
  it("membaca payload, memutuskan, dan mengetik jawabannya kembali", async () => {
    const h = harness();
    expect((await layani(h)).answered).toBe(true);
    expect(h.asked[0]).toContain("Mana yang kamu mau?");
    expect(h.sent).toEqual([{ id: "s1", text: "opsi 1" }]);
  });
  it("does not count an answer that never reached the pane", async () => {
    const h = harness({ send: async () => false });
    const r = await layani(h);
    expect(r.answered).toBe(false);
    expect(answerCount("s1")).toBe(0);
    expect(r.reason).toContain("mengetik");
  });
  it("does not type when lead failed to produce a valid decision", async () => {
    const h = harness({
      decide: (async (req: { projectId: string; question: string }) => recordDecision({
        projectId: req.projectId, gate: "detected", kind: "answer", question: req.question,
        answer: "", reason: "timeout", refs: [], confidence: "ragu", action: "none", status: "gagal",
      })) as unknown as DetectDeps["decide"],
    });
    expect((await layani(h)).answered).toBe(false);
    expect(h.sent).toEqual([]);
  });
});

// SPEC-472 (QA) · pagar AC-11 menghitung jawaban yang BERHASIL diberikan, jadi sesi yang
// keputusannya selalu gagal tak pernah mendekatinya. Terukur di produksi — 152 keputusan `gagal`
// untuk tiga sesi yang sama dalam ±13 menit, satu proses agen (dan kuota langganan yang sama dengan
// sesi pekerja) untuk masing-masing, tanpa satu pun jalan berhenti. Pemicunya berganti di SPEC-909
// (event, bukan denyut 5 detik), tetapi bentuk badainya tak: satu sesi yang terus bertanya
// menerbitkan event terus juga.
describe("admitAsk · batas kegagalan beruntun (SPEC-472)", () => {
  const failing = (): Partial<DetectDeps> => ({
    decide: (async (req: { projectId: string; specId?: string | null; sessionId?: string | null; question: string }) =>
      recordDecision({
        projectId: req.projectId, specId: req.specId, sessionId: req.sessionId,
        gate: "detected", kind: "answer", question: req.question,
        answer: "", reason: "lead claude gagal (exit 1): Invalid API key · Fix external API key",
        refs: [], confidence: "ragu", action: "none", status: "gagal",
      })) as unknown as DetectDeps["decide"],
  });

  it("berhenti memanggil agen setelah maxAutoAnswers kegagalan beruntun", async () => {
    let calls = 0;
    const base = failing();
    const h = harness({
      decide: (async (...a: Parameters<DetectDeps["decide"]>) => { calls++; return (base.decide as DetectDeps["decide"])(...a); }) as DetectDeps["decide"],
    }, cfg({ maxAutoAnswers: 2 }));
    await layani(h);
    await layani(h);
    expect(calls).toBe(2);
    expect(failureCount("s1")).toBe(2);

    const third = await layani(h);
    expect(calls).toBe(2);                       // tak ada agen ketiga yang di-spawn
    expect(third.answered).toBe(false);
    expect(third.reason).toContain("gagal");
  });

  it("menotifikasi operator tepat sekali saat menyerah", async () => {
    const h = harness(failing(), cfg({ maxAutoAnswers: 1 }));
    await layani(h);
    await layani(h);
    await layani(h);
    expect(h.notes.filter((t) => t.includes("gagal"))).toHaveLength(1);
  });

  // Kegagalan harus BERUNTUN: satu keputusan yang berhasil membuktikan lead masih sanggup.
  it("keputusan yang berhasil mengosongkan penghitung kegagalan", async () => {
    let broken = true;
    const base = failing();
    const h = harness({
      decide: (async (...a: Parameters<DetectDeps["decide"]>) =>
        broken ? (base.decide as DetectDeps["decide"])(...a) : harness().deps.decide(...a)) as DetectDeps["decide"],
    }, cfg({ maxAutoAnswers: 2 }));
    await layani(h);
    expect(failureCount("s1")).toBe(1);
    broken = false;
    expect((await layani(h)).answered).toBe(true);
    expect(failureCount("s1")).toBe(0);
  });

  it("campur tangan operator memulihkan sesi yang sudah menyerah", async () => {
    const h = harness(failing(), cfg({ maxAutoAnswers: 1 }));
    await layani(h);
    expect((await layani(h)).reason).toContain("gagal");
    resetSession("s1");
    expect(failureCount("s1")).toBe(0);
  });

  // SPEC-487 (QA) · temuan C audit SPEC-479 baru dibereskan separuh. Pengecualiannya hanya
  // `LeadBusyError` — kasus di mana agen BELUM SEMPAT dipanggil — sementara kasus yang diukur
  // temuan itu (agen dipanggil lalu di-SIGTERM di detik ke-`timeoutSec` karena mesin sedang berat)
  // tiba sebagai `status = "gagal"` biasa dan tetap menaikkan penghitung. Karena `failCapped`
  // adalah keadaan MENYERAP, tiga lonjakan beban menutup lead bagi sesi itu selamanya.
  it("kegagalan yang berjauhan waktu tidak lagi dihitung beruntun", async () => {
    let clock = 1_000_000;
    const h = harness({ ...failing(), now: () => clock }, cfg({ maxAutoAnswers: 2 }));
    await layani(h);
    await layani(h);
    expect(failureCount("s1")).toBe(2);
    expect((await layani(h)).reason).toContain("gagal");

    clock += FAIL_COOLDOWN_MS + 1;                  // bebannya sudah lama hilang
    const after = await layani(h);
    expect(after.reason).not.toContain("batas kegagalan");
    expect(failureCount("s1")).toBe(1);             // dihitung ulang dari nol, bukan dari 3
  });

  it("kegagalan yang beruntun cepat tetap tertahan (badai SPEC-472 utuh)", async () => {
    let clock = 1_000_000;
    let calls = 0;
    const base = failing();
    const h = harness({
      now: () => clock,
      decide: (async (...a: Parameters<DetectDeps["decide"]>) => { calls++; return (base.decide as DetectDeps["decide"])(...a); }) as DetectDeps["decide"],
    }, cfg({ maxAutoAnswers: 2 }));
    for (let i = 0; i < 6; i++) { clock += 5_000; await layani(h); }
    expect(calls).toBe(2);
  });

  // SPEC-479 (QA) · satu-satunya kasus describe "banyak sesi menunggu bersamaan" yang TIDAK ikut
  // pindah ke `lead-ask.test.ts`: yang diukurnya penghitung `failures` milik `runChain`, bukan
  // batas konkurensinya. Inti temuan C: `failures`/`failCapped` SPEC-472 dibuat untuk sebab yang
  // tak hilang dengan mengulang. Penuh adalah kebalikannya — ia hilang begitu slot bebas.
  it("gerbang penuh BUKAN kegagalan lead: tak menambah penghitung, sesinya tetap layak dicoba lagi", async () => {
    let penuh = true;
    let percobaan = 0;
    const h = harness({
      decide: (async (req: { question: string; projectId: string; specId?: string | null; sessionId?: string | null }) => {
        percobaan++;
        if (penuh) throw new LeadBusyError(120_000, 4);
        return recordDecision({
          projectId: req.projectId, specId: req.specId, sessionId: req.sessionId,
          gate: "detected", kind: "answer", question: req.question,
          answer: "opsi 1", reason: "r", refs: [], confidence: "tinggi", action: "none",
        });
      }) as unknown as DetectDeps["decide"],
    });

    for (let i = 0; i < 5; i++) {
      const r = await layani(h);
      expect(r.answered).toBe(false);
      expect(r.reason).toContain("penuh");
    }
    expect(failureCount("s1")).toBe(0);
    expect(await prisma.leadDecision.count()).toBe(0);   // tak ada jejak `gagal` yang menyesatkan

    // Beban hilang → sesi yang sama langsung terlayani lagi, tanpa campur tangan operator.
    penuh = false;
    expect((await layani(h)).answered).toBe(true);
    expect(percobaan).toBe(6);
  });
});

describe("admitAsk · batas jawaban otomatis (AC-11 / OQ-10)", () => {
  it("stops after maxAutoAnswers and notifies exactly once", async () => {
    const h = harness({}, cfg({ maxAutoAnswers: 2 }));
    await layani(h);
    await layani(h);
    expect(answerCount("s1")).toBe(2);
    const third = await layani(h);
    expect(third.answered).toBe(false);
    expect(third.reason).toContain("batas");
    expect(h.notes.filter((t) => t.includes("berhenti menjawab"))).toHaveLength(1);
    await layani(h);   // event berikutnya tak menotifikasi ulang
    expect(h.notes.filter((t) => t.includes("berhenti menjawab"))).toHaveLength(1);
    expect(h.sent).toHaveLength(2);
  });

  // Versi SPEC-909 dari "keeps counting across the marker going empty": markernya bukan lagi
  // pemicu, jadi yang harus dibuktikan sekarang adalah penghitung yang SELAMAT dari event antara
  // yang tak berujung jawaban. Kalau ia di-reset di sana, pagarnya tak pernah tercapai — persis
  // loop tak berujung yang ingin dicegah AC-11.
  it("penghitung selamat dari event antara yang tak berujung jawaban", async () => {
    let bergambar = true;
    const h = harness({}, cfg({ maxAutoAnswers: 2 }), { tergambar: () => bergambar });
    await layani(h);
    expect(answerCount("s1")).toBe(1);
    bergambar = false;
    expect((await layani(h)).answered).toBe(false);   // dialognya tak pernah muncul
    expect(answerCount("s1")).toBe(1);
    bergambar = true;
    await layani(h);
    expect(answerCount("s1")).toBe(2);
    expect((await layani(h)).answered).toBe(false);
  });

  // OQ-8 · manusia menang: campur tangan operator memutus rantai "berturut-turut".
  it("resets the counter when the operator steps in", async () => {
    const h = harness({}, cfg({ maxAutoAnswers: 1 }));
    await layani(h);
    expect((await layani(h)).answered).toBe(false);
    resetSession("s1");
    expect((await layani(h)).answered).toBe(true);
  });
});

describe("answerAsk · jejak", () => {
  it("leaves one trail row per answer, linked to the session", async () => {
    const h = harness();
    await layani(h);
    const rows: LeadDecision[] = await prisma.leadDecision.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sessionId: "s1", specId: "spec-1", gate: "detected" });
  });
});

// SPEC-452 · dua cacat di ujung pintu deteksi: opsi dialog tak pernah sampai ke lead, dan marker
// tak pernah dikosongkan sesudah dialog dijawab (menjawab dialog BUKAN `UserPromptSubmit`, jadi
// hook pengosongnya tak menembak) — lead lalu mengetik lagi ke sesi yang sudah kembali bekerja.
// Sesudah SPEC-909 opsinya datang dari payload; yang dijaga di sini tetap dua hal yang sama.
describe("answerAsk · dialog pilihan (SPEC-452)", () => {
  it("meneruskan opsi dialog ke lead, bukan hanya teks pertanyaannya", async () => {
    const opts: (string[] | undefined)[] = [];
    const h = harness({
      decide: (async (req: { question: string; options?: string[]; projectId: string; specId?: string | null; sessionId?: string | null }) => {
        opts.push(req.options);
        return recordDecision({
          projectId: req.projectId, specId: req.specId, sessionId: req.sessionId,
          gate: "detected", kind: "answer", question: req.question,
          answer: "Tanpa cache", reason: "r", refs: [], confidence: "tinggi", action: "none",
        });
      }) as unknown as DetectDeps["decide"],
    });
    await layani(h);
    expect(opts[0]).toEqual(["In-memory", "Redis", "Tanpa cache"]);
  });

  it("mengosongkan marker sesudah jawaban benar-benar mendarat", async () => {
    const cleared: string[] = [];
    const h = harness({ clearMarker: (f: string) => { cleared.push(f); } });
    await layani(h);
    expect(cleared).toEqual(["/marker"]);
  });

  it("TIDAK mengosongkan marker saat pengetikan gagal — sesi memang masih menunggu", async () => {
    const cleared: string[] = [];
    const h = harness({ send: async () => false, clearMarker: (f: string) => { cleared.push(f); } });
    await layani(h);
    expect(cleared).toEqual([]);
  });
});

// SPEC-474 · dialog `AskUserQuestion` BERANTAI: satu tool call, beberapa pertanyaan berturut-turut.
// Menjawab satu pertanyaan hanya MEMAJUKAN dialog; yang menutupnya adalah layar rekap. Sampai spec
// itu, lead menjawab pertanyaan pertama lalu mengosongkan marker — dan marker itu TAK PERNAH terisi
// lagi, jadi sisa rantainya tak terlihat oleh siapa pun. Sesudah SPEC-909 panjang rantainya datang
// dari `questions.length`; yang masih dibaca dari layar cuma "dialognya sudah tergambar" dan
// "layarnya sudah berganti".
describe("answerAsk · rantai dialog sampai submit (SPEC-474)", () => {
  /** `decide` yang menjawab berbeda tiap panggilan — supaya urutan jawabannya bisa diperiksa. */
  const menjawab = (counter: { n: number }): Partial<DetectDeps> => ({
    decide: (async (req: { question: string; projectId: string; specId?: string | null; sessionId?: string | null }) => {
      counter.n += 1;
      return recordDecision({
        projectId: req.projectId, specId: req.specId, sessionId: req.sessionId,
        gate: "detected", kind: "answer", question: req.question,
        answer: `jawab-${counter.n}`, reason: "r", refs: [], confidence: "tinggi", action: "none",
      });
    }) as unknown as DetectDeps["decide"],
  });

  it("menjawab tiap pertanyaan lalu MENEKAN submit, satu keputusan per pertanyaan", async () => {
    const counter = { n: 0 };
    const cleared: string[] = [];
    const h = harness({
      ...menjawab(counter),
      clearMarker: (f: string) => { cleared.push(f); },
    }, cfg(), { total: 2 });
    expect((await layani(h, rantai())).answered).toBe(true);
    expect(counter.n).toBe(2);                       // dua pertanyaan, dua keputusan
    expect(h.submits).toEqual(["s1"]);               // submit TIDAK memanggil agen ketiga
    expect(h.sent.map((s) => s.text)).toEqual(["jawab-1", "jawab-2"]);
    expect(cleared).toEqual(["/marker"]);            // marker dikosongkan SEKALI, di ujung rantai
    expect(answerCount("s1")).toBe(1);               // satu rantai = SATU jawaban otomatis
  });

  // Layar rekap adalah langkah MEKANIS: menutup dialog yang jawabannya sudah masuk tak butuh
  // pertimbangan apa pun, jadi ia tak boleh membakar satu giliran agen. Dulu dibuktikan lewat pane
  // yang SUDAH berada di layar rekap saat denyut tiba; sesudah SPEC-909 rekap bukan pemicu, jadi
  // yang dibuktikan adalah jumlah panggilan agen di dalam satu rantai yang berujung submit.
  it("menekan submit tak pernah membakar giliran agen", async () => {
    const counter = { n: 0 };
    const h = harness({ ...menjawab(counter) }, cfg(), { total: 2 });
    await layani(h, rantai());
    expect(counter.n).toBe(2);                       // dua pertanyaan → dua panggilan, bukan tiga
    expect(h.submits).toEqual(["s1"]);
  });

  it("memberi tahu lead posisi pertanyaannya di dalam rantai", async () => {
    const seen: string[] = [];
    const h = harness({
      decide: (async (req: { question: string; projectId: string; notes?: string[] }) => {
        seen.push((req.notes ?? []).join(" "));
        return recordDecision({
          projectId: req.projectId, gate: "detected", kind: "answer", question: req.question,
          answer: "ok", reason: "r", refs: [], confidence: "tinggi", action: "none",
        });
      }) as unknown as DetectDeps["decide"],
    }, cfg(), { total: 2 });
    await layani(h, rantai());
    expect(seen[0]).toContain("pertanyaan ke-1");
    expect(seen[1]).toContain("pertanyaan ke-2");
  });

  // Kebalikan dari perilaku sebelum SPEC-474: rantai yang putus HARUS tetap terlihat menunggu.
  it("rantai putus TIDAK mengosongkan marker dan dihitung sebagai kegagalan", async () => {
    let calls = 0;
    const cleared: string[] = [];
    const h = harness({
      clearMarker: (f: string) => { cleared.push(f); },
      decide: (async (req: { question: string; projectId: string }) => {
        calls++;
        return recordDecision({
          projectId: req.projectId, gate: "detected", kind: "answer", question: req.question,
          answer: calls === 1 ? "ok" : "", reason: "r", refs: [], confidence: "tinggi",
          action: "none", ...(calls === 1 ? {} : { status: "gagal" as const }),
        });
      }) as unknown as DetectDeps["decide"],
    }, cfg(), { total: 2 });
    const r = await layani(h, rantai());
    expect(r.answered).toBe(false);
    expect(cleared).toEqual([]);                     // operator tetap melihat sesi MENUNGGU
    expect(failureCount("s1")).toBe(1);
    expect(answerCount("s1")).toBe(0);
  });

  // Pane yang tak pernah maju tak boleh membuat lead mengetik berulang-ulang ke layar yang sama.
  it("berhenti bila layar dialog tak berubah sesudah dijawab (anti-loop)", async () => {
    const counter = { n: 0 };
    const cleared: string[] = [];
    const h = harness({
      ...menjawab(counter),
      pane: () => dialogPane("Pilih warna tema?"),   // layar MACET: judulnya tak pernah berganti
      clearMarker: (f: string) => { cleared.push(f); },
    });
    await layani(h, rantai());
    expect(counter.n).toBe(1);                        // tak mengulang keputusan untuk layar yang sama
    expect(h.sent).toHaveLength(1);
    expect(cleared).toEqual([]);
    expect(failureCount("s1")).toBe(1);
  });

  it("submit yang gagal tak pernah dilaporkan sebagai rantai tuntas", async () => {
    const cleared: string[] = [];
    const h = harness(
      { submit: async () => false, clearMarker: (f: string) => { cleared.push(f); } },
      cfg(), { total: 2 });
    const r = await layani(h, rantai());
    expect(r.answered).toBe(false);
    expect(cleared).toEqual([]);
    expect(r.reason).toContain("Submit");
  });

  // SPEC-909 · regresi yang nyaris lolos: `submitPaneDialog` fail-closed untuk layar yang bukan
  // rekap, dan dialog SATU pertanyaan claude tak pernah menampilkan layar rekap. Menekan Submit
  // tanpa syarat membuat kasus PALING UMUM dilaporkan `gagal` — marker tak dikosongkan, `answers`
  // tak naik, `failures` naik, dan sesudah `maxAutoAnswers` dialog sehat sesi itu kena `failCapped`.
  it("dialog yang menutup sendiri tak pernah menekan Submit", async () => {
    const h = harness({}, cfg(), { total: 1, akhir: "tertutup" });
    expect((await layani(h)).answered).toBe(true);
    expect(h.submits).toEqual([]);
    expect(failureCount("s1")).toBe(0);
  });

  // Sesi itu memang masih menunggu. Mengosongkan markernya menghapusnya dari pil, notifikasi, dan
  // panel pet — dan tak ada yang akan menulisnya kembali (SPEC-474).
  it("dialog yang tak kunjung menutup: marker TETAP terisi, bukan kegagalan lead", async () => {
    const cleared: string[] = [];
    const h = harness({ clearMarker: (f: string) => { cleared.push(f); } },
      cfg(), { total: 1, akhir: "macet" });
    const r = await layani(h);
    expect(r.answered).toBe(false);
    expect(cleared).toEqual([]);
    expect(failureCount("s1")).toBe(0);              // jawabannya mendarat; yang belum cuma layarnya
  });

  // Jalur kolom chat biasa = giliran codex sesudah SPEC-909: gerbangnya `last_assistant_message`,
  // tak ada dialog, tak ada submit.
  it("kolom chat biasa tetap satu jawaban lalu selesai", async () => {
    const cleared: string[] = [];
    const counter = { n: 0 };
    const h = harness({
      ...menjawab(counter),
      pane: () => "> ",                               // codex: tak ada dialog untuk ditunggu
      clearMarker: (f: string) => { cleared.push(f); },
    });
    const r = await layani(h, codex("Pakai Redis atau in-memory?"));
    expect(r.answered).toBe(true);
    expect(counter.n).toBe(1);
    expect(h.submits).toEqual([]);                    // tak ada dialog → tak ada yang di-submit
    expect(cleared).toEqual(["/marker"]);
    expect(answerCount("s1")).toBe(1);
  });

  // Satu pertanyaan = satu keputusan, satu ketikan. Panjang rantainya kini diketahui dari payload
  // dan bukan disimpulkan dari layar; yang masih dibaca dari layar hanya apakah dialognya menutup
  // sendiri atau menyisakan layar rekap untuk ditekan.
  it("dialog satu pertanyaan tetap selesai dalam satu jawaban", async () => {
    const counter = { n: 0 };
    const cleared: string[] = [];
    const h = harness({ ...menjawab(counter), clearMarker: (f: string) => { cleared.push(f); } });
    const r = await layani(h);
    expect(r.answered).toBe(true);
    expect(counter.n).toBe(1);
    expect(h.sent.map((s) => s.text)).toEqual(["jawab-1"]);
    expect(cleared).toEqual(["/marker"]);
  });
});

// SPEC-487 (QA) · ADR-0102 menaruh mesin rantainya di `decide()` dan menyerahkan penggeraknya ke
// "agen peminta" — tapi peminta yang sesungguhnya menggerakkan rantai di produksi adalah `runChain`
// di dalam hanoman sendiri, dan ia dulu memanggil `decide()` tanpa `chain` maupun `flowId`. Terukur
// di DB hidup: 22 dari 22 baris `gate="detected"` ber-`step = 1`, dan 3 alur yang ada ketiganya
// `tunggal` padahal ketiganya SATU dialog 3-pertanyaan. `chainSteps` karena itu selalu kosong.
type AskSpy = { chain?: boolean; flowId?: string | null };
describe("answerAsk · satu rantai = satu LeadFlow (SPEC-487)", () => {
  /** `decide` yang mengaku lahir di alur `F1`, dan merekam apa yang diminta pemanggilnya. */
  const berantai = (seen: AskSpy[]): Partial<DetectDeps> => ({
    decide: (async (req: { question: string; projectId: string; chain?: boolean; flowId?: string | null }) => {
      seen.push({ chain: req.chain, flowId: req.flowId ?? null });
      return recordDecision({
        projectId: req.projectId, gate: "detected", kind: "answer", question: req.question,
        answer: `jawab-${seen.length}`, reason: "r", refs: [], confidence: "tinggi", action: "none",
        flowId: "F1", step: seen.length,
      });
    }) as unknown as DetectDeps["decide"],
  });

  it("langkah kedua meneruskan flowId langkah pertama, dan alurnya ditutup di ujung rantai", async () => {
    const seen: AskSpy[] = [];
    const closed: string[] = [];
    const h = harness({
      ...berantai(seen),
      closeChain: async (id: string) => { closed.push(id); },
    }, cfg(), { total: 2 });
    expect((await layani(h, rantai())).answered).toBe(true);
    expect(seen).toEqual([{ chain: true, flowId: null }, { chain: true, flowId: "F1" }]);
    expect(closed).toEqual(["F1"]);
  });

  // Rantai boleh terputus di tengah (gerbang penuh, agen gagal, layar tak maju). Versi SPEC-909
  // dari "denyut berikutnya": tak ada denyut lagi, jadi yang harus melanjutkan alur yang sama
  // adalah EVENT BERIKUTNYA untuk sesi itu — `chainFlows` diingat lintas panggilan justru untuk
  // itu. Kalau tidak, lanjutannya lahir sebagai alur BARU dan `chainSteps` kosong lagi tepat di
  // tempat yang paling membutuhkannya.
  it("event berikutnya untuk sesi yang sama melanjutkan alur yang sama", async () => {
    const seen: AskSpy[] = [];
    const closed: string[] = [];
    const h = harness({
      ...berantai(seen),
      pane: () => dialogPane("Pilih warna tema?"),   // layar tak pernah maju → rantai putus
      closeChain: async (id: string) => { closed.push(id); },
    });
    await layani(h, rantai());
    await layani(h, rantai());
    expect(seen[0]).toEqual({ chain: true, flowId: null });
    expect(seen).toHaveLength(2);
    for (const a of seen.slice(1)) expect(a).toEqual({ chain: true, flowId: "F1" });
    expect(closed).toEqual([]);                      // belum tuntas → alurnya tetap terbuka
  });
});

// SPEC-480 · ADR-0098 · yang diketik ke kolom jawaban bebas DIRAKIT dari putusan terstruktur.
// Sebelum spec ini, prosa lead adalah satu-satunya jembatan: model di seberang harus menafsirkan
// kalimatnya untuk menebak opsi mana yang dipilih — dan SPEC-452 sudah mengukur ongkos salah tebak.
describe("answerAsk · teks jawaban dirakit dari pilihan (SPEC-480)", () => {
  const withDelivery = (d: Partial<LeadDelivery>): Partial<DetectDeps> => ({
    // SPEC-485 · `choices` adalah bentuk yang berlaku; fixture SPEC-480 memakai `choice` tunggal
    // dan tetap sah — `leadReplyText` jatuh ke sana saat daftarnya kosong.
    delivery: () => ({ decision: "d", reason: "Redis sudah dipakai modul lain.", reply: "", choices: [], choice: null, missing: [], ...d }),
  });

  it("types the chosen option verbatim instead of the raw prose", async () => {
    const h = harness(withDelivery({ choice: { index: 2, option: "Redis" } }));
    await layani(h);
    expect(h.sent[0]!.text).toBe("Pilih: Redis. Redis sudah dipakai modul lain.");
  });

  it("says what is missing when lead declared the context insufficient", async () => {
    const h = harness(withDelivery({ missing: ["versi Redis yang dipakai produksi"] }));
    await layani(h);
    expect(h.sent[0]!.text).toContain("Belum bisa kuputuskan");
    expect(h.sent[0]!.text).toContain("versi Redis yang dipakai produksi");
  });

  // Saluran pengiriman boleh meleset — yang selalu ada adalah `answer`, dan mengetik string kosong
  // ke pane tak pernah boleh terjadi.
  it("falls back to the trail answer when the delivery channel misses", async () => {
    const h = harness({ delivery: () => null });
    await layani(h);
    expect(h.sent[0]!.text).toBe("opsi 1");
  });
});

// SPEC-485 · ADR-0102 · pilihan lead menyeberang sebagai DATA. Tanpa ini dialog `multiSelect`
// hanya menerima prosanya dan kotak-kotaknya tetap kosong — maksudnya sampai, pilihannya tidak.
describe("answerAsk · pilihan diteruskan ke pane (SPEC-485)", () => {
  it("mengirim label opsi terpilih apa adanya ke `send`", async () => {
    const seen: string[][] = [];
    const h = harness({
      delivery: () => ({
        decision: "d", reason: "r", reply: "", missing: [],
        choices: [{ index: 1, option: "alpha" }, { index: 3, option: "gamma" }],
        choice: { index: 1, option: "alpha" },
      }) as LeadDelivery,
      send: async (_id, _text, choices) => { seen.push(choices); return true; },
    });
    await layani(h);
    expect(seen[0]).toEqual(["alpha", "gamma"]);
  });

  it("saluran pengiriman yang kosong tetap mengirim daftar kosong, bukan undefined", async () => {
    const seen: string[][] = [];
    const h = harness({
      delivery: () => null,
      send: async (_id, _text, choices) => { seen.push(choices); return true; },
    });
    await layani(h);
    expect(seen[0]).toEqual([]);
  });
});
