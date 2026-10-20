import { z } from "zod";

// SPEC-409 · ADR-0091 · hanoman-lead: peran "tech lead mesin" di atas semua agen. Modul ini adalah
// bagian MURNI-nya — kosakata keputusan, permukaan tindakan, dan klasifikasi bobot — supaya server
// (gate tindakan), UI (label), dan test berbicara dari satu sumber.
//
// PRD `docs/prd/orchestrator-hanoman.md` membalik kontrak otonomi ADR-0035: lead memutuskan lalu
// melapor. Pengaman satu-satunya yang tak bisa dilucuti operator hidup di sini: `LEAD_ACTIONS`
// adalah ALLOWLIST, bukan denylist (AC-31/32/34). Tindakan yang tak tercantum tak punya jalan
// masuk — termasuk lewat konfigurasi.

/** Pintu masuk sebuah keputusan (AC-23). */
export const zLeadGate = z.enum(["contract", "detected", "pulse"]);
export type LeadGate = z.infer<typeof zLeadGate>;

/** Jenis keputusan; menentukan bagaimana UI mengelompokkannya & apakah ia berbobot. */
export const zLeadKind = z.enum(["answer", "order", "collision", "quality", "refusal"]);
export type LeadKind = z.infer<typeof zLeadKind>;

/** Tingkat keyakinan. `ragu` WAJIB memicu notifikasi (AC-21). */
export const zLeadConfidence = z.enum(["tinggi", "sedang", "ragu"]);
export type LeadConfidence = z.infer<typeof zLeadConfidence>;

/**
 * Status baris jejak. `gagal` bukan keputusan melainkan catatan bahwa lead TIDAK berhasil
 * memutuskan dalam batas waktu (AC-4) — ia tetap disimpan, karena "tak ada barisnya" tak bisa
 * dibedakan dari "tak pernah diminta".
 */
export const zLeadStatus = z.enum(["berlaku", "ditimpa", "dibatalkan", "gagal"]);
export type LeadStatus = z.infer<typeof zLeadStatus>;

/**
 * SPEC-485 · ADR-0102 · status satu RANTAI keputusan (outcome #4).
 *
 * `menunggu` = alur terbuka yang belum punya satu pun langkah berlaku. `sebagian` = sudah ada
 * jawaban, rantainya masih menerima pertanyaan lanjutan. `selesai` = di-submit (atau alur tunggal
 * yang ditutup seketika). `dibatalkan` = operator membatalkannya, atau ia kedaluwarsa.
 */
export const zLeadFlowStatus = z.enum(["menunggu", "sebagian", "selesai", "dibatalkan"]);
export type LeadFlowStatus = z.infer<typeof zLeadFlowStatus>;

/** Alur yang masih boleh menerima langkah baru — satu definisi, dipakai server & UI. */
export const LEAD_FLOW_OPEN: readonly LeadFlowStatus[] = ["menunggu", "sebagian"];

/**
 * PERMUKAAN TINDAKAN LEAD — allowlist tertutup (AC-31/32/34).
 *
 * Sengaja tak memuat: deploy, perintah/konsol VPS, sentuhan data produksi, dan penghapusan apa pun
 * (project, backlog, branch, worktree, notifikasi, baris jejak). Tak ada knob yang bisa
 * menambahkannya — daftar ini konstanta modul, bukan konfigurasi, persis karena AC-31 berbunyi
 * "dalam keadaan apa pun, termasuk saat operator memintanya lewat konfigurasi".
 *
 * `stop-session` ADA di daftar, tapi menghentikan sesi TIDAK menghapus worktree-nya (AC-32a) —
 * itu ditegakkan di sisi server (routes/lead.ts), bukan di sini.
 */
export const LEAD_ACTIONS = [
  "none",              // keputusan murni jawaban; tak ada tindakan menyusul
  "answer-session",    // ketik jawaban ke pane sesi (pintu deteksi otomatis)
  "start-session",     // mulai sesi untuk sebuah backlog (lewat antrean scheduler)
  "stop-session",      // hentikan sesi — worktree DIBIARKAN utuh (AC-32a)
  "resume-session",    // lanjutkan sesi terputus (jalur ADR-0084)
  "restart-session",   // ulangi pekerjaan dari awal
  "order-queue",       // tata urutan antrean yang sudah ada (ADR-0072) — bukan antrean kedua
  "hold-work",         // tunda satu pekerjaan karena tabrakan area kerja
  "push-branch",       // dorong perubahan ke branch
  "integrate-main",    // integrasikan ke branch utama (risiko yang diterima sadar, PRD §Risiko)
  "run-migration",     // jalankan migration pada basis data LOKAL operator
] as const;
export type LeadAction = (typeof LEAD_ACTIONS)[number];
export const zLeadAction = z.enum(LEAD_ACTIONS);

/**
 * Tindakan yang TERKUNCI, ditulis eksplisit meski allowlist sudah menutupnya. Gunanya dua:
 * pesan penolakan yang bisa dibaca manusia (AC-33), dan test yang membuktikan niatnya —
 * allowlist yang kebetulan bertambah satu entri berbahaya akan menabrak test ini.
 */
export const LEAD_FORBIDDEN: Record<string, string> = {
  deploy: "deploy ke produksi",
  "vps-exec": "menjalankan perintah di VPS",
  "vps-console": "membuka konsol VPS",
  "prod-data": "menyentuh data produksi",
  "delete-project": "menghapus project",
  "delete-spec": "menghapus backlog",
  "delete-branch": "menghapus branch",
  "delete-worktree": "menghapus worktree",
  "delete-notification": "menghapus notifikasi",
  "delete-decision": "menghapus jejak keputusan",
};

/** True hanya untuk tindakan yang ada di allowlist. Apa pun selain itu terkunci. */
export function leadActionAllowed(action: string): action is LeadAction {
  return (LEAD_ACTIONS as readonly string[]).includes(action);
}

/** Alasan penolakan yang bisa dibaca manusia; untuk tindakan tak dikenal pun tetap berbunyi. */
export function leadRefusalReason(action: string): string {
  return LEAD_FORBIDDEN[action] ?? `tindakan "${action}" di luar permukaan tindakan lead`;
}

/**
 * "Putusan berbobot" (OQ-5, AC-25). Empat pemicu: tindakan yang sulit dibatalkan
 * (integrate/migration/stop/restart), keraguan, tabrakan area kerja, dan penolakan tindakan
 * terkunci. Fungsi murni supaya definisinya bisa diuji dan tak tersebar di call site.
 */
export function isWeightyDecision(o: { kind: LeadKind; action: LeadAction; confidence: LeadConfidence }): boolean {
  if (o.confidence === "ragu") return true;
  if (o.kind === "collision" || o.kind === "refusal") return true;
  return o.action === "integrate-main" || o.action === "run-migration"
    || o.action === "stop-session" || o.action === "restart-session";
}

// ── SPEC-480 · ADR-0098 · putusan yang bisa dipakai mesin ────────────────────────────────────
//
// Sampai spec ini, satu-satunya jembatan antara "opsi yang dipilih lead" dan "apa yang dijalankan
// server" adalah HARAPAN bahwa prosa `decision` dan field `action` sepakat. Modul ini menggantinya
// dengan pilihan sebagai DATA — divalidasi terhadap daftar opsi yang benar-benar dikirim peminta.

/** Opsi yang terpilih. `index` 1-BASIS: itu nomor yang dilihat manusia & agen di layar. */
export type LeadChoice = { index: number; option: string };
export const zLeadChoice = z.object({ index: z.number().int().positive(), option: z.string() });

/** Putusan "sebagaimana dikirim": terpangkas, siap diketik ke pane / dikembalikan ke peminta. */
export type LeadDelivery = {
  decision: string;
  reason: string;
  reply: string;
  /**
   * SPEC-485 · bentuk yang BERLAKU: selalu daftar, supaya konsumen tak perlu menebak single vs
   * multi. `choice` di bawah tinggal turunannya (`choices[0]`), dipertahankan demi pembaca lama.
   */
  choices: LeadChoice[];
  choice: LeadChoice | null;
  missing: string[];
};

/**
 * Batas panjang putusan. Bukan sopan santun: `reply` masuk ke pane lewat `goalChunks` (potongan
 * 500 char berjeda 50 ms, ADR-0085), dan seluruh prosa ditulis agen DI DALAM anggaran `timeoutSec`
 * yang sama yang SPEC-432 buktikan sebagai pembatas nyata (306 dtk → 101 dtk begitu agen tahu
 * jamnya berdetak).
 */
export const LEAD_DECISION_MAX = 240;   // ±1 kalimat
export const LEAD_REASON_MAX = 480;     // ±3 kalimat

const norm = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();
/** Kepala label: potongan sebelum pemisah pertama — opsi denyut berbentuk "<action> — <uraian>". */
const headOf = (s: string): string => norm(s.split(/\s+[—–-]\s+|:/)[0] ?? s);

/**
 * Petakan `choice` mentah ke salah satu opsi peminta. `null` = TIDAK terpilih, dan itu selalu
 * jawaban yang sah: ambigu tak pernah ditebak. SPEC-452 mengukur ongkos tebakan yang kelihatan
 * benar — lead memutuskan Node 22, yang terpilih Node 20, dan jejaknya tetap berstatus `berlaku`.
 */
export function resolveChoice(raw: string, options: string[]): LeadChoice | null {
  const t = (raw ?? "").trim();
  if (!t || !options.length) return null;
  const pick = (i: number): LeadChoice | null =>
    i >= 0 && i < options.length ? { index: i + 1, option: options[i]! } : null;

  // 1 · nomor, dengan atau tanpa label di belakangnya. Label yang IKUT disebut harus sepakat
  //     dengan nomornya — bertentangan berarti lead sendiri tak konsisten, dan menebak mana yang
  //     ia maksud persis kesalahan yang spec ini ada untuk menghapusnya.
  const num = t.match(/^(?:opsi|option|pilihan|#)?\s*(\d{1,2})\s*[.):-]?\s*(.*)$/i);
  if (num) {
    const hit = pick(Number(num[1]) - 1);
    if (!hit) return null;
    const rest = norm(num[2] ?? "");
    if (!rest) return hit;
    const target = norm(hit.option);
    return target.startsWith(rest) || headOf(hit.option) === rest || target.includes(rest) ? hit : null;
  }

  const n = norm(t);
  const exact = options.findIndex((o) => norm(o) === n);
  if (exact >= 0) return pick(exact);

  const byHead = options.flatMap((o, i) => (headOf(o) === n ? [i] : []));
  if (byHead.length === 1) return pick(byHead[0]!);

  const byPrefix = options.flatMap((o, i) => (norm(o).startsWith(n) ? [i] : []));
  if (byPrefix.length === 1) return pick(byPrefix[0]!);

  return null;
}

// ── SPEC-485 · ADR-0102 · pilihan JAMAK ──────────────────────────────────────────────────────
//
// Kosakata di bawah membungkus `resolveChoice` di atas; ia TIDAK menyalin pencocokannya. Hanoman
// sudah empat kali membayar kelas bug "satu definisi, N call site" (SPEC-431 predikat, SPEC-448
// env spawn, SPEC-475 efek samping, SPEC-481 emit peristiwa), dan pencocokan opsi adalah persis
// bentuk yang gampang bercabang diam-diam.

/**
 * Bentuk pilihan yang diminta PEMINTA. `single` adalah keadaan hari ini dan karena itu default:
 * permintaan lama parse tanpa berubah satu bit pun.
 */
export const zLeadSelect = z.object({
  mode: z.enum(["single", "multi"]).default("single"),
  min: z.number().int().min(0).max(20).default(0),
  max: z.number().int().min(1).max(20).nullable().default(null),
});
export type LeadSelect = z.infer<typeof zLeadSelect>;

/**
 * Batas yang BENAR-BENAR berlaku. `single` selalu 0..1 — MODE yang menentukan, bukan angka yang
 * kebetulan dikirim, supaya "single tapi max 5" tak pernah jadi keadaan yang harus ditangani di
 * hilir. `max: null` berarti "sebanyak opsinya".
 */
export function normalizeSelect(sel: LeadSelect, optionCount: number): { mode: "single" | "multi"; min: number; max: number } {
  const n = Math.max(0, optionCount);
  if (sel.mode === "single") return { mode: "single", min: Math.min(sel.min, 1), max: 1 };
  const max = Math.min(sel.max ?? n, n);
  return { mode: "multi", min: Math.min(sel.min, max), max };
}

/**
 * Cermin jamak `resolveChoice`. Hasilnya diurutkan menurut urutan OPSI, bukan urutan lead
 * menyebutnya: jejak yang dibaca ulang harus cocok dengan menu yang dilihat manusia.
 *
 * Duplikat dibuang diam-diam (menyebut opsi dua kali tak menambah apa pun), sementara yang tak
 * dikenal masuk `rejected` — ia harus terlihat, karena di sanalah lead salah membaca soal.
 */
export function resolveChoices(raw: string[], options: string[]): { choices: LeadChoice[]; rejected: string[] } {
  const seen = new Set<number>();
  const choices: LeadChoice[] = [];
  const rejected: string[] = [];
  for (const r of raw ?? []) {
    const t = (r ?? "").trim();
    if (!t) continue;
    const hit = resolveChoice(t, options);
    if (!hit) { rejected.push(t); continue; }
    if (seen.has(hit.index)) continue;
    seen.add(hit.index);
    choices.push(hit);
  }
  choices.sort((a, b) => a.index - b.index);
  return { choices, rejected };
}

/** Alasan penolakan jumlah pilihan yang bisa dibaca manusia; `null` = jumlahnya sah. */
export function checkChoiceCount(n: number, b: { min: number; max: number }): string | null {
  if (n > b.max) return `pilihan terlalu banyak (${n}) — paling banyak ${b.max}`;
  if (n < b.min) return `pilihan terlalu sedikit (${n}) — paling sedikit ${b.min}`;
  return null;
}

/**
 * Pangkas prosa untuk PENGIRIMAN — jejak menyimpan yang utuh. Memotong di batas kalimat lebih dulu
 * supaya yang sampai tetap kalimat, bukan penggalan. Spasi dilipat sekalian, dan itu BUKAN
 * kosmetik: satu baris baru yang lolos ke pane adalah `Enter`, dan `Enter` di tengah dialog
 * mengirim jawaban yang baru separuh jadi (kelas SPEC-452).
 */
export function clampProse(s: string, max: number): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const stop = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (stop >= Math.floor(max / 2)) return head.slice(0, stop + 1);
  const word = head.lastIndexOf(" ");
  return `${(word > 0 ? head.slice(0, word) : head).trimEnd()}…`;
}

/**
 * Nama tindakan yang DIRAKIT PEMINTA di kepala label opsinya ("integrate-main — merge …").
 * Karena label itu milik pemanggil, bukan lead, hint ini bukan tebakan atas maksud agen — dan
 * untuk label bebas (opsi dialog `AskUserQuestion`) ia memang mengembalikan `null`.
 */
export function optionActionHint(option: string): LeadAction | null {
  const tok = ((option ?? "").trim().split(/[\s—–:]/)[0] ?? "").toLowerCase();
  return leadActionAllowed(tok) ? tok : null;
}

/**
 * Teks yang benar-benar diketik ke pane. Dirakit deterministik, bukan dipungut dari prosa: kolom
 * jawaban bebas dialog `AskUserQuestion` adalah kolom TEKS (SPEC-452), dan menyebut label opsi
 * verbatim adalah cara paling tak ambigu memberitahu model di seberang mana yang dipilih.
 */
export function leadReplyText(d: LeadDelivery): string {
  const budget = LEAD_DECISION_MAX + LEAD_REASON_MAX;
  if (d.missing.length)
    return clampProse(`Belum bisa kuputuskan. Yang kurang: ${d.missing.join("; ")}.`, budget);
  // SPEC-485 · SEMUA label terpilih disebut, dipisah `; ` — koma sudah dipakai DI DALAM label opsi
  // denyut sendiri ("integrate-main — merge, lalu tutup pane"), jadi memisahkan dengan koma
  // membuat batas antar-opsi tak bisa dibaca model di seberang.
  const picked = d.choices?.length ? d.choices : (d.choice ? [d.choice] : []);
  if (picked.length) return clampProse(`Pilih: ${picked.map((c) => c.option).join("; ")}. ${d.reason}`, budget);
  return clampProse(d.reply || d.decision, budget);
}

/**
 * Bentuk jawaban terstruktur yang WAJIB dikembalikan lead (AC-1). `refs` divalidasi ulang di
 * server terhadap repo — rujukan yang tak ada tak boleh dilaporkan sebagai rujukan (AC-6).
 * Longgar pada bagian yang tak mengubah keamanan (default terisi) supaya keluaran agen yang
 * sedikit meleset tetap terpakai; ketat pada `action`, yang menggerbangi tindakan nyata.
 */
export const zLeadVerdict = z.object({
  decision: z.string().min(1),
  reason: z.string().min(1),
  refs: z.array(z.string()).default([]),
  confidence: zLeadConfidence.default("sedang"),
  // Sengaja `string`, BUKAN `zLeadAction`: tindakan di luar allowlist harus bisa MASUK supaya
  // server menolaknya secara sadar — mencatat penolakan & menotifikasi operator (AC-33). Kalau
  // enum yang menyaring di sini, permintaan "deploy ke produksi" hanya akan tampak sebagai
  // keluaran rusak, dan justru peristiwa paling layak dilaporkan itulah yang hilang dari jejak.
  action: z.string().default("none"),
  /**
   * SPEC-480 · opsi yang dipilih — nomor ATAU label. Sengaja `string`, bukan enum/number: pilihan
   * di luar daftar harus BISA MASUK supaya server menolaknya secara sadar & mencatatnya, alasan
   * yang sama persis dengan `action` di atas.
   */
  choice: z.string().default(""),
  /**
   * SPEC-485 · pilihan JAMAK. `string[]` dengan alasan yang sama persis seperti `choice` & `action`
   * di atas: pilihan di luar daftar harus BISA MASUK supaya server menolaknya secara sadar dan
   * mencatatnya. Kosong + `choice` terisi dibaca sebagai satu pilihan — keluaran agen berbentuk
   * ADR-0098 harus tetap terpakai, dan menuntut field baru berarti setiap agen lama mendadak
   * "tak memilih apa pun".
   */
  choices: z.array(z.string().max(2000)).max(20).default([]),
  /**
   * SPEC-480 · apa yang KURANG bila konteksnya memang tak cukup untuk memutuskan. Bukan pengganti
   * `confidence: "ragu"` (bukti tipis, jawabannya tetap ada) melainkan untuk fakta konkret yang
   * tak ada di repo maupun konteks. Terisi ⇒ server memaksa `ragu` ⇒ operator dinotifikasi.
   */
  missing: z.array(z.string().max(200)).max(10).default([]),
  /** Teks yang benar-benar diketik ke pane sesi (pintu deteksi otomatis). */
  reply: z.string().default(""),
});
export type LeadVerdict = z.infer<typeof zLeadVerdict>;

/** Permintaan putusan lewat kontrak eksplisit (pintu #1, AC-1/AC-5). */
export const zLeadAsk = z.object({
  projectId: z.string().min(1),
  specId: z.string().nullish(),
  sessionId: z.string().nullish(),
  question: z.string().min(1).max(8000),
  options: z.array(z.string().max(2000)).max(20).default([]),
  context: z.string().max(20_000).default(""),
  /** SPEC-485 · bentuk pilihan yang diminta peminta. Default = perilaku hari ini (single). */
  select: zLeadSelect.default({ mode: "single", min: 0, max: null }),
  /** `true` = peminta akan mengajukan pertanyaan lanjutan; alurnya dibiarkan terbuka sampai submit. */
  chain: z.boolean().default(false),
  /** Lanjutkan rantai yang sudah ada. Alur tertutup ditolak 409 — bukan dibuatkan diam-diam. */
  flowId: z.string().min(1).nullish().default(null),
});
export type LeadAsk = z.infer<typeof zLeadAsk>;

/** Jawaban operator yang menimpa keputusan lead (AC-28). */
export const zLeadOverride = z.object({
  answer: z.string().min(1).max(8000),
  reason: z.string().max(8000).default(""),
  /**
   * SPEC-485 · centang operator sebagai DATA, bukan prosa. Dipetakan ke opsi baris yang ditimpa,
   * lalu ikut diketikkan ke pane — jadi manusia mencentang di dashboard dan kotaknya benar-benar
   * tercentang di dialog sesi.
   */
  choices: z.array(z.string().max(2000)).max(20).default([]),
});

// ── Sesi lead (ADR-0228) ─────────────────────────────────────────────────────────────────────
// Lead bukan lagi `claude -p` sekali-panggil melainkan satu pane tmux per proyek. Yang hidup di
// sini hanya KONTRAK yang dibagi server & UI: mode wewenang per tindakan, bentuk `act`, dan view.

export const LEAD_AUTHORITY_MODES = ["auto", "ask", "off"] as const;
export type LeadAuthorityMode = (typeof LEAD_AUTHORITY_MODES)[number];
export const zLeadAuthorityMode = z.enum(LEAD_AUTHORITY_MODES);

/** Default wewenang (spec §3): merge minta izin, sisanya jalan sendiri selama gerbang lolos. */
export const LEAD_AUTHORITY_DEFAULTS: Record<LeadAction, LeadAuthorityMode> = {
  none: "auto", "answer-session": "auto", "start-session": "auto", "stop-session": "auto",
  "resume-session": "auto", "restart-session": "auto", "order-queue": "auto", "hold-work": "auto",
  "push-branch": "auto", "integrate-main": "ask", "run-migration": "auto",
};

/**
 * Setelan lead PER PROYEK. `Project` tak punya kolom branch target maupun perintah test, dan blok
 * lead hidup di `Setting.data` (Json) — jadi tempatnya di sini, tanpa migration.
 */
export const zLeadProject = z.object({
  // zod 3: record berkunci enum diinfer `Partial<Record<…>>` — tindakan yang tak disebut memakai default.
  authority: z.record(zLeadAction, zLeadAuthorityMode).default({}),
  targetBranch: z.string().min(1).default("main"),
  /** Kosong = integrasi lead SELALU minta izin (server tak bisa membuktikan test hijau). */
  verifyCommand: z.string().default(""),
  quotaStopPct: z.number().int().min(1).max(100).default(85),
  rampStep: z.number().int().min(1).max(16).default(1),
  rampProbeMin: z.number().int().min(1).max(240).default(10),
  failStreak: z.number().int().min(1).max(20).default(2),
  answerSlaSec: z.number().int().min(30).max(3600).default(300),
});
export type LeadProject = z.infer<typeof zLeadProject>;
export type LeadProjectInput = z.input<typeof zLeadProject>;

/** Bentuk yang dikirim pane lead ke `POST /api/lead-pane/act`. `verdict` = `zLeadVerdict` apa adanya. */
export const zLeadAct = z.object({
  eventId: z.string().min(1),
  verdict: zLeadVerdict,
  evidence: z.array(z.string().max(500)).max(50).default([]),
});
export type LeadAct = z.infer<typeof zLeadAct>;

export const LEAD_EVENT_KINDS = ["ask", "session-ended", "pulse", "human", "rejected", "integrate-failed"] as const;
export type LeadEventKind = (typeof LEAD_EVENT_KINDS)[number];
export const LEAD_EVENT_STATUSES = ["open", "delivered", "done", "late", "human"] as const;
export type LeadEventStatus = (typeof LEAD_EVENT_STATUSES)[number];
/** Prioritas kelas (spec §1): kecil = didahulukan. Denyut tak pernah menahan jawaban pertanyaan. */
export const LEAD_EVENT_PRIORITY: Record<LeadEventKind, number> = {
  ask: 0, "session-ended": 1, "integrate-failed": 1, human: 2, rejected: 2, pulse: 3,
};

export type LeadRefusalCode =
  | "event-closed" | "authority-off" | "budget-zero" | "spec-done" | "spec-not-approved"
  | "spec-empty" | "blocked" | "session-live" | "no-reason" | "no-evidence"
  | "not-waiting" | "plan-open" | "worktree-dirty" | "conflict" | "verify-failed"
  | "integrate-busy" | "no-session" | "action-locked";

export type LeadActResult = {
  outcome: "lolos" | "butuh-izin" | "ditolak";
  code?: LeadRefusalCode;
  detail: string;
  approvalId?: string;
};

export type LeadEventView = {
  id: string; projectId: string; kind: LeadEventKind; status: LeadEventStatus; priority: number;
  question: string; specId: string | null; sessionId: string | null;
  deadlineAt: string | null; deliveredAt: string | null; createdAt: string; decisionId: string | null;
};
export type LeadApprovalStatus = "pending" | "approved" | "rejected" | "expired";
export type LeadApprovalView = {
  id: string; eventId: string; projectId: string; action: string; target: string | null;
  reason: string; evidence: string[]; gateReport: string[]; status: LeadApprovalStatus;
  decidedBy: string | null; decidedAt: string | null; note: string | null; createdAt: string;
};
export type LeadSessionView = {
  projectId: string; sessionId: string; alive: boolean; idle: boolean;
  humanActive: boolean; delivered: number; restarts: number;
};

/**
 * Daftar sensitif (spec §2): jawaban yang menyentuh salah satunya SELALU minta izin, apa pun mode
 * wewenangnya. Kata, bukan regex bebas — operator harus bisa membaca daftarnya. Kasus asal:
 * lead memilih sendiri "bootstrap director sementara" di staging (SPEC-1450, 2026-10-20).
 */
export const LEAD_SENSITIVE_TERMS = [
  "produksi", "production", "kredensial", "credential", "secret", "password", "token",
  "akun", "account", "director", "hapus data", "delete data", "drop table", "truncate",
  "migrasi produksi", "deploy", "rollback", "force push", "--force",
] as const;
export function isSensitiveText(s: string): boolean {
  const t = s.toLowerCase();
  return LEAD_SENSITIVE_TERMS.some((w) => t.includes(w));
}
