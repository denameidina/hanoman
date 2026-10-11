// Audit UI/UX 2026-10 · varian danger untuk ProgressBar, Callout, Radio/RadioGroup, dan Field.
// Warnanya hidup di CSS (feedback.css, forms.css), bukan di style inline: jsdom tak memuat stylesheet,
// jadi yang diikat di sini adalah KONTRAKNYA: atribut data-tone yang dipasang, tak adanya warna inline
// di elemen yang seharusnya lewat kelas, dan aturan CSS yang memakai token --status-err.
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Callout, ProgressBar } from "../src/ds/components/feedback";
import { RadioGroup, Radio, Input } from "../src/ds/components/forms";
import { Field } from "../src/ds/kit";

const dsCss = (file: string) => readFileSync(resolve(import.meta.dirname, `../src/ds/components/${file}`), "utf8");
const feedbackCss = dsCss("feedback.css");
const formsCss = dsCss("forms.css");

afterEach(cleanup);

describe("Callout · tone danger", () => {
  it("danger memakai role alert dan ikon galat, sama dengan err", () => {
    const { container } = render(<Callout tone="danger">Gagal menyimpan</Callout>);
    const box = screen.getByRole("alert");
    expect(box).toHaveTextContent("Gagal menyimpan");
    expect(box).toHaveClass("hn-callout");
    expect(box).toHaveAttribute("data-tone", "danger");
    expect(container.querySelector('[data-icon="octagon-alert"]')).not.toBeNull();
  });

  it("warna danger lewat kelas: tak ada background atau warna inline di akarnya", () => {
    render(<Callout tone="danger">Gagal</Callout>);
    const box = screen.getByRole("alert");
    expect(box.style.background).toBe("");
    expect(box.style.borderLeft).toBe("");
    expect(box.style.color).toBe("");
  });

  it("err dan danger sama-sama di aturan CSS yang memakai token status galat", () => {
    expect(feedbackCss).toMatch(/\.hn-callout\[data-tone="err"\],\s*\.hn-callout\[data-tone="danger"\]\s*\{[^}]*color:\s*var\(--clay-600\)/);
    expect(feedbackCss).toMatch(/\.hn-callout\[data-tone="danger"\][^{]*\{[^}]*background:\s*var\(--status-err-tint\)/);
    expect(feedbackCss).toMatch(/\.hn-callout\[data-tone="danger"\][^{]*\{[^}]*border-left-color:\s*var\(--status-err\)/);
  });

  it("tone yang tak dikenal jatuh ke info, bukan ke warna kosong", () => {
    render(<Callout tone={"tidak-ada" as never}>catatan</Callout>);
    expect(screen.getByRole("note")).toHaveAttribute("data-tone", "info");
  });
});

describe("ProgressBar · tone danger", () => {
  it("isian memakai data-tone danger, dan warnanya bukan style inline", () => {
    const { container } = render(<ProgressBar value={40} label="Kuota" tone="danger" />);
    expect(screen.getByRole("progressbar", { name: "Kuota" })).toBeInTheDocument();
    const fill = container.querySelector<HTMLElement>('[role="progressbar"] > .hn-progress-fill')!;
    expect(fill).toHaveAttribute("data-tone", "danger");
    expect(fill.style.background).toBe("");
    // Lebar tetap inline: nilainya dinamis dan memang tak bisa lewat kelas.
    expect(fill.style.width).toBe("40%");
  });

  it("danger dan err memakai aturan CSS yang sama, dengan token --status-err", () => {
    expect(feedbackCss).toMatch(/\.hn-progress-fill\[data-tone="err"\],\s*\.hn-progress-fill\[data-tone="danger"\]\s*\{\s*background:\s*var\(--status-err\)/);
  });

  it("tone yang tak dikenal jatuh ke brass", () => {
    const { container } = render(<ProgressBar value={1} tone={"nope" as never} />);
    expect(container.querySelector(".hn-progress-fill")).toHaveAttribute("data-tone", "brass");
  });
});

describe("RadioGroup dan Radio · tone danger", () => {
  function Harness({ tone }: { tone?: "default" | "danger" }) {
    const [value, setValue] = useState<string | null>("b");
    return (
      <RadioGroup aria-label="Hapus" value={value} tone={tone} onChange={(v) => setValue(v)}>
        <Radio value="a" label="Arsipkan" />
        <Radio value="b" label="Hapus permanen" />
        <Radio value="c" label="Biarkan" tone="default" />
      </RadioGroup>
    );
  }

  it("tone grup berlaku ke tiap Radio; Radio boleh menimpanya sendiri", () => {
    const { container } = render(<Harness tone="danger" />);
    const labels = Array.from(container.querySelectorAll<HTMLElement>(".hn-choice-target"));
    expect(labels.map((l) => l.getAttribute("data-tone"))).toEqual(["danger", "danger", "default"]);
  });

  it("cincin dan titik tak membawa style inline; keadaan terpilih tetap terbaca", () => {
    const { container } = render(<Harness tone="danger" />);
    const ring = container.querySelector(".hn-radio-ring");
    expect(ring).not.toBeNull();
    expect(ring!.getAttribute("style")).toBeNull();
    expect(container.querySelector(".hn-radio-dot")).not.toBeNull();
    expect(screen.getByRole("radio", { name: "Hapus permanen" })).toHaveAttribute("aria-checked", "true");
  });

  it("panah tetap memilih di grup danger", () => {
    render(<Harness tone="danger" />);
    expect(screen.getByRole("radiogroup", { name: "Hapus" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("radio", { name: "Hapus permanen" }), { key: "ArrowDown" });
    expect(screen.getByRole("radio", { name: "Biarkan" })).toHaveAttribute("aria-checked", "true");
  });

  it("Radio tanpa grup mendukung tone danger lewat propnya sendiri", () => {
    const { container } = render(<Radio label="Hapus" checked onChange={() => {}} tone="danger" />);
    expect(container.querySelector(".hn-choice-target")).toHaveAttribute("data-tone", "danger");
  });

  it("warna danger di forms.css: cincin, titik, dan label memakai --status-err / --clay-600", () => {
    expect(formsCss).toMatch(/\.hn-choice-target\[data-tone="danger"\] \.hn-radio-ring,[\s\S]*?\{\s*border-color:\s*var\(--status-err\)/);
    expect(formsCss).toMatch(/\.hn-choice-target\[data-tone="danger"\] \.hn-radio-dot\s*\{\s*background:\s*var\(--status-err\)/);
    expect(formsCss).toMatch(/\.hn-choice-target\[data-tone="danger"\] \.hn-radio-label\s*\{\s*color:\s*var\(--clay-600\)/);
  });
});

describe("Field · tone danger", () => {
  it("menandai Field dan menyalakan keadaan invalid pada kontrol tanpa pesan", () => {
    const { container } = render(<Field label="Nama tim" tone="danger"><Input placeholder="mis. kirana" /></Field>);
    expect(container.querySelector(".hn-field")).toHaveAttribute("data-tone", "danger");
    const input = screen.getByLabelText("Nama tim");
    expect(input).toHaveAttribute("aria-invalid", "true");
    // Tanpa `error`, tak ada pesan yang diumumkan.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("border kontrol invalid memakai --status-err, sama dengan invalid biasa", () => {
    const { container } = render(<Field label="Port" tone="danger"><Input placeholder="22" /></Field>);
    const wrapper = container.querySelector<HTMLElement>(".hn-input-core")!.parentElement!;
    expect(wrapper.style.border).toContain("var(--status-err)");
  });

  it("tone default tak mengubah apa pun: data-tone default dan tanpa aria-invalid", () => {
    const { container } = render(<Field label="Port"><Input placeholder="22" /></Field>);
    expect(container.querySelector(".hn-field")).toHaveAttribute("data-tone", "default");
    expect(screen.getByLabelText("Port")).not.toHaveAttribute("aria-invalid");
  });

  it("danger bersama error: pesan tetap role=alert dan keduanya menyatu", () => {
    render(<Field label="Port" tone="danger" error="Harus angka 1–65535"><Input placeholder="22" /></Field>);
    expect(screen.getByRole("alert")).toHaveTextContent("Harus angka 1–65535");
    expect(screen.getByLabelText("Port")).toHaveAttribute("aria-invalid", "true");
  });

  it("label berwarna galat lewat aturan CSS, bukan inline", () => {
    expect(formsCss).toMatch(/\.hn-field\[data-tone="danger"\] > \.hn-field-label\s*\{\s*color:\s*var\(--status-err\)/);
    const { container } = render(<Field label="Port" tone="danger"><Input placeholder="22" /></Field>);
    expect(container.querySelector<HTMLElement>(".hn-field-label")!.style.color).toBe("");
  });
});
