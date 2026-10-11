// SPEC-489 · kendala "satu sumber tulisan" memaksa naskah jadi markdown, jadi tabel capability &
// cookie-only tak bisa DI-RENDER dari katalog seperti WebhookDocs (ADR-0100). Gantinya: katalog
// mengikat naskah lewat test. Katalog bertambah → test merah → naskah ikut diperbarui.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { CAPABILITY_DOMAINS, zSpecSource } from "@hanoman/shared";
import { capabilityForRoute } from "../src/services/agent-capabilities";

const DOC = resolve(dirname(fileURLToPath(import.meta.url)), "../../docs/agent-integration.md");
const doc = readFileSync(DOC, "utf8");

describe("naskah panduan AI agent", () => {
  it("menyebut SETIAP domain capability", () => {
    const hilang = CAPABILITY_DOMAINS.map((d) => d.domain).filter((d) => !doc.includes(`\`${d}\``));
    expect(hilang).toEqual([]);
  });

  it("menyebut SETIAP segmen route cookie-only", () => {
    // Segmen teratas yang gate-nya menjawab COOKIE_ONLY bahkan untuk method BACA (paling ketat).
    // SPEC-617 · ADR-0110 · `portal` & `client-accounts` ikut: keduanya permukaan sesi cookie
    // (portal ber-scope akun, client-accounts memegang kredensial), jadi agen yang mencobanya
    // selalu 403 dan naskah harus mengatakannya.
    // SPEC-919 · ADR-0147 · `presence` ikut: naskah ini ada untuk MENJELASKAN arti 403, jadi 403
    // yang baru tanpa penjelasan meninggalkan agen eksternal tanpa rujukan sama sekali.
    // ADR-0193..0195 · `webhooks` & `client-accounts` KELUAR dari daftar (kini capability opt-in),
    // `portal` hanya cookie-only untuk method TULIS (lihat bawah).
    const kandidat = ["auth", "agent-tokens", "device-tokens", "sync", "presence", "remote-control"];
    // ADR-0196..0198 · `agent-tokens`, `device-tokens`, `presence`, `remote-control`, `logs`, dan
    // `devices` KELUAR dari daftar ini (kini capability opt-in, dijelaskan di §3 dan §5 naskah);
    // `auth` tinggal status/setup/login/logout, dan `session-events` ikut dicatat karena 401-nya
    // perlu penjelasan. Daftar kedua memastikan yang dibuka memang memetakan ke capability.
    const kandidat = ["auth", "sync", "webhooks", "portal", "client-accounts", "session-events"];
    for (const seg of kandidat) expect(capabilityForRoute("GET", `/api/${seg}`)).toBe("COOKIE_ONLY");
    const dibuka: [string, string][] = [
      ["agent-tokens", "tokens:read"], ["device-tokens", "devices:read"], ["presence", "presence:read"],
      ["remote-control", "remote:read"], ["logs", "logs:read"], ["devices/d/relay/x", "relay:exec"],
      ["auth/users", "access:read"],
    ];
    for (const [seg, cap] of dibuka) {
      expect(capabilityForRoute("GET", `/api/${seg}`)).toBe(cap);
      expect(doc, seg).toContain(`/api/${seg.split("/")[0]}`);
    }
    const hilang = kandidat.filter((s) => !doc.includes(`/api/${s}`));
    expect(hilang).toEqual([]);
    // ADR-0193..0195 · yang dulu cookie-only kini capability opt-in, dan naskah wajib menyebutnya.
    expect(capabilityForRoute("GET", "/api/telegram/credentials")).toBe("telegram:admin");
    for (const seg of ["webhooks", "client-accounts", "portal"]) expect(doc).toContain(`/api/${seg}`);
    expect(doc).toContain("/api/telegram/credentials");
    // Tulis ke portal (kirim tiket, mulai/kirim chat) = bertindak SEBAGAI klien: tetap cookie-only.
    expect(capabilityForRoute("POST", "/api/portal/projects/p1/tickets")).toBe("COOKIE_ONLY");
    expect(doc).toContain("`portal:read`");
  });

  it("menyebut SETIAP nilai source backlog di tabel payload", () => {
    const hilang = zSpecSource.options.filter((s) => !doc.includes(`\`${s}\``));
    expect(hilang).toEqual([]);
  });

  it("menyebut ketiga tindakan berbahaya yang wajib konfirmasi manusia", () => {
    for (const p of ["POST /api/terminal/sessions", "/api/vps", "POST /api/lead/decisions"])
      expect(doc).toContain(p);
  });

  it("menyebut jebakan yang sudah diketahui", () => {
    for (const j of ["startable", "q", "id", "stage"]) expect(doc).toContain(`\`${j}\``);
    expect(doc).toContain("GET /api/agent-integration.md");
  });

  // Kendala mutlak: dokumen ini terbit publik. Hanya format/placeholder, tak pernah token nyata.
  it("tak memuat token yang terlihat nyata", () => {
    expect(doc).not.toMatch(/hnm_agt_[0-9a-f]{16,}/);
  });
});
