import { describe, expect, it, vi } from "vitest";
import { HN_NAV } from "../ds/shell";
import { fuzzyScore, normalizeText } from "./fuzzy";
import {
  buildPaletteCommands, flattenResults, pushRecent, searchCommands, SEARCH_CAP,
  type PaletteCommand, type PaletteSource,
} from "./commands";

function source(over: Partial<PaletteSource> = {}) {
  const fns = {
    go: vi.fn(), openSpec: vi.fn(), openSession: vi.fn(), newSpec: vi.fn(),
    newProject: vi.fn(), setScope: vi.fn(), setPetOn: vi.fn(),
  };
  const src: PaletteSource = {
    nav: HN_NAV,
    gates: { clients: false },
    projects: [{ id: "erp", name: "ERP Tumbuh" }, { id: "crm", name: "CRM" }],
    specs: [{ id: "SPEC-1", title: "Login ulang", projectId: "erp" }, { id: "SPEC-2", title: "Ekspor laporan", projectId: "crm" }],
    waiting: [],
    scope: "all",
    petOn: false,
    ...fns,
    ...over,
  };
  return { src, fns };
}

const byId = (cmds: PaletteCommand[], id: string) => {
  const c = cmds.find((x) => x.id === id);
  if (!c) throw new Error(`perintah ${id} tidak ada`);
  return c;
};

describe("fuzzy · skor berurutan", () => {
  it("kueri kosong cocok dengan apa pun", () => {
    expect(fuzzyScore("   ", "Backlog")).toBe(0);
  });

  it("huruf berurutan cocok, urutan terbalik tidak", () => {
    expect(fuzzyScore("bkl", "Backlog")).not.toBeNull();
    expect(fuzzyScore("gb", "Backlog")).toBeNull();
  });

  it("substring utuh mengalahkan kecocokan berpencar", () => {
    const utuh = fuzzyScore("back", "Backlog")!;
    const berpencar = fuzzyScore("bkl", "Backlog")!;
    expect(utuh).toBeGreaterThan(berpencar);
  });

  it("kecocokan di awal kata mengalahkan kecocokan di tengah kata", () => {
    expect(fuzzyScore("set", "Settings")!).toBeGreaterThan(fuzzyScore("set", "Upset")!);
  });

  it("tanpa membedakan huruf besar dan diakritik", () => {
    expect(normalizeText("Čari Ekspor")).toBe("cari ekspor");
    expect(fuzzyScore("CARI", "čari")).not.toBeNull();
  });

  it("setiap kata kueri wajib ditemukan", () => {
    expect(fuzzyScore("backlog erp", "Backlog · ERP Tumbuh")).not.toBeNull();
    expect(fuzzyScore("backlog zz", "Backlog · ERP Tumbuh")).toBeNull();
  });
});

describe("buildPaletteCommands", () => {
  it("setiap entri HN_NAV tanpa gerbang muncul sebagai 'Pindah ke' dan menjalankan go(key)", () => {
    const { src, fns } = source();
    const cmds = buildPaletteCommands(src);
    for (const n of HN_NAV.filter((x) => !x.gate)) {
      byId(cmds, `nav:${n.key}`).run();
      expect(fns.go).toHaveBeenLastCalledWith(n.key);
    }
  });

  it("layar bergerbang disembunyikan ketika gerbangnya mati, dan muncul ketika hidup", () => {
    expect(buildPaletteCommands(source().src).some((c) => c.id === "nav:clients")).toBe(false);
    const on = buildPaletteCommands(source({ gates: { clients: true } }).src);
    expect(on.some((c) => c.id === "nav:clients")).toBe(true);
  });

  // ADR-0205 · Dalang tak lagi di sidebar; aksi ini satu-satunya pintu yang diberi nama.
  it("'Buka panggung' membuka Dalang dan tak bergantung pada gerbang apa pun", () => {
    const { src, fns } = source({ gates: {} });
    byId(buildPaletteCommands(src), "action:panggung").run();
    expect(fns.go).toHaveBeenLastCalledWith("dalang");
  });

  it("'Jawab sesi yang menunggu' nonaktif tanpa sesi menunggu dan membuka sesi pertama bila ada", () => {
    const empty = buildPaletteCommands(source().src);
    expect(byId(empty, "action:answer").disabled).toBe(true);

    const { src, fns } = source({ waiting: [{ id: "s1", label: "SPEC-1" }, { id: "s2", label: "SPEC-2" }] });
    const cmds = buildPaletteCommands(src);
    const answer = byId(cmds, "action:answer");
    expect(answer.disabled).toBeFalsy();
    expect(answer.hint).toBe("2 sesi");
    answer.run();
    expect(fns.openSession).toHaveBeenCalledWith("s1");
    expect(byId(cmds, "wait:s2").label).toBe("Jawab · SPEC-2");
  });

  it("Tampilkan/Sembunyikan Hanoman: hanya satu yang tampil, menurut keadaan pet sekarang", () => {
    const off = buildPaletteCommands(source({ petOn: false }).src);
    expect(off.some((c) => c.id === "action:pet-hide")).toBe(false);
    const { src, fns } = source({ petOn: false });
    byId(buildPaletteCommands(src), "action:pet-show").run();
    expect(fns.setPetOn).toHaveBeenLastCalledWith(true);

    const on = source({ petOn: true });
    expect(buildPaletteCommands(on.src).some((c) => c.id === "action:pet-show")).toBe(false);
    byId(buildPaletteCommands(on.src), "action:pet-hide").run();
    expect(on.fns.setPetOn).toHaveBeenLastCalledWith(false);
  });

  it("aksi buat backlog, project baru, pengaturan, dan spec memanggil fungsi sumbernya", () => {
    const { src, fns } = source();
    const cmds = buildPaletteCommands(src);
    byId(cmds, "action:new-spec").run();
    byId(cmds, "action:new-project").run();
    byId(cmds, "action:settings").run();
    byId(cmds, "spec:SPEC-2").run();
    expect(fns.newSpec).toHaveBeenCalledOnce();
    expect(fns.newProject).toHaveBeenCalledOnce();
    expect(fns.go).toHaveBeenCalledWith("settings");
    expect(fns.openSpec).toHaveBeenCalledWith("SPEC-2");
  });

  it("'Ganti project aktif' hanya mengisi kueri; project aktif tak bisa dipilih ulang", () => {
    const { src, fns } = source({ scope: "erp" });
    const cmds = buildPaletteCommands(src);
    expect(byId(cmds, "action:scope").prefill).toBe("project ");
    expect(byId(cmds, "action:scope").hint).toBe("ERP Tumbuh");
    expect(byId(cmds, "scope:erp").disabled).toBe(true);
    byId(cmds, "scope:crm").run();
    expect(fns.setScope).toHaveBeenCalledWith("crm");
  });
});

describe("searchCommands", () => {
  const { src } = source({ waiting: [{ id: "s1", label: "SPEC-1" }] });
  const cmds = buildPaletteCommands(src);

  it("kueri kosong: Riwayat dulu, lalu grup pembuka; Backlog dan Project tak tampil", () => {
    const res = searchCommands(cmds, "", ["nav:backlog", "tidak-ada"]);
    expect(res.map((g) => g.group)).toEqual(["Riwayat", "Menunggu kamu", "Aksi", "Pindah ke"]);
    expect(res[0]!.items.map((i) => i.cmd.id)).toEqual(["nav:backlog"]);
  });

  it("riwayat dibatasi lima dan hanya memuat perintah yang masih ada", () => {
    const ids = ["nav:overview", "nav:projects", "nav:prd", "nav:backlog", "nav:team", "nav:qa"];
    const res = searchCommands(cmds, "", ids);
    expect(res[0]!.items).toHaveLength(5);
  });

  it("kueri terisi mencari di label dan kata kunci, diurutkan skor, dipangkas per grup daftar panjang", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `spec:X-${i}`, group: "Backlog" as const, label: `X-${i} · tugas`, keywords: "spec backlog", run: () => undefined,
    }));
    const res = searchCommands([...cmds, ...many], "spec");
    const backlog = res.find((g) => g.group === "Backlog")!;
    expect(backlog.items).toHaveLength(SEARCH_CAP);
  });

  it("'settings' menemukan 'Buka pengaturan' dan 'Pindah ke Settings' lewat kata kunci", () => {
    const ids = flattenResults(searchCommands(cmds, "settings")).map((c) => c.id);
    expect(ids).toContain("action:settings");
    expect(ids).toContain("nav:settings");
  });

  it("kueri tanpa cocokan mengembalikan daftar kosong", () => {
    expect(searchCommands(cmds, "zzzqqq")).toEqual([]);
  });

  it("pushRecent: terbaru di depan, tanpa duplikat, maksimum lima", () => {
    expect(pushRecent(["a", "b"], "b")).toEqual(["b", "a"]);
    expect(pushRecent(["a", "b", "c", "d", "e"], "f")).toEqual(["f", "a", "b", "c", "d"]);
  });
});

describe("palet menjangkau semua layar HN_NAV", () => {
  it("setiap layar bisa dibuka lewat palet, baik dengan nama maupun dengan kueri pencarian", () => {
    const { src, fns } = source({ gates: { clients: true } });
    const cmds = buildPaletteCommands(src);
    for (const n of HN_NAV) {
      const cmd = byId(cmds, `nav:${n.key}`);
      cmd.run();
      expect(fns.go).toHaveBeenLastCalledWith(n.key);
      const found = flattenResults(searchCommands(cmds, n.label)).map((c) => c.id);
      expect(found, `kueri "${n.label}"`).toContain(`nav:${n.key}`);
    }
  });

  it("layar bergerbang tak tercapai saat gerbangnya mati", () => {
    const cmds = buildPaletteCommands(source({ gates: { clients: false } }).src);
    const gated = HN_NAV.filter((n) => n.gate).map((n) => n.key);
    expect(gated.length).toBeGreaterThan(0);
    for (const key of gated) expect(cmds.some((c) => c.id === `nav:${key}`)).toBe(false);
  });
});
