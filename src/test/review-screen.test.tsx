import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ReviewScreen } from "../src/screens/ReviewScreen";
import { api } from "../src/api/client";
import { mockViewport, resetViewport } from "./viewport";

vi.mock("../src/api/client", () => ({
  api: {
    specReview: vi.fn(), specReviewFile: vi.fn(),
    sessionReview: vi.fn(), sessionReviewFile: vi.fn(),
    specReviewFileDownloadUrl: (id: string, p: string, f: string) => `/api/specs/${id}/review/${p}?download=${f}`,
    sessionReviewFileDownloadUrl: (id: string, p: string, f: string) => `/api/terminal/sessions/${id}/review/${p}?download=${f}`,
  },
}));

beforeEach(() => {
  (api.specReview as any).mockResolvedValue({
    base: "abc", files: ["src/a.ts", "src/b.ts"],
    changed: [{ path: "src/a.ts", add: 3, del: 1, status: "M", binary: false }],
  });
  (api.specReviewFile as any).mockResolvedValue({
    path: "src/a.ts", status: "M", binary: false, truncated: false,
    diff: "@@ -1 +1 @@\n-old\n+new", content: "new content",
  });
});
afterEach(resetViewport);

describe("ReviewScreen (SPEC-171)", () => {
  it("offers mounted Files/Viewer panels on mobile", async () => {
    mockViewport(390);
    render(<ReviewScreen specId="SPEC-171" title="X" onBack={() => {}} />);
    await screen.findByRole("tablist", { name: "Panel Review" });
    expect(document.querySelector('[data-panel="files"]')).toHaveAttribute("aria-hidden", "false");
    fireEvent.click(screen.getByRole("tab", { name: "Viewer" }));
    expect(document.querySelector('[data-panel="viewer"]')).toHaveAttribute("aria-hidden", "false");
    expect(document.querySelector('[data-panel="files"]')).toBeInTheDocument();
  });
  it("menampilkan changed list + memilih file changed pertama (diff hijau)", async () => {
    render(<ReviewScreen specId="SPEC-171" title="X" onBack={() => {}} />);
    await waitFor(() => expect(screen.getAllByText("src/a.ts").length).toBeGreaterThan(0));
    expect(await screen.findByText("+new")).toBeInTheDocument();
  });
  it("tab Source menampilkan content", async () => {
    render(<ReviewScreen specId="SPEC-171" title="X" onBack={() => {}} />);
    await screen.findByText("+new");
    const toggle = screen.getByRole("button", { name: "Sumber" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(await screen.findByText("new content")).toBeInTheDocument();
  });
});

describe("ReviewScreen collapse & tree (SPEC-177)", () => {
  it("Files tree collapsed saat pertama dibuka (folder src/ tertutup)", async () => {
    render(<ReviewScreen specId="SPEC-177" title="X" onBack={() => {}} />);
    // Header folder "src/" muncul di section Files…
    await waitFor(() => expect(screen.getByText("src/")).toBeInTheDocument());
    // …tapi isi folder (b.ts) TIDAK tampil karena collapsed.
    expect(screen.queryByText("b.ts")).toBeNull();
  });

  it("toggle Changed → Tree menampilkan folder induk file changed", async () => {
    (api.specReview as any).mockResolvedValue({
      base: "abc", files: ["src/a.ts"],
      changed: [{ path: "src/deep/a.ts", add: 3, del: 1, status: "M", binary: false }],
    });
    render(<ReviewScreen specId="SPEC-177" title="X" onBack={() => {}} />);
    fireEvent.click(await screen.findByLabelText("Tree Changed"));
    // Rantai folder induk tampil + file changed di bawahnya (auto-expand).
    await waitFor(() => expect(screen.getByText("deep/")).toBeInTheDocument());
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    // Leaf tree membawa counts, sama seperti flat list.
    expect(screen.getByText("+3")).toBeInTheDocument();
  });
});

// SPEC-385 · aksi Preview untuk .md — Review dulu hanya punya Diff|Source, jadi dokumen
// tampil sebagai teks mentah.
describe("ReviewScreen preview .md (SPEC-385)", () => {
  const mdReview = {
    base: "abc", files: ["docs/a.md"],
    changed: [{ path: "docs/a.md", add: 2, del: 0, status: "M", binary: false }],
  };
  const mdFile = {
    path: "docs/a.md", status: "M", binary: false, truncated: false,
    diff: "@@ -1 +1 @@\n+# Judul", content: "# Judul\n\nisi",
  };

  it("tombol Preview membuka modal berisi markdown terender", async () => {
    (api.specReview as any).mockResolvedValue(mdReview);
    (api.specReviewFile as any).mockResolvedValue(mdFile);
    render(<ReviewScreen specId="SPEC-385" title="X" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /preview/i }));
    expect(await screen.findByRole("heading", { name: "Judul" })).toBeInTheDocument();
  });

  it("modal menaut unduh .md/.pdf ke endpoint review backlog (ADR-0078)", async () => {
    (api.specReview as any).mockResolvedValue(mdReview);
    (api.specReviewFile as any).mockResolvedValue(mdFile);
    render(<ReviewScreen specId="SPEC-385" title="X" onBack={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /preview/i }));
    expect(await screen.findByRole("link", { name: /unduh \.md/i }))
      .toHaveAttribute("href", "/api/specs/SPEC-385/review/docs/a.md?download=md");
  });

  it("kind=session memakai endpoint review sesi", async () => {
    (api.sessionReview as any).mockResolvedValue(mdReview);
    (api.sessionReviewFile as any).mockResolvedValue(mdFile);
    render(<ReviewScreen specId="sess1" title="X" onBack={() => {}} kind="session" />);
    fireEvent.click(await screen.findByRole("button", { name: /preview/i }));
    expect(await screen.findByRole("link", { name: /unduh \.pdf/i }))
      .toHaveAttribute("href", "/api/terminal/sessions/sess1/review/docs/a.md?download=pdf");
  });

  it("berkas non-.md tak menawarkan Preview", async () => {
    (api.specReview as any).mockResolvedValue({
      base: "abc", files: ["src/a.ts"],
      changed: [{ path: "src/a.ts", add: 1, del: 0, status: "M", binary: false }],
    });
    (api.specReviewFile as any).mockResolvedValue({
      path: "src/a.ts", status: "M", binary: false, truncated: false, diff: "@@", content: "const x = 1",
    });
    render(<ReviewScreen specId="SPEC-385" title="X" onBack={() => {}} />);
    await waitFor(() => expect(api.specReviewFile).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /preview/i })).toBeNull();
  });

  it("berkas .md yang DIHAPUS tak menawarkan Preview (tak ada isi)", async () => {
    (api.specReview as any).mockResolvedValue({
      base: "abc", files: ["docs/a.md"],
      changed: [{ path: "docs/a.md", add: 0, del: 3, status: "D", binary: false }],
    });
    (api.specReviewFile as any).mockResolvedValue({
      path: "docs/a.md", status: "D", binary: false, truncated: false, diff: "@@", content: null,
    });
    render(<ReviewScreen specId="SPEC-385" title="X" onBack={() => {}} />);
    await waitFor(() => expect(api.specReviewFile).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /preview/i })).toBeNull();
  });
});

describe("ReviewScreen · berkas gagal, legenda, CTA lanjut", () => {
  it("gagal memuat berkas → galat + Coba lagi, bukan 'Memuat file…' selamanya", async () => {
    (api.specReviewFile as any).mockRejectedValueOnce(new Error("boom"));
    render(<ReviewScreen specId="SPEC-171" title="X" onBack={() => {}} />);
    await screen.findByText("Gagal memuat berkas");
    expect(screen.queryByText("Memuat file…")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByText("+new")).toBeTruthy();
  });

  it("legenda A/M/D tampil dan CTA kembali ke backlog memanggil onBack", async () => {
    const onBack = vi.fn();
    render(<ReviewScreen specId="SPEC-171" title="X" onBack={onBack} />);
    await screen.findByText("+new");
    expect(screen.getByText(/A = baru · M = diubah · D = dihapus/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Kembali ke backlog" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

// Audit UI/UX 2026-10 · Fase 3 (3L) · bar keputusan: tiga tujuan, lewat onGoto atau tautan.
describe("ReviewScreen · bar keputusan (Fase 3L)", () => {
  it("tiga tujuan keputusan memanggil onGoto dengan rute yang benar", async () => {
    const onGoto = vi.fn();
    render(<ReviewScreen specId="SPEC-9" title="Judul item" onBack={() => {}} onGoto={onGoto} />);
    await screen.findByRole("region", { name: "Keputusan" });
    fireEvent.click(screen.getByRole("button", { name: "Buka di Backlog" }));
    expect(onGoto).toHaveBeenLastCalledWith({ section: "backlog", specId: "SPEC-9" });
    fireEvent.click(screen.getByRole("button", { name: "Buka di Terminal" }));
    expect(onGoto).toHaveBeenLastCalledWith({ section: "terminal" });
    fireEvent.click(screen.getByRole("button", { name: "Buka di IDE" }));
    expect(onGoto).toHaveBeenLastCalledWith({ section: "ide" });
  });

  it("tanpa onGoto, setiap tujuan berupa tautan ke rute hanoman", async () => {
    render(<ReviewScreen specId="SPEC-9" title="Judul" onBack={() => {}} />);
    await screen.findByRole("region", { name: "Keputusan" });
    expect(screen.getByRole("link", { name: "Buka di Backlog" })).toHaveAttribute("href", "/backlog/SPEC-9");
    expect(screen.getByRole("link", { name: "Buka di Terminal" })).toHaveAttribute("href", "/terminal");
    expect(screen.getByRole("link", { name: "Buka di IDE" })).toHaveAttribute("href", "/ide");
  });

  it("sesi PRD tak punya tujuan Backlog: merge dan konflik hanya di Terminal", async () => {
    (api.sessionReview as any).mockResolvedValue({ base: "abc", files: [], changed: [] });
    render(<ReviewScreen specId="S1" title="PRD" kind="session" onBack={() => {}} />);
    await screen.findByRole("region", { name: "Keputusan" });
    expect(screen.queryByRole("link", { name: "Buka di Backlog" })).toBeNull();
    expect(screen.getByText("Merge dan konflik dikerjakan di Terminal.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Buka di Terminal" })).toBeInTheDocument();
  });

  it("header menyebut jumlah berkas dan total +/− dari daftar changed", async () => {
    (api.specReview as any).mockResolvedValue({
      base: "abc", files: ["a.ts", "b.ts"],
      changed: [
        { path: "a.ts", add: 3, del: 1, status: "M", binary: false },
        { path: "b.ts", add: 2, del: 0, status: "A", binary: false },
      ],
    });
    render(<ReviewScreen specId="SPEC-9" title="Judul" onBack={() => {}} />);
    expect(await screen.findByText("+5 −1")).toBeInTheDocument();
    expect(screen.getByText(/2 berkas berubah/)).toBeInTheDocument();
  });
});

// QA Chrome (P2) · belum ada worktree (409): kalimat manusiawi dan dua tujuan; pesan teknis tak tampil.
describe("ReviewScreen · belum ada worktree (409)", () => {
  const notYet = () => Object.assign(new Error("GET /api/specs/SPEC-142/review → 409"), { status: 409 });

  it("menjelaskan dengan bahasa manusia dan menawarkan Backlog serta Terminal", async () => {
    (api.specReview as any).mockRejectedValue(notYet());
    const onGoto = vi.fn();
    render(<ReviewScreen specId="SPEC-142" title="Judul" onBack={() => {}} onGoto={onGoto} />);
    expect(await screen.findByText("Belum ada perubahan untuk ditinjau")).toBeInTheDocument();
    expect(screen.getByText("Sesi belum membuat worktree. Jalankan atau lanjutkan sesinya dulu, lalu muat ulang.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/GET \/api|→ 409|409/);
    fireEvent.click(screen.getByRole("button", { name: "Buka di Backlog" }));
    expect(onGoto).toHaveBeenLastCalledWith({ section: "backlog", specId: "SPEC-142" });
    fireEvent.click(screen.getByRole("button", { name: "Buka di Terminal" }));
    expect(onGoto).toHaveBeenLastCalledWith({ section: "terminal" });
  });

  it("detail teknis hanya di atribut data-detail untuk penelusuran", async () => {
    (api.specReview as any).mockRejectedValue(notYet());
    const { container } = render(<ReviewScreen specId="SPEC-142" title="Judul" onBack={() => {}} />);
    await screen.findByText("Belum ada perubahan untuk ditinjau");
    const empty = container.querySelector("[data-review-state='empty']");
    expect(empty?.getAttribute("data-status")).toBe("409");
    expect(empty?.getAttribute("data-detail")).toBe("GET /api/specs/SPEC-142/review → 409");
  });

  it("sesi PRD tanpa worktree tak menawarkan Backlog", async () => {
    (api.sessionReview as any).mockRejectedValue(notYet());
    render(<ReviewScreen specId="S1" title="PRD" kind="session" onBack={() => {}} />);
    await screen.findByText("Belum ada perubahan untuk ditinjau");
    expect(screen.queryByRole("link", { name: "Buka di Backlog" })).toBeNull();
    expect(screen.getByRole("link", { name: "Buka di Terminal" })).toBeInTheDocument();
  });
});
