// SPEC-847 · ADR-0127 · kontrak useConfirm: satu promise per dialog, diselesaikan tepat sekali;
// `run` menahan dialog terbuka & busy selama mutasi (pending protection); lemparan `run`
// diteruskan ke pemanggil, TIDAK diterjemahkan jadi `false`.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { useConfirm, type ConfirmOptions } from "../src/ds/useConfirm";

function Harness({ options, onResult }: { options: ConfirmOptions; onResult: (r: unknown) => void }) {
  const { confirm, dialog } = useConfirm();
  return (
    <>
      <button onClick={() => { confirm(options).then((ok) => onResult(ok), (e) => onResult(e)); }}>Picu</button>
      {dialog}
    </>
  );
}

const open = () => fireEvent.click(screen.getByRole("button", { name: "Picu" }));

describe("useConfirm (SPEC-847)", () => {
  it("Batal → resolve false; dialog tertutup", async () => {
    const onResult = vi.fn();
    render(<Harness options={{ title: "Hapus X?" }} onResult={onResult} />);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Batal" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
    expect(screen.queryByText("Hapus X?")).toBeNull();
  });

  it("Konfirmasi tanpa run → resolve true seketika", async () => {
    const onResult = vi.fn();
    render(<Harness options={{ title: "Hapus X?", confirmLabel: "Hapus" }} onResult={onResult} />);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Hapus" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
  });

  it("run menahan dialog terbuka & mematikan Batal/konfirmasi selama pending", async () => {
    let release!: () => void;
    const run = vi.fn(() => new Promise<void>((r) => { release = () => r(); }));
    const onResult = vi.fn();
    render(<Harness options={{ title: "Hapus X?", confirmLabel: "Hapus", run }} onResult={onResult} />);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Hapus" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Batal" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Hapus" })).toBeDisabled();
    expect(screen.getByText("Hapus X?")).toBeTruthy();
    expect(onResult).not.toHaveBeenCalled();
    release();
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    expect(screen.queryByText("Hapus X?")).toBeNull();
  });

  it("klik ganda pada konfirmasi menjalankan run TEPAT sekali", async () => {
    let release!: () => void;
    const run = vi.fn(() => new Promise<void>((r) => { release = () => r(); }));
    render(<Harness options={{ title: "Hapus X?", confirmLabel: "Hapus", run }} onResult={() => {}} />);
    open();
    const btn = await screen.findByRole("button", { name: "Hapus" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    release();
  });

  it("run yang melempar membuat confirm() melempar — bukan resolve false", async () => {
    const boom = new Error("409");
    const onResult = vi.fn();
    render(<Harness options={{ title: "Hapus X?", confirmLabel: "Hapus", run: () => Promise.reject(boom) }}
      onResult={onResult} />);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Hapus" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(boom));
  });

  it("Escape membatalkan selama belum pending", async () => {
    const onResult = vi.fn();
    render(<Harness options={{ title: "Hapus X?" }} onResult={onResult} />);
    open();
    await screen.findByText("Hapus X?");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it("Escape TIDAK membatalkan saat mutasi pending", async () => {
    let release!: () => void;
    const onResult = vi.fn();
    render(<Harness options={{ title: "Hapus X?", confirmLabel: "Hapus",
      run: () => new Promise<void>((r) => { release = () => r(); }) }} onResult={onResult} />);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Hapus" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Batal" })).toBeDisabled());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onResult).not.toHaveBeenCalled();
    expect(screen.getByText("Hapus X?")).toBeTruthy();
    release();
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
  });

  it("fokus awal bukan tombol destruktif, dan kembali ke pemicu saat tutup", async () => {
    render(<Harness options={{ title: "Hapus X?", confirmLabel: "Hapus" }} onResult={() => {}} />);
    const trigger = screen.getByRole("button", { name: "Picu" });
    trigger.focus();
    open();
    await screen.findByText("Hapus X?");
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Hapus" }));
    expect((document.activeElement as HTMLElement).getAttribute("aria-label")).toBe("Tutup");
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("dialog kedua membatalkan dialog pertama alih-alih menggantungkannya", async () => {
    const onResult = vi.fn();
    render(<Harness options={{ title: "Hapus X?" }} onResult={onResult} />);
    open();
    await screen.findByText("Hapus X?");
    open();
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });
});
