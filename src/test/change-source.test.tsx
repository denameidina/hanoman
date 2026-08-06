import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChangeSourceDialog } from "../src/screens/ChangeSourceDialog";
import { SOURCE_META } from "../src/screens/source-meta";
import type { Spec } from "../src/screens/types";

const base = {
  id: "SPEC-800", projectId: "p", title: "Judul", stage: "brainstorming", priority: "sedang",
  author: "dena", objective: "o", branchFrom: null, baseSha: null,
  createdAt: "2026-08-06T00:00:00.000Z", startedAt: null, dependsOn: [], blockedBy: [],
  autoMerge: null, sourceHistory: [],
} as unknown as Spec;
const briefSpec = { ...base, source: "brief",
  payload: { context: "gejalanya", outcome: "maunya", constraints: "tanpa cache", priority: "sedang" } } as Spec;

describe("SPEC-546 · lencana & tab source", () => {
  it("SOURCE_META punya entri help — tanpa itu item Help Center memakai lencana brief", () => {
    expect(SOURCE_META.help).toBeTruthy();
    expect(SOURCE_META.help!.label).toBe("Help Center");
    expect(Object.keys(SOURCE_META).sort()).toEqual(["audit", "brief", "goal", "help", "qa"]);
  });
});

describe("SPEC-546 · ChangeSourceDialog", () => {
  it("item belum dimulai menawarkan keempat source lain", () => {
    render(<ChangeSourceDialog spec={briefSpec} onClose={() => {}} onSubmit={() => {}} />);
    const sel = screen.getByLabelText("Type tujuan") as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value).sort()).toEqual(["audit", "goal", "help", "qa"]);
  });

  it("memilih qa merender field bentuk qa ter-prefill convertPayload", () => {
    render(<ChangeSourceDialog spec={briefSpec} onClose={() => {}} onSubmit={() => {}} />);
    fireEvent.change(screen.getByLabelText("Type tujuan"), { target: { value: "qa" } });
    expect((screen.getByLabelText("Aktual") as HTMLTextAreaElement).value).toBe("gejalanya");
    expect((screen.getByLabelText("Diharapkan") as HTMLTextAreaElement).value).toBe("maunya");
    expect((screen.getByLabelText("Langkah reproduksi") as HTMLTextAreaElement).value).toBe("");
  });

  it("memberitahu field yang tak punya padanan, dan menyebut jejak sebagai penyelamatnya", () => {
    render(<ChangeSourceDialog spec={briefSpec} onClose={() => {}} onSubmit={() => {}} />);
    fireEvent.change(screen.getByLabelText("Type tujuan"), { target: { value: "qa" } });
    expect(screen.getByTestId("source-dropped").textContent).toContain("Constraints");
    expect(screen.getByTestId("source-dropped").textContent).toContain("jejak konversi");
  });

  it("Simpan mengirim source + payload hasil form", () => {
    const onSubmit = vi.fn();
    render(<ChangeSourceDialog spec={briefSpec} onClose={() => {}} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Type tujuan"), { target: { value: "qa" } });
    fireEvent.change(screen.getByLabelText("Langkah reproduksi"), { target: { value: "1. buka" } });
    fireEvent.click(screen.getByRole("button", { name: /Ubah type/i }));
    expect(onSubmit).toHaveBeenCalledWith("qa", expect.objectContaining({
      severity: "minor", steps: "1. buka", actual: "gejalanya", expected: "maunya",
    }));
  });

  it("item yang sudah dimulai hanya menawarkan source se-flow dan tak menampilkan form", () => {
    const started = { ...briefSpec, stage: "executing", baseSha: "abc" } as Spec;
    const onSubmit = vi.fn();
    render(<ChangeSourceDialog spec={started} onClose={() => {}} onSubmit={onSubmit} />);
    const sel = screen.getByLabelText("Type tujuan") as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value)).toEqual(["help"]);
    expect(screen.queryByLabelText("Konteks")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Ubah type/i }));
    expect(onSubmit).toHaveBeenCalledWith("help", undefined);
  });
});
