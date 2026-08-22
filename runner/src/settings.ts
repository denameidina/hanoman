// Guardrail deny PreToolUse dicabut sepenuhnya (SPEC-197, ADR-0037): agen dipercaya penuh,
// isolasi murni lewat worktree. Yang tersisa di sini hanya marker keputusan (SPEC-184) —
// hook dari `--settings` tetap BERGABUNG dengan milik pengguna, bukan menggantikannya.
export const guardSettings = (decisionFile?: string, goal?: string) => {
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
  // SPEC-332 · ADR-0073 · mode goal: mesin yang SAMA dipasang `/goal` di dalam sesi
  // (sessionHooksRegistry.add(cwd,"Stop","",{type:"prompt",prompt})), tapi dari luar dan saat sesi
  // lahir — jadi ia tak bergantung timing TUI maupun kepatuhan agen. BUKAN guardrail deny: ADR-0037
  // tetap dicabut, hook ini tak pernah menolak tool call, ia hanya menahan sesi BERHENTI sebelum
  // kondisinya terbukti di transkrip. Interrupt manusia (Esc) bukan event Stop → kendali tetap ada.
  if (goal) hooks.Stop = [{ hooks: [{ type: "prompt", prompt: goal }] }];
  return { hooks };
};
