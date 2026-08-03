import { describe, it, expect, beforeEach } from "vitest";
import { resetDb, makeProject, makeTempRepo, makeSpec } from "./factory";
import { listPrds, readPrd, listAllPrds } from "../src/services/project-prds";

let dir: string;
beforeEach(async () => {
  await resetDb();
  dir = makeTempRepo({
    "docs/prd/jadwal-invoice.md": "# Jadwal Invoice\n\nRingkasan…",
    "docs/prd/notifikasi.md": "# Notifikasi Realtime",
    "internal/docs/README.md": "# idx",
  });
  await makeProject({ id: "p1", repoDir: dir });
});

describe("project-prds (repoDir)", () => {
  it("mendaftar semua docs/prd/*.md dengan judul dari heading", async () => {
    const items = await listPrds("p1", []);
    expect(items.map((i) => i.slug).sort()).toEqual(["jadwal-invoice", "notifikasi"]);
    const inv = items.find((i) => i.slug === "jadwal-invoice")!;
    expect(inv.title).toBe("Jadwal Invoice");
    expect(inv.path).toBe("docs/prd/jadwal-invoice.md");
    expect(inv.name).toBe("jadwal-invoice.md");
    expect(inv.live).toBe(false);
    expect(inv.projectId).toBe("p1");
    expect(inv.projectName).toBe("p1");
  });
  it("judul fallback ke slug bila tanpa heading", async () => {
    const d = makeTempRepo({ "docs/prd/tanpa-heading.md": "isi tanpa judul" });
    await makeProject({ id: "p2", repoDir: d });
    const items = await listPrds("p2", []);
    expect(items[0]!.title).toBe("tanpa-heading");
  });
  it("membaca isi PRD", async () =>
    expect(await readPrd("p1", "docs/prd/jadwal-invoice.md", [])).toContain("Ringkasan"));
  it("null untuk path di luar docs/prd/", async () =>
    expect(await readPrd("p1", "internal/docs/README.md", [])).toBeNull());
  it("[] untuk project tanpa repoDir", async () => {
    await makeProject({ id: "p3", repoDir: null });
    expect(await listPrds("p3", [])).toEqual([]);
  });
});

describe("listAllPrds (lintas-project)", () => {
  it("menggabungkan PRD dari semua project dengan projectId/projectName", async () => {
    // p1 sudah di-seed di beforeEach (2 PRD, name default "p1")
    const d2 = makeTempRepo({ "docs/prd/auth.md": "# Auth Device" });
    await makeProject({ id: "p2", name: "Proyek B", repoDir: d2 });
    const items = await listAllPrds([]);
    expect(items.map((i) => i.slug).sort()).toEqual(["auth", "jadwal-invoice", "notifikasi"]);
    const auth = items.find((i) => i.slug === "auth")!;
    expect(auth.projectId).toBe("p2");
    expect(auth.projectName).toBe("Proyek B");
    expect(items.find((i) => i.slug === "jadwal-invoice")!.projectId).toBe("p1");
  });
  it("project tanpa repoDir tak menyumbang PRD", async () => {
    await makeProject({ id: "p3", name: "Kosong", repoDir: null });
    const items = await listAllPrds([]);
    expect(items.some((i) => i.projectId === "p3")).toBe(false);
  });
});

describe("project-prds (freshest-wins worktree sesi hidup)", () => {
  it("worktree sesi prd hidup menang atas repoDir", async () => {
    const wt = makeTempRepo({ "docs/prd/draft.md": "# Draft Hidup" });
    const fakeSessions = [
      { id: "prd-draft", projectId: "p1", flow: "prd", cwd: wt, exited: false } as any,
    ];
    const items = await listPrds("p1", fakeSessions);
    // draft-nya (worktree) yang tampil, bukan dua PRD repoDir
    expect(items.map((i) => i.slug)).toEqual(["draft"]);
    expect(items[0]!.live).toBe(true);
    expect(await readPrd("p1", "docs/prd/draft.md", fakeSessions)).toContain("Draft Hidup");
  });
  it("sesi prd yang exited TIDAK menang (fallback ke repoDir)", async () => {
    const wt = makeTempRepo({ "docs/prd/draft.md": "# Draft" });
    const dead = [{ id: "prd-draft", projectId: "p1", flow: "prd", cwd: wt, exited: true } as any];
    const items = await listPrds("p1", dead);
    expect(items.map((i) => i.slug).sort()).toEqual(["jadwal-invoice", "notifikasi"]);
  });
});

// SPEC-520 · status PRD = nilai turunan dari backlog yang lahir darinya (ADR-0018/0019).
describe("status PRD turunan", () => {
  const fromPrd = (id: string, prd: string, stage: string) =>
    makeSpec({ id, projectId: "p1", stage,
      payload: { context: `Dari PRD: ${prd}`, outcome: "", constraints: "", priority: "sedang" } });

  it("PRD tanpa backlog turunan → draft", async () => {
    const items = await listPrds("p1", []);
    const inv = items.find((i) => i.slug === "jadwal-invoice")!;
    expect(inv.status).toBe("draft");
    expect(inv.specCount).toBe(0);
    expect(inv.doneCount).toBe(0);
  });

  it("ada turunan belum semuanya done → dieskalasi + hitungan", async () => {
    await fromPrd("SPEC-1", "docs/prd/jadwal-invoice.md", "done");
    await fromPrd("SPEC-2", "docs/prd/jadwal-invoice.md", "executing");
    const items = await listPrds("p1", []);
    const inv = items.find((i) => i.slug === "jadwal-invoice")!;
    expect(inv).toMatchObject({ status: "dieskalasi", specCount: 2, doneCount: 1 });
    // PRD tetangga di project yang sama tak ikut terwarnai
    expect(items.find((i) => i.slug === "notifikasi")!.status).toBe("draft");
  });

  it("semua turunan done → terwujud", async () => {
    await fromPrd("SPEC-3", "docs/prd/notifikasi.md", "done");
    await fromPrd("SPEC-4", "docs/prd/notifikasi.md", "done");
    const items = await listPrds("p1", []);
    expect(items.find((i) => i.slug === "notifikasi")!)
      .toMatchObject({ status: "terwujud", specCount: 2, doneCount: 2 });
  });

  it("jalur goal (ADR-0089) & breakdown (ADR-0069) ikut terhitung", async () => {
    await makeSpec({ id: "SPEC-5", projectId: "p1", stage: "done", source: "goal",
      payload: { goal: "Wujudkan PRD docs/prd/jadwal-invoice.md", done: "", constraints: "", priority: "sedang" } });
    await makeSpec({ id: "SPEC-6", projectId: "p1", stage: "done",
      payload: { context: "Dari PRD (breakdown): docs/prd/jadwal-invoice.md\n\nScope A",
        outcome: "", constraints: "", priority: "sedang" } });
    const items = await listPrds("p1", []);
    expect(items.find((i) => i.slug === "jadwal-invoice")!)
      .toMatchObject({ status: "terwujud", specCount: 2, doneCount: 2 });
  });

  it("backlog project LAIN tak mewarnai status", async () => {
    const d2 = makeTempRepo({ "docs/prd/jadwal-invoice.md": "# Jadwal Invoice (project lain)" });
    await makeProject({ id: "p2", name: "Proyek B", repoDir: d2 });
    await makeSpec({ id: "SPEC-7", projectId: "p2", stage: "done",
      payload: { context: "Dari PRD: docs/prd/jadwal-invoice.md", outcome: "", constraints: "", priority: "sedang" } });
    const p1 = await listPrds("p1", []);
    expect(p1.find((i) => i.slug === "jadwal-invoice")!.status).toBe("draft");
    const p2 = await listPrds("p2", []);
    expect(p2.find((i) => i.slug === "jadwal-invoice")!).toMatchObject({ status: "terwujud", specCount: 1 });
  });

  it("listAllPrds memberi status yang benar untuk tiap project", async () => {
    const d2 = makeTempRepo({ "docs/prd/auth.md": "# Auth Device" });
    await makeProject({ id: "p2", name: "Proyek B", repoDir: d2 });
    await fromPrd("SPEC-8", "docs/prd/jadwal-invoice.md", "planned");
    await makeSpec({ id: "SPEC-9", projectId: "p2", stage: "done",
      payload: { context: "Dari PRD: docs/prd/auth.md", outcome: "", constraints: "", priority: "sedang" } });
    const items = await listAllPrds([]);
    expect(items.find((i) => i.slug === "jadwal-invoice")!.status).toBe("dieskalasi");
    expect(items.find((i) => i.slug === "auth")!.status).toBe("terwujud");
    expect(items.find((i) => i.slug === "notifikasi")!.status).toBe("draft");
  });
});
