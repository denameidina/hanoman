import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WEBHOOK_EVENTS, WEBHOOK_MAX_ATTEMPTS, WEBHOOK_TOLERANCE_SEC } from "@hanoman/shared";
import { WebhookDocs } from "./WebhookDocs";

describe("WebhookDocs", () => {
  it("mendaftar SETIAP jenis peristiwa dari katalog — tak ada yang ditulis tangan", () => {
    render(<WebhookDocs />);
    for (const e of WEBHOOK_EVENTS) expect(screen.getAllByText(e.type).length).toBeGreaterThan(0);
  });

  it("menyebut kapan tiap peristiwa terpicu", () => {
    render(<WebhookDocs />);
    for (const e of WEBHOOK_EVENTS) expect(screen.getByText(e.when)).toBeTruthy();
  });

  it("menampilkan contoh payload yang bisa disalin", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<WebhookDocs />);
    fireEvent.click(screen.getAllByRole("button", { name: /^salin contoh spec\.created$/i })[0]!);
    expect(writeText).toHaveBeenCalled();
    expect(String(writeText.mock.calls[0]![0])).toContain("hanoman.webhook/1");
  });

  it("memuat potongan verifikasi tanda tangan siap pakai untuk Node dan Python", () => {
    render(<WebhookDocs />);
    expect(screen.getByText(/createHmac/)).toBeTruthy();
    expect(screen.getByText(/timingSafeEqual/)).toBeTruthy();
    expect(screen.getByText(/hmac\.new/)).toBeTruthy();
    expect(screen.getByText(/compare_digest/)).toBeTruthy();
  });

  it("menyebut aturan retry, pengiriman ganda, dan idempotensi dengan angkanya", () => {
    render(<WebhookDocs />);
    expect(screen.getByText(new RegExp(`${WEBHOOK_MAX_ATTEMPTS} percobaan`))).toBeTruthy();
    expect(screen.getAllByText(/idempoten/i).length).toBeGreaterThan(0);
    expect(screen.getByText(new RegExp(`${WEBHOOK_TOLERANCE_SEC} detik`))).toBeTruthy();
  });

  it("memuat panduan langkah demi langkah penerima pertama", () => {
    render(<WebhookDocs />);
    expect(screen.getByText(/penerima webhook pertama/i)).toBeTruthy();
    expect(screen.getAllByText(/^Langkah \d/).length).toBeGreaterThanOrEqual(4);
  });

  it("menyebut nama seluruh header kontrak", () => {
    render(<WebhookDocs />);
    for (const h of ["X-Hanoman-Event", "X-Hanoman-Event-Id", "X-Hanoman-Delivery",
      "X-Hanoman-Attempt", "X-Hanoman-Timestamp", "X-Hanoman-Signature"])
      expect(screen.getAllByText(new RegExp(h)).length).toBeGreaterThan(0);
  });

  it("menyatakan batas DNS rebinding apa adanya, bukan menjanjikan aman total", () => {
    render(<WebhookDocs />);
    expect(screen.getByText(/rebinding/i)).toBeTruthy();
  });

  it("tombol kembali memanggil onBack", () => {
    const onBack = vi.fn();
    render(<WebhookDocs onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /kembali/i }));
    expect(onBack).toHaveBeenCalled();
  });

  // Anggaran gaya inline (Z3): layout lewat kelas `hn-wh-*` di integrations.css.
  it("layout lewat kelas: gaya inline tinggal ≤ 6", () => {
    const src = readFileSync(resolve(import.meta.dirname, "WebhookDocs.tsx"), "utf8");
    expect((src.match(/style=\{\{/g) ?? []).length).toBeLessThanOrEqual(6);
  });
});
