// SPEC-734 · ADR-0113 — registry metode workflow.
//
// Sampai spec ini hanoman hanya mengenal SATU metodologi (superpowers) dan itu tak dipilih di mana
// pun: ia tertulis literal di sembilan tempat, sebagian sebagai string path. Berkas ini menjadi
// satu-satunya tempat pengetahuan itu hidup — menambah metode ketiga = satu entri di `METHODS`.
//
// SENGAJA BEBAS ZOD. Ia diimpor `@hanoman/runner`, lapis yang selama ini bebas skema; menyeret
// mesin validasi ke sana hanya untuk membaca tabel konstanta tak sepadan. Validasinya di batas
// HTTP (`zSetting.method`, `zTerminalSession.method`) dan lenient di sana — lihat ADR-0113.
//
// DEVIASI SADAR dari `enums.ts`, yang mencerminkan Flow/Agent/VerifyScope supaya runner bebas zod:
// cermin masuk akal untuk enum tiga kata, bukan untuk tabel yang harus identik di tiga paket.
// SPEC-407 sudah membayar konvensi itu dengan EMPAT cermin `Flow`.

export interface MethodDef {
  readonly id: string;
  /** Dipakai di judul blok skill prompt DAN sebagai label picker — satu sumber, tak bisa berselisih. */
  readonly label: string;
  /** Relatif terhadap akar worktree, TANPA slash di ujung. */
  readonly planDir: string;
  readonly specDir: string;
  /** Nama fase `PIPELINES` → skill yang wajib dimuat. Fase tanpa entri = sengaja tanpa skill. */
  readonly phaseSkills: Readonly<Record<string, readonly string[]>>;
  /** Gerbang yang digabungkan ke fase TERAKHIR pipeline penulis-kode. Wajib non-kosong (AC-7). */
  readonly exitSkills: readonly string[];
  /** Klausa prompt tambahan khas metode ini. Wajib menyebut `planDir`-nya (dijaga test sumber). */
  readonly extraClause?: string;
  /** Prasyarat instalasi, ditampilkan sebagai catatan di picker. */
  readonly requires: readonly string[];
}

export const DEFAULT_METHOD = "superpowers";

// INVARIAN 2 · mattpocock TIDAK punya padanan verification-before-completion, dan flow `goal`
// (Goal → Verifikasi) kehilangan satu-satunya gerbangnya tanpa ini — fase `Goal` memang sengaja
// tanpa skill (runner/src/prompt.ts). Karena itu gerbangnya konstanta, bukan pilihan katalog.
export const VERIFICATION_GATE = "superpowers:verification-before-completion";

// Sesi hanoman tak berpenunggu: tak ada manusia di terminal yang menjawab wawancara, dan
// AUTONOMY_CLAUSE_FULL eksplisit menyuruh agen tak pernah bertanya. Katalog mattpocock mayoritas
// diketik manusia (`/grill-me`, `/to-spec`), jadi entri di bawah memilih primitif model-invoked-nya
// (`grilling`, bukan `/grill-me`) dan klausa ini menegaskannya ke agen.
const MATT_CLAUSE =
  "Sesi ini TAK BERPENUNGGU — tak ada manusia yang menonton terminal untuk menjawab. Skill "
  + "mattpocock yang kontraknya mewawancarai manusia (`/grill-me`, `/to-spec`, `/triage`) JANGAN "
  + "dipakai: pakai primitif model-invoked-nya dan putuskan sendiri. `to-tickets` di fase Plan "
  + "dipakai HANYA sebagai penghasil berkas plan berkotak `- [ ]` di `docs/matt/plans/`, BUKAN "
  + "penerbit tiket — hanoman sendiri adalah issue tracker-nya, jadi jangan menulis ke tracker "
  + "eksternal mana pun.";

export const METHODS: Readonly<Record<string, MethodDef>> = {
  // Isi `PHASE_SKILLS` (SPEC-166) dipindah APA ADANYA. Objective & Spec adalah keluaran skill
  // brainstorming yang di-invoke di fase Brainstorm — sengaja tak punya entri sendiri. Fase reverse
  // dipandu standar docs di prompt-nya, bukan skill.
  superpowers: {
    id: "superpowers",
    label: "superpowers",
    planDir: "docs/superpowers/plans",
    specDir: "docs/superpowers/specs",
    phaseSkills: {
      Brainstorm: ["superpowers:brainstorming"],
      Audit: ["superpowers:systematic-debugging"],
      Plan: ["superpowers:writing-plans"],
      Execute: [
        "superpowers:executing-plans",
        "superpowers:test-driven-development",
        VERIFICATION_GATE,
      ],
      // SPEC-407 · fase `Goal` sengaja TANPA skill: seluruh inti flow itu membebaskan sesi dari
      // proses kaku. Yang tetap dijaga cuma pintu keluarnya.
      Verifikasi: [VERIFICATION_GATE],
    },
    exitSkills: [VERIFICATION_GATE],
    requires: ["superpowers"],
  },
  // Plugin `mattpocock-skills` (`/plugin install mattpocock-skills`); skill plugin di Claude Code
  // beralamat `plugin:skill`. `superpowers` tetap ikut di `requires` karena gerbang verifikasinya
  // dipinjam dari sana — mattpocock tak punya padanannya.
  matt: {
    id: "matt",
    label: "mattpocock",
    planDir: "docs/matt/plans",
    specDir: "docs/matt/specs",
    phaseSkills: {
      Brainstorm: ["mattpocock-skills:grilling"],
      Audit: ["mattpocock-skills:diagnosing-bugs"],
      Plan: ["mattpocock-skills:to-tickets"],
      Execute: [
        "mattpocock-skills:implement",
        "mattpocock-skills:tdd",
        "mattpocock-skills:code-review",
      ],
      Verifikasi: [VERIFICATION_GATE],
    },
    exitSkills: [VERIFICATION_GATE],
    extraClause: MATT_CLAUSE,
    requires: ["mattpocock-skills", "superpowers"],
  },
};

export const METHOD_IDS: readonly string[] = Object.keys(METHODS);

const uniq = (xs: readonly string[]): readonly string[] => [...new Set(xs)];

/**
 * Union direktori plan seluruh metode terdaftar — INVARIAN 1. Setiap GERBANG (planComplete, Stop
 * hook codex, kondisi mode goal, pembersihan artefak, klasifikasi doc) memindai daftar ini, bukan
 * direktori metode terpilih: item yang lahir dengan superpowers lalu dilanjutkan dengan metode lain
 * akan melihat direktori kosong → gerbang lolos hampa → backlog lompat ke `done` padahal plan lama
 * masih penuh `- [ ]`.
 */
export const PLAN_DIRS: readonly string[] = uniq(METHOD_IDS.map((id) => METHODS[id]!.planDir));
export const SPEC_DIRS: readonly string[] = uniq(METHOD_IDS.map((id) => METHODS[id]!.specDir));

/**
 * Resolusi LENIENT. Instance yang di-sync dari hub bisa membawa id metode yang belum ada di build
 * ini; itu harus jadi fallback diam, bukan lemparan yang mengosongkan layar Settings.
 */
export function resolveMethod(id?: string | null): MethodDef {
  return (id ? METHODS[id] : undefined) ?? METHODS[DEFAULT_METHOD]!;
}

/**
 * Metode yang tercatat di `Spec.payload.method` — metode saat item ini PERTAMA diluncurkan (AC-5).
 * Defensif seperti `readGoalPayload`: payload datang dari kolom `Json`, jadi bentuk apa pun bisa
 * mendarat di sana dan tak satu pun boleh membuat peluncuran sesi melempar.
 */
export function readSpecMethod(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const m = (payload as Record<string, unknown>).method;
  return typeof m === "string" && m.trim() !== "" ? m.trim() : null;
}

/**
 * Payload dengan stempel metode. `null` bila payload bukan objek biasa (array/skalar): menstempel
 * di situ berarti menimpa data yang bukan milik kita, sementara resolusi tetap benar tanpa stempel.
 */
export function stampSpecMethod(
  payload: unknown, methodId: string,
): Record<string, unknown> | null {
  if (payload === null || payload === undefined) return { method: methodId };
  if (typeof payload !== "object" || Array.isArray(payload)) return null;
  return { ...(payload as Record<string, unknown>), method: methodId };
}
