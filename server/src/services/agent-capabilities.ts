import { grantsCapability, type Capability } from "@hanoman/shared";

// SPEC-257 · ADR-0065 · peta route→capability. path = req.url tanpa query (mis. /api/projects/foo/docs/x.md).
// write meng-implikasikan read (grantsCapability). Route tak dikenal → null → gate perlakukan cookie-only.
type Resolved = Capability | "COOKIE_ONLY" | "GLOBAL_READ" | null;

const IDE_SUBS = new Set([
  "tree", "file", "working-status", "file-diff", "graph", "commit", "git",
  "status", "stashes", "remotes", "compare", "archive", "pr-url",
  // ADR-0121 · operasi berkas Explorer. `rw()` menurunkan read/write DARI METHOD, jadi
  // POST/PATCH/DELETE menuntut ide:write — capability yang sudah memberi hak menimpa isi
  // berkas apa pun lewat PUT /file (hindari kelas bug SPEC-405: prefix tanpa lihat method).
  "entry", "upload",
  // SPEC-861 · ADR-0132 · daftar & hapus worktree hidup. `rw()` menurunkan read/write DARI METHOD,
  // jadi POST /worktrees/delete menuntut ide:write (hindari kelas bug SPEC-405).
  "worktrees",
]);

// ADR-0155 · aksi VPS yang MENJALANKAN perintah di mesin remote. Sisanya (CRUD, checklist,
// components, items/na, items/attest) tetap `vps:read|write`. Dicocokkan ke seg[2] — segmen
// sesudah `:id` — jadi `remediate/preview` dan `provision/preview` ikut induknya.
const VPS_EXEC_SUBS = new Set([
  "console", "session", "audit", "probe", "test", "harden", "provision", "remediate",
]);

export function capabilityForRoute(method: string, path: string): Resolved {
  const read = method === "GET" || method === "HEAD";
  const rw = (d: string): Capability => `${d}:${read ? "read" : "write"}` as Capability;
  const seg = path.replace(/^\/api\/?/, "").replace(/\/+$/, "").split("/").filter(Boolean);
  const top = seg[0] ?? "";

  // tak-boleh-didelegasikan.
  // SPEC-617 · ADR-0110 · `portal` & `client-accounts` DULU ikut di sini. ADR-0194/0195 membalik
  // keduanya (lihat blok `portal`/`client-accounts` di bawah): client-accounts jadi `clients:*`,
  // portal jadi `portal:read` HANYA untuk method baca dan HANYA atas nama akun klien eksplisit.
  // Tulis ke portal (kirim tiket, mulai/kirim chat) tetap cookie-only — lihat catatan di bawah.
  // SPEC-909 · ADR-0146 · `session-events` ikut: pemanggilnya hook sesi ber-token turunan, bukan
  // manusia dan bukan agen. Agen yang bisa memalsukan "sesi X bertanya Y" bisa menggerakkan lead
  // atas nama sesi mana pun — itu bukan capability, itu peniruan identitas.
  // SPEC-919 · ADR-0147 · `presence` memaparkan peta pekerjaan yang sedang berjalan di SELURUH
  // mesin operator. Tak ada capability yang berarti apa pun untuk itu (preseden /device-tokens).
  // SPEC-1215 · ADR-0165 §4 · `remote-control` menyalakan eksekusi agen di mesin ini atas perintah hub.
  // Capability apa pun yang bisa menulisnya adalah eskalasi RCE — cookie-only (preseden /agent-tokens).
  // SPEC-1216 · ADR-0165 §4 · `/devices/:id/relay/*` menjalankan aksi sesi di MESIN LAIN atas nama
  // operator — capability apa pun yang bisa mendelegasikannya adalah eskalasi RCE lintas mesin
  // (preseden `remote-control`).
  // SPEC-1217 · `logs` memaparkan lajur event/server/transcript SELURUH mesin operator (LogEntry
  // lintas device) — preseden `presence`: tak ada capability yang berarti apa pun untuk itu.
  if (top === "auth" || top === "agent-tokens" || top === "device-tokens" || top === "sync"
    || top === "presence" || top === "remote-control" || top === "logs"
    || top === "session-events"
    || top === "devices") return "COOKIE_ONLY";
  // read-only global (status). SPEC-405 · ADR-0088 · `GLOBAL_READ` HANYA untuk method baca:
  // `POST /update/apply` me-restart instance, dan itu tak pernah boleh lolos hanya karena
  // prefix-nya kebetulan sama dengan endpoint status. Cookie = akses penuh, seperti sebelumnya.
  // ADR-0187 · `models`, `methods`, `codex` pindah dari cookie-only ke baca-global: ketiganya
  // properti MESIN (katalog model hasil probe CLI, kesiapan skill metode, versi codex), bukan
  // properti akun, dan tak satu pun handler-nya membaca `req.user`. `models` dulu cookie-only
  // semata karena ia lahir sebagai data picker dashboard (SPEC-339); katalognya sudah di-allowlist
  // parser sehingga detail akun CLI tak pernah tersimpan. Method tulis tetap cookie-only.
  if (top === "limits" || top === "update" || top === "events" || top === "fs" || top === "health"
    || top === "models" || top === "methods" || top === "codex")
    return read ? "GLOBAL_READ" : "COOKIE_ONLY";
  // ADR-0188 · log aktivitas (SessionResult). MENURUT METHOD: DELETE = purge yang menyeberang ke
  // semua mesin lewat tombstone sync (ADR-0119), jadi `activity:read` tak pernah cukup untuknya.
  if (top === "session-results") return rw("activity");
  // ADR-0189 · obrolan portal sisi OPERATOR. Dicocokkan ke segmen PERSIS `portal-chat` — bukan
  // prefix `portal` (permukaan sesi cookie klien, ADR-0110) yang tetap cookie-only di atas.
  // `rw()` menurunkan read/write dari method: ekspor & daftar = baca, `POST …/prd` = tulis.
  if (top === "portal-chat") return rw("portal-chat");
  if (top === "scheduler") {
    // SPEC-646 · ADR-0112 · cron BUKAN knob. Ia adalah `POST /terminal/sessions` yang ditunda:
    // sebuah baris cron membuat hanoman membuka sesi agen di worktree project, berulang, tanpa
    // manusia di pane. Membiarkannya di `settings` berarti setiap agent token pemegang
    // `settings:write` bisa menjadwalkan sesi tanpa batas — persis kelas eskalasi yang ditutup
    // SPEC-405 untuk `/update/apply` dan ADR-0097/0100 untuk permukaan kredensial. ADR-0099 sudah
    // menetapkan bahwa MCP tak mengekspos tool yang mengeksekusi; cron adalah eksekusi.
    // ADR-0191 · membalik ADR-0112 DENGAN pagar: `crons` kini domain `scheduler` (menurut method),
    // opt-in, tak diwarisi `settings:*`. Capability itu SAJA tak pernah cukup untuk eksekusi — handler
    // di routes/scheduler.ts menuntut `sessions:spawn` juga untuk create/patch-eksekusi/run. Fungsi
    // ini sengaja tak melihat body (kemurnian (method, path)), jadi gerbang kedua itu hidup di handler.
    if (seg[1] === "crons") return rw("scheduler");
    return rw("settings");   // SPEC-294 · sisanya = setelan instance
  }
  // SPEC-409 · ADR-0091 · domain TERSENDIRI. `POST /lead/decisions` adalah endpoint TULIS: ia
  // melahirkan baris jejak permanen dan keputusannya bisa menggerakkan sesi. Capability baca tak
  // pernah cukup untuk memanggilnya (AC-5) — `rw()` sudah menurunkannya dari method, jadi tak ada
  // pengulangan kelas bug SPEC-405 (prefix status yang dipetakan ke GLOBAL_READ tanpa lihat method).
  if (top === "lead") return rw("lead");
  // SPEC-450 · ADR-0094 keputusan 8 · dipetakan MENURUT METHOD, bukan prefix (kelas bug SPEC-405):
  // menulis definisi agen mengubah apa yang dilihat SETIAP sesi baru di seluruh workspace.
  if (top === "custom-agents") {
    if (seg[1] === "metrics" || seg[1] === "invocations") return "COOKIE_ONLY";
    return rw("agents");
  }
  // Skills library · MENURUT METHOD (kelas bug SPEC-405): skill global hanoman disuntik ke setiap
  // sesi baru, jadi izin baca tak pernah cukup untuk menulisnya.
  if (top === "skills") return rw("skills");
  // SPEC-477 · ADR-0097 · permukaan KREDENSIAL bukan permukaan kerja sesi operator: ia menyimpan
  // bot token & AgentToken. ADR-0193 membalik "cookie-only"-nya menjadi capability `telegram:admin`
  // (akses danger) — BARU dan opt-in, jadi `telegram:write` dan `settings:write` (yang wajib dipegang
  // gateway) tetap TIDAK menjangkaunya. Dipetakan apa pun methodnya: GET (isian tersamar) pun
  // membuka allowlist & chat target. Sub-path `/telegram/*` yang lain tetap domain `telegram` (ADR-0096).
  if (top === "telegram") {
    const sub = seg[1] ?? "";
    if (sub === "settings" || sub === "test" || sub === "credentials") return "telegram:admin";
    return rw("telegram");
  }
  // SPEC-481 · ADR-0100 · pengelolaan webhook memegang SECRET penandatanganan dan menentukan ke
  // mana data workspace mengalir keluar. ADR-0194 membuka lewat domain BARU `webhooks:read|write`
  // (opt-in, menurut METHOD — kelas bug SPEC-405). Pagar yang tak bisa dinyatakan di peta ini
  // (`allowPrivate` = SSRF ke jaringan internal) hidup di handler routes/webhooks.ts.
  if (top === "webhooks") return rw("webhooks");
  // SPEC-617 · ADR-0110 · akun klien memegang kredensial login orang luar. ADR-0194: `clients:*`
  // menurut method. Hanya baris ber-role klien yang terjangkau (handler), akun operator tidak.
  if (top === "client-accounts") return rw("clients");
  // ADR-0195 · portal klien: respons bergantung identitas akun KLIEN, yang tak dimiliki agent token.
  // Yang dibuka hanya BACA, dan handler mensyaratkan `?asClient=<id akun klien>` eksplisit untuk
  // agent token. Tulis (POST kirim tiket, mulai/kirim chat) tetap cookie-only: itu bertindak SEBAGAI
  // klien — peniruan identitas, bukan capability.
  if (top === "portal") return read ? "portal:read" : "COOKIE_ONLY";
  if (top === "settings" || top === "config") return rw("settings");
  if (top === "specs") {
    // ADR-0155 · integrate & hapus backlog menghapus artefak dokumen. `PATCH /specs/:id {stage}`
    // juga — tapi keputusannya bergantung BODY, dan fungsi ini sengaja tak pernah melihat body
    // (kemurnian (method, path) itulah yang membuat uji kontrak katalog MCP mungkin). Gerbang
    // stage-nya hidup di handler `PATCH /specs/:id` di routes/specs.ts.
    if (method === "DELETE" && seg.length === 2) return "backlog:lifecycle";
    if (seg[2] === "integrate") return "backlog:lifecycle";
    return rw("backlog");
  }
  if (top === "notifications") return rw("notifications");
  if (top === "tickets") return rw("support");   // SPEC-384 · `errors` dicabut (ADR-0092)
  // SPEC-471 · ADR-0095 · triase issue GitHub satu domain dengan tiket: keduanya permukaan
  // masuk yang melahirkan backlog. `rw()` menurunkannya dari method (kelas bug SPEC-405).
  if (top === "github-issues") return rw("support");
  if (top === "vps") {
    // seg = ["vps", ":id", sub, …]. `GET /vps/components` tak punya seg[2] → jatuh ke rw("vps").
    if (VPS_EXEC_SUBS.has(seg[2] ?? "")) return "vps:exec";
    return rw("vps");
  }
  if (top === "prds") return rw("docs");
  // ADR-0157 · papan Tim. `tasks` DAN `members` satu domain: kartu tanpa nama penanggung jawab
  // hanyalah judul, dan memberi salah satunya tanpa yang lain menghasilkan agen yang bisa membaca
  // penugasan tapi tak bisa menyebut siapa orangnya. `rw()` menurunkan read/write DARI METHOD.
  //
  // `POST /tasks/:id/escalate` MELAHIRKAN backlog item namun tetap `team:write`, cermin persis
  // `POST /tickets/:id/accept` yang tetap `support:write` (ADR-0062/0095): permukaan MASUK
  // memegang capability permukaannya sendiri. Yang menahan peluncuran sesi tetap `launchPrincipal`
  // — tanpa `sessions:write` pada token yang sama, Spec-nya lahir TANPA `launchApprovedAt`.
  if (top === "tasks" || top === "members") return rw("team");
  // Workspace QA · `/api/qa/template.md` (template unduhan, tak terikat project).
  if (top === "qa") return rw("qa");
  if (top === "terminal") {
    // SPEC-786 · workspace memuat preferensi per akun dan diturunkan dari req.user.id;
    // capability sesi tak membawa identitas admin yang diperlukan untuk isolasi row ini.
    if (seg[1] === "workspace") return "COOKIE_ONLY";
    // ADR-0190 · ADR-0192 · SELURUH sub-pohon `/dialog` (baca, jawab, rebut) = `sessions:decide`,
    // APA PUN method-nya. Dulu `rw("sessions")`: token ber-`sessions:write` — yang cukup untuk
    // steer/interrupt — otomatis bisa menjawab dialog. Membaca ikut digerbangi karena `screenHash`
    // dari GET adalah satu-satunya jalan menuju jawaban, dan pertanyaan sesi bisa memuat rahasia.
    if (seg[1] === "sessions" && seg[3] === "dialog") return "sessions:decide";
    if (seg[seg.length - 1] === "ws") return "sessions:write"; // WS = kontrol interaktif
    // ADR-0155 · membuka sesi BARU ≠ mengendalikan sesi yang sudah ada. Dicocokkan ke panjang
    // segmen PERSIS (`/terminal/sessions`), bukan prefix: `/terminal/sessions/:id/steer`
    // berawalan sama, dan memetakannya lewat prefix mengulang kelas bug SPEC-405.
    if (!read && seg.length === 2 && seg[1] === "sessions") return "sessions:spawn";
    return rw("sessions");
  }
  if (top === "projects") {
    const sub = seg[2]; // seg[1] = :id
    // Workspace QA · laporan QA adalah domain TERSENDIRI. Tanpa baris ini `/projects/:id/qa/**` jatuh
    // ke `rw("projects")` — agen harus dipercaya menyunting & menghapus project hanya untuk menulis
    // laporan. `rw()` menurunkan read/write DARI METHOD (kelas bug SPEC-405).
    // ADR-0183 · HANYA method DELETE yang pindah ke `qa:delete` (akses danger, tak diimplikasikan
    // `qa:write`): laporan/test case/temuan/lampiran yang dihapus ikut terhapus di mesin tersync.
    if (sub === "qa") return method === "DELETE" ? "qa:delete" : rw("qa");
    if (sub === "docs" || sub === "prds") return rw("docs");
    if (sub === "github") return rw("support");   // SPEC-471 · ADR-0095 · tarik/daftar issue
    // ADR-0155 · HANYA tulisan yang merusak yang pindah ke `ide:git`; seluruh pembacaan tetap
    // di tempatnya. `branches` sengaja TIDAK dijadikan anggota IDE_SUBS: daftar branch adalah
    // permukaan project (routes/projects.ts) dan tetap `projects:read` — yang pindah cuma
    // `branches/delete`. Dicocokkan ke method DAN sub-segmen, bukan prefix (kelas bug SPEC-405).
    if (!read && sub === "git") return "ide:git";
    if (!read && (sub === "branches" || sub === "worktrees") && seg[3] === "delete") return "ide:git";
    if (sub && IDE_SUBS.has(sub)) return rw("ide");
    return rw("projects");
  }
  return null;
}

export function checkAgentCapability(caps: string[], method: string, path: string):
  { ok: true } | { ok: false; status: 403; need?: string; reason: "cookie-only" | "capability" } {
  const need = capabilityForRoute(method, path);
  if (need === "GLOBAL_READ") return { ok: true };
  if (need === "COOKIE_ONLY" || need === null) return { ok: false, status: 403, reason: "cookie-only" };
  if (grantsCapability(caps, need)) return { ok: true };
  return { ok: false, status: 403, need, reason: "capability" };
}
