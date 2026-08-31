import { buildApp } from "./app";
import { prisma } from "./db";
import { startVpsMonitor } from "./services/vps-monitor";
import { startScheduler } from "./services/scheduler/engine";
import { startLead } from "./services/lead/engine";
import { registerBacklogSource } from "./services/scheduler/sources/backlog";
import { registerTriaseSource } from "./services/scheduler/sources/triase";
import { installSessionHistory, reconcileHistory } from "./services/session-history";
import { installCustomAgents } from "./services/custom-agents";
import { reconcileAgentInvocations } from "./services/agent-invocations";
import { listSessions } from "./services/pty";
import { installTelegramGateway } from "./services/telegram/bootstrap";
import { installWebhooks } from "./services/webhooks/install";
import { startWebhookEngine } from "./services/webhooks/engine";
import { startAutoMerge } from "./services/auto-merge";
import { startWorktreeReaper } from "./services/worktree-reaper";
import type { AddressInfo } from "node:net";
import { assertRuntimeBoundary } from "./services/session-sandbox";
import { dbFilePath, resolveHardening, resolveHome } from "@hanoman/runner";
import { ensureSetupToken } from "./services/bootstrap";
import { secureHanomanHome } from "./services/secure-home";
import { startRetentionSweep } from "./services/retention";
import { uploadDir } from "./services/uploads";
import { transcriptDir } from "./services/transcript-store";

// SPEC-215 · deteksi update default ON (registry HANOMAN_UPDATE_FETCH="1"), dibaca via resolver
// di services/update.ts. Test memuat buildApp dari app.ts (tak pernah server.ts) dan vitest.config
// memaksa "0" → tak pernah menyentuh jaringan.
const app = buildApp();
const port = Number(process.env.PORT ?? 8787);
// Localhost secara default. Sejak SPEC-169 hanoman punya auth (gate 401 di semua /api,
// termasuk upgrade WebSocket /api/terminal), tapi cookie `Secure` butuh TLS — jadi pola
// deploy yang direkomendasikan tetap: bind 127.0.0.1 di belakang reverse proxy (Caddy/nginx)
// yang menerminasi TLS. Production fail-closed bila bind bukan loopback (SPEC-761/ADR-0117).
const host = process.env.HOST ?? "127.0.0.1";
assertRuntimeBoundary(process.env, { uid: process.getuid?.(), host });

// Jangan biarkan satu promise yatim (mis. sweep monitor saat DB kedip) menjatuhkan orchestrator
// tanpa jejak (SPEC-197). Log, jangan crash.
process.on("unhandledRejection", (err) => console.error("unhandledRejection:", err));
process.on("uncaughtException", (err) => console.error("uncaughtException:", err));

// Tutup rapi: onClose (app.ts) melepas klien tmux; sesi claude selamat — hidup di tmux server,
// bukan proses ini (ADR-0016). Lalu putus Prisma agar koneksi tak menggantung saat restart.
async function shutdown(sig: string): Promise<void> {
  console.log(`${sig} — menutup`);
  try { await app.close(); await prisma.$disconnect(); } finally { process.exit(0); }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

const home = resolveHome();
const bootstrapReady = secureHanomanHome({
  home,
  files: [dbFilePath(process.env.DATABASE_URL!), `${home}/secret.key`, `${home}/setup.token`],
  directories: [uploadDir(), transcriptDir()],
}).then(() => prisma.user.count()).then(async (count) => {
  await secureHanomanHome({ home, files: [dbFilePath(process.env.DATABASE_URL!)] });
  if (count > 0) return;
  // SPEC-884 · ADR-0139 · token hanya lahir bila memang akan diminta. Sebelum ini ia dibuat dan
  // diumumkan tanpa syarat, jadi instalasi tanpa hardening menyuruh operator mencari berkas yang
  // tak pernah ditanyakan siapa pun — dan berkas rahasia itu tetap ditulis ke home tanpa guna.
  if (!resolveHardening(process.env)) {
    console.log("setup awal: buka dashboard dan ikuti wizard — tanpa hardening, akun pertama tak butuh token");
    return;
  }
  const proof = await ensureSetupToken(resolveHome());
  console.log(`setup admin memerlukan token di ${proof.path}; kedaluwarsa ${new Date(proof.expiresAt).toISOString()}`);
});

bootstrapReady.then(() => app.listen({ port, host })).then(async () => {
  console.log(`hanoman api ${host}:${port}`);
  // SPEC-450 · ADR-0094 · muat katalog custom agent & daftarkan sumbernya SEBELUM sesi pertama
  // bisa lahir — governor scheduler & denyut lead sama-sama bisa meluncurkan sesi pada tick
  // pertama. Ditunggu (bukan fire-and-forget): sesi yang lahir sebelum cache terisi akan lahir
  // TANPA custom agent, dan itu gejala senyap — argv-nya sah, agennya cuma tak ada.
  await installCustomAgents();
  // SPEC-481 · ADR-0100 · daftarkan tap webhook SEBELUM apa pun bisa menulis baris. Sebelum ini
  // tap diam, jadi peristiwa yang lahir di antara boot dan pemasangan hilang — dan itu senyap.
  await installWebhooks();
  // SPEC-362 · ADR-0079 · pasang hook riwayat SEBELUM apa pun bisa melahirkan sesi, lalu tutup
  // baris "berjalan" yang panenya sudah lenyap (tmux mati di luar hanoman: kill-server, reboot).
  installSessionHistory();
  // SPEC-402 · `listSessions()` boleh MELEMPAR (kegagalan tmux ≠ tak ada sesi). Rekonsiliasi yang
  // berjalan atas daftar kosong palsu akan menutup baris riwayat sesi yang justru masih berjalan —
  // "selesai padahal belum" versi tabel. Lewati saja: barisnya tetap terbuka sampai boot berikutnya.
  try {
    const liveIds = listSessions().map((s) => s.id);
    void reconcileHistory(liveIds)
      .then((n) => { if (n) console.log(`riwayat sesi: ${n} baris berjalan direkonsiliasi`); })
      .catch((e) => console.error("rekonsiliasi riwayat sesi:", e));
    void reconcileAgentInvocations(liveIds)
      .then((n) => { if (n) console.log(`custom agent: ${n} invocation ditandai abandoned`); })
      .catch((e) => console.error("rekonsiliasi invocation custom agent:", e));
  } catch (e) {
    console.error("rekonsiliasi riwayat sesi dilewati — tmux tak terbaca:", e);
  }
  // SPEC-476 · ADR-0096 · gateway baru boleh polling sesudah server menerima request, katalog
  // custom agent terpasang, dan hook history siap. API base selalu loopback: session operator
  // berjalan di proses lokal walau HTTP publik bind ke alamat lain.
  // SPEC-215 · config runtime: muat override DB lalu terapkan (mirror kredensial + init sync client).
  // SPEC-477 · ADR-0097 · WAJIB sebelum installTelegramGateway: gateway kini membaca kredensialnya
  // lewat resolver config, dan cache config yang masih kosong membuatnya diam-diam jatuh ke env
  // saja — kegagalan yang SENYAP dan tampak benar (gateway berperilaku persis seperti sebelumnya).
  // Di-`await` tapi TIDAK boleh fatal: sebelum SPEC-477 ia fire-and-forget, jadi DB yang kedip di
  // sini dulu hanya mencetak unhandledRejection. Membiarkannya melempar berarti `listen gagal` →
  // `process.exit(1)` untuk seluruh orchestrator (cermin kebijakan "log, jangan crash" di atas).
  // Degradasinya benar: tanpa cache config, gateway jatuh ke env — perilaku pra-SPEC-477.
  try {
    const { loadConfig } = await import("./config");
    const { applyConfigOnBoot } = await import("./services/config-apply");
    await loadConfig();
    await applyConfigOnBoot();
  } catch (e) {
    console.error("config runtime gagal dimuat — memakai env/default:", e);
  }
  const boundPort = (app.server.address() as AddressInfo).port;
  await installTelegramGateway(app, { apiBase: `http://127.0.0.1:${boundPort}` });
  startVpsMonitor(); // healthcheck 5 menit + audit harian (SPEC-164)
  registerBacklogSource(); // SPEC-295 · daftarkan checker backlog sebelum engine tick pertama
  registerTriaseSource(); // SPEC-297 · daftarkan checker triase sebelum engine tick pertama
  startScheduler(); // SPEC-294 · ADR-0072 · engine scheduler in-process (timer .unref, app.ts bebas-timer)
  // SPEC-409 · ADR-0091 · denyut hanoman-lead (in-process, cermin scheduler). Master switch default
  // MATI: tick pertama membaca Setting dan langsung kembali bila lead tak dinyalakan operator (AC-30).
  startLead();
  // SPEC-481 · ADR-0100 · worker antrean webhook (in-process, cermin scheduler). Idle penuh saat
  // tak ada baris `pending` — biayanya satu query ringan tiap 2 detik.
  startWebhookEngine();
  // SPEC-486 · ADR-0103 · sweep auto-merge (in-process, cermin scheduler). Idle penuh saat tak
  // ada backlog selesai dalam 24 jam terakhir: biayanya satu query ringan tiap menit, dan nol
  // sentuhan git selama tak ada project/spec yang meng-opt-in.
  startAutoMerge();
  // SPEC-742 · ADR-0116 · penyapu worktree yang sudah dilepas ke `.worktrees/.trash` (in-process,
  // cermin scheduler). Sapuan pertamanya jalan SEKARANG dan itulah pemulihan crash-nya: entri yang
  // tertinggal karena proses mati di tengah penghapusan dibereskan di sini, bukan menunggu operator
  // menutup sesi berikutnya.
  startWorktreeReaper();
  startRetentionSweep();
}).catch((err) => { console.error("listen gagal:", err); process.exit(1); });
