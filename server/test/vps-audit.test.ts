import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  parseAudit, isHardened, parseHealth, CRITICAL, mapToCatalog, parseStack, scriptPath,
  shouldPublishHealth, PUBLISH_HEARTBEAT_MS,
} from "../src/services/vps-audit";
import { CATALOG } from "../src/vps/catalog/catalog";

const PASS_ALL = [
  "CHECK sudo_ok pass root", "CHECK os_supported pass ubuntu 24.04",
  "CHECK ssh_root_login pass", "CHECK ssh_password_auth pass",
  "CHECK firewall pass ufw active", "CHECK fail2ban pass aktif",
  "CHECK auto_updates pass unattended-upgrades",
].join("\n");

describe("parser audit (SPEC-164)", () => {
  it("parse baris CHECK, abaikan noise", () => {
    const out = "Warning: banner\n" + PASS_ALL + "\nCHECK ntp warn NTP tidak aktif\nbukan check\n";
    const checks = parseAudit(out);
    expect(checks.length).toBe(8);
    expect(checks[0]).toEqual({ check: "sudo_ok", status: "pass", detail: "root" });
    expect(checks.at(-1)).toEqual({ check: "ntp", status: "warn", detail: "NTP tidak aktif" });
  });
  it("hardened hanya bila SEMUA check kritis pass", () => {
    expect(isHardened(parseAudit(PASS_ALL))).toBe(true);
    expect(isHardened(parseAudit(PASS_ALL.replace("CHECK firewall pass ufw active", "CHECK firewall fail ufw tidak aktif")))).toBe(false);
    // warn pada check non-kritis tidak menghalangi
    expect(isHardened(parseAudit(PASS_ALL + "\nCHECK open_ports warn 0.0.0.0:5432"))).toBe(true);
    // check kritis yang HILANG = belum hardened
    expect(isHardened(parseAudit(PASS_ALL.split("\n").slice(0, 5).join("\n")))).toBe(false);
  });
  it("CRITICAL memuat 7 check sesuai spec", () => {
    expect([...CRITICAL]).toEqual(["sudo_ok", "os_supported", "ssh_root_login",
      "ssh_password_auth", "firewall", "fail2ban", "auto_updates"]);
  });
  it("parseHealth", () => {
    const h = parseHealth("HEALTH uptime up 3 days\nHEALTH disk 42%\nHEALTH mem 512/2048MB\nHEALTH load 0.1 0.2 0.3\n");
    expect(h).toEqual({ uptime: "up 3 days", disk: "42%", mem: "512/2048MB", load: "0.1 0.2 0.3" });
    expect(parseHealth("motd sampah\n")).toBeNull();
  });
});

describe("mapping katalog (SPEC-220)", () => {
  it("parse baris CHECK itemId termasuk status na", () => {
    const checks = parseAudit("CHECK fw-b1 pass\nCHECK ssh-b3 fail x\nCHECK fw-i4 na tak ada IPv6\n");
    expect(checks.find((c) => c.check === "fw-b1")?.status).toBe("pass");
    expect(checks.find((c) => c.check === "fw-i4")?.status).toBe("na");
  });
  it("itemId asing/legacy diabaikan aman (AC-3), tidak crash", () => {
    const m = mapToCatalog([
      { check: "sudo_ok", status: "pass", detail: "" },   // legacy → bukan katalog
      { check: "tidak-ada", status: "pass", detail: "" },  // asing
      { check: "fw-b1", status: "pass", detail: "" },       // katalog
    ]);
    expect(m["sudo_ok"]).toBeUndefined();
    expect(m["tidak-ada"]).toBeUndefined();
    expect(m["fw-b1"]).toBe("pass");
  });
  it("probe fail tetap fail — tak pernah dianggap pass (AC-7)", () => {
    expect(mapToCatalog([{ check: "ssh-b3", status: "fail", detail: "" }])["ssh-b3"]).toBe("fail");
  });
  it("probe status na → unknown (bukan pass)", () => {
    expect(mapToCatalog([{ check: "fw-i4", status: "na", detail: "" }])["fw-i4"]).toBe("unknown");
  });
  it("setiap item probe:true punya emitter di audit.sh (tak ada probe-mati)", () => {
    const sh = readFileSync(scriptPath("audit.sh"), "utf8");
    const missing = CATALOG.filter((c) => c.probe).map((c) => c.id).filter((id) => !sh.includes(id));
    expect(missing).toEqual([]);
  });
});

describe("parseStack (SPEC-221)", () => {
  it("parse STACK present/absent, abaikan noise", () => {
    const d = parseStack("STACK webserver absent tak ada\nSTACK database present db\nnoise line\n");
    expect(d.webserver).toEqual({ present: false, detail: "tak ada" });
    expect(d.database).toEqual({ present: true, detail: "db" });
    expect(d.noise).toBeUndefined();
  });
  it("output tanpa STACK → objek kosong", () => {
    expect(parseStack("CHECK fw-b1 pass\n")).toEqual({});
  });
});

describe("SPEC-885 · keputusan publish health", () => {
  const now = Date.parse("2026-08-22T12:00:00.000Z");
  const health = { uptime: "1d", disk: "40%", mem: "50%", load: "0.1" };

  it("health identik + baru saja dipublish → JANGAN publish", () => {
    expect(shouldPublishHealth(
      { health, lastPublishedAt: new Date(now - 60_000) }, health, now,
    )).toBe(false);
  });

  it("health berubah → publish, seberapa pun baru publikasi terakhir", () => {
    expect(shouldPublishHealth(
      { health, lastPublishedAt: new Date(now - 1_000) }, { ...health, disk: "91%" }, now,
    )).toBe(true);
  });

  it("health identik tapi publikasi terakhir sudah lewat ambang → publish (denyut berjangka)", () => {
    expect(shouldPublishHealth(
      { health, lastPublishedAt: new Date(now - PUBLISH_HEARTBEAT_MS - 1) }, health, now,
    )).toBe(true);
  });

  it("belum pernah dipublish → publish", () => {
    expect(shouldPublishHealth({ health, lastPublishedAt: null }, health, now)).toBe(true);
    expect(shouldPublishHealth(null, health, now)).toBe(true);
  });
});
