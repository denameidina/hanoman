// SPEC-847 · AC-1..AC-3 untuk hapus project: nama objek di judul, dampak terstruktur,
// batal/Escape tak memanggil API, konfirmasi memanggil sekali walau diklik berkali-kali,
// dan fokus kembali ke tombol pemicu.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { useConfirm } from "../src/ds/useConfirm";

// Cermin persis badan `deleteProject` di App.tsx — bila keduanya berbeda, test ini kehilangan
// maknanya; jaga tetap sinkron.
function DeleteProjectHarness({ del }: { del: (id: string) => Promise<unknown> }) {
  const { confirm, dialog } = useConfirm();
  const p = { id: "demo", name: "Demo" };
  return (
    <>
      <button onClick={() => {
        void (async () => {
          try {
            if (!await confirm({
              title: `Hapus project "${p.name}"?`,
              message: `Project "${p.id}" dan seluruh isinya dihapus dari dashboard ini.`,
              impact: ["Semua backlog item project ini ikut terhapus.", "Tindakan ini tak bisa dibatalkan."],
              confirmLabel: "Hapus project",
              run: () => del(p.id),
            })) return;
          } catch { /* toast di App */ }
        })();
      }}>Hapus</button>
      {dialog}
    </>
  );
}

describe("hapus project · konfirmasi aplikasi (SPEC-847)", () => {
  it("dialog menyebut nama objek dan dampaknya sebagai daftar", async () => {
    render(<DeleteProjectHarness del={vi.fn(async () => ({}))} />);
    fireEvent.click(screen.getByRole("button", { name: "Hapus" }));
    expect(await screen.findByText('Hapus project "Demo"?')).toBeTruthy();
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Semua backlog item project ini ikut terhapus.", "Tindakan ini tak bisa dibatalkan.",
    ]);
  });

  it("Batal tak memanggil API", async () => {
    const del = vi.fn(async () => ({}));
    render(<DeleteProjectHarness del={del} />);
    fireEvent.click(screen.getByRole("button", { name: "Hapus" }));
    fireEvent.click(await screen.findByRole("button", { name: "Batal" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(del).not.toHaveBeenCalled();
  });

  it("Escape tak memanggil API", async () => {
    const del = vi.fn(async () => ({}));
    render(<DeleteProjectHarness del={del} />);
    fireEvent.click(screen.getByRole("button", { name: "Hapus" }));
    await screen.findByRole("dialog");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(del).not.toHaveBeenCalled();
  });

  it("klik ganda pada konfirmasi memanggil API sekali", async () => {
    let release!: () => void;
    const del = vi.fn(() => new Promise<unknown>((r) => { release = () => r({}); }));
    render(<DeleteProjectHarness del={del} />);
    fireEvent.click(screen.getByRole("button", { name: "Hapus" }));
    const ok = await screen.findByRole("button", { name: "Hapus project" });
    fireEvent.click(ok); fireEvent.click(ok);
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
    release();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("fokus kembali ke tombol pemicu sesudah dialog tutup", async () => {
    render(<DeleteProjectHarness del={vi.fn(async () => ({}))} />);
    const trigger = screen.getByRole("button", { name: "Hapus" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("button", { name: "Batal" }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
