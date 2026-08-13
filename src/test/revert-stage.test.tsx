import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
// SpecDetail memuat branches lewat api.listBranches di useEffect — mock supaya tak fetch nyata.
vi.mock("../src/api/client", () => ({
  api: { listBranches: vi.fn(async () => ({ branches: [], remotes: [] })) },
  ApiError: class extends Error {},
}));
import { BacklogScreen } from "../src/screens/BacklogScreen";
import type { Spec } from "../src/screens/types";

const spec: Spec = {
  id: "SPEC-167", projectId: "p1", title: "T", source: "brief", stage: "planned",
  priority: "tinggi", author: "Rangga", objective: "obj", payload: {}, branchFrom: null,
} as Spec;

function renderScreen(onRevertStage: any) {
  return render(
    <BacklogScreen backlog={[spec]} projects={[{ id: "p1", name: "p1" } as any]}
      projectFilter="all" onProjectFilter={() => {}} onRevertStage={onRevertStage} />,
  );
}

function StatefulScreen({ initial = spec, respond }: { initial?: Spec; respond?: (...args: any[]) => Promise<any> }) {
  const [backlog, setBacklog] = React.useState([initial]);
  return (
    <BacklogScreen backlog={backlog} projects={[{ id: "p1", name: "p1" } as any]}
      projectFilter="all" onProjectFilter={() => {}}
      onRevertStage={async (current, target, confirmDelete) => {
        const result = respond
          ? await (confirmDelete === undefined
            ? respond(current, target)
            : respond(current, target, confirmDelete))
          : { ...current, stage: target };
        if (result && !("pending" in result)) setBacklog([result]);
        return result;
      }} />
  );
}

describe("revert stage", () => {
  it("dropdown revert hanya menawarkan stage lebih awal dari current", async () => {
    renderScreen(vi.fn());
    fireEvent.click(screen.getByText("T"));
    const sel = await screen.findByLabelText("Kembalikan stage");
    const opts = [...sel.querySelectorAll("option")].map((o) => (o as HTMLOptionElement).value).filter(Boolean);
    expect(opts).toEqual(["brainstorming", "objective", "spec-ready"]);
  });

  it("memilih target menampilkan konsekuensi sebelum menyimpan", async () => {
    const onRevert = vi.fn().mockResolvedValue({ ...spec, stage: "objective" });
    renderScreen(onRevert);
    fireEvent.click(screen.getByText("T"));

    fireEvent.change(await screen.findByLabelText("Kembalikan stage"), { target: { value: "objective" } });

    expect(onRevert).not.toHaveBeenCalled();
    expect(screen.getByText("Plan → Objective")).toBeTruthy();
    expect(screen.getByText(/dokumen Spec\/Plan.*mungkin perlu dihapus/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Simpan status" }));
    await waitFor(() => expect(onRevert).toHaveBeenCalledWith(spec, "objective"));
  });

  it("perubahan sukses menyegarkan status tanpa menutup detail", async () => {
    render(<StatefulScreen />);
    fireEvent.click(screen.getByText("T"));
    fireEvent.change(await screen.findByLabelText("Kembalikan stage"), { target: { value: "objective" } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan status" }));

    expect(await screen.findByText("Status saat ini: Objective")).toBeTruthy();
    expect(screen.getAllByLabelText("Status Objective")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Simpan status" })).toBeTruthy();
  });

  it("status paling awal menjelaskan bahwa tidak ada target manual", async () => {
    render(<StatefulScreen initial={{ ...spec, stage: "brainstorming" }} />);
    fireEvent.click(screen.getByText("T"));

    expect(await screen.findByText("Status saat ini: Brainstorm")).toBeTruthy();
    expect(screen.queryByLabelText("Kembalikan stage")).toBeNull();
    expect(screen.getByText(/status paling awal/i)).toBeTruthy();
  });

  it("mengunci kontrol selama penyimpanan agar submit tidak terkirim ganda", async () => {
    let resolveRequest!: (value: any) => void;
    const request = new Promise((resolve) => { resolveRequest = resolve; });
    const onRevert = vi.fn(() => request);
    renderScreen(onRevert);
    fireEvent.click(screen.getByText("T"));
    const select = await screen.findByLabelText("Kembalikan stage");
    fireEvent.change(select, { target: { value: "objective" } });
    const save = screen.getByRole("button", { name: "Simpan status" });

    fireEvent.click(save);
    fireEvent.click(save);

    expect(onRevert).toHaveBeenCalledTimes(1);
    expect((select as HTMLSelectElement).disabled).toBe(true);
    expect((save as HTMLButtonElement).disabled).toBe(true);

    await act(async () => resolveRequest({ ...spec, stage: "objective" }));
  });

  it("kegagalan mempertahankan target agar operator dapat mencoba lagi", async () => {
    const onRevert = vi.fn().mockResolvedValue(undefined);
    renderScreen(onRevert);
    fireEvent.click(screen.getByText("T"));
    const select = await screen.findByLabelText("Kembalikan stage");
    fireEvent.change(select, { target: { value: "objective" } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan status" }));

    await waitFor(() => expect(onRevert).toHaveBeenCalledTimes(1));
    expect((select as HTMLSelectElement).value).toBe("objective");
    expect((screen.getByRole("button", { name: "Simpan status" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("pending meminta konfirmasi sekali lalu menyegarkan detail tanpa menutupnya", async () => {
    let resolveConfirm!: (value: any) => void;
    const confirmRequest = new Promise((resolve) => { resolveConfirm = resolve; });
    const onRevert = vi.fn()
      .mockResolvedValueOnce({ pending: true, stage: "objective", wouldDelete: ["docs/superpowers/plans/x-spec-167.md"] })
      .mockImplementationOnce(() => confirmRequest);
    render(<StatefulScreen respond={onRevert} />);
    fireEvent.click(screen.getByText("T"));
    const sel = await screen.findByLabelText("Kembalikan stage");
    fireEvent.change(sel, { target: { value: "objective" } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan status" }));
    await waitFor(() => expect(onRevert).toHaveBeenCalledWith(spec, "objective"));
    expect(await screen.findByText(/x-spec-167\.md/)).toBeTruthy();
    const remove = screen.getByRole("button", { name: "Hapus & kembalikan" });
    fireEvent.click(remove);
    fireEvent.click(remove);

    expect(onRevert).toHaveBeenCalledTimes(2);
    expect((remove as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Batal" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getAllByRole("button", { name: "Tutup" }).at(-1)!);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByText(/x-spec-167\.md/)).toBeTruthy();
    expect(screen.getByText("Status saat ini: Plan")).toBeTruthy();

    await act(async () => resolveConfirm({ ...spec, stage: "objective" }));
    await waitFor(() => expect(onRevert).toHaveBeenLastCalledWith(spec, "objective", true));
    expect(await screen.findByText("Status saat ini: Objective")).toBeTruthy();
    expect(screen.queryByText(/x-spec-167\.md/)).toBeNull();
  });
});
