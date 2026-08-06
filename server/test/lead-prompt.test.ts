import { describe, it, expect } from "vitest";
import { LEAD_DEFAULTS, LEAD_DECISION_MAX, LEAD_REASON_MAX } from "@hanoman/shared";
import { leadPrompt, type LeadContext, type LeadQuestion } from "../src/services/lead/prompt";

// SPEC-432 · audit `research/audit-spec-432-lead-tak-memutuskan-denyut-spam.md`.
//
// Prompt lead memerintahkan "KUMPULKAN BUKTI DULU: internal/docs/**, ADR, plan, kode, riwayat git"
// tanpa pernah menyebut bahwa ada batas waktu — lalu `brain.think()` meng-SIGTERM agennya di detik
// ke-`timeoutSec`. Akibatnya, di DB operator, TUJUH dari tujuh baris jejak berstatus `gagal` dengan
// alasan identik `kehabisan waktu 120000 ms`; nol keputusan `berlaku` pernah lahir.
//
// Terukur pada agen (claude-opus-5 · effort xhigh) dan harness `execFile` yang sama, dua varian
// prompt yang HANYA berbeda pada ada-tidaknya paragraf anggaran waktu:
//   tanpa anggaran → 306 236 ms (2,55× batas 120 dtk, selalu di-SIGTERM di produksi)
//   dengan anggaran → 101 136 ms, blok ```json sah, MASIH DI BAWAH batas 120 dtk yang berlaku
// Anggaran itu karena itu bukan hiasan prompt: ia adalah perbaikannya.

const ctx = (over: Partial<LeadContext> = {}): LeadContext => ({
  projectId: "demo", projectName: "Demo", repoDir: null, timeoutSec: 300, ...over,
});
const q: LeadQuestion = { kind: "answer", question: "Pakai kolom baru atau turunkan?" };

describe("leadPrompt · anggaran waktu (audit SPEC-432)", () => {
  it("tells lead how many seconds it has before it is killed", () => {
    expect(leadPrompt(q, ctx({ timeoutSec: 300 }))).toContain("300 detik");
  });

  // Anggaran yang berbohong lebih buruk daripada tak ada anggaran: agen yang diberi tahu 600 detik
  // lalu dibunuh di detik ke-120 akan menganggarkan pembacaannya ke arah yang salah.
  it("carries the budget that actually applies, not a constant", () => {
    expect(leadPrompt(q, ctx({ timeoutSec: 45 }))).toContain("45 detik");
    expect(leadPrompt(q, ctx({ timeoutSec: 45 }))).not.toContain("300 detik");
  });

  it("orders lead to stop gathering evidence and decide before the budget runs out", () => {
    const p = leadPrompt(q, ctx());
    expect(p).toMatch(/berhenti membaca/i);
  });

  // Perintah "kumpulkan bukti dulu" tetap ada — yang ditambahkan adalah batasnya, bukan penggantinya.
  it("keeps the evidence-first mandate", () => {
    expect(leadPrompt(q, ctx())).toContain("KUMPULKAN BUKTI DULU");
  });
});

// SPEC-480 · ADR-0098 · putusan yang panjang bukan cuma mahal, ia tak terpakai: peminta harus
// menebak opsi mana yang sebenarnya dipilih, dan `orderReadyWork` bahkan mem-`split` prosanya.
describe("leadPrompt · putusan ringkas & terstruktur (SPEC-480)", () => {
  const OPTS = ["Node 20 LTS", "Node 22"];

  it("names the length budget in numbers, not adjectives", () => {
    const p = leadPrompt(q, ctx());
    expect(p).toContain(String(LEAD_DECISION_MAX));
    expect(p).toContain(String(LEAD_REASON_MAX));
  });

  it("forbids the three things that made past decisions unusable", () => {
    const p = leadPrompt(q, ctx());
    expect(p).toMatch(/ringkasan ulang konteks/i);
    expect(p).toMatch(/latar belakang/i);
    expect(p).toMatch(/alternatif yang tak diminta/i);
  });

  it("demands a structured choice whenever options are on the table", () => {
    const p = leadPrompt({ ...q, options: OPTS }, ctx());
    expect(p).toContain("1. Node 20 LTS");
    expect(p).toContain("2. Node 22");
    expect(p).toMatch(/`choice`/);
    expect(p).toMatch(/di luar daftar ditolak/i);
  });

  it("keeps the json shape example carrying both new fields", () => {
    const p = leadPrompt(q, ctx());
    expect(p).toContain('"choice"');
    expect(p).toContain('"missing"');
  });

  // ADR-0098 mengamandemen AC-22 ADR-0091: larangan "tidak tahu" tetap, tapi kini punya SATU
  // pengecualian bernama — dan pengecualian itu wajib menyebut apa yang kurang.
  it("still forbids a bare `tidak tahu` while naming the one narrow exception", () => {
    const p = leadPrompt(q, ctx());
    expect(p).toContain("Tidak tahu");
    expect(p).toMatch(/missing/);
    expect(p).toMatch(/bisa disediakan seseorang|hal konkret/i);
  });

  // Yang lama tak boleh hilang: anggaran waktu SPEC-432 adalah alasan lead bisa memutuskan sama sekali.
  it("keeps the SPEC-432 time budget intact", () => {
    expect(leadPrompt(q, ctx({ timeoutSec: 300 }))).toContain("300 detik");
  });
});

describe("LEAD_DEFAULTS.timeoutSec (audit SPEC-432)", () => {
  // 120 dtk bukan angka yang terlalu kecil sedikit — ia lebih kecil daripada ongkos terukur SATU
  // keputusan nyata (306 dtk), jadi tiap keputusan pasti gagal, bukan kadang-kadang.
  it("is larger than the measured cost of one real decision (306 s)", () => {
    expect(LEAD_DEFAULTS.timeoutSec).toBeGreaterThan(306);
  });
});

// SPEC-485 · ADR-0102 · dua hal yang harus sampai ke agen: BERAPA opsi boleh dipilih (pola anggaran
// waktu SPEC-432 — batas yang tak diketahui agen adalah batas yang ditabraknya), dan apa yang sudah
// diputuskan di langkah-langkah rantai ini (keluhan "konteks hilang di antaranya").
describe("leadPrompt · pilihan jamak & rantai (SPEC-485)", () => {
  const OPTS = ["alpha", "beta", "gamma"];

  it("menyebut berapa opsi boleh dipilih saat multi, dengan angkanya", () => {
    const p = leadPrompt({ ...q, options: OPTS }, ctx({ select: { mode: "multi", min: 1, max: 2 } }));
    expect(p).toContain("`choices`");
    expect(p).toMatch(/paling sedikit 1/);
    expect(p).toMatch(/paling banyak 2/);
  });

  it("tetap menyuruh memilih SATU lewat `choice` saat single (perilaku ADR-0098 utuh)", () => {
    const p = leadPrompt({ ...q, options: OPTS }, ctx({ select: { mode: "single", min: 0, max: 1 } }));
    expect(p).toContain("`choice`");
    // `choices` hanya muncul di contoh blok json (selalu ada, demi kompatibilitas), TIDAK sebagai
    // perintah — instruksi jamak tak boleh bocor ke pertanyaan single.
    expect(p).not.toContain("Isi `choices`");
    expect(p).not.toContain("TIDAK saling eksklusif");
  });

  it("langkah rantai sebelumnya ikut terbawa, terpisah dari keputusan lain", () => {
    const p = leadPrompt({ ...q, question: "q2" }, ctx({
      chainSteps: [{ question: "q1", options: ["a", "b"], picked: ["b"] }],
    }));
    expect(p).toContain("Rantai keputusan ini");
    expect(p).toContain("q1");
    expect(p).toContain("opsi saat itu: a · b");
  });

  it("tanpa rantai, blok itu tak muncul sama sekali", () => {
    expect(leadPrompt(q, ctx())).not.toContain("Rantai keputusan ini");
  });
});

// SPEC-543 · ADR-0108 · `lead/brain.ts` adalah titik spawn agen KEDUA — yang terlewat SPEC-448
// selama berbulan-bulan karena `rootBypassEnv` hanya dipasang di `pty.ts`. Keluaran lead adalah
// blok JSON, bukan kode; yang menanganinya adalah gerbang di baris pertama klausa ("berlaku setiap
// kali kamu menulis atau mengubah kode"), bukan percabangan di pemanggil.
describe("leadPrompt · klausa gaya kode (SPEC-543)", () => {
  it("membawanya", () => {
    expect(leadPrompt(q, ctx())).toContain("Gaya kode —");
  });

  it("kontrak jawaban ringkas (ADR-0098) tetap utuh di prompt yang sama", () => {
    const p = leadPrompt(q, ctx());
    expect(p).toContain("Sepanjang apa (WAJIB)");
    expect(p).toContain("Bentuk jawaban (WAJIB)");
    expect(p).toContain(String(LEAD_DECISION_MAX));
  });
});
