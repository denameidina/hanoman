/* SPEC-647 · ADR-0107 · `limit` TANPA `page` bukan halaman melainkan PLAFON — jebakan terukur
   SPEC-523 (changelog: item ke-11 permanen tak terjangkau). Yang diuji di sini adalah URL yang
   BENAR-BENAR dikirim: satu argumen `{page,limit}` membuat "limit sendirian" tak bisa lahir. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { portalApi } from "../src/api/portal";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ items: [], total: 0, page: 1, pageSize: 20 }) });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); });

const urlOf = () => String(fetchMock.mock.calls[0][0]);

describe("portalApi paginasi (SPEC-647)", () => {
  it("listBacklog mengirim page dan limit sekaligus", async () => {
    await portalApi.listBacklog("p1", { page: 3, limit: 20 });
    expect(urlOf()).toBe("/api/portal/projects/p1/backlog?page=3&limit=20");
  });

  it("listTickets mengirim page dan limit sekaligus", async () => {
    await portalApi.listTickets("p1", { page: 2, limit: 20 });
    expect(urlOf()).toBe("/api/portal/projects/p1/tickets?page=2&limit=20");
  });

  it("tak ada bentuk panggilan yang mengirim limit tanpa page", async () => {
    await portalApi.listBacklog("p1", { page: 1, limit: 20 });
    const u = urlOf();
    expect(u).toContain("limit=");
    expect(u).toContain("page=");
  });

  it("id project di-encode (klien tak boleh bisa menyusun path sendiri)", async () => {
    await portalApi.listTickets("p 1/x", { page: 1, limit: 20 });
    expect(urlOf()).toBe("/api/portal/projects/p%201%2Fx/tickets?page=1&limit=20");
  });

  // Pemilih project sengaja TANPA halaman: ia pemilih, bukan daftar yang ditelusuri, dan project
  // terpilih yang jatuh dari halaman justru mematahkan "perpindahan halaman mempertahankan
  // project terpilih".
  it("listProjects tetap meminta daftar penuh", async () => {
    await portalApi.listProjects();
    expect(urlOf()).toBe("/api/portal/projects");
  });
});
