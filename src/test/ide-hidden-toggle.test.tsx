import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { IdeScreen } from "../src/screens/IdeScreen";
import { api } from "../src/api/client";

const projects = [{ id: "p1", name: "p1", repoDir: "/r", kind: "existing" }] as any;

// Audit UI/UX 2026-10 (3H): pohon berkas kini di tab Berkas (default-nya Perubahan).
async function openBerkas() {
  const list = await screen.findByRole("tablist", { name: "Bagian IDE" });
  fireEvent.click(within(list).getByRole("tab", { name: "Berkas" }));
  return screen.findByText("README.md");
}

// Balasan server: `dist` diruntuhkan — namanya ada di `dirs`, isinya TIDAK ikut terkirim.
const HIDDEN = {
  ref: "", files: ["README.md", "secret.env"], dirs: ["dist"],
  ignored: ["secret.env", "dist"],
};

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();   // toggle-nya persisten per project — jangan warisi state test sebelumnya
  vi.spyOn(api, "listBranches").mockResolvedValue({ branches: ["main"], remotes: [] });
  vi.spyOn(api, "ideFile").mockResolvedValue({ path: "README.md", content: "# hi", binary: false, truncated: false });
  vi.spyOn(api, "ideWorkingStatus").mockResolvedValue({ branch: "main", staged: [], unstaged: [] });
  vi.spyOn(api, "ideTree").mockImplementation(async (_id: string, _ref = "", opts?: { hidden?: boolean; under?: string }) => {
    if (opts?.under === "dist") return { ref: "", files: ["dist/bundle.js"], dirs: ["dist/deep"], ignored: [] };
    if (opts?.hidden) return HIDDEN;
    return { ref: "", files: ["README.md"], dirs: [], ignored: [] };
  });
});

// Toggle "Diabaikan git" Explorer. Yang dijaga bukan cuma "entri muncul", tapi bahwa mematikannya
// benar-benar KEMBALI ke daftar tanpa entri terabaikan — toggle yang cuma bisa menambah membuat
// Explorer memanjang sekali lalu tak pernah pulih sampai halaman dimuat ulang.
describe("Explorer · toggle diabaikan git", () => {
  it("mati secara default; menyala → memuat ulang dengan hidden dan menampilkan entri terabaikan", async () => {
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    await openBerkas();
    expect(api.ideTree).toHaveBeenCalledWith("p1", "", { hidden: false });
    expect(screen.queryByText("secret.env")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /diabaikan git/i }));
    expect(await screen.findByText("secret.env")).toBeInTheDocument();
    expect(api.ideTree).toHaveBeenCalledWith("p1", "", { hidden: true });
  });

  it("mematikannya lagi membuang entri terabaikan dari pohon", async () => {
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    await openBerkas();
    const btn = screen.getByRole("button", { name: /diabaikan git/i });
    fireEvent.click(btn);
    await screen.findByText("secret.env");
    fireEvent.click(btn);
    await waitFor(() => expect(screen.queryByText("secret.env")).toBeNull());
  });

  it("direktori terabaikan yang diruntuhkan baru memuat isinya saat dibuka", async () => {
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    await openBerkas();
    fireEvent.click(screen.getByRole("button", { name: /diabaikan git/i }));
    // `dist` tampil sebagai folder meski tak satu pun berkas di bawahnya terkirim…
    const dir = await screen.findByText("dist/");
    expect(api.ideTree).not.toHaveBeenCalledWith("p1", "", { under: "dist" });
    // …dan isinya baru diminta saat folder itu dibuka.
    fireEvent.click(dir);
    await waitFor(() => expect(api.ideTree).toHaveBeenCalledWith("p1", "", { under: "dist" }));
    expect(await screen.findByText("bundle.js")).toBeInTheDocument();
    expect(await screen.findByText("deep/")).toBeInTheDocument();
  });

  it("togglenya mati saat sedang melihat sebuah ref — commit tak punya berkas terabaikan", async () => {
    render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
    await openBerkas();
    fireEvent.change(screen.getByDisplayValue("Belum di-commit"), { target: { value: "main" } });
    await waitFor(() => expect(screen.getByRole("button", { name: /diabaikan git/i })).toBeDisabled());
  });
});
