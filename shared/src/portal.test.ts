import { describe, it, expect } from "vitest";
import {
  toPortalProject, toPortalSpec, toPortalTicket, toPortalTicketDetail,
  PORTAL_PROJECT_KEYS, PORTAL_SPEC_KEYS, PORTAL_TICKET_KEYS,
} from "./portal";

const SPEC_ROW = {
  id: "SPEC-1", projectId: "p1", title: "Judul", source: "brief", stage: "executing",
  priority: "tinggi", author: "operator@internal.co", objective: "Hasil yang dikejar",
  payload: { context: "catatan internal", outcome: "rahasia" },
  branchFrom: "main", baseSha: "abc123", headSha: "def456", version: 3,
  createdAt: new Date("2026-08-01T00:00:00Z"), startedAt: new Date("2026-08-02T00:00:00Z"),
  doneAt: null, dependsOn: ["SPEC-0"], autoMerge: { mode: "off" }, sourceHistory: [],
  updatedAt: new Date("2026-08-03T00:00:00Z"),
};

const PROJECT_ROW = {
  id: "p1", name: "P1", desc: "rahasia", kind: "existing", repoDir: "/tmp/x", gitRemote: null,
};

const TICKET_ROW = {
  id: "t1", projectId: "p1", number: 7, category: "bug", title: "Tombol mati",
  detail: "langkah repro", reporterEmail: "pelapor@luar.co", status: "accepted",
  accessKeyHash: "hash", shareToken: "tok", specId: "SPEC-1",
  createdAt: new Date("2026-08-01T00:00:00Z"), updatedAt: new Date("2026-08-02T00:00:00Z"),
};

describe("proyeksi portal (SPEC-617)", () => {
  // Allowlist eksplisit, bukan Omit<>: kolom baru di Prisma TIDAK boleh diam-diam ikut terkirim.
  it("spec hanya memancarkan kunci yang diizinkan", () => {
    const out = toPortalSpec(SPEC_ROW);
    expect(Object.keys(out).sort()).toEqual([...PORTAL_SPEC_KEYS].sort());
  });

  it("spec tak membawa payload, author, sha, branch, dependency, riwayat", () => {
    const out = toPortalSpec(SPEC_ROW) as Record<string, unknown>;
    for (const k of ["payload", "author", "baseSha", "headSha", "branchFrom", "dependsOn",
      "sourceHistory", "autoMerge", "version", "source", "projectId", "updatedAt"])
      expect(out[k], k).toBeUndefined();
  });

  it("spec memakai stage & tanggal apa adanya (ISO string / null)", () => {
    expect(toPortalSpec(SPEC_ROW)).toEqual({
      id: "SPEC-1", title: "Judul", priority: "tinggi", stage: "executing",
      objective: "Hasil yang dikejar",
      createdAt: "2026-08-01T00:00:00.000Z", startedAt: "2026-08-02T00:00:00.000Z", doneAt: null,
    });
  });

  // Email pelapor tak pernah menyeberang — keputusan operator saat brainstorm.
  it("tiket tak membawa reporterEmail, detail, shareToken, accessKeyHash, specId", () => {
    const out = toPortalTicket(TICKET_ROW, null) as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual([...PORTAL_TICKET_KEYS].sort());
    for (const k of ["reporterEmail", "detail", "shareToken", "accessKeyHash", "specId", "projectId"])
      expect(out[k], k).toBeUndefined();
  });

  // Status memakai kosakata publik yang sudah ada (SPEC-293) — tanpa istilah stage internal.
  it("status tiket diturunkan publicStatus(status, stage spec)", () => {
    expect(toPortalTicket(TICKET_ROW, "done").status).toBe("Selesai");
    expect(toPortalTicket(TICKET_ROW, "executing").status).toBe("Sedang dikerjakan");
    expect(toPortalTicket({ ...TICKET_ROW, status: "new" }, null).status).toBe("Sedang ditinjau");
    expect(toPortalTicket({ ...TICKET_ROW, status: "rejected" }, null).status).toBe("Ditutup");
  });

  it("detail tiket menambahkan tepat satu kunci: detail", () => {
    const out = toPortalTicketDetail(TICKET_ROW, null);
    expect(Object.keys(out).sort()).toEqual([...PORTAL_TICKET_KEYS, "detail"].sort());
    expect(out.detail).toBe("langkah repro");
  });

  it("project hanya id & nama", () => {
    const out = toPortalProject(PROJECT_ROW);
    expect(Object.keys(out).sort()).toEqual([...PORTAL_PROJECT_KEYS].sort());
    expect(out).toEqual({ id: "p1", name: "P1" });
  });
});
