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
  // SPEC-450 · ADR-0094 · custom agent. Domain TERSENDIRI, dipetakan MENURUT METHOD: menulis
  // definisi agen mengubah apa yang dilihat SETIAP sesi baru di seluruh workspace, jadi izin
  // baca tak pernah cukup untuk itu (kelas bug SPEC-405).
  "agents:read", "agents:write",
  // SPEC-476 · ADR-0096 · context/memory/reply/audit kanal Telegram. Aksi produk tetap memakai
  // capability domain produk masing-masing; domain ini tidak memberi akses shell atau sesi.
  "telegram:read", "telegram:write",
  // ADR-0157 · papan Tim (`/api/tasks`, `/api/members`). Domain TERSENDIRI, bukan menumpang
  // `backlog`: kartu tim adalah pekerjaan MANUSIA yang `status`-nya bebas dipindah, sementara
  // `Spec.stage` diturunkan dari fase sesi (ADR-0008/0024). Menumpangkannya berarti satu centang
  // "Backlog — tulis" diam-diam membuka papan orang, dan sebaliknya.
  "team:read", "team:write",
  // ADR-0155 · akses KETIGA: `danger`. Dipecah dari `:write` karena keempat operasi ini bukan
  // "menulis lebih banyak", melainkan menjalankan sesuatu di luar proses hanoman — sesi agen di
  // worktree, perintah di VPS, git yang mengubah sejarah, penghapusan artefak dokumen.
  // `:write` TIDAK mengimplikasikannya (lihat grantsCapability di bawah): kalau diimplikasikan,
  // pemecahan ini kosmetik dan tak menghasilkan batas apa pun.
  "sessions:spawn", "ide:git", "backlog:lifecycle", "vps:exec",
] as const;
export const zCapability = z.enum(CAPABILITY_IDS);
export type Capability = z.infer<typeof zCapability>;

export const zCapabilityInfo = z.object({
  id: zCapability, domain: z.string(), access: z.enum(["read", "write", "danger"]),
  label: z.string(), desc: z.string(), risk: z.enum(["rce", "exec"]).optional(),
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
  { id: "agents:read", domain: "agents", access: "read", label: "Custom agent — baca", desc: "Lihat katalog custom agent global & per project." },
  { id: "agents:write", domain: "agents", access: "write", label: "Custom agent — tulis", desc: "Buat/ubah/hapus custom agent; definisinya dipakai setiap sesi baru.", risk: "exec" },
  { id: "telegram:read", domain: "telegram", access: "read", label: "Telegram — baca", desc: "Baca status gateway, binding, memory, dan audit Telegram." },
  { id: "telegram:write", domain: "telegram", access: "write", label: "Telegram — tulis", desc: "Perbarui context/memory dan terbitkan reply sesi operator Telegram." },
  { id: "team:read", domain: "team", access: "read", label: "Tim — baca", desc: "Lihat kartu papan Tim & direktori anggota." },
  { id: "team:write", domain: "team", access: "write", label: "Tim — tulis", desc: "Buat/ubah/hapus kartu papan Tim & anggota; eskalasi kartu jadi backlog item." },
  // ADR-0155 · akses `danger`. Tak satu pun diimplikasikan `:write` di domainnya; manusia harus
  // mencentangnya sendiri di Settings → Akses AI Agent.
  { id: "sessions:spawn", domain: "sessions", access: "danger", label: "Sesi — buka sesi baru", desc: "Membuka sesi agen BARU di worktree (menjalankan claude/codex dengan izin penuh). Dipisah dari Sesi — tulis: mengendalikan sesi yang sudah ada tak lagi cukup untuk membuka yang baru.", risk: "rce" },
  { id: "ide:git", domain: "ide", access: "danger", label: "IDE/Git — operasi git", desc: "merge, rebase, pull, drop, hapus branch, hapus worktree. Mengubah sejarah dan menghapus pekerjaan yang tak dipegang berkas mana pun; dipisah dari menulis berkas working tree.", risk: "exec" },
  { id: "backlog:lifecycle", domain: "backlog", access: "danger", label: "Backlog — siklus hidup", desc: "Integrate, hapus backlog, dan geser stage. Ketiganya menghapus artefak dokumen; dipisah dari menyunting isi backlog.", risk: "exec" },
  { id: "vps:exec", domain: "vps", access: "danger", label: "VPS — remote exec", desc: "console, session, provision, harden, remediate, probe, test, audit. Menjalankan perintah di VPS produksi; dipisah dari mengelola daftar VPS & checklist kepatuhan.", risk: "exec" },
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
  { domain: "telegram", label: "Telegram", desc: "Status, binding, memory, reply, dan audit kanal operator Telegram." },
  { domain: "team", label: "Tim", desc: "Kartu papan Tim (kerja manusia), direktori anggota, eskalasi kartu ke backlog." },
];

// write meng-implikasikan read pada domain yang sama.
export function grantsCapability(granted: string[], need: Capability): boolean {
  if (granted.includes(need)) return true;
  if (need.endsWith(":read")) return granted.includes(need.replace(/:read$/, ":write"));
  return false;
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
