import { describe, expect, it, vi } from "vitest";
import {
  createDiagRecorder, DIAG_BATCH_MS, DIAG_MAX_BUFFER, showBytes,
} from "../src/screens/terminal-diag";

describe("showBytes", () => {
  // Muatan input TUI agen ESC-berat. Kalau ESC ditulis apa adanya ke JSONL, berkasnya tak bisa
  // dibaca mata dan `\x1b[A` tak bisa dibedakan dari huruf `[A` yang benar-benar diketik —
  // padahal justru perbedaan itu yang sedang diselidiki.
  it("menampilkan ESC, kontrol C0, dan DEL sebagai teks yang bisa dibaca", () => {
    expect(showBytes("\x1b[A")).toBe("\\e[A");
    expect(showBytes("\r")).toBe("\\r");
    expect(showBytes("\n")).toBe("\\n");
    expect(showBytes("\t")).toBe("\\t");
    expect(showBytes("\x7f")).toBe("\\x7f");
    expect(showBytes("\x03")).toBe("\\x03");
  });

  it("membiarkan grafem cetak apa adanya, termasuk non-ASCII", () => {
    expect(showBytes("abc")).toBe("abc");
    expect(showBytes("é❯")).toBe("é❯");
  });

  it("tak pernah kehilangan karakter", () => {
    expect(showBytes("a\x1bb")).toBe("a\\eb");
  });
});

describe("createDiagRecorder", () => {
  const setup = (over: Partial<Parameters<typeof createDiagRecorder>[0]> = {}) => {
    const sent: unknown[][] = [];
    let clock = 1_000;
    const rec = createDiagRecorder({
      now: () => clock,
      send: (ev) => sent.push(ev),
      ...over,
    });
    return { rec, sent, tick: (ms: number) => { clock += ms; } };
  };

  it("menstempel tiap peristiwa relatif terhadap peristiwa pertama", () => {
    vi.useFakeTimers();
    const { rec, sent, tick } = setup();
    rec.record("key", "a", 65);
    tick(120);
    rec.record("data", "a");
    rec.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual([
      { t: 0, k: "key", v: "a", n: 65 },
      { t: 120, k: "data", v: "a" },
    ]);
    vi.useRealTimers();
  });

  it("menggabungkan peristiwa dalam satu jendela batch, bukan satu frame per tombol", () => {
    vi.useFakeTimers();
    const { rec, sent } = setup();
    rec.record("key", "a");
    rec.record("key", "b");
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(DIAG_BATCH_MS);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(2);
    vi.useRealTimers();
  });

  it("tak mengirim frame kosong saat tak ada yang tercatat", () => {
    vi.useFakeTimers();
    const { rec, sent } = setup();
    rec.flush();
    vi.advanceTimersByTime(DIAG_BATCH_MS * 4);
    expect(sent).toEqual([]);
    vi.useRealTimers();
  });

  // Perekam ini menyala di jaringan yang sedang bermasalah. Kalau `send` gagal atau operator
  // mengetik lebih cepat dari kurasannya, buffer tak boleh tumbuh tanpa batas di dalam tab.
  it("membuang peristiwa TERTUA saat buffer penuh, bukan yang terbaru", () => {
    vi.useFakeTimers();
    const { rec, sent } = setup();
    for (let i = 0; i < DIAG_MAX_BUFFER + 5; i += 1) rec.record("key", `k${i}`);
    rec.flush();
    const batch = sent[0] as { v: string }[];
    expect(batch).toHaveLength(DIAG_MAX_BUFFER);
    expect(batch[batch.length - 1]!.v).toBe(`k${DIAG_MAX_BUFFER + 4}`);
    expect(batch[0]!.v).toBe("k5");
    vi.useRealTimers();
  });

  it("dispose menguras sisa dan menghentikan timer", () => {
    vi.useFakeTimers();
    const { rec, sent } = setup();
    rec.record("key", "a");
    rec.dispose();
    expect(sent).toHaveLength(1);
    rec.record("key", "b");
    vi.advanceTimersByTime(DIAG_BATCH_MS * 4);
    expect(sent).toHaveLength(1);
    vi.useRealTimers();
  });
});
