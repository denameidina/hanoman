import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { SYNCED, isEntity, snapshot } from "../src/services/sync";
import { listOutbox } from "../src/services/outbox";

const app = buildApp({ requireAuth: false });
const clean = async () => { await prisma.syncOutbox.deleteMany(); };
beforeEach(clean); afterAll(clean);

describe("sync exclusions — preferensi lokal tak tersync (SPEC-213 AC-30)", () => {
  it("SYNCED excludes settings/notification/deviceToken/localBinding", () => {
    for (const e of ["setting", "notification", "deviceToken", "localBinding", "session", "user", "syncOutbox"]) {
      expect(SYNCED as readonly string[]).not.toContain(e);
      expect(isEntity(e)).toBe(false);
    }
  });

  it("SYNCED is exactly the authoritative entities (SPEC-272: +ticketAttachment; SPEC-384: −errorGroup; SPEC-450: +customAgent; SPEC-471: +githubIssue; SPEC-945: +member, +task)", () => {
    // SPEC-450 · ADR-0094 · `customAgent` ikut menyeberang: katalog persona adalah pengetahuan
    // bersama, dan id-nya deterministik justru supaya dua mesin yang membuat nama sama bertemu
    // sebagai SATU baris di sini, bukan dua yang saling menelan di objek JSON berkunci nama.
    // SPEC-471 · ADR-0095 · `githubIssue` mengikuti pola yang sama: cermin issue + keputusan
    // triase-nya adalah pengetahuan bersama, id-nya deterministik "<projectId>:<slug>#<n>".
    // SPEC-945 · ADR-0150 · `member` & `task` ikut: papan tim adalah pengetahuan bersama, dan
    // `Member.id` deterministik dari email dengan alasan yang sama persis.
    expect([...SYNCED].sort()).toEqual(
      ["customAgent", "githubIssue", "member", "project", "sessionResult", "spec", "task", "ticket", "ticketAttachment", "vps"],
    );
  });

  // SPEC-384 · ADR-0092 · errorGroup dicabut dari record-sync bersama error monitoring. Klien
  // versi lama bisa saja masih mendorongnya; yang benar adalah menolaknya sebagai kind tak
  // dikenal, bukan menerimanya ke tabel yang sudah tak ada.
  it("errorGroup bukan lagi entity ter-sync", () => {
    expect(SYNCED as readonly string[]).not.toContain("errorGroup");
    expect(isEntity("errorGroup")).toBe(false);
    expect(isEntity("ticket")).toBe(true);   // kontrol negatif: tiket tetap tersync
  });

  it("mutating settings does NOT enqueue outbox (settings are per-device)", async () => {
    // baca lalu tulis kembali settings via route yang ada
    const get = await app.inject({ method: "GET", url: "/api/settings" });
    expect(get.statusCode).toBe(200);
    const put = await app.inject({ method: "PUT", url: "/api/settings", payload: get.json() });
    expect([200, 204]).toContain(put.statusCode);
    expect(await listOutbox()).toHaveLength(0);
  });

  it("snapshot of an unknown/local-only entity is null (guarded)", async () => {
    // @ts-expect-error — sengaja entity tak dikenal
    expect(await snapshot("setting", "1").catch(() => null)).toBeNull();
  });
});
