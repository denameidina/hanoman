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

export function capabilityForRoute(method: string, path: string): Resolved {
  const read = method === "GET" || method === "HEAD";
  const rw = (d: string): Capability => `${d}:${read ? "read" : "write"}` as Capability;
  const seg = path.replace(/^\/api\/?/, "").replace(/\/+$/, "").split("/").filter(Boolean);
  const top = seg[0] ?? "";

  // tak-boleh-didelegasikan.
  // SPEC-617 · ADR-0110 · `portal` & `client-accounts` ikut: portal adalah permukaan SESI COOKIE
  // ber-scope akun (respons bergantung `req.user`, jadi tak ada capability yang bisa berarti
  // apa pun di sana), dan client-accounts memegang kredensial (preseden /agent-tokens).
  if (top === "auth" || top === "agent-tokens" || top === "device-tokens" || top === "sync"
    || top === "portal" || top === "client-accounts") return "COOKIE_ONLY";
  // read-only global (status). SPEC-405 · ADR-0088 · `GLOBAL_READ` HANYA untuk method baca:
  // `POST /update/apply` me-restart instance, dan itu tak pernah boleh lolos hanya karena
  // prefix-nya kebetulan sama dengan endpoint status. Cookie = akses penuh, seperti sebelumnya.
  if (top === "limits" || top === "update" || top === "events" || top === "fs" || top === "health")
    return read ? "GLOBAL_READ" : "COOKIE_ONLY";
  if (top === "scheduler") {
    // SPEC-646 · ADR-0112 · cron BUKAN knob. Ia adalah `POST /terminal/sessions` yang ditunda:
    // sebuah baris cron membuat hanoman membuka sesi agen di worktree project, berulang, tanpa
    // manusia di pane. Membiarkannya di `settings` berarti setiap agent token pemegang
    // `settings:write` bisa menjadwalkan sesi tanpa batas — persis kelas eskalasi yang ditutup
    // SPEC-405 untuk `/update/apply` dan ADR-0097/0100 untuk permukaan kredensial. ADR-0099 sudah
    // menetapkan bahwa MCP tak mengekspos tool yang mengeksekusi; cron adalah eksekusi.
    if (seg[1] === "crons") return "COOKIE_ONLY";
    return rw("settings");   // SPEC-294 · sisanya = setelan instance
  }
  // SPEC-409 · ADR-0091 · domain TERSENDIRI. `POST /lead/decisions` adalah endpoint TULIS: ia
  // melahirkan baris jejak permanen dan keputusannya bisa menggerakkan sesi. Capability baca tak
  // pernah cukup untuk memanggilnya (AC-5) — `rw()` sudah menurunkannya dari method, jadi tak ada
  // pengulangan kelas bug SPEC-405 (prefix status yang dipetakan ke GLOBAL_READ tanpa lihat method).
  if (top === "lead") return rw("lead");
  // SPEC-450 · ADR-0094 keputusan 8 · dipetakan MENURUT METHOD, bukan prefix (kelas bug SPEC-405):
  // menulis definisi agen mengubah apa yang dilihat SETIAP sesi baru di seluruh workspace.
  if (top === "custom-agents") return rw("agents");
  // SPEC-477 · ADR-0097 · permukaan KREDENSIAL bukan permukaan kerja sesi operator: ia menyimpan
  // bot token & AgentToken, jadi agent token mana pun (termasuk milik gateway itu sendiri, yang
  // wajib memegang `settings:write`) tak boleh menyentuhnya. Sub-path `/telegram/*` yang lain
  // tetap domain `telegram` seperti ADR-0096.
  if (top === "telegram") {
    const sub = seg[1] ?? "";
    if (sub === "settings" || sub === "test" || sub === "credentials") return "COOKIE_ONLY";
    return rw("telegram");
  }
  // SPEC-481 · ADR-0100 · pengelolaan webhook memegang SECRET penandatanganan dan menentukan ke
  // mana data workspace mengalir keluar. Tak ada capability yang cukup untuk itu — cookie-only,
  // apa pun methodnya (preseden /telegram/{settings,test,credentials}, ADR-0097).
  if (top === "webhooks") return "COOKIE_ONLY";
  if (top === "settings" || top === "config") return rw("settings");
  if (top === "specs") return rw("backlog");
  if (top === "notifications") return rw("notifications");
  if (top === "tickets") return rw("support");   // SPEC-384 · `errors` dicabut (ADR-0092)
  // SPEC-471 · ADR-0095 · triase issue GitHub satu domain dengan tiket: keduanya permukaan
  // masuk yang melahirkan backlog. `rw()` menurunkannya dari method (kelas bug SPEC-405).
  if (top === "github-issues") return rw("support");
  if (top === "vps") return rw("vps");
  if (top === "prds") return rw("docs");
  if (top === "terminal") {
    // SPEC-786 · workspace memuat preferensi per akun dan diturunkan dari req.user.id;
    // capability sesi tak membawa identitas admin yang diperlukan untuk isolasi row ini.
    if (seg[1] === "workspace") return "COOKIE_ONLY";
    if (seg[seg.length - 1] === "ws") return "sessions:write"; // WS = kontrol interaktif
    return rw("sessions");
  }
  if (top === "projects") {
    const sub = seg[2]; // seg[1] = :id
    // SPEC-516 · ADR-0105 · changelog adalah DOKUMEN, sejajar docs/prds. Tanpa baris ini ia jatuh
    // ke `rw("projects")` di bawah — artinya agen harus dipercaya menyunting & menghapus project
    // hanya untuk membaca changelog-nya.
    if (sub === "docs" || sub === "prds" || sub === "changelog") return rw("docs");
    if (sub === "github") return rw("support");   // SPEC-471 · ADR-0095 · tarik/daftar issue
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
