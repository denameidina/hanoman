import { describe, it, expect, beforeEach } from "vitest";
import { generateChangelog, CHANGELOG_TIMEOUT_MS } from "../src/services/changelog/generate";
import { resetDb, makeProject, makeSpec, makeRepoWithTags } from "./factory";

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0);

beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
  await makeSpec({ id: "SPEC-1", projectId: "p1", stage: "done",
    title: "Laporan bisa diunduh", objective: "Pemakai mengunduh sendiri.", doneAt: at(2026, 7, 10) });
});

describe("generateChangelog", () => {
  it("memakai keluaran agen saat agen berhasil", async () => {
    const think = async () => "# Changelog — Juli\n\n- **Laporan** — bisa diunduh sendiri.\n";
    const r = await generateChangelog("p1", { mode: "backlog", from: "2026-07-01", to: "2026-07-31" }, { think });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.generator).toBe("agent");
    expect(r.row.warning).toBeNull();
    expect(r.row.body).toContain("Laporan");
    expect(r.row.itemCount).toBe(1);
    expect(r.row.mode).toBe("backlog");
  });

  it("men-scrub keluaran agen yang masih bocor teknis", async () => {
    const think = async () => "# Changelog\n\n- Perbaikan pada `pty.ts` (b89f8fe) sesuai SPEC-511\n";
    const r = await generateChangelog("p1", { mode: "backlog", from: "2026-07-01", to: "2026-07-31" }, { think });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.body).not.toMatch(/pty\.ts|b89f8fe|SPEC-511/);
  });

  it("agen gagal → draf deterministik + warning, BUKAN galat", async () => {
    const think = async () => { throw new Error("lead claude kehabisan waktu 180000 ms"); };
    const r = await generateChangelog("p1", { mode: "backlog", from: "2026-07-01", to: "2026-07-31" }, { think });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.generator).toBe("fallback");
    expect(r.row.warning).toContain("kehabisan waktu");
    expect(r.row.body).toContain("Laporan bisa diunduh");
  });

  it("agen memulangkan teks kosong → fallback", async () => {
    const think = async () => "   \n";
    const r = await generateChangelog("p1", { mode: "backlog", from: "2026-07-01", to: "2026-07-31" }, { think });
    expect(r.ok && r.row.generator).toBe("fallback");
  });

  // Deterministik tanpa membekukan jam: item disemai pada HARI INI, lalu judulnya dibandingkan
  // dengan `defaultRange(new Date())` yang sama. Menyandarkan test pada tanggal tetap (mis. Juli
  // 2026) akan berubah verdict-nya seiring waktu berjalan.
  it("tanpa rentang → memakai 30 hari terakhir", async () => {
    const { defaultRange } = await import("@hanoman/shared");
    const d = defaultRange(new Date());
    await makeSpec({ id: "SPEC-BARU", projectId: "p1", stage: "done",
      title: "Perubahan terbaru", objective: "Terasa langsung.", doneAt: new Date() });
    const think = async () => "# Changelog\n\n- apa saja\n";
    const r = await generateChangelog("p1", { mode: "backlog" }, { think });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.title).toBe(`${d.from} – ${d.to}`);
  });

  it("catatan cakupan masuk ke warning meski agen berhasil", async () => {
    await makeSpec({ id: "SPEC-2", projectId: "p1", stage: "done", title: "Tanpa stempel", doneAt: null });
    const think = async () => "# Changelog\n\n- apa saja\n";
    const r = await generateChangelog("p1", { mode: "backlog", from: "2026-07-01", to: "2026-07-31" }, { think });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.generator).toBe("agent");
    expect(r.row.warning).toMatch(/tanpa stempel/i);
  });

  it("mode version memakai repo project", async () => {
    const dir = makeRepoWithTags({ "v1.0.0": ["fitur satu"], "v1.1.0": ["fitur dua"] });
    await makeProject({ id: "p2", name: "p2", repoDir: dir });
    const think = async () => "# Changelog — v1.1.0\n\n- **Fitur dua** — tersedia.\n";
    const r = await generateChangelog("p2", { mode: "version", toTag: "v1.1.0" }, { think });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.mode).toBe("version");
    expect(r.row.title).toBe("v1.1.0");
  });

  it("keadaan sah yang bukan galat dipulangkan sebagai reason", async () => {
    await makeProject({ id: "p3", name: "p3", repoDir: null });
    const r = await generateChangelog("p3", { mode: "commit", fromSha: "aaaa", toSha: "bbbb" }, { think: async () => "x" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/belum ditautkan/i);
  });

  it("anggaran waktu default 180 detik", () => {
    expect(CHANGELOG_TIMEOUT_MS).toBe(180_000);
  });
});
