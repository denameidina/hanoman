import { LEAD_ACTIONS, LEAD_DECISION_MAX, LEAD_REASON_MAX, type LeadKind } from "@hanoman/shared";
import { CODE_STYLE_CLAUSE } from "@hanoman/runner";

// SPEC-409 · ADR-0091 · prompt hanoman-lead. Murni (string masuk, string keluar) supaya bentuk
// kontraknya bisa dites tanpa men-spawn agen apa pun — pola `runner/src/prompt.ts`.

export type LeadContext = {
  projectId: string;
  projectName: string;
  repoDir: string | null;
  /**
   * SPEC-432 · anggaran waktu yang BENAR-BENAR berlaku (`Setting.lead.timeoutSec`), diteruskan
   * `decide()` dari cfg yang sama yang dipakai `brain.think()` untuk meng-SIGTERM agennya. Angka
   * ini tak boleh berupa konstanta terpisah: anggaran yang berbohong menggeser pembacaan lead ke
   * arah yang salah, dan itu lebih buruk daripada tak punya anggaran sama sekali.
   */
  timeoutSec: number;
  /** Backlog item peminta, bila ada. */
  spec?: { id: string; title: string; objective: string; stage: string; priority: string } | null;
  /** Sesi yang sedang berjalan di project ini — konteks yang tak dimiliki sesi manapun (E). */
  liveSessions?: { id: string; specId?: string; flow?: string; branch?: string }[];
  /** Keputusan sebelumnya (terbaru dulu) supaya putusan berikutnya konsisten (US-8). */
  priorDecisions?: { question: string; answer: string; reason: string; createdAt: string }[];
  /** Catatan tambahan yang sudah dikumpulkan pemanggil (mis. daftar berkas yang bertabrakan). */
  notes?: string[];
  /** SPEC-485 · berapa opsi boleh dipilih. Tak ada = single, perilaku sebelum ADR-0102. */
  select?: { mode: "single" | "multi"; min: number; max: number };
  /**
   * SPEC-485 · langkah RANTAI yang sudah dijawab, urut naik. Sengaja terpisah dari
   * `priorDecisions` (10 terakhir se-project): yang satu urusan tak boleh tenggelam di antara yang
   * kebetulan berdekatan waktunya — itulah keluhan "konteks hilang di antaranya".
   */
  chainSteps?: { question: string; options: string[]; picked: string[] }[];
};

export type LeadQuestion = {
  kind: LeadKind;
  question: string;
  options?: string[];
};

const bullet = (s: string) => `- ${s}`;

/**
 * AC-20/21/22 · tiga hal yang WAJIB ada di prompt ini, dan alasannya:
 *
 * 0. SPEC-432 · ANGGARAN WAKTU. Perintah nomor 1 di bawah ("baca SoT, ADR, plan, kode, riwayat
 *    git") tak punya dasar berhenti, sementara `brain.think()` meng-SIGTERM agennya di detik
 *    ke-`timeoutSec`. Tanpa memberi tahu agen bahwa jam berdetak, keduanya bertabrakan setiap kali:
 *    di DB operator, TUJUH dari tujuh baris jejak berstatus `gagal` dengan alasan identik
 *    "kehabisan waktu 120000 ms" — nol keputusan pernah lahir. Terukur pada agen & harness yang
 *    sama, prompt yang sama plus paragraf anggaran ini selesai 3× lebih cepat (306 236 ms →
 *    101 136 ms) DAN mengembalikan blok json yang sah. Anggaran ini karena itu bukan sopan santun
 *    prompt; ia adalah yang membuat lead bisa memutuskan sama sekali.
 * 1. Perintah mengumpulkan bukti DULU (docs SoT, ADR, plan, kode, riwayat git) — lead yang menebak
 *    lebih buruk daripada operator yang absen.
 * 2. Larangan mengembalikan "tidak tahu": setelah bukti dikumpulkan ia tetap harus memutuskan,
 *    memilih opsi yang paling mudah dibatalkan, dan menandai dirinya `ragu`. Itulah seluruh
 *    gunanya lead — keraguan tak boleh berubah jadi mandek yang justru ingin dihapus PRD ini.
 * 3. Permukaan tindakan TERTUTUP. Daftar `action` di bawah adalah satu-satunya yang server terima;
 *    apa pun di luarnya ditolak, dicatat, dan dinotifikasi (AC-33). Menyebutkannya di prompt bukan
 *    pengaman (pengamannya di server) melainkan supaya lead tak menghabiskan giliran mengusulkan
 *    sesuatu yang pasti ditolak.
 */
export function leadPrompt(q: LeadQuestion, c: LeadContext): string {
  const lines: string[] = [];
  lines.push("Kamu adalah **hanoman-lead**: tech lead mesin di atas semua agen yang bekerja di workspace ini.");
  lines.push("Kamu MEMUTUSKAN, lalu melapor. Tidak ada manusia yang menunggu untuk menyetujui jawabanmu.");
  lines.push("");
  lines.push("## Konteks");
  lines.push(bullet(`Project: ${c.projectName} (${c.projectId})`));
  if (c.repoDir) lines.push(bullet(`Checkout: ${c.repoDir}`));
  if (c.spec) {
    lines.push(bullet(`Backlog item: ${c.spec.id} — ${c.spec.title} · stage ${c.spec.stage} · prioritas ${c.spec.priority}`));
    if (c.spec.objective) lines.push(bullet(`Objective: ${c.spec.objective}`));
  }
  for (const s of c.liveSessions ?? []) {
    lines.push(bullet(`Sesi berjalan: ${s.id}${s.specId ? ` (${s.specId})` : ""}${s.flow ? ` · flow ${s.flow}` : ""}${s.branch ? ` · branch ${s.branch}` : ""}`));
  }
  for (const n of c.notes ?? []) lines.push(bullet(n));
  lines.push("");
  if (c.priorDecisions?.length) {
    lines.push("## Keputusan yang sudah kamu ambil sebelumnya (jangan bertentangan tanpa alasan)");
    for (const d of c.priorDecisions.slice(0, 10)) {
      lines.push(`- [${d.createdAt}] "${d.question.slice(0, 200)}" → ${d.answer.slice(0, 300)} (${d.reason.slice(0, 200)})`);
    }
    lines.push("");
  }
  // SPEC-485 · ADR-0102 · rantai: langkah yang sudah dijawab disebut EKSPLISIT, bukan diserahkan ke
  // daftar `priorDecisions` yang bercampur dengan urusan lain.
  if (c.chainSteps?.length) {
    lines.push("## Rantai keputusan ini (langkah yang sudah dijawab)");
    for (const [i, s] of c.chainSteps.entries()) {
      lines.push(`${i + 1}. "${s.question.slice(0, 200)}" → ${s.picked.length ? s.picked.join("; ") : "(tanpa pilihan)"}`);
      if (s.options.length) lines.push(`   opsi saat itu: ${s.options.map((o) => o.slice(0, 80)).join(" · ")}`);
    }
    lines.push("");
    lines.push("Pertanyaan di bawah adalah lanjutan dari rantai itu. Jangan bertentangan dengan yang sudah kamu putuskan di atas, dan jangan mengulang penjelasannya.");
    lines.push("");
  }
  lines.push("## Yang harus kamu putuskan");
  lines.push(q.question.trim());
  if (q.options?.length) {
    lines.push("");
    lines.push("Opsi yang dilihat peminta:");
    for (const [i, o] of q.options.entries()) lines.push(`${i + 1}. ${o}`);
    // SPEC-480 · ADR-0098 · sampai spec ini, satu-satunya jembatan antara "opsi yang dipilih" dan
    // "apa yang dijalankan" adalah harapan bahwa prosa `decision` dan field `action` sepakat.
    lines.push("");
    if (c.select?.mode === "multi") {
      // SPEC-485 · angkanya DISEBUT (pola anggaran waktu SPEC-432): batas yang tak diketahui agen
      // adalah batas yang ditabraknya, dan jumlah di luar batas membatalkan SELURUH pilihannya.
      lines.push(`Opsinya TIDAK saling eksklusif. Isi \`choices\` dengan daftar nomor atau label yang kamu pilih (mis. ["1","3"]) — paling sedikit ${c.select.min}, paling banyak ${c.select.max}. Jumlah di luar itu membuat SELURUH pilihanmu dibatalkan, bukan dipangkas.`);
    } else {
      lines.push("Salah satu dari daftar itu WAJIB kamu pilih lewat field `choice` — isi nomornya (\"2\") atau labelnya persis.");
    }
    lines.push("Pilihan di luar daftar ditolak server, dicatat sebagai penolakan, dan peminta kembali menunggu manusia.");
  }
  lines.push("");
  lines.push("## Batas waktu (BACA INI DULU)");
  lines.push(`Kamu punya **${c.timeoutSec} detik** sejak sekarang. Lewat dari itu prosesmu dihentikan paksa, keluaranmu DIBUANG, dan permintaan ini dicatat sebagai kegagalan — peminta kembali mandek menunggu manusia. Jadi keputusan tepat waktu di atas bukti secukupnya jauh lebih berguna daripada pembacaan lengkap yang tak pernah sampai.`);
  lines.push(`Anggarkan begini: pakai paling banyak separuh waktu untuk mengumpulkan bukti, lalu **berhenti membaca** dan tulis jawabannya dengan apa yang sudah kamu punya. Kalau buktinya jadi tipis karena itu, turunkan \`confidence\`-nya — jangan menambah waktu baca.`);
  lines.push("");
  lines.push("## Cara kerja");
  lines.push("1. KUMPULKAN BUKTI DULU sebelum memutuskan, DI DALAM anggaran waktu di atas: `internal/docs/**` (Source of Truth) dan index-nya, ADR yang relevan, plan `docs/superpowers/plans/**`, kode yang bersangkutan, dan riwayat git. Baca, jangan mengingat — tapi baca seperlunya, bukan sehabisnya.");
  lines.push("2. Putuskan. Kalau setelah membaca kamu masih ragu, TETAP putuskan: pilih opsi yang PALING MUDAH DIBATALKAN, lalu tandai `confidence: \"ragu\"`. \"Tidak tahu\" bukan jawaban, dan meminta manusia memutuskan adalah persis keadaan yang kamu ada untuk menghapusnya. SATU pengecualian: bila jawabannya menuntut fakta konkret yang memang TIDAK ADA di repo maupun di konteks ini, isi `missing` dengan daftar pendek hal yang kurang — hal yang bisa disediakan seseorang, bukan keluhan — dan tetap tulis `decision` sebagai langkah paling aman sementara. `missing` yang terisi memaksa `confidence` jadi `ragu` dan memanggil operator; jangan memakainya untuk bukti yang cuma tipis.");
  lines.push("3. Rujuk bukti yang BENAR-BENAR kamu baca. Rujukan berupa path berkas relatif terhadap checkout, nomor ADR (`ADR-0091`), atau sha commit. Rujukan yang tak ada di repo akan dibuang server dan membuat jawabanmu tampak tanpa dasar.");
  lines.push("4. JANGAN membaca atau mengutip kredensial (isi `.env*`, token, kunci privat). Jejak keputusan disimpan di basis data; rahasia tak boleh mendarat di sana.");
  lines.push("5. Kamu TIDAK mengeksekusi apa pun sendiri. Kamu mengusulkan satu `action`; server yang menjalankannya, dan hanya bila ia ada di daftar tertutup ini:");
  lines.push(`   ${LEAD_ACTIONS.join(" · ")}`);
  lines.push("   Deploy, perintah/konsol VPS, data produksi, dan penghapusan apa pun (project, backlog, branch, worktree, notifikasi, jejak) TERKUNCI dan tidak akan pernah dijalankan.");
  lines.push("");
  // SPEC-543 · ADR-0108 · lead tak menulis kode sendiri, tapi `reply`-nya diketikkan ke terminal
  // agen peminta dan `decision`-nya mengarahkan apa yang ditulis di sana. Yang membuatnya diam saat
  // lead sekadar memutuskan adalah gerbang di baris pertama klausa, bukan percabangan di sini —
  // konstanta yang sama dipakai lima permukaan lain dan varian kedua akan berselisih dengannya.
  lines.push(CODE_STYLE_CLAUSE);
  lines.push("");
  lines.push("## Sepanjang apa (WAJIB)");
  lines.push(`Peminta jawabanmu adalah MESIN yang sedang menunggu, bukan pembaca laporan. \`decision\` paling banyak ${LEAD_DECISION_MAX} karakter (satu kalimat) dan \`reason\` paling banyak ${LEAD_REASON_MAX} karakter (dua-tiga kalimat). Yang lebih panjang dipangkas server sebelum sampai ke peminta.`);
  lines.push("JANGAN menuliskan: ringkasan ulang konteks yang sudah kamu terima di atas, latar belakang atau sejarah masalahnya, daftar alternatif yang tak diminta, maupun rencana kerja bertahap. Langsung putusannya dan alasannya.");
  lines.push("");
  lines.push("## Bentuk jawaban (WAJIB)");
  lines.push("Akhiri jawabanmu dengan TEPAT SATU blok berikut, tanpa teks sesudahnya:");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify({
    decision: "keputusan yang dipilih, satu kalimat",
    choice: "nomor atau label opsi yang kamu pilih; kosongkan bila tak ada daftar opsi",
    choices: [],
    reason: "alasannya, dua-tiga kalimat, menyebut bukti",
    refs: ["internal/docs/…", "ADR-00xx"],
    confidence: "tinggi | sedang | ragu",
    action: "none",
    missing: [],
    reply: "teks yang akan diketikkan ke terminal agen peminta (kosongkan bila tak relevan)",
  }, null, 2));
  lines.push("```");
  return lines.join("\n");
}
