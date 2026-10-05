import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWebSpeechEngine, mapWebSpeechError } from "../src/screens/web-speech-engine";

class FakeRecognition {
  static last: FakeRecognition | undefined;
  lang = ""; continuous = false; interimResults = false;
  started = 0; stopped = 0;
  onresult: ((e: any) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() { FakeRecognition.last = this; }
  start() { this.started += 1; }
  stop() { this.stopped += 1; }
  abort() { this.stopped += 1; }
}

const res = (text: string, isFinal: boolean) => Object.assign([{ transcript: text }], { isFinal });
const win = (extra: Record<string, unknown> = {}) =>
  ({ SpeechRecognition: FakeRecognition, isSecureContext: true, ...extra }) as unknown as Window;

beforeEach(() => { FakeRecognition.last = undefined; });

describe("mapWebSpeechError", () => {
  it("memetakan kode Web Speech", () => {
    expect(mapWebSpeechError("not-allowed")).toBe("not-allowed");
    expect(mapWebSpeechError("service-not-allowed")).toBe("not-allowed");
    expect(mapWebSpeechError("no-speech")).toBe("no-speech");
    expect(mapWebSpeechError("network")).toBe("network");
    expect(mapWebSpeechError("audio-capture")).toBe("other");
    expect(mapWebSpeechError("language-not-supported")).toBe("other");
  });
  it("aborted (kita sendiri yang berhenti) bukan galat", () => {
    expect(mapWebSpeechError("aborted")).toBeNull();
  });
});

describe("createWebSpeechEngine", () => {
  it("supported=false bila tak ada SpeechRecognition", () => {
    expect(createWebSpeechEngine({} as unknown as Window).supported).toBe(false);
  });
  it("memakai webkitSpeechRecognition bila yang standar tak ada", () => {
    const w = { webkitSpeechRecognition: FakeRecognition, isSecureContext: true } as unknown as Window;
    expect(createWebSpeechEngine(w).supported).toBe(true);
  });
  it("start menyetel bahasa, continuous, interimResults, lalu memulai", () => {
    const e = createWebSpeechEngine(win());
    e.start("id-ID");
    const r = FakeRecognition.last!;
    expect(r.lang).toBe("id-ID");
    expect(r.continuous).toBe(true);
    expect(r.interimResults).toBe(true);
    expect(r.started).toBe(1);
  });
  it("stop memanggil stop() recognition", () => {
    const e = createWebSpeechEngine(win());
    e.start("id-ID");
    e.stop();
    expect(FakeRecognition.last!.stopped).toBe(1);
  });
  it("memisahkan interim dan final dari satu event", () => {
    const e = createWebSpeechEngine(win());
    const onFinal = vi.fn(); const onInterim = vi.fn();
    e.onFinal(onFinal); e.onInterim(onInterim);
    e.start("id-ID");
    FakeRecognition.last!.onresult!({
      resultIndex: 0,
      results: [res("halo dunia", true), res("apa kab", false)],
    });
    expect(onFinal).toHaveBeenCalledWith("halo dunia");
    expect(onInterim).toHaveBeenLastCalledWith("apa kab");
  });
  it("hanya memproses hasil sejak resultIndex (final lama tak diulang)", () => {
    const e = createWebSpeechEngine(win());
    const onFinal = vi.fn();
    e.onFinal(onFinal);
    e.start("id-ID");
    FakeRecognition.last!.onresult!({
      resultIndex: 1,
      results: [res("sudah dikirim", true), res("baru", true)],
    });
    expect(onFinal).toHaveBeenCalledTimes(1);
    expect(onFinal).toHaveBeenCalledWith("baru");
  });
  it("event tanpa interim mengosongkan pratinjau", () => {
    const e = createWebSpeechEngine(win());
    const onInterim = vi.fn();
    e.onInterim(onInterim);
    e.start("id-ID");
    FakeRecognition.last!.onresult!({ resultIndex: 0, results: [res("selesai", true)] });
    expect(onInterim).toHaveBeenLastCalledWith("");
  });
  it("meneruskan galat terpetakan, mengabaikan aborted", () => {
    const e = createWebSpeechEngine(win());
    const onError = vi.fn();
    e.onError(onError);
    e.start("id-ID");
    FakeRecognition.last!.onerror!({ error: "aborted" });
    expect(onError).not.toHaveBeenCalled();
    FakeRecognition.last!.onerror!({ error: "not-allowed" });
    expect(onError).toHaveBeenCalledWith("not-allowed");
  });
  it("onend diteruskan dan recognition boleh dibuat ulang di start berikutnya", () => {
    const e = createWebSpeechEngine(win());
    const onEnd = vi.fn();
    e.onEnd(onEnd);
    e.start("id-ID");
    const first = FakeRecognition.last!;
    first.onend!();
    expect(onEnd).toHaveBeenCalledTimes(1);
    e.start("en-US");
    expect(FakeRecognition.last).not.toBe(first);
    expect(FakeRecognition.last!.lang).toBe("en-US");
  });
  it("konteks tak aman → insecure-context + end, tanpa memulai recognition", () => {
    const e = createWebSpeechEngine(win({ isSecureContext: false }));
    const onError = vi.fn(); const onEnd = vi.fn();
    e.onError(onError); e.onEnd(onEnd);
    e.start("id-ID");
    expect(onError).toHaveBeenCalledWith("insecure-context");
    expect(onEnd).toHaveBeenCalled();
    expect(FakeRecognition.last).toBeUndefined();
  });
  it("tak didukung → start melapor unsupported + end", () => {
    const e = createWebSpeechEngine({} as unknown as Window);
    const onError = vi.fn(); const onEnd = vi.fn();
    e.onError(onError); e.onEnd(onEnd);
    e.start("id-ID");
    expect(onError).toHaveBeenCalledWith("unsupported");
    expect(onEnd).toHaveBeenCalled();
  });
  it("recognition.start() melempar → other + end", () => {
    class Boom extends FakeRecognition { start() { throw new Error("InvalidStateError"); } }
    const e = createWebSpeechEngine({ SpeechRecognition: Boom, isSecureContext: true } as unknown as Window);
    const onError = vi.fn(); const onEnd = vi.fn();
    e.onError(onError); e.onEnd(onEnd);
    e.start("id-ID");
    expect(onError).toHaveBeenCalledWith("other");
    expect(onEnd).toHaveBeenCalled();
  });
});
