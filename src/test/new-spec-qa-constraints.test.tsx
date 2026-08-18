import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../src/api/client", () => ({
  api: { listBranches: vi.fn(async () => ({ branches: ["main"], remotes: [] })) },
  ApiError: class extends Error {},
}));

import { NewSpecModal } from "../src/App";

// SPEC-826 · form buat-backlog adalah pintu tempat pelapor QA menuliskan batasannya. Tanpa field
// di sini, `zQaPayload.constraints` cuma hidup di skema dan tak pernah terisi manusia.
const projects = [{ id: "p1", name: "P1" }] as any;

describe("SPEC-826 · Batasan di form temuan QA", () => {
  it("tab QA finding merender Batasan berikut contoh nilainya (SPEC-490)", () => {
    render(<NewSpecModal open onClose={() => {}} projects={projects} defaultProject="p1" onCreate={vi.fn()} />);
    fireEvent.click(screen.getByText("QA finding"));
    expect((screen.getByLabelText("Batasan") as HTMLInputElement).placeholder)
      .toBe("mis. jangan ubah kontrak API");
  });

  it("Filekan meneruskan constraints yang diketik ke onCreate", () => {
    const onCreate = vi.fn();
    render(<NewSpecModal open onClose={() => {}} projects={projects} defaultProject="p1" onCreate={onCreate} />);
    fireEvent.click(screen.getByText("QA finding"));
    fireEvent.change(screen.getByLabelText("Judul"), { target: { value: "Funnel dobel" } });
    fireEvent.change(screen.getByLabelText("Batasan"), { target: { value: "jangan ubah kontrak API" } });
    fireEvent.click(screen.getByText("Filekan finding → audit"));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({
      kind: "qa", constraints: "jangan ubah kontrak API" }));
  });
});
