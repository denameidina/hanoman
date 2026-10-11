import { describe, it, expect } from "vitest";
import { capabilityForRoute, checkAgentCapability } from "../src/services/agent-capabilities";

describe("capabilityForRoute", () => {
  const cases: [string, string, unknown][] = [
    ["GET", "/api/projects", "projects:read"],
    ["POST", "/api/projects", "projects:write"],
    ["GET", "/api/projects/foo", "projects:read"],
    ["POST", "/api/projects/foo/rename", "projects:write"],
    ["GET", "/api/projects/foo/branches", "projects:read"],
    // SPEC-360 · `branches` SENGAJA bukan anggota IDE_SUBS: baris di atas sudah memetakan ke
    // projects:read, dan memasukkannya ke IDE_SUBS akan diam-diam mengubah endpoint lama itu.
    ["GET", "/api/projects/foo/branches/unused", "projects:read"],
    // ADR-0155 · PINDAH dari projects:write → ide:git: menghapus branch menghancurkan pekerjaan
    // yang tak dipegang berkas mana pun. Daftar branch di atas TETAP projects:read.
    ["POST", "/api/projects/foo/branches/delete", "ide:git"],
    ["PUT", "/api/projects/foo/binding", "projects:write"],
    ["GET", "/api/projects/foo/docs/README.md", "docs:read"],
    ["PUT", "/api/projects/foo/docs/x.md", "docs:write"],
    ["GET", "/api/projects/foo/prds", "docs:read"],
    ["GET", "/api/prds", "docs:read"],
    ["GET", "/api/projects/foo/tree", "ide:read"],
    // ADR-0155 · PINDAH dari ide:write → ide:git.
    ["POST", "/api/projects/foo/git", "ide:git"],
    ["GET", "/api/projects/foo/status", "ide:read"],
    ["POST", "/api/projects/foo/remotes", "ide:write"],
    // ADR-0121 · operasi berkas Explorer. Diturunkan DARI METHOD, bukan dari prefix.
    ["POST", "/api/projects/foo/entry", "ide:write"],
    ["PATCH", "/api/projects/foo/entry", "ide:write"],
    ["DELETE", "/api/projects/foo/entry", "ide:write"],
    ["POST", "/api/projects/foo/upload", "ide:write"],
    ["GET", "/api/specs", "backlog:read"],
    ["POST", "/api/specs", "backlog:write"],
    // ADR-0155 · PINDAH dari backlog:write → backlog:lifecycle.
    ["POST", "/api/specs/SPEC-1/integrate", "backlog:lifecycle"],
    ["GET", "/api/terminal/sessions", "sessions:read"],
    // ADR-0155 · PINDAH dari sessions:write → sessions:spawn. Baris GET di atas tak tersentuh.
    ["POST", "/api/terminal/sessions", "sessions:spawn"],
    ["GET", "/api/terminal/sessions/abc/ws", "sessions:write"], // WS = kontrol interaktif
    ["GET", "/api/terminal/workspace", "COOKIE_ONLY"],
    ["PUT", "/api/terminal/workspace", "COOKIE_ONLY"],
    // SPEC-742 · ADR-0116 · route baru di bawah /terminal ikut capability `sessions` yang sudah
    // ada — nol domain baru, nol perubahan gerbang. Diikat di sini supaya tetap begitu.
    ["GET", "/api/terminal/cleanups", "sessions:read"],
    ["GET", "/api/vps", "vps:read"],
    // ADR-0155 · PINDAH dari vps:write → vps:exec: harden menjalankan perintah di mesin remote.
    ["POST", "/api/vps/v1/harden", "vps:exec"],
    ["GET", "/api/settings", "settings:read"],
    ["PUT", "/api/settings", "settings:write"],
    ["GET", "/api/config", "settings:read"],
    ["GET", "/api/tickets", "support:read"],
    ["POST", "/api/tickets/t1/accept", "support:write"],
    ["GET", "/api/notifications", "notifications:read"],
    ["POST", "/api/notifications/read", "notifications:write"],
    ["GET", "/api/limits", "GLOBAL_READ"],
    ["GET", "/api/update", "GLOBAL_READ"],
    ["GET", "/api/events/ws", "GLOBAL_READ"],
    ["GET", "/api/fs/browse", "GLOBAL_READ"],
    // ADR-0187 · properti MESIN, bukan akun: baca terbuka, tulis tetap cookie-only.
    ["GET", "/api/models", "GLOBAL_READ"],
    ["GET", "/api/methods/status", "GLOBAL_READ"],
    ["GET", "/api/codex/version", "GLOBAL_READ"],
    ["POST", "/api/models", "COOKIE_ONLY"],
    ["POST", "/api/methods/status", "COOKIE_ONLY"],
    ["PUT", "/api/codex/version", "COOKIE_ONLY"],
    // ADR-0188 · log aktivitas MENURUT METHOD: DELETE = purge yang menyeberang lewat sync.
    ["GET", "/api/session-results", "activity:read"],
    ["DELETE", "/api/session-results", "activity:write"],
    // ADR-0189 · chat portal sisi OPERATOR. `/api/portal/**` (sesi cookie klien) tetap cookie-only.
    ["GET", "/api/portal-chat/sessions", "portal-chat:read"],
    ["GET", "/api/portal-chat/sessions/s1", "portal-chat:read"],
    ["GET", "/api/portal-chat/export", "portal-chat:read"],
    ["POST", "/api/portal-chat/sessions/s1/prd", "portal-chat:write"],
    ["POST", "/api/portal/projects/p1/chat/sessions/s1/messages", "COOKIE_ONLY"],
    // ADR-0196 · dulu COOKIE_ONLY; kini capability baru yang opt-in, menurut METHOD.
    ["GET", "/api/auth/users", "access:read"],
    ["POST", "/api/auth/users", "access:admin"],
    ["DELETE", "/api/auth/users/u1", "access:admin"],
    ["POST", "/api/auth/change-password", "access:admin"],
    ["GET", "/api/agent-tokens", "tokens:read"],
    ["GET", "/api/agent-tokens/capabilities", "tokens:read"],
    ["POST", "/api/agent-tokens", "tokens:write"],
    ["PATCH", "/api/agent-tokens/t1", "tokens:write"],
    ["DELETE", "/api/agent-tokens/t1", "tokens:write"],
    ["GET", "/api/device-tokens", "devices:read"],
    ["POST", "/api/device-tokens", "devices:write"],
    ["DELETE", "/api/device-tokens/d1", "devices:write"],
    // Yang TETAP cookie-only karena tak bisa dibungkus secara teknis.
    ["GET", "/api/auth/status", "COOKIE_ONLY"],
    ["POST", "/api/auth/setup", "COOKIE_ONLY"],
    ["POST", "/api/auth/login", "COOKIE_ONLY"],
    ["POST", "/api/auth/logout", "COOKIE_ONLY"],
    ["GET", "/api/sync/pull", "COOKIE_ONLY"],
    // SPEC-909 · ADR-0146 · memalsukan "sesi X bertanya Y" bukan capability, itu peniruan identitas.
    ["POST", "/api/session-events", "COOKIE_ONLY"],
    // ADR-0197 · SPEC-919 · peta pekerjaan lintas mesin kini `presence:read` (hanya GET).
    ["GET", "/api/presence", "presence:read"],
    ["POST", "/api/presence", "COOKIE_ONLY"],
    // SPEC-1215 · ADR-0165 §4 · ADR-0197 · baca grant ≠ mengubahnya (RCE → `remote:control`).
    ["GET", "/api/remote-control", "remote:read"],
    ["PUT", "/api/remote-control", "remote:control"],
    ["GET", "/api/logs", "logs:read"],
    ["GET", "/api/logs/12/transcript", "logs:read"],
    ["GET", "/api/logs/retention", "logs:read"],
    ["PUT", "/api/logs/retention", "logs:write"],
    // ADR-0198 · metrik & disposisi custom agent: domain `metrics`, bukan `agents`.
    ["GET", "/api/custom-agents/metrics", "metrics:read"],
    ["PATCH", "/api/custom-agents/invocations/i1", "metrics:write"],
    ["GET", "/api/custom-agents", "agents:read"],
    ["GET", "/api/nonsense", null],
  ];
  it.each(cases)("%s %s → %s", (m, p, want) => {
    expect(capabilityForRoute(m, p)).toBe(want);
  });

  // SPEC-1216 · ADR-0165 §4 · `/devices/:id/relay/*` menjalankan aksi sesi di mesin lain atas nama
  // operator — eskalasi RCE lintas mesin. ADR-0197 membukanya HANYA lewat capability tersendiri
  // `relay:exec` (danger, tak diimplikasikan apa pun) untuk SEMUA method — membaca isi sesi mesin
  // lain pun sensitif — dan memisahkannya dari `remote:control` (grant mesin INI).
  it("top devices → relay:exec untuk semua method (ADR-0197)", () => {
    expect(capabilityForRoute("GET", "/api/devices/dev1/relay/terminal/sessions")).toBe("relay:exec");
    expect(capabilityForRoute("POST", "/api/devices/dev1/relay/specs/x/done")).toBe("relay:exec");
    expect(capabilityForRoute("DELETE", "/api/devices/dev1/relay/x")).toBe("relay:exec");
    expect(checkAgentCapability(["sessions:spawn", "remote:control", "sessions:write"], "POST", "/api/devices/dev1/relay/terminal/sessions"))
      .toMatchObject({ ok: false, need: "relay:exec" });
    expect(checkAgentCapability(["relay:exec"], "POST", "/api/devices/dev1/relay/terminal/sessions")).toEqual({ ok: true });
  });

  // ADR-0196..0198 · capability admin opt-in: TAK ADA capability lama yang membukanya, dan
  // `:write`-nya tak mengimplikasikan danger di domain lain.
  it("capability lama tak membuka permukaan admin (opt-in sungguhan)", () => {
    const old = ["settings:write", "agents:write", "sessions:write", "sessions:spawn", "vps:exec", "projects:write",
      "backlog:lifecycle", "lead:write", "telegram:write", "ide:git"];
    for (const [m, p] of [
      ["GET", "/api/agent-tokens"], ["POST", "/api/agent-tokens"], ["GET", "/api/device-tokens"],
      ["GET", "/api/auth/users"], ["POST", "/api/auth/users"], ["POST", "/api/auth/change-password"],
      ["GET", "/api/remote-control"], ["PUT", "/api/remote-control"], ["GET", "/api/logs"],
      ["PUT", "/api/logs/retention"], ["GET", "/api/presence"], ["GET", "/api/custom-agents/metrics"],
      ["PATCH", "/api/custom-agents/invocations/i"], ["POST", "/api/devices/d/relay/terminal/sessions"],
    ] as const) expect(checkAgentCapability(old, m, p), `${m} ${p}`).toMatchObject({ ok: false, reason: "capability" });
    // sebaliknya: tokens:write TIDAK membuka akun, relay, atau kendali jarak jauh
    for (const [m, p] of [
      ["POST", "/api/auth/users"], ["PUT", "/api/remote-control"], ["POST", "/api/devices/d/relay/x"],
    ] as const) expect(checkAgentCapability(["tokens:write", "devices:write", "logs:write"], m, p).ok, `${m} ${p}`).toBe(false);
  });

  it("agents:write (definisi agen) tak membuka disposisi metrik, dan metrics:write tak membuka definisi agen", () => {
    expect(checkAgentCapability(["agents:write"], "PATCH", "/api/custom-agents/invocations/i")).toMatchObject({ ok: false, need: "metrics:write" });
    expect(checkAgentCapability(["metrics:write"], "POST", "/api/custom-agents")).toMatchObject({ ok: false, need: "agents:write" });
    expect(checkAgentCapability(["metrics:write"], "GET", "/api/custom-agents/metrics")).toEqual({ ok: true });
  });

  // SPEC-471 · ADR-0095 · triase issue satu domain dengan tiket; dipetakan MENURUT METHOD
  // (kelas bug SPEC-405: prefix status yang lolos GLOBAL_READ tanpa melihat method).
  it("SPEC-471 · github-issues & projects/:id/github → domain support per-method", () => {
    expect(capabilityForRoute("GET", "/api/projects/p/github/issues")).toBe("support:read");
    expect(capabilityForRoute("POST", "/api/projects/p/github/pull")).toBe("support:write");
    expect(capabilityForRoute("GET", "/api/github-issues")).toBe("support:read");
    expect(capabilityForRoute("POST", "/api/github-issues/x/accept")).toBe("support:write");
  });

});

describe("checkAgentCapability", () => {
  it("allows when granted, write covers read, denies otherwise", () => {
    expect(checkAgentCapability(["projects:read"], "GET", "/api/projects")).toEqual({ ok: true });
    expect(checkAgentCapability(["projects:write"], "GET", "/api/projects")).toEqual({ ok: true });
    expect(checkAgentCapability(["projects:read"], "POST", "/api/projects"))
      .toMatchObject({ ok: false, status: 403, need: "projects:write", reason: "capability" });
    expect(checkAgentCapability(["projects:read"], "POST", "/api/auth/login"))
      .toMatchObject({ ok: false, status: 403, reason: "cookie-only" });
    expect(checkAgentCapability(["projects:read"], "GET", "/api/nonsense"))
      .toMatchObject({ ok: false, status: 403, reason: "cookie-only" });
    // GLOBAL_READ: token dengan capability apa pun boleh
    expect(checkAgentCapability(["projects:read"], "GET", "/api/limits")).toEqual({ ok: true });
  });
});

describe("status global read-only tak boleh tembus lewat method tulis (SPEC-405 · ADR-0088)", () => {
  it("GET /api/update tetap lolos tanpa capability apa pun", () => {
    expect(capabilityForRoute("GET", "/api/update")).toBe("GLOBAL_READ");
    expect(checkAgentCapability([], "GET", "/api/update")).toEqual({ ok: true });
  });
  // ADR-0200 · membalik bagian SPEC-405: `POST /update/apply` kini terjangkau agent token, TAPI hanya
  // lewat capability danger `instance:admin` — capability lain (termasuk yang paling berkuasa) tetap ditolak.
  it("POST /api/update/apply menuntut instance:admin — capability lain TIDAK cukup", () => {
    expect(capabilityForRoute("POST", "/api/update/apply")).toBe("instance:admin");
    const caps = ["backlog:write", "sessions:write", "sessions:spawn", "settings:write", "projects:write", "vps:exec", "ide:git"];
    expect(checkAgentCapability(caps, "POST", "/api/update/apply")).toMatchObject({ ok: false, status: 403, need: "instance:admin" });
    expect(checkAgentCapability(["instance:admin"], "POST", "/api/update/apply")).toEqual({ ok: true });
  });
  it("POST /api/restart menuntut instance:admin; metode lain & sub-path tetap cookie-only", () => {
    expect(capabilityForRoute("POST", "/api/restart")).toBe("instance:admin");
    expect(capabilityForRoute("GET", "/api/restart")).toBe("COOKIE_ONLY");
    expect(capabilityForRoute("POST", "/api/restart/now")).toBe("COOKIE_ONLY");
    expect(capabilityForRoute("GET", "/api/update/apply")).toBe("GLOBAL_READ");   // method baca tetap status (kelas SPEC-405 tertutup di sisi sebaliknya)
    expect(capabilityForRoute("POST", "/api/update")).toBe("COOKIE_ONLY");
    expect(checkAgentCapability(["instance:admin"], "GET", "/api/restart")).toMatchObject({ ok: false, reason: "cookie-only" });
  });
  it("prefix status lain ikut: POST /api/limits & /api/health ditolak", () => {
    expect(capabilityForRoute("POST", "/api/limits")).toBe("COOKIE_ONLY");
    expect(capabilityForRoute("POST", "/api/health")).toBe("COOKIE_ONLY");
  });
  it("HEAD dianggap baca", () => {
    expect(capabilityForRoute("HEAD", "/api/update")).toBe("GLOBAL_READ");
  });
  // SPEC-477 · ADR-0097 · permukaan KREDENSIAL bukan permukaan kerja sesi operator.
  // ADR-0193 membalik "cookie-only" itu menjadi capability BARU `telegram:admin` (danger).
  it("ADR-0193 · settings/test/credentials Telegram = telegram:admin, sisanya tetap domain telegram", () => {
    expect(capabilityForRoute("GET", "/api/telegram/settings")).toBe("telegram:admin");
    expect(capabilityForRoute("PUT", "/api/telegram/settings")).toBe("telegram:admin");
    expect(capabilityForRoute("POST", "/api/telegram/test")).toBe("telegram:admin");
    expect(capabilityForRoute("DELETE", "/api/telegram/credentials")).toBe("telegram:admin");
    expect(capabilityForRoute("GET", "/api/telegram/status")).toBe("telegram:read");
    expect(capabilityForRoute("POST", "/api/telegram/replies")).toBe("telegram:write");
    expect(capabilityForRoute("GET", "/api/telegram/audit")).toBe("telegram:read");
  });
});

// ADR-0157 · papan Tim TERBUKA bagi agent token lewat domain `team` — membalik keputusan
// ADR-0150 yang membiarkannya jatuh ke `null`. Yang dijaga di sini tiga hal, dan yang KETIGA yang
// paling mudah rusak: bentuk 3-segmen (`/tasks/:id/escalate`) harus ikut domainnya, bukan diam-diam
// jatuh ke cabang lain — pola `IDE_SUBS` & `seg[1] === "crons"` adalah cara paling lazim sebuah
// sub-path menyimpang dari induknya.
describe("papan tim = domain capability `team`", () => {
  const paths = ["/api/members", "/api/members/a@x.id", "/api/tasks", "/api/tasks/t1",
    "/api/tasks/t1/escalate"];

  for (const p of paths) {
    it(`GET ${p} → team:read`, () => expect(capabilityForRoute("GET", p)).toBe("team:read"));
    for (const m of ["POST", "PATCH", "PUT", "DELETE"])
      it(`${m} ${p} → team:write`, () => expect(capabilityForRoute(m, p)).toBe("team:write"));
  }

  it("token backlog/support penuh TIDAK menjangkau papan tim — domainnya memang terpisah", () => {
    const r = checkAgentCapability(["backlog:write", "support:write"], "POST", "/api/tasks");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.need).toBe("team:write");
    expect(!r.ok && r.reason).toBe("capability");
  });

  it("`team:read` tak cukup untuk menulis, `team:write` mencakup baca", () => {
    expect(checkAgentCapability(["team:read"], "POST", "/api/tasks").ok).toBe(false);
    expect(checkAgentCapability(["team:read"], "GET", "/api/tasks").ok).toBe(true);
    expect(checkAgentCapability(["team:write"], "GET", "/api/members").ok).toBe(true);
    expect(checkAgentCapability(["team:write"], "DELETE", "/api/tasks/t1").ok).toBe(true);
  });

  // Sisi yang selalu perlu dijaga saat sebuah top-segment baru lahir: tetangganya tak ikut.
  it("segmen lain tak ikut terseret oleh cabang baru", () => {
    expect(capabilityForRoute("GET", "/api/specs")).toBe("backlog:read");
    expect(capabilityForRoute("GET", "/api/tickets")).toBe("support:read");
    expect(capabilityForRoute("POST", "/api/terminal/sessions")).toBe("sessions:spawn");
  });
});

// ADR-0155 · empat operasi dipecah dari `:write` ke capability berakses `danger`. Test ini menjaga
// DUA sisi sekaligus: yang berbahaya benar-benar pindah, DAN tetangganya yang tak berbahaya tidak
// ikut pindah. Sisi kedua itu yang paling mudah rusak — cabang berbasis prefix (kelas bug SPEC-405)
// selalu menyeret lebih banyak dari yang dimaksud.
describe("route berbahaya pindah ke capability danger", () => {
  it("membuka sesi BARU ≠ mengendalikan sesi yang sudah ada", () => {
    expect(capabilityForRoute("POST", "/api/terminal/sessions")).toBe("sessions:spawn");
    expect(capabilityForRoute("GET", "/api/terminal/sessions")).toBe("sessions:read");
    for (const sub of ["steer", "interrupt", "integrate"])
      expect(capabilityForRoute("POST", `/api/terminal/sessions/s1/${sub}`), sub).toBe("sessions:write");
    // ADR-0190 · dialog pindah dari sessions:write → sessions:decide (semua method, termasuk baca).
    for (const sub of ["dialog/answer", "dialog/takeover"])
      expect(capabilityForRoute("POST", `/api/terminal/sessions/s1/${sub}`), sub).toBe("sessions:decide");
    expect(capabilityForRoute("GET", "/api/terminal/sessions/s1/dialog")).toBe("sessions:decide");
    expect(capabilityForRoute("DELETE", "/api/terminal/sessions/s1")).toBe("sessions:write");
    // Panjang segmen PERSIS, bukan prefix: `/terminal/sessions/:id/…` berawalan sama.
    expect(capabilityForRoute("POST", "/api/terminal/sessions/s1/attachments")).toBe("sessions:write");
  });

  it("git yang mengubah sejarah / menghapus ≠ menulis berkas working tree", () => {
    for (const p of ["git", "git/merge", "git/rebase", "git/pull", "git/drop"])
      expect(capabilityForRoute("POST", `/api/projects/p/${p}`), p).toBe("ide:git");
    expect(capabilityForRoute("POST", "/api/projects/p/branches/delete")).toBe("ide:git");
    expect(capabilityForRoute("POST", "/api/projects/p/worktrees/delete")).toBe("ide:git");
    // ADR-0213 · hapus worktree satu backlog item = aksi yang sama, BUKAN `backlog:write` hasil rw().
    expect(capabilityForRoute("DELETE", "/api/specs/SPEC-1/worktree")).toBe("ide:git");
    // Menulis berkas TIDAK ikut pindah.
    expect(capabilityForRoute("PUT", "/api/projects/p/file")).toBe("ide:write");
    expect(capabilityForRoute("POST", "/api/projects/p/entry")).toBe("ide:write");
    expect(capabilityForRoute("POST", "/api/projects/p/remotes")).toBe("ide:write");
  });

  it("SELURUH pembacaan tak tersentuh pemecahan ini", () => {
    expect(capabilityForRoute("GET", "/api/projects/p/worktrees")).toBe("ide:read");
    expect(capabilityForRoute("GET", "/api/projects/p/worktrees/stats")).toBe("ide:read");
    // ADR-0213 · review tetap pembacaan backlog; hapus item penuh tetap `backlog:lifecycle`.
    expect(capabilityForRoute("GET", "/api/specs/SPEC-1/review")).toBe("backlog:read");
    expect(capabilityForRoute("DELETE", "/api/specs/SPEC-1")).toBe("backlog:lifecycle");
    expect(capabilityForRoute("GET", "/api/projects/p/status")).toBe("ide:read");
    // `branches` BUKAN anggota IDE_SUBS dan tak dijadikan anggota: daftar branch adalah permukaan
    // project (projects.ts), bukan IDE. Hanya `branches/delete` yang pindah, karena ia merusak.
    expect(capabilityForRoute("GET", "/api/projects/p/branches")).toBe("projects:read");
    expect(capabilityForRoute("GET", "/api/projects/p/branches/unused")).toBe("projects:read");
  });

  it("siklus hidup backlog ≠ menyunting backlog", () => {
    expect(capabilityForRoute("DELETE", "/api/specs/SPEC-1")).toBe("backlog:lifecycle");
    expect(capabilityForRoute("POST", "/api/specs/SPEC-1/integrate")).toBe("backlog:lifecycle");
    expect(capabilityForRoute("POST", "/api/specs")).toBe("backlog:write");
    expect(capabilityForRoute("POST", "/api/specs/SPEC-1/done")).toBe("backlog:write");
    expect(capabilityForRoute("DELETE", "/api/specs/SPEC-1/attachments/a1")).toBe("backlog:write");
    // PATCH tetap `backlog:write` DI SINI. Cabang `{stage}` hidup di handler routes/specs.ts,
    // karena keputusannya bergantung body dan fungsi ini sengaja tak pernah melihat body.
    expect(capabilityForRoute("PATCH", "/api/specs/SPEC-1")).toBe("backlog:write");
  });

  it("remote exec VPS ≠ mengelola daftar & checklist VPS", () => {
    for (const p of ["console", "session", "harden", "test", "probe", "audit",
      "provision", "provision/preview", "remediate", "remediate/preview"])
      expect(capabilityForRoute("POST", `/api/vps/v1/${p}`), p).toBe("vps:exec");
    expect(capabilityForRoute("GET", "/api/vps")).toBe("vps:read");
    expect(capabilityForRoute("POST", "/api/vps")).toBe("vps:write");
    expect(capabilityForRoute("PATCH", "/api/vps/v1")).toBe("vps:write");
    expect(capabilityForRoute("DELETE", "/api/vps/v1")).toBe("vps:write");
    expect(capabilityForRoute("GET", "/api/vps/components")).toBe("vps:read");
    expect(capabilityForRoute("GET", "/api/vps/v1/checklist")).toBe("vps:read");
    expect(capabilityForRoute("POST", "/api/vps/v1/items/i1/na")).toBe("vps:write");
    expect(capabilityForRoute("POST", "/api/vps/v1/items/na-bulk")).toBe("vps:write");
    expect(capabilityForRoute("POST", "/api/vps/v1/items/i1/attest")).toBe("vps:write");
  });

  it("403 menyebut capability yang kurang, bukan sekadar cookie-only", () => {
    const r = checkAgentCapability(["sessions:write"], "POST", "/api/terminal/sessions");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe("capability");
    expect(!r.ok && r.need).toBe("sessions:spawn");
  });

  it("capability danger memang membuka pintunya", () => {
    expect(checkAgentCapability(["sessions:spawn"], "POST", "/api/terminal/sessions").ok).toBe(true);
    expect(checkAgentCapability(["ide:git"], "POST", "/api/projects/p/git/merge").ok).toBe(true);
    expect(checkAgentCapability(["vps:exec"], "POST", "/api/vps/v1/console").ok).toBe(true);
    expect(checkAgentCapability(["backlog:lifecycle"], "DELETE", "/api/specs/SPEC-1").ok).toBe(true);
  });
});

// ADR-0199 · `sync` DIBELAH. Tiga permukaan UI dibuka lewat capability opt-in; kanal mesin-ke-mesin
// (device-token) TETAP cookie-only. Dicocokkan ke method + PANJANG segmen, jadi tetangga sepasang
// (pull/push/logs/ws…) tak ikut terseret — kelas bug SPEC-405 untuk prefix.
describe("sync UI = capability sync:*, kanal mesin-ke-mesin tetap cookie-only (ADR-0199)", () => {
  it("tiga permukaan UI dipetakan menurut method", () => {
    expect(capabilityForRoute("POST", "/api/sync/now")).toBe("sync:write");
    expect(capabilityForRoute("GET", "/api/sync/conflicts")).toBe("sync:read");
    expect(capabilityForRoute("GET", "/api/sync/pending")).toBe("sync:read");
    expect(capabilityForRoute("POST", "/api/sync/conflicts/spec/SPEC-1/resolve")).toBe("sync:resolve");
  });

  it("method/segmen yang menyimpang jatuh ke cookie-only, bukan ke capability tetangganya", () => {
    expect(capabilityForRoute("GET", "/api/sync/now")).toBe("COOKIE_ONLY");
    expect(capabilityForRoute("POST", "/api/sync/pending")).toBe("COOKIE_ONLY");
    expect(capabilityForRoute("POST", "/api/sync/conflicts")).toBe("COOKIE_ONLY");
    expect(capabilityForRoute("GET", "/api/sync/conflicts/spec/SPEC-1/resolve")).toBe("COOKIE_ONLY");
    expect(capabilityForRoute("POST", "/api/sync/conflicts/spec/SPEC-1")).toBe("COOKIE_ONLY");
    expect(capabilityForRoute("GET", "/api/sync")).toBe("COOKIE_ONLY");
  });

  it("kanal mesin-ke-mesin & tiket WS TIDAK terjangkau capability apa pun", () => {
    const all = ["sync:read", "sync:write", "sync:resolve", "instance:admin", "settings:write", "projects:write"];
    for (const [m, p] of [
      ["GET", "/api/sync/pull"], ["GET", "/api/sync/bootstrap"], ["POST", "/api/sync/push"],
      ["POST", "/api/sync/logs"], ["GET", "/api/sync/attachments/k"], ["GET", "/api/sync/qa-attachments/i"],
      ["PUT", "/api/sync/qa-attachments/i"], ["GET", "/api/sync/ws"], ["GET", "/api/sync/relay/ws"],
      ["POST", "/api/ws-tickets"],
    ] as const) {
      expect(checkAgentCapability(all, m, p), `${m} ${p}`).toMatchObject({ ok: false, status: 403, reason: "cookie-only" });
    }
  });

  it("sync:write TIDAK memutuskan konflik, dan sync:resolve TIDAK membaca antrean", () => {
    expect(checkAgentCapability(["sync:write"], "POST", "/api/sync/conflicts/spec/SPEC-1/resolve"))
      .toMatchObject({ ok: false, status: 403, need: "sync:resolve" });
    expect(checkAgentCapability(["sync:resolve"], "GET", "/api/sync/conflicts"))
      .toMatchObject({ ok: false, status: 403, need: "sync:read" });
    expect(checkAgentCapability(["sync:write"], "GET", "/api/sync/conflicts").ok).toBe(true);   // write ⊇ read
    expect(checkAgentCapability(["sync:read"], "POST", "/api/sync/now"))
      .toMatchObject({ ok: false, status: 403, need: "sync:write" });
  });

  it("panduan agen publik dipetakan GLOBAL_READ hanya untuk method baca", () => {
    expect(capabilityForRoute("GET", "/api/agent-integration.md")).toBe("GLOBAL_READ");
    expect(capabilityForRoute("POST", "/api/agent-integration.md")).toBe("COOKIE_ONLY");
  });

  it("Help Center publik tak mendapat capability: bypass gerbang, bukan domain agen (ADR-0201)", () => {
    expect(capabilityForRoute("GET", "/api/help/p1")).toBeNull();
    expect(capabilityForRoute("POST", "/api/help/p1/tickets")).toBeNull();
  });
});
