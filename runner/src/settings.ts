// Guardrail deny PreToolUse dicabut sepenuhnya (SPEC-197, ADR-0037): agen dipercaya penuh,
// isolasi murni lewat worktree. Yang tersisa di sini hanya marker keputusan (SPEC-184) —
// hook dari `--settings` tetap BERGABUNG dengan milik pengguna, bukan menggantikannya.
/**
 * SPEC-909 · ADR-0146 · pengirim event pertanyaan sesi ke server.
 *
 * Satu definisi dipakai KEDUA mesin (codex mengutipnya lagi untuk TOML): dua penulis perintah yang
 * tak sepakat adalah kelas kegagalan SPEC-431/448, dan di sini perbedaan satu header berarti separuh
 * sesi diam tanpa satu pun error.
 *
 * Empat hal yang mengikat di baris ini:
 * - `exit 0` tanpa syarat — `PreToolUse` yang keluar dengan kode 2 MEMBLOKIR tool-nya; server mati
 *   tak boleh berarti agen tak bisa bertanya.
 * - `-m 2` — batas atas stall yang dibayar agen saat server tak menjawab. Ia menunggu manusia
 *   sesudah ini, jadi dua detik adalah harga yang benar untuk kepastian.
 * - stdout dibuang — keluaran hook `type: "command"` dibaca claude sebagai kendali izin.
 * - payload diteruskan APA ADANYA (`--data-binary @-`): bentuknya kontrak agen dan bisa bertambah
 *   field tiap rilis; server yang memarsenya. Tak ada `jq` di jalur ini — hook tak boleh menuntut
 *   biner yang belum tentu terpasang.
 *
 * Env-nya dipasang saat sesi lahir (`sessionEventEnv`, server/src/services/pty.ts). Tanpa env itu
 * `curl` memanggil URL kosong, gagal, dan `exit 0` — sesi kembali ke perilaku menunggu manusia.
 */
export const EVENT_HOOK_COMMAND = [
  'curl -sS -m 2 -X POST "$HANOMAN_EVENT_URL"',
  "-H 'content-type: application/json'",
  '-H "authorization: Bearer $HANOMAN_EVENT_TOKEN"',
  '-H "x-hanoman-session: $HANOMAN_SESSION_ID"',
  '${HANOMAN_EVENT_HOST:+-H "host: $HANOMAN_EVENT_HOST"}',
  "--data-binary @- >/dev/null 2>&1; exit 0",
].join(" ");

export const guardSettings = (decisionFile?: string, goal?: string, eventHook?: boolean) => {
  const hooks: Record<string, unknown[]> = {};
  // SPEC-184 · sinyal "agen minta masukan manusia" dari Claude sendiri. Notification idle/izin/
  // agent_needs_input menandai marker; UserPromptSubmit (manusia menjawab) mengosongkannya.
  // Apakah sesinya SEDANG menunggu diputuskan server, bukan di sini (SPEC-903, catatan di bawah).
  // Path dikutip-single agar aman terhadap spasi. ponytail: path dengan single-quote tak didukung
  // (bagian variabel hanya <sessionId> = [a-z0-9_-]); naikkan bila repoDir bisa memuat "'".
  if (decisionFile) {
    const f = `'${decisionFile.split("'").join("'\\''")}'`;
    // SPEC-898 · ADR-0141 · isi marker = detik epoch ONSET episode ini, ditulis SEKALI. Notification
    // berulang (Claude idle lagi) tak boleh mencapnya ulang: kalau ia mencap ulang, "menunggu sejak"
    // selalu terbaca lebih muda dari satu putaran idle dan gerbang urgensi tak pernah menyala.
    // `size > 0` tetap satu-satunya arti marker (SPEC-184) — markerFilled tak berubah. SPEC-903 ·
    // ADR-0143 · artinya kini "pernah minta masukan", bukan "sedang menunggu": server menggerbanginya
    // dengan keadaan pane. Hook di sini sengaja TIDAK ikut berubah.
    hooks.Notification = [{ hooks: [{ type: "command",
      command: `grep -qiE 'idle|permission|waiting for|needs.?input' && { [ -s ${f} ] || date +%s > ${f}; } || true` }] }];
    hooks.UserPromptSubmit = [{ hooks: [{ type: "command", command: `: > ${f}` }] }];
  }
  // SPEC-909 · ADR-0146 · pintu deteksi lead tak lagi memindai; ia menunggu event ini. Matcher
  // `AskUserQuestion` menembak TEPAT saat agen bertanya — terukur 6 023–6 071 ms lebih awal dari
  // hook `Notification` di atas, yang lahir dari pengait idle 6 detik dan hanya mengisi marker.
  // Keduanya hidup berdampingan: marker tetap milik pil/notifikasi/pet (ADR-0141/0143).
  if (eventHook) {
    hooks.PreToolUse = [{ matcher: "AskUserQuestion",
      hooks: [{ type: "command", command: EVENT_HOOK_COMMAND }] }];
    hooks.SubagentStart = [{ hooks: [{ type: "command", command: EVENT_HOOK_COMMAND }] }];
    hooks.SubagentStop = [{ hooks: [{ type: "command", command: EVENT_HOOK_COMMAND }] }];
  }
  // SPEC-332 · ADR-0073 · mode goal: mesin yang SAMA dipasang `/goal` di dalam sesi
  // (sessionHooksRegistry.add(cwd,"Stop","",{type:"prompt",prompt})), tapi dari luar dan saat sesi
  // lahir — jadi ia tak bergantung timing TUI maupun kepatuhan agen. BUKAN guardrail deny: ADR-0037
  // tetap dicabut, hook ini tak pernah menolak tool call, ia hanya menahan sesi BERHENTI sebelum
  // kondisinya terbukti di transkrip. Interrupt manusia (Esc) bukan event Stop → kendali tetap ada.
  if (goal) hooks.Stop = [{ hooks: [{ type: "prompt", prompt: goal }] }];
  return { hooks };
};
