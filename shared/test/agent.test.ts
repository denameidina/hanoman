import { describe, it, expect } from "vitest";
import {
  CAPABILITY_IDS, zCapability, CAPABILITIES, CAPABILITY_DOMAINS, grantsCapability,
  zAgentTokenCreate, zSetting,
} from "../src";

describe("agent capabilities", () => {
  // SPEC-476 · ADR-0096 · +domain `telegram` untuk context/memory/reply/audit gateway → 12 domain.
  // ADR-0155 · domain tak lagi selalu berpasangan read/write: empat domain mendapat akses KETIGA
  // `danger` (sessions, ide, backlog, vps) → 24 + 4 = 28. Karena itu jumlahnya tak bisa lagi
  // diturunkan dari "domain × 2"; ia dihitung dari akses yang benar-benar ada.
  // ADR-0157 · +domain `team` (papan Tim: `/api/tasks` & `/api/members`) → 13 domain, 30 id.
  it("has 13 domains, 30 capability ids across three access levels, all in metadata", () => {
    expect(CAPABILITY_IDS.length).toBe(30);
    expect(new Set(CAPABILITY_IDS).size).toBe(30);
    expect(new Set(CAPABILITIES.map((c) => c.domain)).size).toBe(13);
    expect(CAPABILITIES.filter((c) => c.access === "danger").map((c) => c.id).sort())
      .toEqual(["backlog:lifecycle", "ide:git", "sessions:spawn", "vps:exec"]);
    expect(CAPABILITIES.map((c) => c.id).sort()).toEqual([...CAPABILITY_IDS].sort());
    expect(zCapability.safeParse("projects:read").success).toBe(true);
    expect(zCapability.safeParse("telegram:write").success).toBe(true);
    expect(zCapability.safeParse("nope:read").success).toBe(false);
  });

  it("danger is granted by NOTHING but itself — write must not imply it", () => {
    expect(grantsCapability(["sessions:write"], "sessions:spawn")).toBe(false);
    expect(grantsCapability(["ide:write"], "ide:git")).toBe(false);
    expect(grantsCapability(["backlog:write"], "backlog:lifecycle")).toBe(false);
    expect(grantsCapability(["vps:write"], "vps:exec")).toBe(false);
    expect(grantsCapability(["vps:exec"], "vps:exec")).toBe(true);
    // dan sebaliknya: danger tak memberi baca.
    expect(grantsCapability(["vps:exec"], "vps:read")).toBe(false);
  });

  it("write implies read; unrelated caps do not grant", () => {
    expect(grantsCapability(["projects:write"], "projects:read")).toBe(true);
    expect(grantsCapability(["projects:read"], "projects:write")).toBe(false);
    expect(grantsCapability(["projects:read"], "projects:read")).toBe(true);
    expect(grantsCapability(["backlog:write"], "projects:read")).toBe(false);
    expect(grantsCapability([], "projects:read")).toBe(false);
  });

  it("CAPABILITY_DOMAINS covers every domain exactly once, in grid order", () => {
    const gridDomains = Array.from(new Set(CAPABILITIES.map((c) => c.domain)));
    expect(CAPABILITY_DOMAINS.map((d) => d.domain)).toEqual(gridDomains);
    for (const d of CAPABILITY_DOMAINS) {
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.desc.length).toBeGreaterThan(0);
    }
  });

  // SPEC-264 · grid capability dulu hanya merender slug domain mentah, jadi cakupan tiap domain
  // tak terbaca. SPEC-384 · "error" dicabut dari daftar ini bersama error monitoring (ADR-0092);
  // domain `support` bertahan dan kini bercakupan tiket Help Desk saja.
  it("SPEC-264: PRD & Help Desk terbaca di label/desc domain", () => {
    const blob = CAPABILITY_DOMAINS.map((d) => `${d.label} ${d.desc}`).join(" ").toLowerCase();
    expect(blob).toContain("prd");
    expect(blob).toContain("help desk");
    expect(blob).toContain("tiket");
    expect(blob).not.toContain("error");   // cakupan yang dicabut tak boleh diiklankan kembali
  });

  it("high-risk caps are flagged", () => {
    const risky = CAPABILITIES.filter((c) => c.risk).map((c) => c.id);
    expect(risky).toContain("sessions:write");
    expect(risky).toContain("vps:write");
    // ADR-0155 · keempat capability `danger` wajib bertanda risk; tanpa itu grid Settings
    // merendernya tanpa ⚠ dan pemecahannya kehilangan separuh gunanya.
    for (const id of ["sessions:spawn", "ide:git", "backlog:lifecycle", "vps:exec"])
      expect(risky, id).toContain(id);
  });

  it("zAgentTokenCreate rejects unknown capability and empty name", () => {
    expect(zAgentTokenCreate.safeParse({ name: "bot", capabilities: ["projects:read"] }).success).toBe(true);
    expect(zAgentTokenCreate.safeParse({ name: "bot", capabilities: ["ghost:read"] }).success).toBe(false);
    expect(zAgentTokenCreate.safeParse({ name: "", capabilities: [] }).success).toBe(false);
  });

  it("zSetting defaults agentAccessEnabled to false", () => {
    const s = zSetting.parse({
      model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true,
      notifyFail: true, notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
    });
    expect(s.agentAccessEnabled).toBe(false);
    expect(s.telegram).toEqual({
      enabled: false, progress: true,
      engine: { enabled: false, agent: "claude", model: "claude-opus-5", effort: "xhigh" },
    });
  });
});
