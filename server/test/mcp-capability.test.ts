// SPEC-482 · ADR-0099 · katalog MCP TIDAK boleh menjanjikan capability yang berbeda dari yang
// benar-benar ditegakkan gate `onRequest`. Peta route→capability hidup di server; katalognya di
// shared. Test ini satu-satunya tempat keduanya bertemu — tanpa ini, mengubah salah satu diam-diam
// membuat panel Settings menyuruh manusia mencentang capability yang salah.
import { describe, expect, it } from "vitest";
import { MCP_TOOLS } from "@hanoman/shared";
import { capabilityForRoute } from "../src/services/agent-capabilities";

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

  it("tak ada tool yang bisa menjalankan sesi atau menyentuh VPS", () => {
    for (const t of MCP_TOOLS) {
      expect(t.samplePath, t.name).not.toMatch(/^\/vps/);
      if (t.samplePath.startsWith("/terminal")) expect(t.sampleMethod, t.name).toBe("GET");
    }
    // Kontrol positif: kalau seseorang menambahkannya kelak, peta memang menuntutnya.
    // ADR-0155 · sejak pemecahan akses `danger`, yang dituntut BUKAN lagi `sessions:write` —
    // `sessions:write` hanya cukup untuk mengendalikan sesi yang SUDAH ada. Membuka sesi baru
    // menuntut `sessions:spawn`, yang tak diimplikasikan capability mana pun.
    expect(capabilityForRoute("POST", "/api/terminal/sessions")).toBe("sessions:spawn");
    expect(capabilityForRoute("POST", "/api/vps/1/run")).toBe("vps:write");
  });

  // SPEC-899 · ADR-0142 · inbox keputusan. Dua sifatnya dikunci sekaligus: capability-nya
  // diturunkan dari METHOD (bukan dari prefix — kelas bug SPEC-405), dan ia TAK ADA di katalog MCP.
  // Yang terakhir bukan kelalaian: agen yang bisa menjawab `AskUserQuestion` bisa menjawab
  // pertanyaannya sendiri, dan gerbang "manusia terakhir yang memutuskan" runtuh lewat pintu itu.
  it("dialog sesi memakai capability sessions menurut method, dan tak muncul di katalog MCP", () => {
    expect(capabilityForRoute("GET", "/api/terminal/sessions/s1/dialog")).toBe("sessions:read");
    expect(capabilityForRoute("POST", "/api/terminal/sessions/s1/dialog/answer")).toBe("sessions:write");
    for (const t of MCP_TOOLS) expect(t.samplePath, t.name).not.toMatch(/\/dialog/);
  });

  // ADR-0099 §4 dulu melarang tool merge/rebase/hapus/stage hadir sama sekali; ADR-0155
  // membalikkannya. Yang menggantikan larangan itu adalah DUA hal yang lebih kuat, dan keduanya
  // diuji di sini karena berkas inilah tempat katalog bertemu peta capability server:
  //   1. tiap tool semacam itu menuntut capability berakses `danger` — yang tak diimplikasikan
  //      `:write` mana pun, sehingga token lama TIDAK diam-diam mewarisinya;
  //   2. `hanoman_backlog_update` tetap tak bisa menyentuh stage, jadi jalur "tulis biasa" tak
  //      pernah menjadi jalur belakang menuju penghapusan artefak.
  it("tool yang mengeksekusi menuntut capability danger, dan jalur tulis biasa tak jadi pintu belakang", () => {
    const DANGER_CAPS = new Set(["sessions:spawn", "ide:git", "backlog:lifecycle", "vps:exec"]);
    for (const t of MCP_TOOLS) {
      if (!/integrate|\/git(\/|$)|^\/vps/.test(t.samplePath)) continue;
      // `stage_set` adalah pengecualian yang DISENGAJA: gerbangnya di handler, bukan di peta.
      if (t.name === "hanoman_backlog_stage_set") continue;
      expect(DANGER_CAPS.has(t.capability ?? ""), t.name).toBe(true);
      expect(t.mode, t.name).toBe("danger");
    }
    const update = MCP_TOOLS.find((t) => t.name === "hanoman_backlog_update")!;
    const body = update.build({ spec: "SPEC-1", title: "x", stage: "objective", confirmDelete: true })?.body as Record<string, unknown>;
    expect(body.stage).toBeUndefined();
    expect(body.confirmDelete).toBeUndefined();
  });
});
