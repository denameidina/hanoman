# Custom Agent Bawaan Sistem — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** hanoman mengirim delapan custom agent bawaan (dev · QA · audit · security) yang lahir sebagai baris `CustomAgent` global saat boot, empat di antaranya menyala, dan sesi didorong memakainya lewat satu klausa prompt.

**Architecture:** Katalog hidup sebagai tabel konstanta di `shared` (data murni, cermin registry `METHODS`/ADR-0113). Service seed di server menulisnya sebagai baris `CustomAgent` ber-id `global:<name>` saat boot — menghormati tombstone, dan hanya memperbarui baris yang belum disunting operator (dibandingkan lewat sidik jari yang disimpan di `Setting.data`, lokal per mesin). Status "bawaan" tak pernah jadi kolom: ia field turunan di response. Klausa delegasi ditempel ke berkas prompt di titik yang sama dengan roster codex.

**Tech Stack:** TypeScript strict · pnpm workspace (`shared`, `server`, `runner`, `src` = web) · Prisma 6 + SQLite · Fastify · Vitest · React 18.

## Global Constraints

- **Bahasa dokumen & komentar kode: Indonesia.** Ikuti gaya berkas tetangga.
- **Tak ada perubahan skema Prisma.** Nol migration di seluruh plan ini. Bookkeeping menumpang kolom `Setting.data` yang sudah `Json`.
- **Nama agen immutable** (ADR-0094 keputusan 2). Delapan nama ini final: `scout`, `root-causer`, `qa-verifier`, `edge-case-hunter`, `blast-radius`, `spec-auditor`, `security-reviewer`, `dep-auditor`.
- **Semua bawaan daun:** `mentions: []`, `model: null`, `runtime: null`, `projectId: null`.
- **`tools` hanya boleh anggota `DEFAULT_AGENT_TOOLS`** (`Read Write Edit Bash Glob Grep WebFetch WebSearch`). Nama MCP dilarang — berbeda per mesin, dan claude membuang nama tool tak dikenal SENYAP (ADR-0094 M4).
- **`instructions` < 20.000 karakter** per agen (`zCreateCustomAgent`). Seed melewati validasi route, jadi batas ini hanya ditegakkan test kontrak.
- **Empat `enabledByDefault: true`:** `scout`, `qa-verifier`, `blast-radius`, `security-reviewer`.
- **Perintah test wajib:** `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism <path>`. Tanpa `TEST_DATABASE_URL` sesi tetangga menghapus DB test di tengah run; tanpa `--no-file-parallelism` test server saling menimpa satu berkas DB.
- **Jangan `git stash`** di worktree mana pun — tumpukan stash milik repo, sesi tetangga bisa mem-pop stash sesi ini.
- Perbarui `internal/docs` yang tersentuh **dalam commit yang sama** (Task 8).

## File Structure

| Berkas | Tanggung jawab |
|---|---|
| `shared/src/builtin-agents.ts` **(baru)** | Tabel konstanta delapan entri. Data murni: nol I/O, nol `node:crypto` (paket ini ikut dibundel browser). |
| `shared/test/builtin-agents.test.ts` **(baru)** | Test kontrak katalog: nama, tools, panjang, jumlah yang menyala. |
| `shared/src/index.ts` | Ekspor ulang tabel + tipe. |
| `shared/src/entities.ts` | `builtinAgents` masuk `zSetting`. |
| `server/src/services/settings.ts` | `builtinAgents: {}` masuk `DEFAULT_SETTING`. |
| `server/src/services/builtin-agents.ts` **(baru)** | Sidik jari + algoritma seed. Satu-satunya yang menulis baris bawaan. |
| `server/test/builtin-agents.test.ts` **(baru)** | Seed: create · idempoten · tombstone · baris disunting · `enabled` operator. |
| `server/src/services/custom-agents.ts` | `installCustomAgents()` memanggil seed **sebelum** `loadCustomAgents()`. |
| `server/src/routes/custom-agents.ts` | `view()` menambah `builtin` & `builtinEdited`. |
| `server/test/custom-agents.route.test.ts` | Test field turunan di response. |
| `runner/src/custom-agents.ts` | `agentDelegationClause(defs)` — klausa untuk jalur claude. |
| `runner/test/custom-agents.test.ts` | Test bentuk klausa + kosong saat roster kosong. |
| `server/src/services/pty.ts` | Memasang klausa di berkas prompt untuk claude. |
| `server/test/custom-agents.pty.test.ts` | Test klausa mendarat di berkas prompt. |
| `src/src/screens/CustomAgentsPanel.tsx` | Badge "bawaan" / "bawaan · disunting". |
| `src/test/custom-agents-panel.test.tsx` | Test badge. |
| `internal/docs/adr/0136-*.md` **(baru)** | ADR-0136. |
| `internal/docs/architecture/api-contract.md` · `internal/docs/adr/README.md` · `internal/docs/README.md` | Docs SoT yang tersentuh. |

---

### Task 1: Katalog konstanta delapan agen

**Files:**
- Create: `shared/src/builtin-agents.ts`
- Create: `shared/test/builtin-agents.test.ts`
- Modify: `shared/src/index.ts`

**Interfaces:**
- Consumes: `AGENT_NAME_RE`, `DEFAULT_AGENT_TOOLS` dari `shared/src/custom-agent.ts`.
- Produces: `type BuiltinAgentDef = { readonly name: string; readonly description: string; readonly instructions: string; readonly tools: readonly string[]; readonly enabledByDefault: boolean }` dan `export const BUILTIN_AGENTS: readonly BuiltinAgentDef[]`.

- [ ] **Step 1: Tulis test kontrak yang gagal**

```ts
// shared/test/builtin-agents.test.ts
import { describe, it, expect } from "vitest";
import { BUILTIN_AGENTS, AGENT_NAME_RE, DEFAULT_AGENT_TOOLS } from "../src";

describe("katalog agen bawaan", () => {
  it("berisi delapan entri bernama unik", () => {
    expect(BUILTIN_AGENTS).toHaveLength(8);
    const names = BUILTIN_AGENTS.map((a) => a.name);
    expect(new Set(names).size).toBe(8);
  });

  it("setiap nama lolos AGENT_NAME_RE", () => {
    for (const a of BUILTIN_AGENTS) expect(a.name).toMatch(AGENT_NAME_RE);
  });

  // ADR-0094 M4 · nama tool tak dikenal DIBUANG claude tanpa satu pun pesan → agen tanpa alat,
  // exit 0, tanpa keluhan. Nama MCP dilarang: ia berbeda per mesin.
  it("setiap tool adalah anggota DEFAULT_AGENT_TOOLS", () => {
    for (const a of BUILTIN_AGENTS) {
      expect(a.tools.length).toBeGreaterThan(0);
      for (const t of a.tools) expect(DEFAULT_AGENT_TOOLS).toContain(t);
    }
  });

  // Seed menulis langsung lewat Prisma dan MELEWATI validasi route — batas ini hanya
  // ditegakkan di sini. Kalau test ini tak ada, batasnya tak ada sama sekali.
  it("description & instructions ada di dalam batas zCreateCustomAgent", () => {
    for (const a of BUILTIN_AGENTS) {
      expect(a.description.trim().length).toBeGreaterThan(0);
      expect(a.description.length).toBeLessThanOrEqual(500);
      expect(a.instructions.trim().length).toBeGreaterThan(0);
      expect(a.instructions.length).toBeLessThanOrEqual(20_000);
    }
  });

  it("tepat empat menyala secara default", () => {
    const on = BUILTIN_AGENTS.filter((a) => a.enabledByDefault).map((a) => a.name).sort();
    expect(on).toEqual(["blast-radius", "qa-verifier", "scout", "security-reviewer"]);
  });

  // Berkas ini ikut dibundel untuk browser. `node:crypto` di sini mematikan build web, dan
  // gejalanya muncul jauh dari sini.
  it("tabelnya data murni", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../src/builtin-agents.ts", import.meta.url), "utf8"));
    expect(src).not.toMatch(/from "node:/);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm vitest --run shared/test/builtin-agents.test.ts`
Expected: FAIL — `BUILTIN_AGENTS` tak diekspor dari `../src`.

- [ ] **Step 3: Tulis tabel katalog**

Buat `shared/src/builtin-agents.ts` dengan header:

```ts
import { AGENT_NAME_RE, DEFAULT_AGENT_TOOLS } from "./custom-agent";

// SPEC-881 · ADR-0136 · katalog agen bawaan sistem. Cermin registry METHODS (ADR-0113): tabel
// konstanta, satu-satunya tempat pengetahuan ini hidup, menambah agen kesembilan = satu entri.
//
// DATA MURNI: nol I/O, nol `node:crypto`. Paket ini ikut dibundel untuk browser, dan sidik jari
// baris dihitung di server (`services/builtin-agents.ts`), bukan di sini.
//
// Nilai yang KONSTAN untuk kedelapan sengaja BUKAN field: projectId null (global) · model null
// (warisi sesi) · mentions [] · runtime null. Menjadikannya field berarti mengundang entri masa
// depan yang memasang `mentions`, dan itu membuka kembali lapis-1 anti-loop ADR-0094 yang hari
// ini nol risiko — tanpa `mentions`, `Task` DICABUT dari argv dan agen daun tak punya alat
// memanggil siapa pun.
export type BuiltinAgentDef = {
  readonly name: string;
  /** Dibaca claude untuk MEMILIH subagent. Mulai dengan "Gunakan saat …" — ini pintunya. */
  readonly description: string;
  readonly instructions: string;
  /** Himpunan bagian DEFAULT_AGENT_TOOLS. Nama MCP dilarang: berbeda per mesin. */
  readonly tools: readonly string[];
  readonly enabledByDefault: boolean;
};

/** Klausa yang diulang beberapa agen — ditulis sekali supaya tak hanyut satu sama lain. */
const ANCHOR =
  "Setiap klaim WAJIB berpasangan jangkar `path:baris`. Klaim tanpa jangkar tidak boleh kamu tulis.";

export const BUILTIN_AGENTS: readonly BuiltinAgentDef[] = [
  // … delapan entri, lihat langkah 3a–3h
];

// Jaring saat modul dievaluasi tak dipasang di sini: `builtin-agents.test.ts` yang menegakkannya,
// dan melempar saat impor akan mematikan seluruh aplikasi karena satu salah ketik di tabel data.
export const BUILTIN_AGENT_NAMES: readonly string[] = BUILTIN_AGENTS.map((a) => a.name);
```

Catatan: `AGENT_NAME_RE` & `DEFAULT_AGENT_TOOLS` diimpor **hanya** bila dipakai. Bila entri di bawah tak memakainya, hapus impornya — TypeScript strict akan mengeluh.

- [ ] **Step 3a: Entri `scout`**

```ts
  {
    name: "scout",
    description:
      "Gunakan saat perlu tahu DI MANA sesuatu dikerjakan di basis kode, atau bagaimana sebuah "
      + "alur data mengalir, sebelum menyentuh kode. Ia menyapu banyak berkas dan mengembalikan "
      + "peta ringkas berisi jangkar path:baris — bukan isi berkas. Panggil dia alih-alih membaca "
      + "belasan berkas sendiri.",
    tools: ["Read", "Glob", "Grep"],
    enabledByDefault: true,
    instructions: [
      "Kamu navigator basis kode. Tugasmu MENJAWAB, bukan menyalin.",
      "",
      "Prosedur:",
      "1. Sapu dari beberapa sudut sekaligus, jangan satu grep: nama simbol · nama konsep dalam",
      "   bahasa manusia · jejak string yang muncul di UI/log/pesan galat · nama berkas & folder.",
      "2. Cari juga CERMIN konsep yang sama: tipe yang disalin antar-paket, enum kembar, konstanta",
      "   yang diduplikasi, daftar literal string yang tak punya rujukan tipe. Cermin adalah",
      "   tempat bug paling senyap hidup, dan ia tak akan muncul dari satu pencarian nama.",
      "3. Berhenti begitu pertanyaannya terjawab. Kamu bukan pembuat dokumentasi.",
      "",
      "Aturan keluaran:",
      "- JANGAN mengembalikan isi berkas. Kembalikan kesimpulan + jangkar.",
      "- Setiap klaim berpasangan `path:baris`.",
      "- Bila kamu TAK menemukan sesuatu, katakan itu dan sebutkan pola apa saja yang sudah kamu",
      "  coba. 'Tidak ada' yang tak menyebut cara mencarinya tak bisa dipercaya siapa pun.",
      "",
      "Bentuk laporan: (a) titik masuk · (b) alur data ringkas · (c) tempat perubahan harus",
      "mendarat · (d) cermin yang ditemukan · (e) yang sudah dicari tapi tak ada.",
    ].join("\n"),
  },
```

- [ ] **Step 3b: Entri `root-causer`**

```ts
  {
    name: "root-causer",
    description:
      "Gunakan saat ada bug, test merah, atau perilaku tak terduga yang belum jelas sebabnya. Ia "
      + "membuktikan akar lewat eksperimen sebelum ada perbaikan yang diusulkan. Jangan panggil "
      + "dia untuk memperbaiki — dia mendiagnosis.",
    tools: ["Read", "Glob", "Grep", "Bash"],
    enabledByDefault: false,
    instructions: [
      "Kamu diagnostikus. Kamu TIDAK memperbaiki kode — kamu membuktikan sebabnya.",
      "",
      "Prosedur:",
      "1. REPRODUKSI dulu. Tulis satu perintah yang bisa dijalankan ulang siapa pun dan yang",
      "   memperlihatkan gejalanya. Bila kamu tak bisa mereproduksi, itulah temuanmu — laporkan,",
      "   jangan lanjut menebak di atas gejala yang tak pernah kamu lihat sendiri.",
      "2. Daftar hipotesis yang BERSAING, minimal dua. Satu hipotesis tunggal adalah tebakan yang",
      "   sedang mencari pembenaran.",
      "3. Rancang satu eksperimen yang MEMBEDAKAN hipotesis — yang hasilnya berbeda tergantung",
      "   mana yang benar. Eksperimen yang hanya mengonfirmasi favoritmu tak menambah apa pun.",
      "4. Jalankan. Buang yang terbantah. Ulangi sampai akar terbukti.",
      "",
      "Gerbang bukti — ini yang membedakanmu dari tebakan yang rapi:",
      "- DILARANG mengusulkan perbaikan sebelum akar terbukti.",
      "- Setiap hipotesis yang kamu terima wajib disertai eksperimen yang akan GAGAL bila",
      "  hipotesis itu salah. Bila kamu tak bisa menyebut eksperimen itu, kamu belum membuktikan.",
      "- 'Kemungkinan besar karena…' bukan keluaran yang sah. Tulis 'belum terbukti' dan sebutkan",
      "  apa yang masih kurang.",
      "",
      "Bentuk laporan: (a) reproduksi · (b) hipotesis yang diuji & yang terbantah + buktinya ·",
      "(c) akar + bukti · (d) perbaikan TERKECIL yang menyentuh akar (bukan gejala) · (e) cara",
      "memverifikasi perbaikannya.",
    ].join("\n"),
  },
```

- [ ] **Step 3c: Entri `qa-verifier`**

```ts
  {
    name: "qa-verifier",
    description:
      "Gunakan SEBELUM menyatakan pekerjaan selesai atau test hijau. Ia menjalankan test yang "
      + "tersentuh perubahan, memisahkan gagal palsu dari regresi, dan membuktikan bahwa test "
      + "yang lulus itu benar-benar menguji perubahannya.",
    tools: ["Read", "Glob", "Grep", "Bash"],
    enabledByDefault: true,
    instructions: [
      "Kamu gerbang terakhir sebelum sesuatu diumumkan hijau. Tugasmu MERAGUKAN kehijauan itu.",
      "",
      "Prosedur:",
      "1. Tentukan test yang TERSENTUH perubahan (dari diff terhadap base), bukan suite penuh.",
      "2. Jalankan. Catat perintah persisnya.",
      "3. Untuk setiap kegagalan, putuskan PALSU vs REGRESI dengan bukti, bukan firasat. Kandidat",
      "   gagal palsu yang wajib kamu periksa dulu: berkas DB/state yang dibagi antar run,",
      "   paralelisme antar-berkas test, sisa proses/soket/port dari run sebelumnya, variabel",
      "   lingkungan yang bocor dari shell, dan test yang memang sudah merah SEBELUM perubahan.",
      "   Cara memutuskannya: jalankan ulang test itu SENDIRIAN, dengan state yang bersih.",
      "4. UJI RELEVANSI — langkah yang hampir tak pernah dilakukan siapa pun, dan tanpa ini",
      "   'hijau' tak berarti apa-apa: siapkan pohon kerja terpisah di commit SEBELUM perubahan",
      "   (`git worktree add --detach <dir> <base-sha>`), pasang test barunya di sana, jalankan,",
      "   dan tuntut test itu MERAH. Test yang tetap hijau tanpa perubahan tidak membuktikan",
      "   apa pun tentang perubahan itu.",
      "5. Bersihkan pohon kerja sementara (`git worktree remove`).",
      "",
      "Larangan keras:",
      "- JANGAN `git stash` untuk apa pun. Tumpukan stash milik REPO, bukan pohon kerja — sesi",
      "  lain bisa mem-pop stash milikmu, dan kamu bisa mem-pop milik mereka. Isolasi memakai",
      "  `git worktree add`, titik.",
      "- JANGAN mengubah test agar lulus. Bila test yang salah, laporkan itu sebagai temuan.",
      "",
      "Gerbang bukti: setiap klaim membawa perintah DAN potongan keluarannya. Tanpa keluaran,",
      "tanpa klaim. 'Semua test lulus' tanpa keluaran adalah kegagalanmu, bukan laporan.",
      "",
      "Bentuk laporan: satu baris per test — lulus-dan-relevan · lulus-tapi-tak-membuktikan-apa-pun",
      "· regresi · gagal-palsu (+ sebabnya) — lalu satu putusan akhir: layak diumumkan selesai,",
      "atau belum, dan apa yang kurang.",
    ].join("\n"),
  },
```

- [ ] **Step 3d: Entri `edge-case-hunter`**

```ts
  {
    name: "edge-case-hunter",
    description:
      "Gunakan saat test yang ada hanya menguji jalur mulus dan kamu ingin batas-batas kontrak "
      + "benar-benar tertutup. Ia menulis test yang hilang dan membuktikan tiap test baru merah "
      + "dulu sebelum menyimpannya.",
    tools: ["Read", "Glob", "Grep", "Bash", "Write", "Edit"],
    enabledByDefault: false,
    instructions: [
      "Kamu penambal jalur bahagia. Cakupan yang terlihat baik bukan urusanmu — kontrak yang tak",
      "pernah diuji itu urusanmu.",
      "",
      "Prosedur:",
      "1. Baca kontrak unit yang berubah: apa yang ia janjikan, apa yang ia terima, apa yang ia",
      "   lakukan saat janji itu tak bisa dipenuhi.",
      "2. Enumerasi batas SECARA SISTEMATIS, jangan mengandalkan ingatan: kosong · null/undefined",
      "   · nol & negatif · unicode & string sangat panjang · urutan terbalik · kedatangan ganda",
      "   (idempotensi) · kegagalan separuh jalan · timeout & retry · nilai asing dari luar batas",
      "   kepercayaan (input pengguna, berkas konfigurasi, data yang datang dari mesin lain).",
      "3. Adu daftar itu dengan test yang sudah ada. Tandai yang belum tertutup.",
      "4. Tulis test yang hilang. Ikuti gaya berkas test tetangga — nama, struktur, helper.",
      "5. Jalankan.",
      "",
      "Gerbang bukti: setiap test baru WAJIB kamu tunjukkan MERAH dulu terhadap kode yang belum",
      "diperbaiki. Test yang lahir langsung hijau kamu laporkan sebagai 'tak membuktikan apa-apa'",
      "— jangan disimpan diam-diam, karena ia akan tetap hijau saat kodenya kelak rusak.",
      "",
      "Batas: kamu menulis TEST. Jangan mengubah kode produksi agar test lulus — bila test barumu",
      "menemukan bug sungguhan, laporkan bugnya, biarkan test itu merah, dan katakan dengan jelas",
      "bahwa ia merah karena bug, bukan karena test-nya salah.",
      "",
      "Bentuk laporan: (a) batas yang kini tertutup · (b) batas yang sengaja dilewati + alasannya",
      "· (c) bug yang ditemukan test baru.",
    ].join("\n"),
  },
```

- [ ] **Step 3e: Entri `blast-radius`**

```ts
  {
    name: "blast-radius",
    description:
      "Gunakan sesudah perubahan selesai untuk menemukan tempat LAIN yang seharusnya ikut berubah "
      + "tapi tidak: daftar kolom, cermin tipe antar-paket, enum kembar, dokumen kontrak, tabel "
      + "konstanta. Ia mencari kegagalan senyap, yang tak memunculkan satu pun error.",
    tools: ["Read", "Glob", "Grep", "Bash"],
    enabledByDefault: true,
    instructions: [
      "Kamu pencari cermin yang hanyut. Kelas bug yang kamu buru punya satu ciri: TIDAK ADA yang",
      "error. Satu kontrak hidup di beberapa tempat, satu tempat diperbarui, sisanya diam.",
      "",
      "Prosedur:",
      "1. Baca diff terhadap base. Tarik daftar yang berubah: simbol, kolom, nilai enum, kunci",
      "   konfigurasi, nama berkas, bentuk payload.",
      "2. Untuk TIAP satu, sapu seluruh repo untuk semua tempat lain yang menyebutnya — ATAU yang",
      "   seharusnya menyebutnya. Yang kedua ini yang penting, dan ia tak akan muncul dari",
      "   pencarian nama saja. Tempat yang wajib kamu periksa:",
      "   - daftar/array literal yang mencacah field atau kolom secara manual;",
      "   - tabel konstanta & peta yang kuncinya harus lengkap tapi tak punya rujukan tipe;",
      "   - tipe yang disalin (bukan diimpor) antar-paket, dan enum kembar;",
      "   - skema validasi di batas HTTP vs bentuk yang disimpan;",
      "   - dokumen kontrak (API, data model) dan berkas contoh/konfigurasi;",
      "   - berkas test yang mengunci bentuk lama.",
      "3. Laporkan yang belum ikut berubah.",
      "",
      "Gerbang bukti: tiap temuan menyebut `path:baris` DAN apa yang terjadi bila dibiarkan. Bila",
      "konsekuensinya 'gagal senyap' — nilai default palsu, kolom yang hilang tanpa error, cabang",
      "yang tak pernah dijalankan — NAIKKAN prioritasnya, jangan turunkan. Yang berteriak akan",
      "ketahuan sendiri; yang diam tidak.",
      "",
      "Bentuk laporan: daftar cermin yang hanyut, diurut dari yang paling senyap, tiap baris:",
      "jangkar · apa yang hanyut · akibat bila dibiarkan.",
    ].join("\n"),
  },
```

- [ ] **Step 3f: Entri `spec-auditor`**

```ts
  {
    name: "spec-auditor",
    description:
      "Gunakan sebelum menutup pekerjaan untuk mengadu apa yang DIMINTA dengan apa yang benar-benar "
      + "ada di diff. Ia menolak 'sepertinya sudah' dan memperlakukan kriteria tanpa jejak sebagai "
      + "tak terpenuhi, walau kotaknya sudah tercentang.",
    tools: ["Read", "Glob", "Grep", "Bash"],
    enabledByDefault: false,
    instructions: [
      "Kamu pengadu janji. Kamu tak menilai bagus atau tidaknya kode — kamu menilai apakah yang",
      "diminta benar-benar ada.",
      "",
      "Prosedur:",
      "1. Baca sumber permintaannya: spec, plan, issue, atau deskripsi tugas. Bila ada beberapa,",
      "   baca semuanya — plan bisa menyimpang dari spec, dan penyimpangan itu sendiri temuan.",
      "2. Ubah jadi daftar kriteria yang bisa diperiksa SATU PER SATU. Kalimat yang tak bisa",
      "   diperiksa ('lebih baik', 'rapi') kamu tandai sebagai tak terukur, bukan kamu tafsirkan.",
      "3. Untuk tiap kriteria, cari JEJAKNYA di diff. Bukan di niat, bukan di komentar kode.",
      "4. Putuskan: terpenuhi (+jangkar) · tak terpenuhi · terpenuhi BERBEDA dari yang diminta ·",
      "   dikerjakan TANPA diminta.",
      "",
      "Gerbang bukti:",
      "- Kriteria tanpa jangkar di diff = TAK TERPENUHI. Kotak yang sudah tercentang di berkas",
      "  plan bukan bukti — ia klaim, dan klaim itu justru yang sedang kamu periksa.",
      "- Pekerjaan yang dikerjakan tanpa diminta dilaporkan TERPISAH, bukan dipuji. Ia menambah",
      "  permukaan yang tak pernah diminta siapa pun untuk dipelihara.",
      "",
      "Bentuk laporan: tabel — kriteria · putusan · jangkar; lalu daftar pekerjaan di luar minta;",
      "lalu satu putusan akhir: boleh ditutup, atau belum, dan apa yang kurang.",
    ].join("\n"),
  },
```

- [ ] **Step 3g: Entri `security-reviewer`**

```ts
  {
    name: "security-reviewer",
    description:
      "Gunakan sebelum menggabungkan perubahan yang menyentuh route, handler, job, CLI, atau apa "
      + "pun yang menerima input dari luar. Ia menelusuri jalur konkret dari input tak terpercaya "
      + "sampai ke tempat ia melukai, dan menolak melaporkan kekhawatiran yang tak bisa ia buktikan "
      + "jalurnya.",
    tools: ["Read", "Glob", "Grep", "Bash"],
    enabledByDefault: true,
    instructions: [
      "Kamu penelusur sumber-ke-sink. Daftar kekhawatiran umum tak mengubah apa pun; yang",
      "mengubah adalah satu jalur konkret dari input yang tak dipercaya sampai ke tempat ia",
      "melukai.",
      "",
      "Prosedur:",
      "1. Enumerasi TITIK MASUK yang tersentuh diff: route HTTP, handler pesan/webhook, job",
      "   terjadwal, perintah CLI, pembaca berkas konfigurasi, dan apa pun yang membaca input",
      "   pengguna atau data dari mesin lain.",
      "2. Untuk tiap titik masuk, telusuri input tak terpercaya sampai SINK: query basis data,",
      "   `exec`/shell, path berkas, template/render, deserialisasi, permintaan keluar, redirect,",
      "   dan apa pun yang ditulis ke log atau dikembalikan ke pemanggil.",
      "3. Di sepanjang jalur itu, periksa gerbang yang seharusnya ada:",
      "   - autentikasi — siapa dia;",
      "   - OTORISASI KEPEMILIKAN OBJEK — apakah dia berhak atas objek INI. Ini yang paling",
      "     sering hilang, dan justru hilangnya di endpoint yang autentikasinya sudah benar;",
      "   - validasi bentuk di batas, bukan di dalam;",
      "   - batas ukuran & jumlah (payload, unggahan, paginasi, perulangan);",
      "   - kredensial: bocor ke log, ke response, ke pesan galat, atau ikut ter-commit.",
      "",
      "Gerbang bukti — ini yang membedakanmu dari daftar kekhawatiran:",
      "- Temuan TANPA jalur konkret input → dampak TIDAK kamu laporkan. Tahan.",
      "- Sebutkan juga jalur mana saja yang sudah kamu telusuri dan BERSIH. Tanpa itu, diammu",
      "  tak bisa dibedakan dari tidak memeriksa.",
      "- Jangan menilai dari nama fungsi atau kecocokan pola. Baca jalurnya.",
      "",
      "Bentuk laporan: per temuan — jalur (dengan jangkar) · dampak · perbaikan TERKECIL; lalu",
      "daftar titik masuk yang dinyatakan bersih.",
    ].join("\n"),
  },
```

- [ ] **Step 3h: Entri `dep-auditor`**

```ts
  {
    name: "dep-auditor",
    description:
      "Gunakan saat diff menambah atau menaikkan versi dependensi. Ia memeriksa advisory, lisensi, "
      + "tanda pemeliharaan, dan — yang paling sering terlewat — apakah fungsinya sudah tersedia "
      + "tanpa dependensi baru itu.",
    tools: ["Read", "Glob", "Grep", "Bash", "WebSearch", "WebFetch"],
    enabledByDefault: false,
    instructions: [
      "Kamu gerbang rantai pasok. Satu dependensi masuk lewat satu baris diff dan tak pernah",
      "diperiksa lagi seumur hidup proyek — pemeriksaan itu terjadi sekarang atau tidak sama",
      "sekali.",
      "",
      "Prosedur:",
      "1. Dari diff, ambil dependensi yang BERTAMBAH atau NAIK VERSI (termasuk devDependencies).",
      "   Lockfile ikut dibaca: dependensi transitif baru yang besar juga temuan.",
      "2. Untuk tiap satu, periksa dan sebutkan sumbernya:",
      "   - advisory/CVE yang diketahui untuk rentang versi itu;",
      "   - tanggal rilis terakhir & tanda pemeliharaan (isu terbuka menumpuk, maintainer tunggal);",
      "   - lisensi, dan apakah ia cocok dengan lisensi proyek ini;",
      "   - ukuran pohon transitifnya;",
      "   - apakah paket menjalankan skrip saat instalasi.",
      "3. Pertanyaan yang paling sering dilewati, dan tanyakan SELALU: apakah fungsi yang dipakai",
      "   sudah tersedia di dependensi yang SUDAH ada di proyek ini, atau di runtime-nya? Cek",
      "   dulu sebelum menerima. Satu dependensi yang tak jadi masuk lebih berharga daripada",
      "   sepuluh yang diaudit.",
      "",
      "Gerbang bukti: klaim CVE atau lisensi WAJIB membawa URL sumbernya. Tanpa sumber, tulis",
      "'tak terverifikasi' — jangan hilangkan, dan jangan naikkan jadi fakta.",
      "",
      "Bentuk laporan: per dependensi — aman · aman dengan catatan · tolak (+ penggantinya, atau",
      "cara mengerjakannya tanpa dependensi itu).",
    ].join("\n"),
  },
```

- [ ] **Step 4: Ekspor dari index**

Di `shared/src/index.ts`, tambahkan sejajar ekspor `custom-agent`:

```ts
export * from "./builtin-agents";
```

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `pnpm vitest --run shared/test/builtin-agents.test.ts`
Expected: PASS, 6 test.

- [ ] **Step 6: Commit**

```bash
git add shared/src/builtin-agents.ts shared/src/index.ts shared/test/builtin-agents.test.ts
git commit -m "feat(spec-881): katalog delapan agen bawaan sebagai tabel konstanta"
```

---

### Task 2: Bookkeeping sidik jari di `zSetting`

**Files:**
- Modify: `shared/src/entities.ts` (blok `zSetting`, sekitar baris 341-367)
- Modify: `server/src/services/settings.ts` (`DEFAULT_SETTING`, sekitar baris 13-31)
- Test: `shared/test/builtin-agents.test.ts` (tambah blok)

**Interfaces:**
- Consumes: `zSetting` dari Task 0 (sudah ada).
- Produces: `Setting["builtinAgents"]` bertipe `Record<string, string>` — peta `name → sidik jari isi bawaan yang TERAKHIR ditulis seed di mesin ini`.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `shared/test/builtin-agents.test.ts`:

```ts
import { zSetting } from "../src";

describe("bookkeeping sidik jari di zSetting", () => {
  // Zod MEMBUANG kunci tak dikenal. Kalau field ini tak dideklarasikan, seluruh bookkeeping
  // lenyap diam-diam di `PUT /settings` pertama dan seed lalu menganggap SEMUA baris belum
  // pernah disunting — lalu menimpa kerja operator saat upgrade.
  it("bertahan melewati parse", () => {
    const parsed = zSetting.parse({ builtinAgents: { scout: "abc123" } });
    expect(parsed.builtinAgents).toEqual({ scout: "abc123" });
  });

  it("default objek kosong saat absen", () => {
    expect(zSetting.parse({}).builtinAgents).toEqual({});
  });

  // Baris Setting bisa datang dari mesin/versi lain; bentuk yang tak terduga tak boleh
  // mengosongkan layar Settings.
  it("bentuk asing jatuh ke default, tidak melempar", () => {
    expect(zSetting.safeParse({ builtinAgents: "bukan objek" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `pnpm vitest --run shared/test/builtin-agents.test.ts -t "bookkeeping"`
Expected: FAIL — `parsed.builtinAgents` undefined.

- [ ] **Step 3: Tambahkan field ke `zSetting`**

Di `shared/src/entities.ts`, di dalam objek `zSetting` sesudah baris `portalChat: …`:

```ts
  // SPEC-881 · ADR-0136 · sidik jari isi bawaan yang TERAKHIR ditulis seed di mesin ini, per nama
  // agen. Dipakai seed untuk membedakan "belum pernah disunting operator" dari "sudah". WAJIB
  // dideklarasikan di sini: zod membuang kunci tak dikenal, dan `PUT /settings` menulis balik
  // hasil parse — kunci asing akan lenyap tanpa satu pun error, lalu seed menimpa kerja operator.
  //
  // LOKAL per mesin: `setting` tidak ada di FIELDS sync (server/src/services/sync.ts), jadi dua
  // mesin dengan versi hanoman berbeda tak bisa saling menimpa definisi bolak-balik.
  builtinAgents: z.record(z.string(), z.string()).default({}),  // SPEC-881 · ADR-0136
```

- [ ] **Step 4: Tambahkan ke `DEFAULT_SETTING`**

Di `server/src/services/settings.ts`, di dalam `DEFAULT_SETTING` sesudah `portalChat`:

```ts
  builtinAgents: {},                // SPEC-881 · ADR-0136 · sidik jari seed (lokal, tak disync)
```

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `pnpm vitest --run shared/test/builtin-agents.test.ts`
Expected: PASS, 9 test.

- [ ] **Step 6: Pastikan tipe `Setting` tak memecah pemakai lain**

Run: `pnpm --filter @hanoman/server exec tsc --noEmit`
Expected: nol error. Bila ada objek `Setting` yang dibangun literal di test, ia akan mengeluh kurang field — tambahkan `builtinAgents: {}` di sana.

- [ ] **Step 7: Commit**

```bash
git add shared/src/entities.ts server/src/services/settings.ts shared/test/builtin-agents.test.ts
git commit -m "feat(spec-881): bookkeeping sidik jari agen bawaan di Setting"
```

---

### Task 3: Service seed

**Files:**
- Create: `server/src/services/builtin-agents.ts`
- Create: `server/test/builtin-agents.test.ts`

**Interfaces:**
- Consumes: `BUILTIN_AGENTS`, `customAgentId`, `toolsOf` dari `@hanoman/shared`; `prisma` dari `../db`; `getSetting` dari `./settings`; `findTombstone` dari `./tombstone`; `notifySynced` dari `./sync-notify`.
- Produces:
  - `export function builtinFingerprint(a: BuiltinAgentDef): string` — hex 16 karakter.
  - `export function rowFingerprint(r: { name: string; description: string; instructions: string; tools: unknown }): string` — sidik jari baris DB, memakai fungsi hash yang sama.
  - `export async function seedBuiltinAgents(): Promise<void>`.

- [ ] **Step 1: Tulis test yang gagal**

```ts
// server/test/builtin-agents.test.ts
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { prisma } from "../src/db";
import { seedBuiltinAgents, builtinFingerprint } from "../src/services/builtin-agents";
import { getSetting } from "../src/services/settings";
import { writeTombstone } from "../src/services/tombstone";
import { BUILTIN_AGENTS, customAgentId } from "@hanoman/shared";

const clean = async () => {
  await prisma.customAgent.deleteMany();
  await prisma.syncTombstone.deleteMany();
  await prisma.setting.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(clean);
afterAll(clean);

const idOf = (name: string) => customAgentId(null, name);

describe("seedBuiltinAgents — kelahiran", () => {
  it("melahirkan seluruh katalog sebagai baris global", async () => {
    await seedBuiltinAgents();
    const rows = await prisma.customAgent.findMany();
    expect(rows).toHaveLength(BUILTIN_AGENTS.length);
    for (const r of rows) {
      expect(r.projectId).toBeNull();
      expect(r.id).toBe(idOf(r.name));
      expect(r.mentions).toEqual([]);
      expect(r.model).toBeNull();
      expect(r.runtime).toBeNull();
    }
  });

  it("menghormati enabledByDefault", async () => {
    await seedBuiltinAgents();
    for (const a of BUILTIN_AGENTS) {
      const row = await prisma.customAgent.findUnique({ where: { id: idOf(a.name) } });
      expect(row.enabled).toBe(a.enabledByDefault);
    }
  });

  it("mencatat sidik jari tiap agen di Setting", async () => {
    await seedBuiltinAgents();
    const s = await getSetting();
    for (const a of BUILTIN_AGENTS) {
      expect(s.builtinAgents[a.name]).toBe(builtinFingerprint(a));
    }
  });
});

describe("seedBuiltinAgents — idempoten", () => {
  it("boot kedua tak menggerakkan updatedAt maupun version", async () => {
    await seedBuiltinAgents();
    const before = await prisma.customAgent.findUnique({ where: { id: idOf("scout") } });
    await seedBuiltinAgents();
    const after = await prisma.customAgent.findUnique({ where: { id: idOf("scout") } });
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(after.version).toBe(before.version);
  });
});

describe("seedBuiltinAgents — penghapusan bertahan", () => {
  it("baris bertombstone tidak dibangkitkan", async () => {
    await seedBuiltinAgents();
    await prisma.customAgent.delete({ where: { id: idOf("scout") } });
    await writeTombstone("customAgent", idOf("scout"), 99, {});
    await seedBuiltinAgents();
    expect(await prisma.customAgent.findUnique({ where: { id: idOf("scout") } })).toBeNull();
  });

  it("agen lain tetap lahir walau satu bertombstone", async () => {
    await writeTombstone("customAgent", idOf("scout"), 1, {});
    await seedBuiltinAgents();
    expect(await prisma.customAgent.findUnique({ where: { id: idOf("qa-verifier") } })).not.toBeNull();
  });
});

describe("seedBuiltinAgents — upgrade", () => {
  /** Tulis stempel sidik jari satu agen — cara mensimulasikan "seed versi lain pernah jalan". */
  const stempel = async (name: string, fp: string) => {
    const s = await getSetting();
    await prisma.setting.update({ where: { id: 1 },
      data: { data: { ...s, builtinAgents: { ...s.builtinAgents, [name]: fp } } } });
  };

  it("memperbarui baris yang belum disunting", async () => {
    await seedBuiltinAgents();
    const shipped = BUILTIN_AGENTS.find((a) => a.name === "scout");
    // Baris ini SEOLAH ditulis seed versi sebelumnya: isinya beda dari katalog terpasang, tapi
    // stempelnya cocok dengan isinya — jadi "belum disentuh operator", hanya versi lama.
    const lama = { ...shipped, instructions: "isi versi lama" };
    await prisma.customAgent.update({ where: { id: idOf("scout") },
      data: { instructions: lama.instructions } });
    await stempel("scout", builtinFingerprint(lama));

    await seedBuiltinAgents();

    const row = await prisma.customAgent.findUnique({ where: { id: idOf("scout") } });
    expect(row.instructions).toBe(shipped.instructions);
    expect((await getSetting()).builtinAgents.scout).toBe(builtinFingerprint(shipped));
  });

  it("TIDAK menyentuh baris yang sudah disunting operator", async () => {
    await seedBuiltinAgents();
    await prisma.customAgent.update({ where: { id: idOf("scout") },
      data: { instructions: "punya operator" } });
    // Stempel dibiarkan menunjuk isi BAWAAN — jadi isi baris tak lagi cocok dengannya, dan itulah
    // tanda "disunting operator" yang dibaca seed.
    await seedBuiltinAgents();
    const row = await prisma.customAgent.findUnique({ where: { id: idOf("scout") } });
    expect(row.instructions).toBe("punya operator");
  });

  it("upgrade memperbarui isi tapi TIDAK pernah mengembalikan saklar enabled operator", async () => {
    await seedBuiltinAgents();
    const shipped = BUILTIN_AGENTS.find((a) => a.name === "scout");
    // Baris versi lama yang belum disunting, TAPI sudah dimatikan operator.
    const lama = { ...shipped, instructions: "isi versi lama" };
    await prisma.customAgent.update({ where: { id: idOf("scout") },
      data: { instructions: lama.instructions, enabled: false } });
    await stempel("scout", builtinFingerprint(lama));

    await seedBuiltinAgents();

    const row = await prisma.customAgent.findUnique({ where: { id: idOf("scout") } });
    // Isi ikut versi baru …
    expect(row.instructions).toBe(shipped.instructions);
    // … saklarnya tidak. `enabled` sengaja BUKAN bagian sidik jari: mematikan satu agen tak boleh
    // terbaca sebagai "disunting", karena baris itu lalu tak pernah lagi menerima perbaikan.
    expect(row.enabled).toBe(false);
  });
});

describe("seedBuiltinAgents — tak pernah menggagalkan boot", () => {
  it("menelan galat DB dan kembali normal", async () => {
    const spy = vi.spyOn(prisma.customAgent, "findUnique").mockRejectedValue(new Error("DB mati"));
    await expect(seedBuiltinAgents()).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
```

Catatan penting untuk test terakhir: `mockRestore()` pada method Prisma **menghapus** method itu di beberapa versi klien — kalau test berikutnya gagal dengan "findUnique is not a function", ganti `spy.mockRestore()` menjadi `spy.mockReset()` lalu pulihkan implementasi aslinya secara eksplisit, atau pindahkan test ini ke berkas sendiri.

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/builtin-agents.test.ts`
Expected: FAIL — modul `../src/services/builtin-agents` tak ada.

- [ ] **Step 3: Tulis service seed**

```ts
// server/src/services/builtin-agents.ts
import { createHash } from "node:crypto";
import { BUILTIN_AGENTS, customAgentId, toolsOf, type BuiltinAgentDef } from "@hanoman/shared";
import { prisma } from "../db";
import { getSetting } from "./settings";
import { findTombstone } from "./tombstone";
import { notifySynced } from "./sync-notify";

// SPEC-881 · ADR-0136 · penyemaian katalog agen bawaan. Satu-satunya penulis baris bawaan.
//
// BUKAN `upsert` buta: baris yang sudah disunting operator tak tersentuh selamanya, dan `enabled`
// tak pernah ikut diperbarui — saklar itu milik operator sejak seed pertama.

/**
 * `enabled` SENGAJA di luar sidik jari: mematikan satu agen tak boleh terbaca sebagai
 * "disunting", karena baris itu lalu tak pernah lagi menerima perbaikan instruksi.
 * `projectId`/`model`/`mentions`/`runtime` juga di luar — keempatnya konstan untuk semua bawaan.
 */
const fingerprint = (
  name: string, description: string, instructions: string, tools: readonly string[],
): string =>
  createHash("sha256")
    .update([name, description, instructions, [...tools].join(",")].join(" "))
    .digest("hex")
    .slice(0, 16);

export const builtinFingerprint = (a: BuiltinAgentDef): string =>
  fingerprint(a.name, a.description, a.instructions, a.tools);

export const rowFingerprint = (
  r: { name: string; description: string; instructions: string; tools: unknown },
): string => fingerprint(r.name, r.description, r.instructions, toolsOf(r.tools) ?? []);

export async function seedBuiltinAgents(): Promise<void> {
  try {
    const setting = await getSetting();
    const stamps: Record<string, string> = { ...setting.builtinAgents };
    let changed = false;

    for (const a of BUILTIN_AGENTS) {
      const id = customAgentId(null, a.name);
      const fp = builtinFingerprint(a);
      const row = await prisma.customAgent.findUnique({ where: { id } });

      if (!row) {
        // ADR-0119 · penghapusan operator bertahan lintas boot DAN lintas upgrade. Seed yang
        // membangkitkan baris yang sudah dibuang adalah fitur yang tak bisa dimatikan.
        if (await findTombstone("customAgent", id)) continue;
        await prisma.customAgent.create({ data: {
          id, projectId: null, name: a.name,
          description: a.description, instructions: a.instructions,
          tools: [...a.tools] as never, model: null, mentions: [] as never, runtime: null,
          enabled: a.enabledByDefault,
        } });
        await notifySynced("customAgent", id);
        stamps[a.name] = fp; changed = true;
        continue;
      }

      // SATU-SATUNYA jalur perbaruan, dan ia menuntut DUA hal: isi baris masih persis sidik jari
      // yang terakhir ditulis seed (= belum disentuh operator) DAN versi terpasang membawa isi
      // yang berbeda. Tanpa syarat pertama, upgrade menimpa kerja operator; tanpa syarat kedua,
      // setiap boot menulis ulang baris yang sudah mutakhir — `updatedAt` bergerak tanpa sebab
      // dan menyeberang sync sebagai mutasi palsu ke setiap mesin lain.
      const stamped = stamps[a.name];
      if (!stamped || stamped === fp) continue;
      if (stamped !== rowFingerprint(row as never)) continue;

      await prisma.customAgent.update({ where: { id }, data: {
        description: a.description, instructions: a.instructions,
        tools: [...a.tools] as never,
        // `enabled` TIDAK di sini. Sengaja.
      } });
      await notifySynced("customAgent", id);
      stamps[a.name] = fp; changed = true;
    }

    if (changed) {
      const data = { ...setting, builtinAgents: stamps };
      await prisma.setting.upsert({
        where: { id: 1 }, update: { data }, create: { id: 1, data },
      });
    }
  } catch {
    // ADR-0094 keputusan 7 · katalog agen tak pernah boleh menggagalkan boot maupun kelahiran
    // sesi. Gagal di sini = katalog apa adanya, bukan server yang tak menyala.
  }
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/builtin-agents.test.ts`
Expected: PASS, 10 test.

Bila `mencatat sidik jari` merah dengan `builtinAgents` undefined: Task 2 belum termuat — jalankan `pnpm --filter @hanoman/shared build` bila server memakai hasil build, bukan sumber.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/builtin-agents.ts server/test/builtin-agents.test.ts
git commit -m "feat(spec-881): service seed agen bawaan (hormati tombstone, tak menimpa suntingan)"
```

---

### Task 4: Pasang seed di titik boot

**Files:**
- Modify: `server/src/services/custom-agents.ts:127-131` (`installCustomAgents`)
- Test: `server/test/builtin-agents.test.ts` (tambah blok)

**Interfaces:**
- Consumes: `seedBuiltinAgents` (Task 3); `loadCustomAgents`, `agentDefsFor`, `registerCustomAgentSource` (sudah ada).
- Produces: tak ada tanda tangan baru — hanya urutan di dalam `installCustomAgents()`.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `server/test/builtin-agents.test.ts`:

```ts
import { installCustomAgents, agentDefsFor } from "../src/services/custom-agents";

describe("installCustomAgents — urutan mengikat", () => {
  // Urutan terbalik = sesi PERTAMA sesudah boot lahir tanpa agen bawaan, lalu gejalanya hilang
  // sendiri di boot berikutnya. Bug yang tak bisa direproduksi kalau urutannya tak diuji.
  it("cache sudah berisi agen bawaan begitu install selesai", async () => {
    await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "web" } });
    await installCustomAgents();
    const names = agentDefsFor("p1", "claude").map((a) => a.name).sort();
    expect(names).toEqual(["blast-radius", "qa-verifier", "scout", "security-reviewer"]);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/builtin-agents.test.ts -t "urutan mengikat"`
Expected: FAIL — `names` kosong (`[]`).

- [ ] **Step 3: Pasang seed sebelum load**

Di `server/src/services/custom-agents.ts`, ganti isi `installCustomAgents`:

```ts
/** Dipanggil sekali dari server.ts, SEBELUM sesi pertama bisa lahir. */
export async function installCustomAgents(): Promise<void> {
  // SPEC-881 · ADR-0136 · urutannya MENGIKAT: seed dulu, baru cache. Terbalik berarti sesi
  // pertama sesudah boot lahir tanpa agen bawaan — argv-nya sah, agennya cuma tak ada — dan
  // gejalanya hilang sendiri di boot berikutnya.
  await seedBuiltinAgents();
  await loadCustomAgents();
  registerCustomAgentSource((projectId, agent) => agentDefsFor(projectId, agent));
}
```

Tambahkan impornya di kepala berkas:

```ts
import { seedBuiltinAgents } from "./builtin-agents";
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/builtin-agents.test.ts server/test/custom-agents.service.test.ts`
Expected: PASS keduanya.

`custom-agents.service.test.ts` memanggil `loadCustomAgents()` langsung (bukan `installCustomAgents`), jadi seharusnya tak terpengaruh. Bila ia tetap merah karena jumlah agen tak terduga, perbaiki `clean()`-nya agar menghapus `customAgent` — **jangan** menambahkan pengecualian di service.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/custom-agents.ts server/test/builtin-agents.test.ts
git commit -m "feat(spec-881): seed agen bawaan di titik boot installCustomAgents"
```

---

### Task 5: Field turunan `builtin` & `builtinEdited` di response

**Files:**
- Modify: `shared/src/custom-agent.ts` (tipe `CustomAgentView`)
- Modify: `server/src/routes/custom-agents.ts:24-31` (`view`) dan seluruh pemanggilnya
- Test: `server/test/custom-agents.route.test.ts`

**Interfaces:**
- Consumes: `BUILTIN_AGENT_NAMES` (Task 1), `rowFingerprint` (Task 3), `getSetting`.
- Produces: `CustomAgentView` bertambah dua field opsional — `builtin?: boolean`, `builtinEdited?: boolean`.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `server/test/custom-agents.route.test.ts`. Berkas itu sudah punya `const app = buildApp({ requireAuth: false })` dan memanggil route lewat prefix `/api` — pakai keduanya apa adanya:

```ts
import { seedBuiltinAgents } from "../src/services/builtin-agents";

describe("field turunan agen bawaan", () => {
  it("menandai baris bawaan", async () => {
    await seedBuiltinAgents();
    const list = (await app.inject({ method: "GET", url: "/api/custom-agents" }))
      .json() as Array<Record<string, unknown>>;
    const scout = list.find((a) => a.name === "scout");
    expect(scout.builtin).toBe(true);
    expect(scout.builtinEdited).toBe(false);
  });

  it("menandai baris bawaan yang sudah disunting", async () => {
    await seedBuiltinAgents();
    await app.inject({
      method: "PATCH", url: "/api/custom-agents/global:scout",
      payload: { instructions: "punya operator" },
    });
    const list = (await app.inject({ method: "GET", url: "/api/custom-agents" }))
      .json() as Array<Record<string, unknown>>;
    const scout = list.find((a) => a.name === "scout");
    expect(scout.builtin).toBe(true);
    expect(scout.builtinEdited).toBe(true);
  });

  it("baris buatan operator tidak ditandai bawaan", async () => {
    await app.inject({ method: "POST", url: "/api/custom-agents", payload: {
      name: "punyaku", description: "d", instructions: "i",
    } });
    const list = (await app.inject({ method: "GET", url: "/api/custom-agents" }))
      .json() as Array<Record<string, unknown>>;
    const mine = list.find((a) => a.name === "punyaku");
    expect(mine.builtin).toBe(false);
    expect(mine.builtinEdited).toBe(false);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan gagal**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/custom-agents.route.test.ts -t "field turunan"`
Expected: FAIL — `scout.builtin` undefined.

- [ ] **Step 3: Tambahkan field ke tipe view**

Di `shared/src/custom-agent.ts`, di dalam `export type CustomAgentView`, sesudah `enabled: boolean;`:

```ts
  /**
   * SPEC-881 · ADR-0136 · DITURUNKAN di lapis response, bukan kolom. Kolom baru berarti kolom
   * baru di changefeed sync, dan hub versi lama menolak SELURUH push yang membawanya (kelas
   * SPEC-880). Pola yang sama dengan `inherited`.
   */
  builtin?: boolean;
  /** Isi baris tak lagi cocok dengan sidik jari yang terakhir ditulis seed di mesin ini. */
  builtinEdited?: boolean;
```

- [ ] **Step 4: Hitung field itu di route**

Di `server/src/routes/custom-agents.ts`, tambahkan impor:

```ts
import { BUILTIN_AGENT_NAMES } from "@hanoman/shared";
import { getSetting } from "../services/settings";
import { rowFingerprint } from "../services/builtin-agents";
```

`getSetting()` async sementara `view` sinkron, jadi peta sidik jari diserahkan sebagai argumen — dibaca sekali per request, bukan per baris:

```ts
/** Peta sidik jari untuk satu request. */
const stampsOf = async (): Promise<Record<string, string>> => (await getSetting()).builtinAgents;

/** Satu tempat yang tahu bentuk respons; `inherited` hanya bermakna saat diminta per-project. */
const view = (r: CustomAgentRow, projectId?: string, stamps: Record<string, string> = {}) => {
  const builtin = r.projectId === null && BUILTIN_AGENT_NAMES.includes(r.name);
  return {
    id: r.id, projectId: r.projectId, name: r.name,
    description: r.description, instructions: r.instructions,
    tools: toolsOf(r.tools), model: r.model, mentions: mentionsOf(r.mentions),
    runtime: runtimeOf(r.runtime),
    enabled: r.enabled,
    builtin,
    // Sidik jari yang tak tercatat (baris menyeberang sync dari mesin lain, seed di sini belum
    // pernah menyentuhnya) dibaca sebagai "disunting" — lebih baik menandai berlebih daripada
    // menjanjikan "asli bawaan" untuk isi yang tak bisa kita buktikan.
    builtinEdited: builtin ? stamps[r.name] !== rowFingerprint(r) : false,
    ...(projectId ? { inherited: r.projectId === null } : {}),
  };
};
```

Lalu setiap pemanggil `view(...)`:
- `GET /custom-agents`: `const stamps = await stampsOf();` sebelum `.map`, lalu `view(r, projectId, stamps)`.
- `POST` (201) dan `PATCH` (200): `view(row as unknown as CustomAgentRow, undefined, await stampsOf())`.

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/custom-agents.route.test.ts`
Expected: PASS seluruh berkas.

- [ ] **Step 6: Commit**

```bash
git add shared/src/custom-agent.ts server/src/routes/custom-agents.ts server/test/custom-agents.route.test.ts
git commit -m "feat(spec-881): tandai baris bawaan & yang disunting di response custom agent"
```

---

### Task 6: Klausa delegasi di prompt sesi claude

**Files:**
- Modify: `runner/src/custom-agents.ts` (tambah fungsi di akhir berkas)
- Modify: `server/src/services/pty.ts:384` dan impor di baris 10
- Test: `runner/test/custom-agents.test.ts`, `server/test/custom-agents.pty.test.ts`

**Interfaces:**
- Consumes: `AgentDef` (sudah ada di `runner/src/custom-agents.ts`).
- Produces: `export function agentDelegationClause(defs: AgentDef[]): string` — string kosong saat `defs` kosong.

- [ ] **Step 1: Tulis test runner yang gagal**

Tambahkan ke `runner/test/custom-agents.test.ts`:

```ts
import { agentDelegationClause } from "../src/custom-agents";

describe("agentDelegationClause", () => {
  const def = (name: string, description: string) => ({
    name, description, instructions: "i", tools: null, model: null, mentions: [],
  });

  // Invarian ADR-0094: katalog kosong → prompt byte-identik dengan sebelum fitur ini.
  it("kosong saat tak ada agen", () => {
    expect(agentDelegationClause([])).toBe("");
  });

  it("hanya menyebut agen yang ada di roster", () => {
    const out = agentDelegationClause([def("scout", "cari kode"), def("qa-verifier", "uji")]);
    expect(out).toContain("scout");
    expect(out).toContain("qa-verifier");
    expect(out).not.toContain("blast-radius");
  });

  it("membawa deskripsi tiap agen sebagai pemicunya", () => {
    expect(agentDelegationClause([def("scout", "cari kode")])).toContain("cari kode");
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm vitest --run runner/test/custom-agents.test.ts -t "agentDelegationClause"`
Expected: FAIL — `agentDelegationClause` tak diekspor.

- [ ] **Step 3: Tulis fungsinya**

Tambahkan di akhir `runner/src/custom-agents.ts`:

```ts
/**
 * SPEC-881 · ADR-0136 · klausa untuk jalur CLAUDE. Codex sudah menerima `agentRosterBlock` yang
 * menyuruhnya MENGADOPSI peran; claude menerima definisinya lewat `--agents` tapi tak menerima
 * satu pun dorongan untuk menoleh ke sana — dan katalog yang tak pernah dipanggil sama saja
 * dengan katalog kosong.
 *
 * Menyebut agen yang BENAR-BENAR ada di roster sesi ini, bukan daftar statis: operator yang
 * mematikan sebuah agen tak boleh menerima prompt yang menyuruh memanggilnya.
 *
 * Kosong saat roster kosong — invarian "prompt byte-identik saat katalog kosong" (ADR-0094).
 */
export function agentDelegationClause(defs: AgentDef[]): string {
  if (defs.length === 0) return "";
  return [
    "",
    "## Subagent yang tersedia",
    "",
    "Sesi ini punya subagent berikut. Delegasikan saat tugasnya cocok — konteks mereka TERPISAH",
    "dari milikmu, jadi menyerahkan penyapuan & verifikasi ke mereka menghemat konteksmu sendiri,",
    "bukan memboroskannya.",
    "",
    ...defs.map((d) => `- **${d.name}** — ${d.description}`),
    "",
    `Panggil lewat tool ${MENTION_TOOL} dengan nama agennya. Mereka tak bisa mendelegasikan lagi,`,
    "jadi tak ada rantai panggilan yang perlu kamu jaga. Laporan mereka adalah MASUKAN — kamu yang",
    "memutuskan, dan kamu yang bertanggung jawab atas hasilnya.",
    "",
  ].join("\n");
}
```

`MENTION_TOOL` sudah diimpor di kepala berkas itu.

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `pnpm vitest --run runner/test/custom-agents.test.ts`
Expected: PASS seluruh berkas.

- [ ] **Step 5: Tulis test pty yang gagal**

Tambahkan ke `server/test/custom-agents.pty.test.ts`. Berkas itu sudah punya `defs`, `cwd`, `born()`, `registerCustomAgentSource`, `promptFilePath`, dan `readFileSync` — pakai semuanya apa adanya:

```ts
describe("klausa delegasi di prompt", () => {
  it("sesi claude menerima klausa yang menyebut agen di roster", () => {
    registerCustomAgentSource(() => defs);
    const s = createSession("p1", cwd, { id: born("ca-klausa-1"), agent: "claude", prompt: "halo" });
    const prompt = readFileSync(promptFilePath(s.id), "utf8");
    expect(prompt).toContain("## Subagent yang tersedia");
    expect(prompt).toContain("- **rev** — tinjau");
    expect(prompt).toContain("- **tes** — uji");
  });

  // Invarian ADR-0094: katalog kosong → prompt byte-identik dengan sebelum fitur ini.
  it("sesi claude tanpa custom agent menerima prompt byte-identik", () => {
    registerCustomAgentSource(() => []);
    const s = createSession("p1", cwd, { id: born("ca-klausa-2"), agent: "claude", prompt: "halo" });
    expect(readFileSync(promptFilePath(s.id), "utf8")).toBe("halo");
  });

  // Codex mengadopsi peran INLINE lewat roster (ADR-0094 keputusan 4) — ia tak punya subagent
  // untuk didelegasi, jadi klausa claude di sana akan menyuruhnya memanggil yang tak ada.
  it("sesi codex tetap menerima roster, bukan klausa", () => {
    registerCustomAgentSource(() => defs);
    const s = createSession("p1", cwd, { id: born("ca-klausa-3"), agent: "codex", prompt: "halo" });
    const prompt = readFileSync(promptFilePath(s.id), "utf8");
    expect(prompt).toContain("## Custom agent hanoman");
    expect(prompt).not.toContain("## Subagent yang tersedia");
  });
});
```

- [ ] **Step 6: Jalankan, pastikan gagal**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/custom-agents.pty.test.ts`
Expected: FAIL pada test pertama.

- [ ] **Step 7: Pasang di pty**

Di `server/src/services/pty.ts` baris 384, ganti:

```ts
  // SPEC-881 · ADR-0136 · dua kanal, satu titik. Codex mengadopsi peran INLINE lewat roster;
  // claude menerima definisi lewat `--agents` dan hanya perlu DORONGAN untuk menoleh ke sana.
  // Keduanya mengembalikan "" saat katalog kosong → prompt sesi byte-identik seperti sebelumnya.
  const rosterBlock = agentForDefs === "codex"
    ? agentRosterBlock(customDefs)
    : agentDelegationClause(customDefs);
```

dan tambahkan `agentDelegationClause` ke impor `@hanoman/runner` di baris 10.

- [ ] **Step 8: Jalankan, pastikan lulus**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/custom-agents.pty.test.ts runner/test/custom-agents.test.ts`
Expected: PASS keduanya.

- [ ] **Step 9: Commit**

```bash
git add runner/src/custom-agents.ts runner/test/custom-agents.test.ts server/src/services/pty.ts server/test/custom-agents.pty.test.ts
git commit -m "feat(spec-881): klausa delegasi subagent di prompt sesi claude"
```

---

### Task 7: Badge "bawaan" di panel

**Files:**
- Modify: `src/src/screens/CustomAgentsPanel.tsx:188-196`
- Test: `src/test/custom-agents-panel.test.tsx`

**Interfaces:**
- Consumes: `CustomAgentView.builtin` & `.builtinEdited` (Task 5).
- Produces: tak ada API baru.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `src/test/custom-agents-panel.test.tsx`. Berkas itu memakai mock `listCustomAgents` dan array `rows` yang sudah ada; **jest-dom tidak terpasang di sana**, jadi assert lewat `.textContent`/`queryByTestId`, bukan `toBeInTheDocument()`:

```tsx
describe("badge agen bawaan", () => {
  const bawaan = (extra: Record<string, unknown>) => ({
    id: "global:scout", projectId: null, name: "scout", description: "cari kode",
    instructions: "i", tools: null, model: null, mentions: [], runtime: null,
    enabled: true, inherited: false, ...extra,
  });

  it("menandai agen bawaan", async () => {
    listCustomAgents.mockResolvedValue([bawaan({ builtin: true, builtinEdited: false })]);
    render(<CustomAgentsPanel projectId={null} />);
    const badge = await screen.findByTestId("builtin-scout");
    expect(badge.textContent).toBe("bawaan");
  });

  it("membedakan bawaan yang sudah disunting", async () => {
    listCustomAgents.mockResolvedValue([bawaan({ builtin: true, builtinEdited: true })]);
    render(<CustomAgentsPanel projectId={null} />);
    const badge = await screen.findByTestId("builtin-scout");
    expect(badge.textContent).toBe("bawaan · disunting");
  });

  it("agen buatan operator tak bertanda bawaan", async () => {
    listCustomAgents.mockResolvedValue([
      bawaan({ id: "global:punyaku", name: "punyaku", builtin: false, builtinEdited: false }),
    ]);
    render(<CustomAgentsPanel projectId={null} />);
    await waitFor(() => expect(listCustomAgents).toHaveBeenCalled());
    expect(screen.queryByTestId("builtin-punyaku")).toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `pnpm vitest --run src/test/custom-agents-panel.test.tsx -t "bawaan"`
Expected: FAIL — teks "bawaan" tak ditemukan.

- [ ] **Step 3: Render badge-nya**

Di `src/src/screens/CustomAgentsPanel.tsx`, sesudah baris `{readOnly && <Badge tone="neutral" size="sm">warisan global</Badge>}`:

```tsx
{a.builtin && (
  <Badge tone="neutral" size="sm" data-testid={`builtin-${a.name}`}>
    {a.builtinEdited ? "bawaan · disunting" : "bawaan"}
  </Badge>
)}
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `pnpm vitest --run src/test/custom-agents-panel.test.tsx`
Expected: PASS seluruh berkas.

Bila SELURUH berkas jsdom gagal ramai soal `localStorage`, itu Node 25 — bukan regresi perubahan ini. Jalankan dengan Node 22/24.

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/CustomAgentsPanel.tsx src/test/custom-agents-panel.test.tsx
git commit -m "feat(spec-881): badge bawaan di panel custom agent"
```

---

### Task 8: ADR-0136 + docs SoT + verifikasi API nyata

**Files:**
- Create: `internal/docs/adr/0136-agen-bawaan-sistem-seed-idempoten.md`
- Modify: `internal/docs/adr/README.md`, `internal/docs/README.md`, `internal/docs/architecture/api-contract.md`
- Modify: `docs/superpowers/plans/2026-08-22-spec-881-custom-agent-bawaan.md`

**Interfaces:**
- Consumes: seluruh keputusan Task 1-7. Produces: dokumen; tak ada kode.

- [ ] **Step 1: Tulis ADR-0136**

Ikuti bentuk `internal/docs/adr/0101-form-custom-agent-katalog-runtime.md`: Status · Tanggal · SPEC · Terkait (**memperluas** ADR-0094 & ADR-0101; **mengikuti** ADR-0113 pola tabel konstanta dan ADR-0119 tombstone; **tidak mencabut** apa pun) · Konteks · Keputusan · Konsekuensi · Gotcha yang wajib diingat · Alternatif yang ditolak.

Isinya diangkat dari `docs/superpowers/specs/2026-08-22-spec-881-custom-agent-bawaan-design.md`: enam keputusan (K1-K6), enam gotcha, dan tiga alternatif yang ditolak (konstanta runtime + lapis override keempat · galeri template · selalu timpa tiap boot).

- [ ] **Step 2: Tautkan di index**

Tambahkan satu baris ADR-0136 di `internal/docs/adr/README.md` mengikuti bentuk baris tetangganya, dan pastikan `internal/docs/README.md` menautkan berkas yang tersentuh.

- [ ] **Step 3: Perbarui kontrak API**

Di `internal/docs/architecture/api-contract.md`, bagian `/api/custom-agents`: tambahkan `builtin` & `builtinEdited` pada bentuk response, dengan catatan bahwa keduanya **turunan, bukan kolom**, dan tak menyeberang sync.

- [ ] **Step 4: Centang checklist plan**

Ubah seluruh `- [ ]` yang sudah dikerjakan menjadi `- [x]` di berkas plan ini.

- [ ] **Step 5: Verifikasi API nyata di local**

```bash
# HOME khusus supaya smoke tak menyentuh instalasi nyata — tanpa ini `setup.token` ditulis ke
# ~/.hanoman milik operator.
export HANOMAN_HOME="$(mktemp -d)"
pnpm dev     # atau: node server/dist/server.js
```

Di terminal lain:

```bash
curl -s localhost:3000/api/custom-agents \
  | jq -r '.[] | "\(.name)\t\(.enabled)\t\(.builtin)\t\(.builtinEdited)"'
```

Expected: delapan baris; `blast-radius`, `qa-verifier`, `scout`, `security-reviewer` ber-`enabled=true`, empat sisanya `false`; kedelapan ber-`builtin=true` dan `builtinEdited=false`.

```bash
curl -s -X PATCH localhost:3000/api/custom-agents/global:scout \
  -H 'content-type: application/json' -d '{"instructions":"disunting"}' | jq '.builtinEdited'
```

Expected: `true`.

Restart server, lalu:

```bash
curl -s localhost:3000/api/custom-agents | jq -r '.[] | select(.name=="scout") | .instructions'
```

Expected: `disunting` — bukan teks bawaan. Ini yang membuktikan K4 bekerja end-to-end.

- [ ] **Step 6: Jalankan seluruh test yang tersentuh**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism \
  shared/test/builtin-agents.test.ts \
  server/test/builtin-agents.test.ts \
  server/test/custom-agents.service.test.ts \
  server/test/custom-agents.route.test.ts \
  server/test/custom-agents.pty.test.ts \
  server/test/custom-agent-sync.test.ts \
  runner/test/custom-agents.test.ts \
  src/test/custom-agents-panel.test.tsx
```

Expected: seluruhnya hijau. `custom-agent-sync.test.ts` ikut karena baris bawaan menyeberang changefeed seperti baris lain — bila ia merah, yang berubah adalah `FIELDS.customAgent` atau bentuk barisnya, bukan test-nya yang salah.

- [ ] **Step 7: Commit**

```bash
git add internal/docs docs/superpowers/plans/2026-08-22-spec-881-custom-agent-bawaan.md
git commit -m "docs(spec-881): ADR-0136 agen bawaan sistem + kontrak API"
```

