// src/src/screens/skills/SkillsWorkspace.test.tsx
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillsWorkspace } from "./SkillsWorkspace";

const e = (o: Record<string, unknown>) => ({
  description: "Use when x", projectId: null, dir: "/d", loadedBy: ["claude"], editable: true, ...o,
});
const library = {
  global: [
    e({ key: "hanoman~-~hanoman~shared-a", name: "shared-a", layer: "hanoman", source: "hanoman", loadedBy: ["claude", "codex"] }),
    e({ key: "plugin~-~plugin:pkg~pl", name: "pl", layer: "plugin", source: "plugin:pkg", editable: false }),
  ],
  projects: [
    { projectId: "p1", name: "Alpha", skills: [e({ key: "project~p1~.agents~deploy", name: "deploy", layer: "project", source: ".agents", projectId: "p1", loadedBy: ["codex"] })] },
    { projectId: "p2", name: "Beta", skills: [], error: "repo tidak ditemukan" },
  ],
};
const json = (v: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => v } as Response);

function mockFetch(extra: (u: string, init?: RequestInit) => Promise<Response> | null = () => null) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((url, init) => {
    const u = String(url);
    const x = extra(u, init);
    if (x) return x;
    if (u.includes("/api/skills?scope=all")) return json(library);
    if (u.endsWith("/tree")) return json({ files: [{ path: "SKILL.md", size: 10 }, { path: "references/api.md", size: 3 }], dirs: ["references"] });
    if (u.includes("/file?")) return json({ path: "SKILL.md", size: 10, hash: "h1", content: "---\nname: shared-a\ndescription: Use when x\n---\n# isi", binary: false, tooLarge: false });
    return json({});
  });
}
afterEach(() => vi.restoreAllMocks());

describe("SkillsWorkspace (/skills)", () => {
  // Redesign 3K: daftar datar; lapis jadi chip (Global · Project · Plugin), bukan grup lipat.
  // Skill project menampilkan nama project-nya di baris, dan galat repo tampil di atas daftar.
  it("daftar datar dengan chip lapis; skill project menyebut nama project; galat repo tampil", async () => {
    mockFetch();
    render(<SkillsWorkspace />);
    expect(await screen.findByText("shared-a")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Global/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("deploy")).toBeTruthy();
    expect(screen.getByText(/repo tidak ditemukan/)).toBeTruthy();
    expect(screen.getByText(".agents")).toBeTruthy();
  });

  it("memilih skill memuat struktur dan SKILL.md, lalu menyimpan dengan baseHash", async () => {
    const put = vi.fn();
    mockFetch((u, init) => {
      if (init?.method === "PUT") { put(u, JSON.parse(String(init.body))); return json({ hash: "h2" }); }
      return null;
    });
    render(<SkillsWorkspace />);
    fireEvent.click(await screen.findByText("shared-a"));
    expect(await screen.findByText("references/")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const ta = await screen.findByRole("textbox", { name: /isi berkas/i });
    fireEvent.change(ta, { target: { value: "---\nname: shared-a\ndescription: baru\n---\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(put.mock.calls[0]![1]).toMatchObject({ baseHash: "h1" });
  });

  it("skill plugin baca-saja: tanpa tombol Edit, ada Fork", async () => {
    mockFetch();
    render(<SkillsWorkspace />);
    fireEvent.click(await screen.findByText("pl"));
    expect(await screen.findByRole("button", { name: /Fork/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("409 saat simpan menampilkan pesan konflik", async () => {
    mockFetch((u, init) => init?.method === "PUT" ? json({ error: "berkas berubah di tempat lain" }, 409) : null);
    render(<SkillsWorkspace />);
    fireEvent.click(await screen.findByText("shared-a"));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(await screen.findByRole("textbox", { name: /isi berkas/i }), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan" }));
    expect(await screen.findByText(/berubah di tempat lain/)).toBeTruthy();
  });

  // Redesign 3K: tanpa grup lipat, semua skill tampil dalam satu daftar; pencarian menyaring.
  it("daftar datar menampilkan semua skill besar; pencarian menyaring", async () => {
    const many = Array.from({ length: 12 }, (_, i) => e({ key: `plugin~-~plugin:pkg~p${i}`, name: `plug-${i}`, layer: "plugin", source: "plugin:pkg", editable: false }));
    mockFetch((u) => u.includes("/api/skills?scope=all") ? json({ ...library, global: [...library.global, ...many] }) : null);
    render(<SkillsWorkspace />);
    expect(await screen.findByText("shared-a")).toBeTruthy();
    expect(screen.getByText("plug-3")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Cari skill" }), { target: { value: "plug-3" } });
    expect(await screen.findByText("plug-3")).toBeTruthy();
    expect(screen.queryByText("plug-4")).toBeNull();
  });

  it("pencarian tanpa hasil menampilkan pesan khusus, bukan 'Belum ada skill'", async () => {
    mockFetch();
    render(<SkillsWorkspace />);
    await screen.findByText("shared-a");
    fireEvent.change(screen.getByRole("textbox", { name: "Cari skill" }), { target: { value: "zzz-tidak-ada" } });
    expect(await screen.findByText("Tak ada skill cocok pencarian")).toBeTruthy();
    expect(screen.queryByText("Belum ada skill")).toBeNull();
  });

  it("baris terpilih ditandai aria-current", async () => {
    mockFetch();
    render(<SkillsWorkspace />);
    fireEvent.click(await screen.findByText("shared-a"));
    await screen.findByText("references/");
    const rows = [...document.querySelectorAll(".hn-skill-row")];
    const current = rows.filter((r) => r.getAttribute("aria-current") === "true");
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toContain("shared-a");
  });

  // Redesign 3K: lapis dipilih lewat chip; chip Plugin menyaring daftar ke skill plugin saja.
  it("chip lapis menyaring daftar ke satu lapis", async () => {
    mockFetch();
    render(<SkillsWorkspace />);
    expect(await screen.findByText("shared-a")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Plugin/ }));
    expect(screen.getByRole("button", { name: /Plugin/ })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("pl")).toBeTruthy();
    expect(screen.queryByText("shared-a")).toBeNull();
  });

  it("gagal memuat berkas menampilkan galat + Coba lagi, bukan spinner abadi", async () => {
    let fail = true;
    mockFetch((u) => u.includes("/file?") && fail ? json({ error: "disk penuh" }, 500) : null);
    render(<SkillsWorkspace />);
    fireEvent.click(await screen.findByText("shared-a"));
    expect(await screen.findByText("Gagal memuat berkas")).toBeTruthy();
    expect(screen.getByText("disk penuh")).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByRole("heading", { name: "isi" })).toBeTruthy();
  });

  it("gagal memuat daftar skill menampilkan galat dan Coba lagi", async () => {
    let fail = true;
    mockFetch((u) => u.includes("/api/skills?scope=all") && fail ? json({ error: "db terkunci" }, 500) : null);
    render(<SkillsWorkspace />);
    expect(await screen.findByText("Gagal memuat skill")).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Coba lagi" }));
    expect(await screen.findByText("shared-a")).toBeTruthy();
  });

  it("Simpan tetap terlihat di Pratinjau saat draft kotor", async () => {
    mockFetch();
    render(<SkillsWorkspace />);
    fireEvent.click(await screen.findByText("shared-a"));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(await screen.findByRole("textbox", { name: /isi berkas/i }), { target: { value: "# baru" } });
    fireEvent.click(screen.getByRole("button", { name: "Pratinjau" }));
    expect((screen.getByRole("button", { name: "Simpan" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("belum disimpan")).toBeTruthy();
  });

  async function dirtyEditor() {
    fireEvent.click(await screen.findByText("shared-a"));
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(await screen.findByRole("textbox", { name: /isi berkas/i }), { target: { value: "# draf saya" } });
  }

  it("pindah skill saat draft kotor meminta konfirmasi; batal mempertahankan draft", async () => {
    mockFetch();
    render(<SkillsWorkspace />);
    await dirtyEditor();
    fireEvent.click(screen.getByText("deploy"));
    expect(await screen.findByText("Buang perubahan?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tetap mengedit" }));
    await waitFor(() => expect(screen.queryByText("Buang perubahan?")).toBeNull());
    expect((screen.getByRole("textbox", { name: /isi berkas/i }) as HTMLTextAreaElement).value).toBe("# draf saya");
  });

  it("pindah skill saat draft kotor: konfirmasi membuang draft dan berpindah", async () => {
    mockFetch();
    render(<SkillsWorkspace />);
    await dirtyEditor();
    fireEvent.click(screen.getByText("deploy"));
    fireEvent.click(await screen.findByRole("button", { name: "Buang perubahan" }));
    await waitFor(() => expect(screen.getByText("deploy/")).toBeTruthy());
  });

  it("pindah skill tanpa perubahan tidak meminta konfirmasi", async () => {
    mockFetch();
    render(<SkillsWorkspace />);
    fireEvent.click(await screen.findByText("shared-a"));
    await screen.findByText("references/");
    fireEvent.click(screen.getByText("deploy"));
    await waitFor(() => expect(screen.getByText("deploy/")).toBeTruthy());
    expect(screen.queryByText("Buang perubahan?")).toBeNull();
  });

  describe("Timpa", () => {
    it("meminta konfirmasi dengan dampak, lalu menulis di atas hash terbaru", async () => {
      const put = vi.fn();
      let reads = 0;
      mockFetch((u, init) => {
        if (init?.method === "PUT") {
          const body = JSON.parse(String(init.body));
          put(body);
          return body.baseHash === "h-fresh" ? json({ hash: "h3" }) : json({ error: "berubah" }, 409);
        }
        if (!u.includes("/file?")) return null;
        reads++;
        return json({ path: "SKILL.md", size: 10, hash: reads > 1 ? "h-fresh" : "h1", content: "---\nname: shared-a\ndescription: Use when x\n---\n# isi", binary: false, tooLarge: false });
      });
      render(<SkillsWorkspace />);
      await dirtyEditor();
      fireEvent.click(screen.getByRole("button", { name: "Simpan" }));
      await screen.findByText(/berubah di tempat lain/);
      fireEvent.click(screen.getByRole("button", { name: "Timpa" }));
      expect(await screen.findByText("Timpa SKILL.md?")).toBeTruthy();
      expect(screen.getByText(/hilang/)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Timpa berkas" }));
      await waitFor(() => expect(screen.queryByText(/berubah di tempat lain/)).toBeNull());
      expect(put).toHaveBeenLastCalledWith(expect.objectContaining({ baseHash: "h-fresh", content: "# draf saya" }));
      expect(screen.queryByText("belum disimpan")).toBeNull();
    });

    it("gagal menimpa menampilkan galat inline dan mempertahankan draft", async () => {
      mockFetch((u, init) => init?.method === "PUT" ? json({ error: "disk penuh" }, 500) : null);
      render(<SkillsWorkspace />);
      await dirtyEditor();
      fireEvent.click(screen.getByRole("button", { name: "Simpan" }));
      await screen.findByText(/Gagal menyimpan berkas: disk penuh/);
      fireEvent.click(screen.getByRole("button", { name: "Timpa" }));
      fireEvent.click(await screen.findByRole("button", { name: "Timpa berkas" }));
      expect(await screen.findByText(/Gagal menimpa berkas: disk penuh/)).toBeTruthy();
      expect((screen.getByRole("textbox", { name: /isi berkas/i }) as HTMLTextAreaElement).value).toBe("# draf saya");
    });
  });

  describe("berkas baru", () => {
    it("memakai Modal DS dengan validasi, bukan window.prompt", async () => {
      const prompt = vi.spyOn(window, "prompt");
      const post = vi.fn();
      mockFetch((u, init) => {
        if (init?.method === "POST" && u.endsWith("/entry")) { post(JSON.parse(String(init.body))); return json({}); }
        return null;
      });
      render(<SkillsWorkspace />);
      fireEvent.click(await screen.findByText("shared-a"));
      await screen.findByText("references/");
      fireEvent.click(screen.getByRole("button", { name: "Berkas" }));
      const input = await screen.findByRole("textbox", { name: "Path berkas" });
      const submit = screen.getByRole("button", { name: "Buat" }) as HTMLButtonElement;
      expect(submit.disabled).toBe(true);
      fireEvent.change(input, { target: { value: "a\\b.md" } });
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(screen.getByText(/bukan \\/)).toBeTruthy();
      expect(submit.disabled).toBe(true);
      fireEvent.change(input, { target: { value: "../x.md" } });
      expect(submit.disabled).toBe(true);
      fireEvent.change(input, { target: { value: "SKILL.md" } });
      expect(screen.getByText(/sudah ada/)).toBeTruthy();
      fireEvent.change(input, { target: { value: "references/baru.md" } });
      expect(input.getAttribute("aria-invalid")).toBeNull();
      expect(submit.disabled).toBe(false);
      fireEvent.click(submit);
      await waitFor(() => expect(post).toHaveBeenCalled());
      expect(prompt).not.toHaveBeenCalled();
    });
  });
});
