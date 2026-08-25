import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TaskView } from "@hanoman/shared";
import { EscalateDialog } from "../src/screens/EscalateDialog";
import { TeamScreen } from "../src/screens/TeamScreen";
import { api } from "../src/api/client";

const task = (over: Partial<TaskView> = {}): TaskView => ({
  id: "t1", projectId: "p1", title: "Perbaiki halaman harga", detail: null, status: "doing",
  priority: "tinggi", memberId: null, startDate: null, dueDate: null, order: 0,
  specId: null, spec: null, createdAt: "2026-08-25T00:00:00.000Z", updatedAt: "2026-08-25T00:00:00.000Z",
  ...over,
});
const projects = [
  { id: "p1", name: "hanoman" } as any,
  { id: "p2", name: "erp" } as any,
];
const escalated = (over: Partial<TaskView> = {}) =>
  ({ created: true, spec: { id: "SPEC-9" } as any, task: task({ specId: "SPEC-9", ...over }) });

function open(t: TaskView) {
  const onDone = vi.fn(), onClose = vi.fn(), onToast = vi.fn();
  render(<EscalateDialog task={t} projects={projects}
    onClose={onClose} onDone={onDone} onToast={onToast} />);
  return { onDone, onClose, onToast };
}
const submit = () => screen.getByRole("button", { name: /^eskalasi$/i });

beforeEach(() => vi.restoreAllMocks());

describe("EscalateDialog", () => {
  it("default source brief, prioritas PREFILLED dari kartu", async () => {
    const spy = vi.spyOn(api, "escalateTask").mockResolvedValue(escalated());
    open(task());
    fireEvent.click(submit());
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0]![1]).toMatchObject({ source: "brief", priority: "tinggi" });
  });

  it("mengirim source & prioritas yang dipilih operator", async () => {
    const spy = vi.spyOn(api, "escalateTask").mockResolvedValue(escalated());
    open(task());
    fireEvent.change(screen.getByLabelText(/source/i), { target: { value: "qa" } });
    fireEvent.change(screen.getByLabelText(/prioritas/i), { target: { value: "rendah" } });
    fireEvent.click(submit());
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0]![1]).toMatchObject({ source: "qa", priority: "rendah" });
  });

  /* Gerbang project hidup HANYA di JSX; unit test aturan takkan menangkapnya. Kelas bug SPEC-546:
     menolak dengan diam. Di sini penolakannya bernama DAN mendahului request. */
  it("kartu tanpa project: kirim MATI sampai project dipilih, dengan sebab yang tertulis", async () => {
    const spy = vi.spyOn(api, "escalateTask");
    open(task({ projectId: null }));
    expect(submit()).toBeDisabled();
    expect(screen.getByText(/nomor spec/i)).toBeInTheDocument();
    fireEvent.click(submit());
    expect(spy).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/project/i), { target: { value: "p2" } });
    expect(submit()).not.toBeDisabled();
  });

  it("kartu tanpa project: projectId yang dipilih ikut terkirim", async () => {
    const spy = vi.spyOn(api, "escalateTask").mockResolvedValue(escalated({ projectId: "p2" }));
    open(task({ projectId: null }));
    fireEvent.change(screen.getByLabelText(/project/i), { target: { value: "p2" } });
    fireEvent.click(submit());
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls[0]![1]).toMatchObject({ projectId: "p2" });
  });

  it("kartu BER-project tak merender pemilih project", () => {
    open(task());
    expect(screen.queryByLabelText(/project/i)).toBeNull();
  });

  it("sukses: onDone membawa kartu terbaru, toast menyebut nomor SPEC", async () => {
    const r = escalated({ spec: { id: "SPEC-9", stage: "brainstorming", priority: "tinggi" } });
    vi.spyOn(api, "escalateTask").mockResolvedValue(r);
    const { onDone, onClose, onToast } = open(task());
    fireEvent.click(submit());
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(r.task));
    expect(onClose).toHaveBeenCalled();
    expect(onToast.mock.calls[0]![0]).toContain("SPEC-9");
  });

  // Isian operator tak boleh hilang gara-gara jaringan.
  it("galat API: dialog TETAP terbuka, toast galat", async () => {
    vi.spyOn(api, "escalateTask").mockRejectedValue(new Error("boom"));
    const { onClose, onToast } = open(task());
    fireEvent.click(submit());
    await waitFor(() => expect(onToast).toHaveBeenCalled());
    expect(onToast.mock.calls[0]![1]).toBe("err");
    expect(onClose).not.toHaveBeenCalled();
    expect(submit()).toBeInTheDocument();
  });
});

const page = (items: TaskView[]) => ({ items, total: items.length, page: 1, pageSize: 200 });

describe("TeamScreen · wiring eskalasi", () => {
  beforeEach(() => {
    vi.spyOn(api, "listMembers").mockResolvedValue(page([]) as any);
  });

  it("klik Eskalasi membuka dialog untuk kartu itu", async () => {
    vi.spyOn(api, "listTasks").mockImplementation(async (p: any) =>
      page(p.status === "doing" ? [task()] : []) as any);
    render(<TeamScreen projects={projects} projectFilter="all"
      onProjectFilter={() => {}} onToast={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /eskalasi ke backlog/i }));
    expect(await screen.findByLabelText(/source/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/prioritas/i)).toBeInTheDocument();
  });

  it("klik Lepas tautan memanggil API dan mengosongkan lencana di papan", async () => {
    const linked = task({ specId: "SPEC-9", spec: { id: "SPEC-9", stage: "executing", priority: "tinggi" } });
    vi.spyOn(api, "listTasks").mockImplementation(async (p: any) =>
      page(p.status === "doing" ? [linked] : []) as any);
    const spy = vi.spyOn(api, "unlinkTaskSpec").mockResolvedValue(task({ specId: null }));
    render(<TeamScreen projects={projects} projectFilter="all"
      onProjectFilter={() => {}} onToast={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: /lepas tautan/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("t1"));
    await waitFor(() => expect(screen.queryByText("SPEC-9 · executing")).toBeNull());
  });
});
