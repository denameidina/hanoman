// Audit UI/UX 2026-10 (1F) · IDE: Edit tak boleh menimpa working tree dengan isi ref lain,
// draft kotor dijaga saat pindah berkas, dan Hapus/Ganti nama mengikuti entri yang DIKLIK di pohon.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { IdeScreen } from "../src/screens/IdeScreen";
import { api } from "../src/api/client";

const projects = [{ id: "p1", name: "p1", repoDir: "/r", kind: "existing" }] as any;
const fileOf = (path: string) => ({ path, content: `isi ${path}`, binary: false, truncated: false }) as any;

function mountIde(files: string[]) {
  vi.spyOn(api, "ideTree").mockResolvedValue({ ref: "", files } as any);
  vi.spyOn(api, "listBranches").mockResolvedValue({ branches: ["main", "feat"], remotes: [] });
  vi.spyOn(api, "ideWorkingStatus").mockResolvedValue({ branch: "main", staged: [], unstaged: [], untracked: [], clean: true } as any);
  vi.spyOn(api, "ideFile").mockImplementation(async (_p, path) => fileOf(path));
  return render(<IdeScreen projects={projects} projectId="p1" onProject={() => {}} />);
}

beforeEach(() => { vi.restoreAllMocks(); });

describe("IDE · guard edit & target", () => {
  it("Edit nonaktif saat ref lain (bukan working tree) dipilih", async () => {
    mountIde(["README.md", "CHANGELOG.md"]);
    fireEvent.change(await screen.findByLabelText("Ref yang dilihat"), { target: { value: "feat" } });
    fireEvent.click(await screen.findByText("README.md"));
    await waitFor(() => expect(screen.getByRole("button", { name: /^edit$/i })).toBeDisabled());
  });

  it("draft kotor: memilih berkas lain meminta konfirmasi; Lanjut mengedit mempertahankan draft", async () => {
    mountIde(["README.md", "CHANGELOG.md"]);
    fireEvent.click(await screen.findByText("README.md"));
    await waitFor(() => expect(screen.getByRole("button", { name: /^edit$/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.change(screen.getByLabelText("Isi README.md"), { target: { value: "ubahan" } });
    fireEvent.click(screen.getByText("CHANGELOG.md"));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Buang perubahan?")).toBeInTheDocument();
    fireEvent.click(dialog.getByRole("button", { name: "Lanjut mengedit" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByLabelText("Isi README.md")).toHaveValue("ubahan");
  });

  it("Hapus memakai folder yang diklik di pohon, bukan berkas yang sedang terbuka", async () => {
    mountIde(["src/a.ts", "README.md"]);
    fireEvent.click(await screen.findByText("README.md"));
    fireEvent.click(screen.getByText("src/"));
    expect(screen.getByTestId("ide-entry-target")).toHaveTextContent("src/");
    fireEvent.click(screen.getByRole("button", { name: /^hapus$/i }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("Hapus folder beserta isinya?")).toBeInTheDocument();
  });
});
