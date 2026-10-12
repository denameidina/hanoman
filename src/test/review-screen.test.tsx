import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ReviewScreen } from "../src/screens/ReviewScreen";
import { api } from "../src/api/client";
import { mockViewport, resetViewport } from "./viewport";
import { routePath } from "../src/routes";

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

// ADR-0213/0215 · 409 yang tersisa (project belum punya repoDir) adalah galat, bukan keadaan kosong.
describe("ReviewScreen · 409 repoDir belum diatur", () => {
  const noRepo = () => Object.assign(new Error("GET /api/specs/SPEC-142/review → 409"), { status: 409 });

  it("tampil sebagai galat yang bisa dicoba ulang, tanpa pesan teknis", async () => {
    (api.specReview as any).mockRejectedValue(noRepo());
    render(<ReviewScreen specId="SPEC-142" title="Judul" onBack={() => {}} />);
    expect(await screen.findByText("Gagal memuat review")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/GET \/api|→ 409/);
    expect(screen.queryByText("Belum ada perubahan untuk ditinjau")).toBeNull();
  });

  it("keadaan kosong tetap lewat 200 empty dengan dua tujuan navigasi", async () => {
    (api.specReview as any).mockResolvedValue({ base: "", files: [], changed: [], empty: true, reason: "no-worktree" });
    const onGoto = vi.fn();
    render(<ReviewScreen specId="SPEC-142" title="Judul" onBack={() => {}} onGoto={onGoto} />);
    expect(await screen.findByText("Belum ada perubahan untuk ditinjau")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Buka di Backlog" }));
    expect(onGoto).toHaveBeenLastCalledWith({ section: "backlog", specId: "SPEC-142" });
    fireEvent.click(screen.getByRole("button", { name: "Buka di Terminal" }));
    expect(onGoto).toHaveBeenLastCalledWith({ section: "terminal" });
  });

  it("sesi PRD tanpa worktree tak menawarkan Backlog (200 empty, ADR-0215)", async () => {
    (api.sessionReview as any).mockResolvedValue({ base: "", files: [], changed: [], empty: true, reason: "no-worktree" });
    render(<ReviewScreen specId="S1" title="PRD" kind="session" onBack={() => {}} />);
    await screen.findByText("Belum ada perubahan untuk ditinjau");
    expect(screen.queryByRole("link", { name: "Buka di Backlog" })).toBeNull();
    expect(screen.getByRole("link", { name: "Buka di Terminal" })).toBeInTheDocument();
  });
});

// Audit UI/UX 2026-10 · Fase 3L′ · bar keputusan dengan prop: Integrasikan (primer), Kembalikan ke
// Dikerjakan (sekunder), dan ⋯ berisi Hapus worktree serta navigasi. Setiap mutasi lewat useConfirm;
// galatnya tampil di bar. Layar induk yang menjalankan mutasi, jadi tes memakai callback tiruan.
describe("ReviewScreen · bar keputusan dengan prop (Fase 3L′)", () => {
  beforeEach(() => mockViewport(1280));

  const renderReview = (extra: Partial<ComponentProps<typeof ReviewScreen>> = {}) =>
    render(<ReviewScreen specId="SPEC-171" title="Judul item" onBack={() => {}} {...extra} />);
  // Bar dicari lewat region-nya, supaya tombol di dalam dialog tidak tercampur.
  async function decideBar() {
    await screen.findByText("Judul item");
    return screen.getByRole("region", { name: "Keputusan" });
  }

  it("tanpa prop keputusan: hanya tiga tujuan navigasi, tanpa aksi mutasi", async () => {
    renderReview({ onGoto: vi.fn() });
    const bar = await decideBar();
    expect(within(bar).getByRole("button", { name: "Buka di Backlog" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Buka di Terminal" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Buka di IDE" })).toBeInTheDocument();
    expect(within(bar).queryByRole("button", { name: "Integrasikan" })).toBeNull();
    expect(within(bar).queryByRole("button", { name: "Kembalikan ke Dikerjakan" })).toBeNull();
    expect(within(bar).queryByRole("button", { name: "Aksi lain" })).toBeNull();
  });

  it("dengan keputusan: Kembalikan, Integrasikan, dan Terminal berlabel di bar; Backlog dan IDE di Aksi lain", async () => {
    renderReview({ onGoto: vi.fn(), onIntegrate: vi.fn(), onRevert: vi.fn(), onDiscard: vi.fn() });
    const bar = await decideBar();
    expect(within(bar).getByRole("button", { name: "Kembalikan ke Dikerjakan" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Integrasikan" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Buka di Terminal" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Aksi lain" })).toBeInTheDocument();
    expect(within(bar).queryByRole("button", { name: "Buka di IDE" })).toBeNull();
  });

  it("spec belum done (Hapus worktree saja): tiga tujuan tetap berlabel; Hapus worktree di Aksi lain", async () => {
    renderReview({ onGoto: vi.fn(), onDiscard: vi.fn() });
    const bar = await decideBar();
    expect(within(bar).getByRole("button", { name: "Buka di Backlog" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Buka di Terminal" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Buka di IDE" })).toBeInTheDocument();
    expect(within(bar).getByText(/Merge dan konflik dikerjakan di Backlog/)).toBeInTheDocument();
    fireEvent.click(within(bar).getByRole("button", { name: "Aksi lain" }));
    const menu = await screen.findByRole("dialog");
    expect(within(menu).getByRole("menuitem", { name: "Hapus worktree" })).toBeInTheDocument();
  });

  it("menu Aksi lain memuat navigasi yang tak tampil di bar dan memanggil onGoto", async () => {
    const onGoto = vi.fn();
    renderReview({ onGoto, onIntegrate: vi.fn(), onDiscard: vi.fn() });
    const bar = await decideBar();
    fireEvent.click(within(bar).getByRole("button", { name: "Aksi lain" }));
    const menu = await screen.findByRole("dialog");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Buka di IDE" }));
    expect(onGoto).toHaveBeenCalledWith({ section: "ide" });
  });

  it("di bawah 400px tak ada tombol inline: keputusan dan tujuan semuanya di Aksi lain", async () => {
    mockViewport(390);
    renderReview({ onGoto: vi.fn(), onIntegrate: vi.fn(), onDiscard: vi.fn() });
    const bar = await decideBar();
    expect(within(bar).queryByRole("button", { name: "Integrasikan" })).toBeNull();
    expect(within(bar).queryByRole("button", { name: "Buka di Terminal" })).toBeNull();
    fireEvent.click(within(bar).getByRole("button", { name: "Aksi lain" }));
    const menu = await screen.findByRole("dialog");
    expect(within(menu).getByRole("menuitem", { name: "Integrasikan" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Buka di Terminal" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Buka di IDE" })).toBeInTheDocument();
  });

  it("integrasi memakai tone netral: tombol konfirmasinya tidak berwarna danger", async () => {
    renderReview({ onIntegrate: vi.fn() });
    const bar = await decideBar();
    fireEvent.click(within(bar).getByRole("button", { name: "Integrasikan" }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByRole("button", { name: "Integrasikan" })).not.toHaveClass("hn-btn-danger");
  });

  it("integrasi: konfirmasi memuat branch, berkas +/−, dan cabang tujuan; konfirmasi memanggil onIntegrate", async () => {
    const onIntegrate = vi.fn().mockResolvedValue(undefined);
    renderReview({ onIntegrate, integrateTarget: "main (lokal)" });
    const bar = await decideBar();
    fireEvent.click(within(bar).getByRole("button", { name: "Integrasikan" }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByText("Branch: hanoman/spec-171")).toBeInTheDocument();
    expect(within(dlg).getByText("1 berkas berubah, +3 −1 baris")).toBeInTheDocument();
    expect(within(dlg).getByText("Cabang tujuan: main (lokal)")).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole("button", { name: "Integrasikan" }));
    await waitFor(() => expect(onIntegrate).toHaveBeenCalledWith("SPEC-171"));
  });

  it("integrasi tanpa cabang tujuan eksplisit menyebut cabang asal item", async () => {
    renderReview({ onIntegrate: vi.fn() });
    const bar = await decideBar();
    fireEvent.click(within(bar).getByRole("button", { name: "Integrasikan" }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByText("Cabang tujuan: cabang asal item (default project)")).toBeInTheDocument();
  });

  it("integrasi: Batal menutup dialog tanpa memanggil onIntegrate", async () => {
    const onIntegrate = vi.fn().mockResolvedValue(undefined);
    renderReview({ onIntegrate });
    const bar = await decideBar();
    fireEvent.click(within(bar).getByRole("button", { name: "Integrasikan" }));
    const dlg = await screen.findByRole("dialog");
    fireEvent.click(within(dlg).getByRole("button", { name: "Batal" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onIntegrate).not.toHaveBeenCalled();
  });

  it("integrasi yang gagal tampil sebagai galat di bar, tidak ditelan", async () => {
    const onIntegrate = vi.fn().mockRejectedValue(new Error("branch belum ada"));
    renderReview({ onIntegrate });
    const bar = await decideBar();
    fireEvent.click(within(bar).getByRole("button", { name: "Integrasikan" }));
    const dlg = await screen.findByRole("dialog");
    fireEvent.click(within(dlg).getByRole("button", { name: "Integrasikan" }));
    expect(await screen.findByText("Gagal mengintegrasikan item: branch belum ada")).toBeInTheDocument();
  });

  it("kembalikan: dry-run pending memuat daftar dokumen; konfirmasi memanggil ulang dengan confirmDelete", async () => {
    const onRevert = vi.fn().mockImplementation((_id: string, confirmDelete?: boolean) => Promise.resolve(
      confirmDelete ? undefined : { pending: true, stage: "executing", wouldDelete: ["internal/docs/spec.md", "docs/plan.md"] }));
    renderReview({ onRevert });
    const bar = await decideBar();
    fireEvent.click(within(bar).getByRole("button", { name: "Kembalikan ke Dikerjakan" }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByText("internal/docs/spec.md")).toBeInTheDocument();
    expect(within(dlg).getByText("2 berkas dokumen fase akan dihapus dari disk. Kode dan commit tidak disentuh.")).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole("button", { name: "Hapus dokumen & kembalikan" }));
    await waitFor(() => expect(onRevert).toHaveBeenLastCalledWith("SPEC-171", true));
    expect(onRevert).toHaveBeenNthCalledWith(1, "SPEC-171");
  });

  it("kembalikan tanpa balasan pending langsung selesai tanpa dialog", async () => {
    const onRevert = vi.fn().mockResolvedValue(undefined);
    renderReview({ onRevert });
    const bar = await decideBar();
    fireEvent.click(within(bar).getByRole("button", { name: "Kembalikan ke Dikerjakan" }));
    await waitFor(() => expect(onRevert).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("hapus worktree dari ⋯ lewat konfirmasi memanggil onDiscard", async () => {
    const onDiscard = vi.fn().mockResolvedValue(undefined);
    renderReview({ onDiscard });
    const bar = await decideBar();
    fireEvent.click(within(bar).getByRole("button", { name: "Aksi lain" }));
    const menu = await screen.findByRole("dialog");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Hapus worktree" }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByText("Sesi yang masih berjalan di worktree ini ditutup.")).toBeInTheDocument();
    fireEvent.click(within(dlg).getByRole("button", { name: "Hapus worktree" }));
    await waitFor(() => expect(onDiscard).toHaveBeenCalledWith("SPEC-171"));
  });

  it("hapus worktree yang gagal tampil sebagai galat di bar", async () => {
    const onDiscard = vi.fn().mockRejectedValue(new Error("worktree terkunci"));
    renderReview({ onDiscard });
    const bar = await decideBar();
    fireEvent.click(within(bar).getByRole("button", { name: "Aksi lain" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("menuitem", { name: "Hapus worktree" }));
    const dlg = await screen.findByRole("dialog");
    fireEvent.click(within(dlg).getByRole("button", { name: "Hapus worktree" }));
    expect(await screen.findByText("Gagal menghapus worktree: worktree terkunci")).toBeInTheDocument();
  });

  it("bar keputusan adalah anak terakhir layar, di luar panel berkas dan isi", async () => {
    renderReview({ onIntegrate: vi.fn() });
    const bar = await decideBar();
    expect(bar.parentElement?.lastElementChild).toBe(bar);
    expect(bar.closest(".hn-review-viewer")).toBeNull();
    expect(bar.closest(".hn-review-pane")).toBeNull();
  });
});

describe("ReviewScreen · kontrak CSS bar keputusan", () => {
  // Bar sticky di dalam area gulir `.hn-shell-main`, yang berakhir di atas lajur pet (DS: pet di alur layout).
  // Jsdom tidak menghitung layout, jadi yang dikunci adalah deklarasinya.
  const css = readFileSync(resolve(import.meta.dirname, "../src/screens/styles/review.css"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  it("bar keputusan sticky di bawah dan memiliki z-index", () => {
    const rule = /\.hn-review-decide\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/position:\s*sticky/);
    expect(rule).toMatch(/bottom:\s*0/);
    expect(rule).toMatch(/z-index:\s*\d+/);
  });

  it("di bawah 400px hint bar satu baris dan terpotong, tak bertumpuk di atas aksi", () => {
    const narrow = /@media \(max-width: 399px\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
    expect(narrow).toMatch(/\.hn-review-decide-hint\s*\{[^}]*white-space:\s*nowrap/);
    expect(narrow).toMatch(/\.hn-review-decide-hint\s*\{[^}]*text-overflow:\s*ellipsis/);
    expect(narrow).toMatch(/\.hn-review-decide-hint\s*\{[^}]*flex:\s*1 1 0/);
  });
});

// QA Chrome (#2) · chip "Changed" dan toggle list/tree di Review tampil sebagai tombol bawaan browser,
// karena kelasnya dulu hanya termuat bersama ide.css (layar IDE). Kini pohon membawa stylesheet-nya sendiri.
describe("ReviewScreen · gaya daftar berkas termuat tanpa IDE", () => {
  const treeCss = readFileSync(resolve(import.meta.dirname, "../src/screens/styles/file-tree.css"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const treeTsx = readFileSync(resolve(import.meta.dirname, "../src/screens/file-tree.tsx"), "utf8");
  const ideCss = readFileSync(resolve(import.meta.dirname, "../src/screens/styles/ide.css"), "utf8");

  it("file-tree.tsx mengimpor stylesheet-nya, jadi Review tak bergantung pada ide.css", () => {
    expect(treeTsx).toMatch(/import "\.\/styles\/file-tree\.css";/);
  });

  it("baris Changed berupa flex (huruf status tak menempel ke nama) dan chip toggle berkelas", () => {
    expect(treeCss).toMatch(/\.hn-ide-changed-row\s*\{\s*display:\s*flex/);
    expect(treeCss).toMatch(/\.hn-ide-status\s*\{/);
    expect(treeCss).toMatch(/\.hn-ide-changed-head\s*\{[^}]*display:\s*flex/);
    expect(treeCss).toMatch(/\.hn-ide-view-btn\s*\{[^}]*display:\s*flex/);
  });

  it("blok pohon dan daftar Changed tak lagi ganda di ide.css (satu sumber: file-tree.css)", () => {
    expect(ideCss).not.toMatch(/\.hn-ide-tree-leaf\s*\{/);
    expect(ideCss).not.toMatch(/\.hn-ide-changed-head\s*\{/);
  });
});
