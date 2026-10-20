import { z } from "zod";

// SPEC-257 · ADR-0065 · capability scope untuk agent token. "<domain>:<access>", write⊇read.
// Satu sumber untuk gate server (map route→cap) dan UI Settings (checkbox).
export const CAPABILITY_IDS = [
  "projects:read", "projects:write",
  "backlog:read", "backlog:write",
  "sessions:read", "sessions:write",
  "docs:read", "docs:write",
  "ide:read", "ide:write",
  "vps:read", "vps:write",
  "settings:read", "settings:write",
  "support:read", "support:write",
  "notifications:read", "notifications:write",
  // SPEC-409 · ADR-0091 · minta putusan ke hanoman-lead + baca jejak keputusan. Domain TERSENDIRI,
  // bukan menumpang prefix baca yang sudah ada: meminta putusan adalah operasi TULIS (ia melahirkan
  // baris jejak & bisa menggerakkan sesi), dan SPEC-405 sudah membuktikan apa yang terjadi saat
  // endpoint tulis menumpang prefix status yang dipetakan tanpa melihat method (AC-5).
  "lead:read", "lead:write",
  // ADR-0228 · menyetujui tindakan lead yang menunggu izin (bisa MERGE ke branch target). Akses
  // `danger`, tak diimplikasikan `lead:write`: pane lead & agen peminta putusan memegang write,
  // dan mereka tak boleh menyetujui tindakannya sendiri (ADR-0192).
  "lead:approve",
  // SPEC-450 · ADR-0094 · custom agent. Domain TERSENDIRI, dipetakan MENURUT METHOD: menulis
  // definisi agen mengubah apa yang dilihat SETIAP sesi baru di seluruh workspace, jadi izin
  // baca tak pernah cukup untuk itu (kelas bug SPEC-405).
  "agents:read", "agents:write",
  // Skills library · domain TERSENDIRI, MENURUT METHOD: menulis skill mengubah instruksi yang
  // dibaca SETIAP sesi berikutnya (global hanoman disuntik ke semua project).
  "skills:read", "skills:write",
  // SPEC-476 · ADR-0096 · context/memory/reply/audit kanal Telegram. Aksi produk tetap memakai
  // capability domain produk masing-masing; domain ini tidak memberi akses shell atau sesi.
  "telegram:read", "telegram:write",
  // ADR-0157 · papan Tim (`/api/tasks`, `/api/members`). Domain TERSENDIRI, bukan menumpang
  // `backlog`: kartu tim adalah pekerjaan MANUSIA yang `status`-nya bebas dipindah, sementara
  // `Spec.stage` diturunkan dari fase sesi (ADR-0008/0024). Menumpangkannya berarti satu centang
  // "Backlog — tulis" diam-diam membuka papan orang, dan sebaliknya.
  "team:read", "team:write",
  "qa:read", "qa:write",
  // ADR-0193..0195 · permukaan integrasi yang dulu cookie-only (ADR-0097/0100/0110). Semuanya OPT-IN:
  // tak ada yang diimplikasikan capability lama, dan tak ikut default token mana pun.
  "webhooks:read", "webhooks:write",   // ADR-0194 · webhook keluar
  "clients:read", "clients:write",     // ADR-0194 · akun klien portal
  "portal:read",                       // ADR-0195 · lihat portal ATAS NAMA akun klien eksplisit (tak ada :write)
  // ADR-0155 · akses KETIGA: `danger`. Dipecah dari `:write` karena keempat operasi ini bukan
  // "menulis lebih banyak", melainkan menjalankan sesuatu di luar proses hanoman — sesi agen di
  // worktree, perintah di VPS, git yang mengubah sejarah, penghapusan artefak dokumen.
  // `:write` TIDAK mengimplikasikannya (lihat grantsCapability di bawah): kalau diimplikasikan,
  // pemecahan ini kosmetik dan tak menghasilkan batas apa pun.
  "sessions:spawn", "ide:git", "backlog:lifecycle", "vps:exec",
  // ADR-0188 · log aktivitas (`/api/session-results`): perpindahan stage, commit, PR lintas device.
  // Domain TERSENDIRI: purge-nya menyeberang lewat tombstone sync ke SEMUA mesin (ADR-0119), jadi
  // ia tak pantas menumpang `sessions:write`.
  "activity:read", "activity:write",
  // ADR-0189 · permukaan OPERATOR obrolan portal klien (`/api/portal-chat/*`). Domain TERSENDIRI
  // karena isinya percakapan + email KLIEN, dan `portal-chat:write` menulis berkas PRD ke checkout.
  // Bukan `portal`: itu permukaan sesi cookie klien dan tetap cookie-only (ADR-0110).
  "portal-chat:read", "portal-chat:write",
  // ADR-0183 · hapus laporan/test case/temuan/lampiran QA. Dipecah dari `qa:write` seperti keempat di atas.
  "qa:delete",
  // ADR-0190 · ADR-0192 · MENJAWAB/merebut dialog `AskUserQuestion` sebuah sesi. Akses `danger`
  // dengan domain tampilan SENDIRI (`decisions`): ia gerbang "manusia yang memutuskan" (ADR-0142),
  // bukan bagian dari mengendalikan sesi, jadi `sessions:write` tak pernah mengimplikasikannya.
  "sessions:decide",
  // ADR-0191 · cronjob per project (`/api/scheduler/crons*`). Sebuah baris cron = `POST
  // /terminal/sessions` yang ditunda (ADR-0112); karena itu server MENUNTUT `sessions:spawn` juga
  // untuk membuat/mengubah/menjalankannya — capability ini saja tidak pernah cukup untuk eksekusi.
  "scheduler:read", "scheduler:write",
  // ADR-0193 · kredensial kanal Telegram (bot token + AgentToken gateway + allowlist). Akses `danger`:
  // siapa yang memegang ini ikut menentukan SIAPA yang bisa memerintah gateway ber-capability penuh.
  "telegram:admin",
  // ADR-0196..0198 · permukaan ADMIN yang dulu cookie-only (ADR-0065/0097/0110/0146/0147/0165).
  // Semuanya OPT-IN: tak satu pun diimplikasikan capability lama, dan `:write` di sini tak pernah
  // memberi apa pun di domain lain. Kredensial & kendali mesin dipecah dari baca: manusia mencentang
  // tiap kotak di Settings → Akses AI Agent.
  "tokens:read", "tokens:write",
  "devices:read", "devices:write",
  "access:read", "access:admin",
  "remote:read", "remote:control",
  "relay:exec",
  "logs:read", "logs:write",
  "presence:read",
  "metrics:read", "metrics:write",
  // ADR-0199 · ADR-0200 · sync UI (antrean konflik, pemicu manual) dan operasi instance (pasang
  // pembaruan, restart). Opt-in, tak diimplikasikan capability lama mana pun. `sync:resolve`
  // membuang data satu sisi; `instance:admin` memasang paket npm dan me-restart proses.
  "sync:read", "sync:write", "sync:resolve", "instance:admin",
] as const;
export const zCapability = z.enum(CAPABILITY_IDS);
export type Capability = z.infer<typeof zCapability>;

export const zCapabilityInfo = z.object({
  id: zCapability, domain: z.string(), access: z.enum(["read", "write", "danger"]),
  label: z.string(), desc: z.string(), risk: z.enum(["rce", "exec", "data"]).optional(),
});
export type CapabilityInfo = z.infer<typeof zCapabilityInfo>;

// Metadata untuk UI (label Indonesia). risk = high-risk badge.
export const CAPABILITIES: CapabilityInfo[] = [
  { id: "projects:read", domain: "projects", access: "read", label: "Projects — baca", desc: "Lihat daftar & detail project, branch, binding." },
  { id: "projects:write", domain: "projects", access: "write", label: "Projects — tulis", desc: "Buat/ubah/hapus project, rename, clone, Help Center." },
  { id: "backlog:read", domain: "backlog", access: "read", label: "Backlog — baca", desc: "Lihat spec/backlog, dokumen, review diff." },
  { id: "backlog:write", domain: "backlog", access: "write", label: "Backlog — tulis", desc: "Buat/ubah/hapus spec, integrate branch." },
  { id: "sessions:read", domain: "sessions", access: "read", label: "Sesi — baca", desc: "Lihat sesi terminal, fase, review." },
  { id: "sessions:write", domain: "sessions", access: "write", label: "Sesi — tulis", desc: "Jalankan sesi claude/shell, kirim input, tutup, integrate.", risk: "rce" },
  { id: "docs:read", domain: "docs", access: "read", label: "Docs — baca", desc: "Baca dokumen SoT project & PRD." },
  { id: "docs:write", domain: "docs", access: "write", label: "Docs — tulis", desc: "Tulis/hapus file .md project." },
  { id: "ide:read", domain: "ide", access: "read", label: "IDE/Git — baca", desc: "Lihat tree, file, status git, graph, commit, diff." },
  { id: "ide:write", domain: "ide", access: "write", label: "IDE/Git — tulis", desc: "Tulis file working tree, operasi git, kelola remote." },
  { id: "vps:read", domain: "vps", access: "read", label: "VPS — baca", desc: "Lihat VPS & checklist kepatuhan." },
  { id: "vps:write", domain: "vps", access: "write", label: "VPS — tulis", desc: "Kelola VPS, audit, harden, remediasi, konsol (remote exec).", risk: "exec" },
  { id: "settings:read", domain: "settings", access: "read", label: "Settings — baca", desc: "Baca setelan & config runtime." },
  { id: "settings:write", domain: "settings", access: "write", label: "Settings — tulis", desc: "Ubah setelan & config runtime." },
  { id: "support:read", domain: "support", access: "read", label: "Tiket — baca", desc: "Lihat tiket Help Center." },
  { id: "support:write", domain: "support", access: "write", label: "Tiket — tulis", desc: "Terima/tolak tiket, ubah status, promosikan ke backlog." },
  { id: "notifications:read", domain: "notifications", access: "read", label: "Notifikasi — baca", desc: "Lihat notifikasi." },
  { id: "notifications:write", domain: "notifications", access: "write", label: "Notifikasi — tulis", desc: "Tandai terbaca / bersihkan notifikasi." },
  { id: "lead:read", domain: "lead", access: "read", label: "Lead — baca", desc: "Baca jejak keputusan hanoman-lead & statusnya." },
  { id: "lead:write", domain: "lead", access: "write", label: "Lead — tulis", desc: "Minta putusan ke hanoman-lead (keputusan bisa menggerakkan sesi).", risk: "exec" },
  { id: "lead:approve", domain: "lead", access: "danger", label: "Lead — setujui", desc: "Setujui/tolak tindakan hanoman-lead yang menunggu izin — termasuk merge branch sesi ke branch target. Beri HANYA ke token manusia, bukan token yang dipakai agen di dalam sesi.", risk: "exec" },
  { id: "agents:read", domain: "agents", access: "read", label: "Custom agent — baca", desc: "Lihat katalog custom agent global & per project." },
  { id: "agents:write", domain: "agents", access: "write", label: "Custom agent — tulis", desc: "Buat/ubah/hapus custom agent; definisinya dipakai setiap sesi baru.", risk: "exec" },
  { id: "skills:read", domain: "skills", access: "read", label: "Skills — baca", desc: "Lihat skill global, plugin & per project beserta isi berkasnya." },
  { id: "skills:write", domain: "skills", access: "write", label: "Skills — tulis", desc: "Buat/ubah/hapus skill; skill global hanoman disuntik ke setiap sesi baru.", risk: "exec" },
  { id: "telegram:read", domain: "telegram", access: "read", label: "Telegram — baca", desc: "Baca status gateway, binding, memory, dan audit Telegram." },
  { id: "telegram:write", domain: "telegram", access: "write", label: "Telegram — tulis", desc: "Perbarui context/memory dan terbitkan reply sesi operator Telegram." },
  { id: "team:read", domain: "team", access: "read", label: "Tim — baca", desc: "Lihat kartu papan Tim & direktori anggota." },
  { id: "team:write", domain: "team", access: "write", label: "Tim — tulis", desc: "Buat/ubah/hapus kartu papan Tim & anggota; eskalasi kartu jadi backlog item." },
  { id: "qa:read", domain: "qa", access: "read", label: "QA — baca", desc: "Lihat laporan QA, test case, temuan, dan lampirannya." },
  { id: "qa:write", domain: "qa", access: "write", label: "QA — tulis", desc: "Buat/ubah/hapus laporan QA, test case, temuan, lampiran; impor laporan Markdown/ZIP." },
  { id: "webhooks:read", domain: "webhooks", access: "read", label: "Webhook — baca", desc: "Lihat endpoint webhook keluar (tanpa secret) dan riwayat pengiriman — termasuk payload peristiwa lintas project." },
  { id: "webhooks:write", domain: "webhooks", access: "write", label: "Webhook — tulis", desc: "Daftarkan/ubah/hapus endpoint webhook, putar secret, kirim ping, ulangi pengiriman. Menentukan ke mana data workspace mengalir keluar.", risk: "exec" },
  { id: "clients:read", domain: "clients", access: "read", label: "Akun klien — baca", desc: "Lihat akun login portal klien beserta project yang boleh dilihatnya." },
  { id: "clients:write", domain: "clients", access: "write", label: "Akun klien — tulis", desc: "Buat/ubah/nonaktifkan/hapus akun klien, atur project yang boleh dilihat, reset password. Membuka login baru ke data project." },
  { id: "portal:read", domain: "portal", access: "read", label: "Portal klien — lihat sebagai klien", desc: "Membaca portal (backlog, tiket, chat) ATAS NAMA satu akun klien yang disebut eksplisit. Baca-saja: tak ada tulis atas nama klien." },
  // ADR-0155 · akses `danger`. Tak satu pun diimplikasikan `:write` di domainnya; manusia harus
  // mencentangnya sendiri di Settings → Akses AI Agent.
  { id: "sessions:spawn", domain: "sessions", access: "danger", label: "Sesi — buka sesi baru", desc: "Membuka sesi agen BARU di worktree (menjalankan claude/codex dengan izin penuh). Dipisah dari Sesi — tulis: mengendalikan sesi yang sudah ada tak lagi cukup untuk membuka yang baru.", risk: "rce" },
  { id: "ide:git", domain: "ide", access: "danger", label: "IDE/Git — operasi git", desc: "merge, rebase, pull, drop, hapus branch, hapus worktree. Mengubah sejarah dan menghapus pekerjaan yang tak dipegang berkas mana pun; dipisah dari menulis berkas working tree.", risk: "exec" },
  { id: "backlog:lifecycle", domain: "backlog", access: "danger", label: "Backlog — siklus hidup", desc: "Integrate, hapus backlog, dan geser stage. Ketiganya menghapus artefak dokumen; dipisah dari menyunting isi backlog.", risk: "exec" },
  { id: "vps:exec", domain: "vps", access: "danger", label: "VPS — remote exec", desc: "console, session, provision, harden, remediate, probe, test, audit. Menjalankan perintah di VPS produksi; dipisah dari mengelola daftar VPS & checklist kepatuhan.", risk: "exec" },
  // ADR-0188 · ADR-0189 · domain biasa (read/write), bukan `danger`: tak satu pun memulai pekerjaan di luar proses hanoman.
  { id: "activity:read", domain: "activity", access: "read", label: "Aktivitas — baca", desc: "Baca log aktivitas: perpindahan stage, commit, branch, dan PR lintas device." },
  { id: "activity:write", domain: "activity", access: "write", label: "Aktivitas — tulis", desc: "Purge log aktivitas per project dan/atau rentang tanggal. Penghapusan menyeberang ke semua mesin lewat sync dan tak bisa dibatalkan." },
  { id: "portal-chat:read", domain: "portal-chat", access: "read", label: "Chat portal — baca", desc: "Baca percakapan klien di chat portal berikut email klien, kuota, dan PRD draft; termasuk ekspor transkrip." },
  { id: "portal-chat:write", domain: "portal-chat", access: "write", label: "Chat portal — tulis", desc: "Materialisasi PRD draft chat portal menjadi berkas docs/prd/<slug>.md di checkout repo (menimpa berkas bernama sama). Isi draftnya berasal dari percakapan klien.", risk: "exec" },
  { id: "qa:delete", domain: "qa", access: "danger", label: "QA — hapus", desc: "Hapus laporan QA, test case, temuan, dan lampiran (permanen, ikut tersinkron ke mesin lain). Dipisah dari QA — tulis: menyunting laporan tak lagi cukup untuk menghapusnya.", risk: "exec" },
  // ADR-0190 · ADR-0192 · domain tampilan `decisions` (bukan `sessions`): grid Settings hanya punya
  // SATU sel `berbahaya` per domain, dan `sessions` sudah dipakai `sessions:spawn`.
  { id: "sessions:decide", domain: "decisions", access: "danger", label: "Keputusan — jawab dialog sesi", desc: "Membaca, menjawab, dan merebut dialog AskUserQuestion sebuah sesi dari lead. Ini gerbang \"manusia yang memutuskan\": beri HANYA ke token yang tidak dipakai agen di dalam sesi hanoman. Server menolak token yang meluncurkan sesi itu dan panggilan dari dalam sesi.", risk: "exec" },
  // ADR-0191
  { id: "scheduler:read", domain: "scheduler", access: "read", label: "Cronjob — baca", desc: "Lihat cronjob per project (jadwal, prompt, agen) dan riwayat run-nya." },
  { id: "scheduler:write", domain: "scheduler", access: "write", label: "Cronjob — tulis", desc: "Buat/ubah/hapus/jalankan cronjob. Membuat, mengubah prompt/agen/jadwal, mengaktifkan, dan menjalankan cron juga menuntut Sesi — buka sesi baru (cron = sesi agen tertunda).", risk: "exec" },
  { id: "telegram:admin", domain: "telegram", access: "danger", label: "Telegram — kredensial", desc: "Baca/ubah/hapus bot token, AgentToken gateway & allowlist user Telegram, dan uji koneksi. Siapa pun yang boleh memerintah gateway mewarisi capability token gateway; server menolak bila token gateway melebihi capability pemanggil.", risk: "exec" },
  // ADR-0196..0198 · permukaan admin. Dibalik dari cookie-only dengan SADAR oleh pemilik; pagar
  // tak-eskalasi-diri ditegakkan di handler server (lihat routes/agent-tokens.ts), bukan di label ini.
  { id: "tokens:read", domain: "tokens", access: "read", label: "Agent token — baca", desc: "Lihat daftar agent token (nama, prefix, capability) dan katalog capability. Plaintext token tak pernah ikut." },
  { id: "tokens:write", domain: "tokens", access: "write", label: "Agent token — tulis", desc: "Cetak, ubah, dan cabut agent token. Token baru/ubahan HANYA boleh memuat capability yang dimiliki pemanggil, dan token sendiri tak bisa diubah/dicabut. Plaintext token tampil sekali saat dicetak.", risk: "exec" },
  { id: "devices:read", domain: "devices", access: "read", label: "Device token — baca", desc: "Lihat daftar device token (identitas mesin sync/relay) milik pemilik token ini." },
  { id: "devices:write", domain: "devices", access: "write", label: "Device token — tulis", desc: "Cetak & cabut device token — kredensial mesin untuk sync workspace dan relay. Plaintext tampil sekali; token dicetak atas nama akun manusia yang menerbitkan agent token ini.", risk: "exec" },
  { id: "access:read", domain: "access", access: "read", label: "Akun — baca", desc: "Lihat daftar akun operator/klien (email, role)." },
  { id: "access:admin", domain: "access", access: "danger", label: "Akun — admin", desc: "Buat akun admin, hapus akun, dan setel ulang password akun lain. Akun admin = akses penuh dashboard (termasuk yang cookie-only): capability ini setara menyerahkan seluruh instance.", risk: "rce" },
  { id: "remote:read", domain: "remote", access: "read", label: "Kendali jarak jauh — baca", desc: "Lihat grant kendali jarak jauh, lajur pengiriman log, status tautan relay, dan audit terakhir." },
  { id: "remote:control", domain: "remote", access: "danger", label: "Kendali jarak jauh — ubah grant", desc: "Menyalakan/mengubah grant kendali jarak jauh mesin ini dan lajur pengiriman log ke hub. Grant yang menyala membuat hub bisa menjalankan agen di mesin ini; token hanya boleh memberi capability yang ia miliki sendiri.", risk: "rce" },
  { id: "relay:exec", domain: "relay", access: "danger", label: "Relay perangkat — jalankan", desc: "Meneruskan aksi sesi (buka/steer/interrupt/selesai) ke mesin LAIN lewat relay hub atas nama operator. Eksekusi lintas mesin: dipisah dari kendali jarak jauh mesin ini.", risk: "rce" },
  { id: "logs:read", domain: "logs", access: "read", label: "Log terpusat — baca", desc: "Cari log lintas device, baca transkrip, dan lihat retensi. Jejak audit seluruh mesin operator." },
  { id: "logs:write", domain: "logs", access: "write", label: "Log terpusat — tulis", desc: "Ubah retensi log (memendekkan retensi menghapus jejak audit) dan lajur pengiriman log ke hub. Setiap perubahan oleh agen dicatat di log event.", risk: "exec" },
  { id: "presence:read", domain: "presence", access: "read", label: "Presence — baca", desc: "Peta sesi yang sedang hidup di seluruh device operator." },
  { id: "metrics:read", domain: "metrics", access: "read", label: "Metrik custom agent — baca", desc: "Metrik pemakaian & disposisi (diterima/ditolak) custom agent." },
  { id: "metrics:write", domain: "metrics", access: "write", label: "Metrik custom agent — tulis", desc: "Menyetel disposisi satu invokasi (accepted/partial/rejected/false-positive). Disposisi adalah vonis MANUSIA atas mutu agen; agen yang menilai dirinya sendiri merusak sinyal itu.", risk: "exec" },
  // ADR-0199 · ADR-0200 · sync UI & operasi instance. Opt-in: tak ikut default dan tak diwarisi capability lama.
  { id: "sync:read", domain: "sync", access: "read", label: "Sync — baca", desc: "Lihat antrean konflik rekonsil dan penghapusan yang belum menyeberang ke hub." },
  { id: "sync:write", domain: "sync", access: "write", label: "Sync — jalankan", desc: "Picu siklus sync manual ke hub (termasuk tarik ulang penuh dari kursor 0). Tidak termasuk memutuskan konflik." },
  { id: "sync:resolve", domain: "sync", access: "danger", label: "Sync — putuskan konflik", desc: "Memilih sisi lokal atau hub untuk sebuah konflik rekonsil; sisi yang kalah DIBUANG tanpa jalan pulang. Dipisah dari Sync — jalankan.", risk: "data" },
  { id: "instance:admin", domain: "instance", access: "danger", label: "Instance — pasang pembaruan & restart", desc: "Memasang versi hanoman terbaru dari registry npm dan me-restart proses server (koneksi terputus sesaat; sesi tmux selamat). Hanya sah bila instance punya supervisor.", risk: "exec" },
];

// SPEC-264 · Metadata per-domain untuk grid capability di Settings (label ramah + cakupan).
// Grid dulu hanya merender slug domain mentah ("docs", "support") sehingga PRD/Help Desk
// tak terbaca; ini sumber tunggal label/desc supaya cakupan tiap domain kelihatan. Urutan =
// urutan kemunculan domain di CAPABILITIES.
export const CAPABILITY_DOMAINS: { domain: string; label: string; desc: string }[] = [
  { domain: "projects", label: "Projects", desc: "Project, branch, binding, Help Center." },
  { domain: "backlog", label: "Backlog / Spec", desc: "Spec/backlog, dokumen, review diff, integrate." },
  { domain: "sessions", label: "Sesi", desc: "Sesi terminal, fase, jalankan claude/shell." },
  { domain: "docs", label: "Docs & PRD", desc: "Dokumen SoT project & PRD." },
  { domain: "ide", label: "IDE / Git", desc: "Tree, file, status git, graph, commit, diff." },
  { domain: "vps", label: "VPS", desc: "VPS, checklist kepatuhan, audit, konsol." },
  { domain: "settings", label: "Settings", desc: "Setelan & config runtime." },
  { domain: "support", label: "Help Desk", desc: "Tiket Help Center (Help Desk): lihat, terima/tolak, promosikan ke backlog." },
  { domain: "notifications", label: "Notifikasi", desc: "Lihat & kelola notifikasi." },
  { domain: "lead", label: "Lead", desc: "Minta putusan ke hanoman-lead & baca jejak keputusannya." },
  { domain: "agents", label: "Custom agent", desc: "Katalog persona agen global & per project." },
  { domain: "skills", label: "Skills", desc: "Skill global hanoman, user, plugin & per project." },
  { domain: "telegram", label: "Telegram", desc: "Status, binding, memory, reply, dan audit kanal operator Telegram." },
  { domain: "team", label: "Tim", desc: "Kartu papan Tim (kerja manusia), direktori anggota, eskalasi kartu ke backlog." },
  { domain: "qa", label: "QA", desc: "Laporan QA per project: test case, temuan, lampiran, ekspor/impor." },
  { domain: "webhooks", label: "Webhook", desc: "Endpoint webhook keluar, secret penandatanganan, riwayat pengiriman." },
  { domain: "clients", label: "Akun klien", desc: "Akun login portal klien dan project yang boleh dilihatnya." },
  { domain: "portal", label: "Portal klien", desc: "Lihat portal atas nama satu akun klien (baca-saja)." },
  { domain: "activity", label: "Aktivitas", desc: "Log aktivitas lintas device (stage, commit, PR) dan purge-nya." },
  { domain: "portal-chat", label: "Chat portal", desc: "Percakapan klien di chat portal (berisi email klien), PRD draft, dan ekspor transkrip." },
  { domain: "decisions", label: "Keputusan sesi", desc: "Jawab/rebut dialog AskUserQuestion sesi — gerbang manusia yang memutuskan." },
  { domain: "scheduler", label: "Cronjob", desc: "Cronjob per project: sesi agen terjadwal. Eksekusinya juga menuntut Sesi — buka sesi baru." },
  { domain: "tokens", label: "Agent token", desc: "Cetak/ubah/cabut agent token — hanya sebatas capability milik pemanggil." },
  { domain: "devices", label: "Device token", desc: "Kredensial mesin untuk sync & relay: daftar, cetak, cabut." },
  { domain: "access", label: "Akun & password", desc: "Daftar akun, buat/hapus akun admin, setel ulang password — setara akses penuh." },
  { domain: "remote", label: "Kendali jarak jauh", desc: "Grant kendali jarak jauh mesin ini dan lajur log ke hub." },
  { domain: "relay", label: "Relay perangkat", desc: "Aksi sesi di mesin lain lewat relay hub." },
  { domain: "logs", label: "Log terpusat", desc: "Pencarian log lintas device, transkrip, retensi." },
  { domain: "presence", label: "Presence", desc: "Sesi yang sedang hidup di seluruh device operator." },
  { domain: "metrics", label: "Metrik custom agent", desc: "Metrik pemakaian custom agent & disposisi per invokasi." },
  { domain: "sync", label: "Sync", desc: "Antrean konflik rekonsil, penghapusan tertunda, pemicu sync manual ke hub." },
  { domain: "instance", label: "Instance", desc: "Pasang pembaruan hanoman dan restart proses server." },
];

// write meng-implikasikan read pada domain yang sama.
export function grantsCapability(granted: string[], need: Capability): boolean {
  if (granted.includes(need)) return true;
  if (need.endsWith(":read")) return granted.includes(need.replace(/:read$/, ":write"));
  return false;
}

// ADR-0196 · pagar tak-eskalasi-diri: capability di `requested` yang TIDAK dimiliki `granted`
// (write tetap mengimplikasikan read; danger tak pernah diimplikasikan). Kosong = `requested`
// adalah himpunan-bagian dari hak pemanggil. Id tak dikenal dianggap melebihi (fail closed).
export function exceedingCapabilities(granted: readonly string[], requested: readonly string[]): string[] {
  const g = [...granted];
  return [...new Set(requested)].filter((c) => !zCapability.safeParse(c).success || !grantsCapability(g, c as Capability));
}

export const zAgentTokenView = z.object({
  id: z.string(), name: z.string(), tokenPrefix: z.string(),
  capabilities: z.array(zCapability), enabled: z.boolean(),
  createdBy: z.string().nullable(), createdAt: z.string(),
  lastUsedAt: z.string().nullable(), revokedAt: z.string().nullable(),
});
export type AgentTokenView = z.infer<typeof zAgentTokenView>;

export const zAgentTokenCreate = z.object({
  name: z.string().min(1),
  capabilities: z.array(zCapability),
});
export const zAgentTokenPatch = z.object({
  name: z.string().min(1).optional(),
  capabilities: z.array(zCapability).optional(),
  enabled: z.boolean().optional(),
});
