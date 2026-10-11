// SPEC-482 · ADR-0099 · katalog MCP TIDAK boleh menjanjikan capability yang berbeda dari yang
// benar-benar ditegakkan gate `onRequest`. Peta route→capability hidup di server; katalognya di
// shared. Test ini satu-satunya tempat keduanya bertemu — tanpa ini, mengubah salah satu diam-diam
// membuat panel Settings menyuruh manusia mencentang capability yang salah.
import { describe, expect, it } from "vitest";
import { MCP_TOOLS } from "@hanoman/shared";
import { capabilityForRoute, checkAgentCapability } from "../src/services/agent-capabilities";

const withApi = (p: string) => `/api${p}`;

describe("kontrak capability katalog MCP", () => {
  it("capability yang dijanjikan katalog == yang ditegakkan capabilityForRoute", () => {
    for (const t of MCP_TOOLS) {
      if (t.capability === null) continue;
      expect(capabilityForRoute(t.sampleMethod, withApi(t.samplePath)), t.name).toBe(t.capability);
    }
  });

  it("tak ada tool yang mendarat di route cookie-only atau route tak dikenal", () => {
    for (const t of MCP_TOOLS) {
      if (t.capability === null) continue;
      const r = capabilityForRoute(t.sampleMethod, withApi(t.samplePath));
      expect(r, t.name).not.toBe("COOKIE_ONLY");
      expect(r, t.name).not.toBeNull();
    }
  });

  it("hanoman_about hanya menyentuh /api/health yang memang GLOBAL_READ", () => {
    expect(capabilityForRoute("GET", "/api/health")).toBe("GLOBAL_READ");
  });

  // ADR-0099 §4 melarang tool yang menjalankan sesi / menyentuh VPS hadir sama sekali; ADR-0155
  // membalikkannya. Penggantinya bukan pelonggaran, melainkan invarian yang lebih tepat: yang
  // MEMULAI pekerjaan di luar proses hanoman wajib menuntut capability berakses `danger` — yang
  // tak diimplikasikan `:write` mana pun, sehingga token lama tak diam-diam mewarisinya.
  //
  // Mengendalikan sesi yang SUDAH ada (steer/interrupt) sengaja TIDAK termasuk: ia tak memulai apa
  // pun, dan menahannya di `sessions:write` justru inti pemecahan ADR-0155.
  it("yang MEMULAI pekerjaan di luar proses hanoman menuntut capability danger", () => {
    for (const t of MCP_TOOLS) {
      const startsWork =
        t.samplePath === "/terminal/sessions" && t.sampleMethod === "POST" ? "sessions:spawn"
        : /^\/vps\/[^/]+\/(console|session|audit|probe|test|harden|provision|remediate)/.test(t.samplePath) ? "vps:exec"
        : /\/git(\/|$)/.test(t.samplePath) || /branches\/delete|worktrees\/delete/.test(t.samplePath)
          || /^\/specs\/[^/]+\/worktree$/.test(t.samplePath) ? "ide:git"   // ADR-0213 · hapus worktree backlog
        : null;
      if (!startsWork) continue;
      expect(t.capability, t.name).toBe(startsWork);
      expect(t.mode, t.name).toBe("danger");
    }
    // Kontrol positif: peta memang menuntut capability itu, bukan sekadar katalog yang mengklaim.
    expect(capabilityForRoute("POST", "/api/terminal/sessions")).toBe("sessions:spawn");
    expect(capabilityForRoute("POST", "/api/vps/1/console")).toBe("vps:exec");
    expect(capabilityForRoute("POST", "/api/vps/1/run")).toBe("vps:write");
  });

  // SPEC-899 · ADR-0142 · inbox keputusan. ADR-0190 MEMBALIK larangan "tak ada di katalog MCP" —
  // pemilik meminta dialog dibungkus — tetapi pembaliknya bukan pelonggaran: sub-pohon `/dialog`
  // kini capability `sessions:decide` (akses danger; TAK diimplikasikan `sessions:write`) pada
  // SEMUA method, tool-nya bermode danger, dan gerbang self-decision hidup di server
  // (server/test/decision-gate.test.ts). Yang dikunci di sini: peta + katalog tak bisa berselisih.
  it("dialog sesi = sessions:decide pada semua method; tool-nya danger dan hanya tiga", () => {
    expect(capabilityForRoute("GET", "/api/terminal/sessions/s1/dialog")).toBe("sessions:decide");
    expect(capabilityForRoute("POST", "/api/terminal/sessions/s1/dialog/answer")).toBe("sessions:decide");
    expect(capabilityForRoute("POST", "/api/terminal/sessions/s1/dialog/takeover")).toBe("sessions:decide");
    // tetangga dialog TIDAK ikut tergeser (kelas bug SPEC-405: prefix tanpa lihat segmen)
    expect(capabilityForRoute("POST", "/api/terminal/sessions/s1/steer")).toBe("sessions:write");
    expect(capabilityForRoute("GET", "/api/terminal/sessions/s1/phases")).toBe("sessions:read");
    const dialogTools = MCP_TOOLS.filter((t) => /\/dialog/.test(t.samplePath));
    expect(dialogTools.map((t) => t.name).sort()).toEqual([
      "hanoman_session_dialog_answer", "hanoman_session_dialog_get", "hanoman_session_dialog_takeover",
    ]);
    for (const t of dialogTools) {
      expect(t.capability, t.name).toBe("sessions:decide");
      expect(t.mode, t.name).toBe("danger");
    }
    // `sessions:write` — capability yang cukup untuk steer — TIDAK cukup untuk dialog.
    expect(checkAgentCapability(["sessions:write", "sessions:spawn"], "POST", "/api/terminal/sessions/s1/dialog/answer"))
      .toMatchObject({ ok: false, status: 403, need: "sessions:decide" });
    expect(checkAgentCapability(["sessions:decide"], "POST", "/api/terminal/sessions/s1/dialog/answer")).toEqual({ ok: true });
  });

  // ADR-0191 · cron. Capability-nya `scheduler:*`, TIDAK diwarisi `settings:*`; yang mengeksekusi
  // (create/patch/run) dilabeli dalam deskripsi bahwa `sessions:spawn` juga dituntut — penegakannya
  // di handler (server/test/scheduler-cron-gate.test.ts), sebab peta tak melihat body.
  it("cron: scheduler:read|write, bukan settings; tool eksekusi menyebut sessions:spawn", () => {
    expect(checkAgentCapability(["settings:write"], "GET", "/api/scheduler/crons"))
      .toMatchObject({ ok: false, need: "scheduler:read" });
    expect(checkAgentCapability(["scheduler:write"], "GET", "/api/scheduler/crons")).toEqual({ ok: true });
    const cron = MCP_TOOLS.filter((t) => t.samplePath.startsWith("/scheduler/crons"));
    expect(cron.map((t) => t.name).sort()).toEqual([
      "hanoman_scheduler_cron_create", "hanoman_scheduler_cron_delete", "hanoman_scheduler_cron_run",
      "hanoman_scheduler_cron_runs", "hanoman_scheduler_cron_update", "hanoman_scheduler_crons_list",
    ]);
    for (const t of cron) {
      const reads = t.sampleMethod === "GET";
      expect(t.mode, t.name).toBe(reads ? "read" : "danger");
      expect(t.capability, t.name).toBe(reads ? "scheduler:read" : "scheduler:write");
    }
    for (const n of ["hanoman_scheduler_cron_create", "hanoman_scheduler_cron_update", "hanoman_scheduler_cron_run"])
      expect(MCP_TOOLS.find((t) => t.name === n)!.description, n).toContain("sessions:spawn");
  });

  // ADR-0099 §4 dulu melarang tool merge/rebase/hapus/stage hadir sama sekali; ADR-0155
  // membalikkannya. Yang menggantikan larangan itu adalah DUA hal yang lebih kuat, dan keduanya
  // diuji di sini karena berkas inilah tempat katalog bertemu peta capability server:
  //   1. tiap tool semacam itu menuntut capability berakses `danger` — yang tak diimplikasikan
  //      `:write` mana pun, sehingga token lama TIDAK diam-diam mewarisinya;
  //   2. `hanoman_backlog_update` tetap tak bisa menyentuh stage, jadi jalur "tulis biasa" tak
  //      pernah menjadi jalur belakang menuju penghapusan artefak.
  it("tool yang mengeksekusi menuntut capability danger, dan jalur tulis biasa tak jadi pintu belakang", () => {
    const DANGER_CAPS = new Set(["sessions:spawn", "ide:git", "backlog:lifecycle", "vps:exec", "qa:delete"]);
    for (const t of MCP_TOOLS) {
      // Regex vps dipersempit ke sub-path yang benar-benar menyentuh mesin remote: `^/vps`
      // polos ikut mencocokkan daftar & checklist, yang tak mengeksekusi apa pun.
      if (!/integrate|\/git(\/|$)|^\/vps\/[^/]+\/(console|session|audit|probe|test|harden|provision|remediate)/.test(t.samplePath)) continue;
      // DUA pengecualian yang disengaja, keduanya karena capability-nya ditentukan PETA, bukan
      // katalog: `stage_set` digerbangi di handler (bergantung body), dan `session_integrate`
      // hidup di bawah prefix `terminal` sehingga petanya memberi `sessions:write` — tak ada
      // `sessions:integrate`, dan membuatnya akan memecah domain untuk satu endpoint.
      // Keduanya tetap bermode `danger`, jadi tetap hilang dari tingkat default.
      if (t.name === "hanoman_backlog_stage_set" || t.name === "hanoman_session_integrate") {
        expect(t.mode, t.name).toBe("danger");
        continue;
      }
      expect(DANGER_CAPS.has(t.capability ?? ""), t.name).toBe(true);
      expect(t.mode, t.name).toBe("danger");
    }
    const update = MCP_TOOLS.find((t) => t.name === "hanoman_backlog_update")!;
    const body = update.build({ spec: "SPEC-1", title: "x", stage: "objective", confirmDelete: true })?.body as Record<string, unknown>;
    expect(body.stage).toBeUndefined();
    expect(body.confirmDelete).toBeUndefined();
  });
});
