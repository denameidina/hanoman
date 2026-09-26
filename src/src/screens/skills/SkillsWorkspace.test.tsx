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
  it("mengelompokkan Global dan satu section per project, termasuk error repo", async () => {
    mockFetch();
    render(<SkillsWorkspace />);
    expect(await screen.findByText("shared-a")).toBeTruthy();
    expect(screen.getByText("Global")).toBeTruthy();
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
});
