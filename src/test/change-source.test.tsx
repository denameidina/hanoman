import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChangeSourceDialog } from "../src/screens/ChangeSourceDialog";
import { SOURCE_META } from "../src/screens/source-meta";
import { BacklogScreen } from "../src/screens/BacklogScreen";
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
    expect(Object.keys(SOURCE_META).sort()).toEqual(["audit", "brief", "goal", "help", "no_effort", "qa"]);
  });
});

describe("SPEC-546 · ChangeSourceDialog", () => {
  it("item belum dimulai menawarkan kelima source lain", () => {
    render(<ChangeSourceDialog spec={briefSpec} onClose={() => {}} onSubmit={async () => null} />);
    const sel = screen.getByLabelText("Type tujuan") as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value).sort()).toEqual(["audit", "goal", "help", "no_effort", "qa"]);
  });

  it("memilih qa merender field bentuk qa ter-prefill convertPayload, Batasan ikut", () => {
    render(<ChangeSourceDialog spec={briefSpec} onClose={() => {}} onSubmit={async () => null} />);
    fireEvent.change(screen.getByLabelText("Type tujuan"), { target: { value: "qa" } });
    expect((screen.getByLabelText("Aktual") as HTMLTextAreaElement).value).toBe("gejalanya");
    expect((screen.getByLabelText("Diharapkan") as HTMLTextAreaElement).value).toBe("maunya");
    expect((screen.getByLabelText("Langkah reproduksi") as HTMLTextAreaElement).value).toBe("");
    // SPEC-826 · batasan brief menyeberang ke bentuk qa alih-alih dilaporkan hilang.
    expect((screen.getByLabelText("Batasan") as HTMLTextAreaElement).value).toBe("tanpa cache");
  });

  it("memberitahu field yang tak punya padanan, dan menyebut jejak sebagai penyelamatnya", () => {
    render(<ChangeSourceDialog spec={briefSpec} onClose={() => {}} onSubmit={async () => null} />);
    // brief → goal masih membuang Konteks; brief → qa sejak SPEC-826 tak membuang apa pun.
    fireEvent.change(screen.getByLabelText("Type tujuan"), { target: { value: "goal" } });
    expect(screen.getByTestId("source-dropped").textContent).toContain("Konteks");
    expect(screen.getByTestId("source-dropped").textContent).toContain("jejak konversi");
  });

  it("SPEC-826 · brief → qa tak lagi melaporkan apa pun sebagai hilang", () => {
    render(<ChangeSourceDialog spec={briefSpec} onClose={() => {}} onSubmit={async () => null} />);
    fireEvent.change(screen.getByLabelText("Type tujuan"), { target: { value: "qa" } });
    expect(screen.queryByTestId("source-dropped")).toBeNull();
  });

  it("Simpan mengirim source + payload hasil form", () => {
    const onSubmit = vi.fn();
    render(<ChangeSourceDialog spec={briefSpec} onClose={() => {}} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Type tujuan"), { target: { value: "qa" } });
    fireEvent.change(screen.getByLabelText("Langkah reproduksi"), { target: { value: "1. buka" } });
    fireEvent.click(screen.getByRole("button", { name: /Ubah type/i }));
    // ADR-0149 · argumen ketiga = confirmReset; item ini belum dimulai, jadi tak pernah terisi.
    expect(onSubmit).toHaveBeenCalledWith("qa", expect.objectContaining({
      severity: "minor", steps: "1. buka", actual: "gejalanya", expected: "maunya",
    }), undefined);
  });

  // ADR-0149 · dulu saringan flow menyisakan NOL opsi untuk qa/audit/goal/no_effort yang sudah
  // dimulai, dan dialog menjawabnya dengan `return null` — tombol terklik, tak ada modal.
  it("item yang sudah dimulai kini menawarkan KELIMA source lain", () => {
    const started = { ...briefSpec, stage: "executing", baseSha: "abc" } as Spec;
    render(<ChangeSourceDialog spec={started} onClose={() => {}} onSubmit={async () => null} />);
    const sel = screen.getByLabelText("Type tujuan") as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value).sort())
      .toEqual(["audit", "goal", "help", "no_effort", "qa"]);
  });

  it("se-alur pada item berjalan: tanpa form, tanpa peringatan reset", () => {
    const started = { ...briefSpec, stage: "executing", baseSha: "abc" } as Spec;
    const onSubmit = vi.fn(async () => null);
    render(<ChangeSourceDialog spec={started} onClose={() => {}} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Type tujuan"), { target: { value: "help" } });
    expect(screen.queryByTestId("source-reset-warning")).toBeNull();
    expect(screen.queryByLabelText("Konteks")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Ubah type/i }));
    expect(onSubmit).toHaveBeenCalledWith("help", undefined, undefined);
  });

  it("lintas-alur pada item berjalan: form konversi + peringatan reset", () => {
    const started = { ...briefSpec, stage: "executing", baseSha: "abc" } as Spec;
    render(<ChangeSourceDialog spec={started} onClose={() => {}} onSubmit={async () => null} />);
    fireEvent.change(screen.getByLabelText("Type tujuan"), { target: { value: "qa" } });
    expect(screen.getByTestId("source-reset-warning").textContent).toContain("Brainstorming");
    expect((screen.getByLabelText("Aktual") as HTMLTextAreaElement).value).toBe("gejalanya");
  });

  it("balasan pending memunculkan daftar konkret, lalu submit kedua membawa confirmReset", async () => {
    const started = { ...briefSpec, stage: "executing", baseSha: "abc" } as Spec;
    const onSubmit = vi.fn()
      .mockResolvedValueOnce({ pending: true, wouldDelete: ["docs/superpowers/plans/spec-800-plan.md"],
        worktree: "/repo/.worktrees/spec-800", branch: "hanoman/spec-800" })
      .mockResolvedValueOnce(null);
    render(<ChangeSourceDialog spec={started} onClose={() => {}} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("Type tujuan"), { target: { value: "qa" } });
    fireEvent.click(screen.getByRole("button", { name: /^Ubah type$/i }));

    const list = await screen.findByTestId("source-reset-impact");
    expect(list.textContent).toContain("spec-800-plan.md");
    expect(list.textContent).toContain("hanoman/spec-800");

    fireEvent.click(screen.getByRole("button", { name: /Reset & ubah type/i }));
    expect(onSubmit).toHaveBeenLastCalledWith("qa", expect.objectContaining({ actual: "gejalanya" }), true);
  });
});

describe("SPEC-546 · backlog: tab help & jejak konversi", () => {
  it("tab filter punya pintu Help Center", () => {
    render(<BacklogScreen backlog={[]} projects={[]} projectFilter="all" onProjectFilter={() => {}} />);
    expect(screen.getByRole("tab", { name: "Help Center" })).toBeTruthy();
  });

  it("detail menampilkan tombol Ubah type dan blok jejak konversi", () => {
    const withTrail = { ...briefSpec,
      sourceHistory: [{ at: "2026-08-06T04:00:00.000Z", from: "qa", to: "brief", by: "dena@x" }] } as Spec;
    render(<BacklogScreen backlog={[withTrail]} projects={[]} projectFilter="all"
      onProjectFilter={() => {}} initialDetailId="SPEC-800" onChangeSource={() => {}} />);
    expect(screen.getByRole("button", { name: /Ubah type/i })).toBeTruthy();
    expect(screen.getByTestId("source-trail").textContent).toContain("qa → brief");
  });

  // ADR-0149 · regresi untuk keluhan aslinya: "ketika diklik ubah type-nya tidak muncul modalnya".
  it("item qa yang sudah done MEMBUKA modal — dulu tombolnya diam total", () => {
    const doneQa = { ...briefSpec, source: "qa", stage: "done", baseSha: "abc",
      payload: { severity: "minor", steps: "", expected: "e", actual: "a", env: "" } } as Spec;
    render(<BacklogScreen backlog={[doneQa]} projects={[]} projectFilter="all"
      onProjectFilter={() => {}} initialDetailId="SPEC-800" onChangeSource={async () => null} />);
    fireEvent.click(screen.getByRole("button", { name: /Ubah type/i }));
    expect(screen.getByLabelText("Type tujuan")).toBeTruthy();
  });
});
