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
    fireEvent.click(screen.getByText("source"));
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
