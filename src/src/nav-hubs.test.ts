import { describe, expect, it } from "vitest";
import { HN_NAV } from "./ds/shell";
import {
  HN_GROUPS, HN_HUBS, PALETTE_ONLY_SECTIONS, hubBadge, hubOf, hubTarget, sectionsOf, tabOf, tabsOf,
} from "./nav-hubs";
import { EMPTY_PENDING } from "@hanoman/shared";

const hub = (key: string) => {
  const h = HN_HUBS.find((x) => x.key === key);
  if (!h) throw new Error(`hub ${key} tak ada`);
  return h;
};
const ALL_ON = { clients: true };
const CLIENTS_OFF = { clients: false };

describe("nav-hubs · bentuk daftar", () => {
  it("delapan hub, masing-masing di salah satu dari tiga grup", () => {
    expect(HN_HUBS.map((h) => h.key)).toEqual(["overview", "projects", "backlog", "triage", "sesi", "otonom", "skills", "pengaturan"]);
    const groups = HN_GROUPS.map((g) => g.key);
    for (const h of HN_HUBS) expect(groups, h.key).toContain(h.group);
    expect(HN_GROUPS.map((g) => g.label)).toEqual(["Kerja", "Otomasi", "Sistem"]);
  });

  it("kunci hub unik, dan tiap hub punya minimal satu tab", () => {
    expect(new Set(HN_HUBS.map((h) => h.key)).size).toBe(HN_HUBS.length);
    for (const h of HN_HUBS) expect(h.children.length, h.key).toBeGreaterThan(0);
  });

  it("`default` adalah tab hub itu sendiri dan tak bergerbang", () => {
    for (const h of HN_HUBS) {
      const def = h.children.find((c) => c.section === h.default);
      expect(def, `${h.key}.default`).toBeDefined();
      expect(def?.gate, `${h.key}.default bergerbang`).toBeUndefined();
    }
  });
});

describe("nav-hubs · tak ada section yatim", () => {
  // Kontrak utama ADR-0205: setiap section di HN_NAV (rute yang valid) harus bisa dicapai — lewat
  // tab sebuah hub, atau lewat palet bila memang sengaja di luar sidebar. Tak boleh ada yang diam.
  it("setiap section HN_NAV dimiliki sebuah hub, atau tercatat sebagai palet-saja", () => {
    const owned = new Set(HN_HUBS.flatMap((h) => sectionsOf(h)));
    for (const n of HN_NAV) {
      const reachable = owned.has(n.key) || PALETTE_ONLY_SECTIONS.includes(n.key);
      expect(reachable, `section ${n.key} yatim`).toBe(true);
    }
  });

  it("palet-saja hanya berisi section yang benar-benar ada di HN_NAV dan tak dimiliki hub", () => {
    for (const key of PALETTE_ONLY_SECTIONS) {
      expect(HN_NAV.some((n) => n.key === key), key).toBe(true);
      expect(hubOf(key), key).toBeUndefined();
    }
  });

  it("satu section hanya dimiliki satu hub", () => {
    const all = HN_HUBS.flatMap((h) => sectionsOf(h));
    expect(new Set(all).size).toBe(all.length);
  });

  it("setiap tab hub adalah entri HN_NAV dengan gerbang yang sama", () => {
    for (const h of HN_HUBS) {
      for (const c of h.children) {
        const nav = HN_NAV.find((n) => n.key === c.section);
        expect(nav, `tab ${c.section} tak ada di HN_NAV`).toBeDefined();
        expect(c.gate, `gerbang tab ${c.section}`).toBe(nav?.gate);
      }
    }
  });

  it("turunan hub adalah section yang tak ada di HN_NAV dan menunjuk ke tab milik hub yang sama", () => {
    for (const h of HN_HUBS) {
      for (const d of h.derived ?? []) {
        expect(HN_NAV.some((n) => n.key === d.section), d.section).toBe(false);
        expect(h.children.some((c) => c.section === d.under), `${d.section} → ${d.under}`).toBe(true);
      }
    }
  });
});

describe("nav-hubs · hubOf / tabOf / sectionsOf", () => {
  it("hubOf menemukan hub dari tab maupun turunan", () => {
    expect(hubOf("ide")?.key).toBe("projects");
    expect(hubOf("project")?.key).toBe("projects");
    expect(hubOf("review")?.key).toBe("backlog");
    expect(hubOf("clients")?.key).toBe("sesi");
    expect(hubOf("settings")?.key).toBe("pengaturan");
  });

  it("hubOf tak menemukan apa pun untuk dalang, rute kosong, atau section tak dikenal", () => {
    expect(hubOf("dalang")).toBeUndefined();
    expect(hubOf("")).toBeUndefined();
    expect(hubOf(null)).toBeUndefined();
    expect(hubOf("runs")).toBeUndefined();
  });

  it("tabOf: tab mewakili dirinya, turunan mewakili induknya", () => {
    expect(tabOf("team")).toBe("team");
    expect(tabOf("project")).toBe("projects");
    expect(tabOf("review")).toBe("backlog");
    expect(tabOf("dalang")).toBeUndefined();
  });

  it("sectionsOf: semua section milik hub, lewat kunci atau objeknya", () => {
    expect(sectionsOf("projects")).toEqual(["projects", "prd", "docs", "qa", "ide", "project"]);
    expect(sectionsOf(hub("backlog"))).toEqual(["backlog", "team", "review"]);
    expect(sectionsOf("tidak-ada")).toEqual([]);
  });
});

describe("nav-hubs · tabsOf dan hubTarget", () => {
  it("tabsOf menyaring tab bergerbang sesuai gerbang yang aktif", () => {
    expect(tabsOf(hub("sesi"), ALL_ON).map((c) => c.section)).toEqual(["terminal", "clients"]);
    expect(tabsOf(hub("sesi"), CLIENTS_OFF).map((c) => c.section)).toEqual(["terminal"]);
  });

  it("tanpa riwayat, klik hub mendarat di default-nya", () => {
    expect(hubTarget(hub("projects"), {}, ALL_ON)).toBe("projects");
    expect(hubTarget(hub("backlog"), {}, ALL_ON)).toBe("backlog");
  });

  it("riwayat tab dipakai selama tab itu masih tampil", () => {
    expect(hubTarget(hub("projects"), { projects: "prd" }, ALL_ON)).toBe("prd");
    expect(hubTarget(hub("backlog"), { backlog: "team" }, ALL_ON)).toBe("team");
  });

  it("riwayat yang bergerbang atau bukan tab hub itu jatuh ke default", () => {
    expect(hubTarget(hub("sesi"), { sesi: "clients" }, CLIENTS_OFF)).toBe("terminal");
    expect(hubTarget(hub("backlog"), { backlog: "ide" }, ALL_ON)).toBe("backlog");
    expect(hubTarget(hub("backlog"), { backlog: "review" }, ALL_ON)).toBe("backlog");
  });

  it("riwayat klien dipakai bila gerbangnya menyala", () => {
    expect(hubTarget(hub("sesi"), { sesi: "clients" }, ALL_ON)).toBe("clients");
  });

  it("riwayat hub lain tak ikut terbawa", () => {
    expect(hubTarget(hub("projects"), { backlog: "team" }, ALL_ON)).toBe("projects");
  });
});

describe("nav-hubs · hubBadge", () => {
  it("angka hub = jumlah antrean tab yang tampil; nol tak dirender", () => {
    expect(hubBadge(hub("projects"), { ...EMPTY_PENDING, prd: 2 }, ALL_ON)).toBe(2);
    expect(hubBadge(hub("projects"), EMPTY_PENDING, ALL_ON)).toBeUndefined();
    expect(hubBadge(hub("projects"), null, ALL_ON)).toBeUndefined();
  });

  it("hub Backlog menanggung antrean Spec; Tugas manusia tak punya angka sendiri", () => {
    expect(hubBadge(hub("backlog"), { ...EMPTY_PENDING, backlog: 12 }, ALL_ON)).toBe(12);
  });

  it("hub Otonom menanggung Lead; Scheduler tak punya antrean keputusan", () => {
    expect(hubBadge(hub("otonom"), { ...EMPTY_PENDING, lead: 3 }, ALL_ON)).toBe(3);
  });
});
