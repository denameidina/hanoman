import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceControls } from "../src/screens/VoiceControls";
import { useVoiceInput } from "../src/screens/use-voice-input";
import type { SpeechEngine, SpeechError } from "../src/screens/speech-engine";

function fakeEngine(supported = true) {
  const cb = {
    interim: (_: string) => {}, final: (_: string) => {},
    error: (_: SpeechError) => {}, end: () => {},
  };
  const engine: SpeechEngine & { starts: string[]; stops: number } = {
    supported, starts: [], stops: 0,
    start(lang) { engine.starts.push(lang); },
    stop() { engine.stops += 1; },
    onInterim(f) { cb.interim = f; }, onFinal(f) { cb.final = f; },
    onError(f) { cb.error = f; }, onEnd(f) { cb.end = f; },
  };
  return { engine, cb };
}

function Harness({ engine, onFinalText, enabled = true }: {
  engine: SpeechEngine; onFinalText: (t: string) => void; enabled?: boolean;
}) {
  const voice = useVoiceInput({ engine, onFinalText, enabled });
  return <VoiceControls voice={voice} />;
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("VoiceControls", () => {
  it("tak merender apa pun bila engine tak didukung", () => {
    const { engine } = fakeEngine(false);
    render(<Harness engine={engine} onFinalText={() => {}} />);
    expect(screen.queryByTestId("terminal-voice")).toBeNull();
  });

  it("tak merender apa pun bila enabled=false (pane baca-saja)", () => {
    const { engine } = fakeEngine(true);
    render(<Harness engine={engine} onFinalText={() => {}} enabled={false} />);
    expect(screen.queryByTestId("terminal-voice")).toBeNull();
  });

  it("toggle: klik pertama start dengan id-ID, klik kedua stop", () => {
    const { engine } = fakeEngine();
    render(<Harness engine={engine} onFinalText={() => {}} />);
    const btn = screen.getByTestId("voice-toggle");
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(btn);
    expect(engine.starts).toEqual(["id-ID"]);
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(btn);
    expect(engine.stops).toBe(1);
  });

  it("status baru kembali idle saat engine melapor end, bukan saat stop()", () => {
    const { engine, cb } = fakeEngine();
    render(<Harness engine={engine} onFinalText={() => {}} />);
    const btn = screen.getByTestId("voice-toggle");
    fireEvent.click(btn);
    fireEvent.click(btn); // stop
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    act(() => cb.end());
    expect(btn.getAttribute("aria-pressed")).toBe("false");
  });

  it("final → onFinalText dipanggil; interim → pratinjau saja, tidak memanggil onFinalText", () => {
    const { engine, cb } = fakeEngine();
    const onFinalText = vi.fn();
    render(<Harness engine={engine} onFinalText={onFinalText} />);
    fireEvent.click(screen.getByTestId("voice-toggle"));
    act(() => cb.interim("halo du"));
    expect(screen.getByTestId("voice-interim").textContent).toBe("halo du");
    expect(onFinalText).not.toHaveBeenCalled();
    act(() => cb.final("halo dunia"));
    expect(onFinalText).toHaveBeenCalledWith("halo dunia");
    expect(screen.queryByTestId("voice-interim")).toBeNull();
  });

  it("galat tampil lalu idle; tampil pesan; hilang otomatis setelah 6 dtk", () => {
    vi.useFakeTimers();
    const { engine, cb } = fakeEngine();
    render(<Harness engine={engine} onFinalText={() => {}} />);
    fireEvent.click(screen.getByTestId("voice-toggle"));
    act(() => { cb.error("not-allowed"); cb.end(); });
    expect(screen.getByTestId("voice-error").textContent).toContain("Izin mikrofon ditolak");
    expect(screen.getByTestId("voice-toggle").getAttribute("aria-pressed")).toBe("false");
    act(() => { vi.advanceTimersByTime(6000); });
    expect(screen.queryByTestId("voice-error")).toBeNull();
  });

  it("memulai lagi menghapus galat sebelumnya", () => {
    const { engine, cb } = fakeEngine();
    render(<Harness engine={engine} onFinalText={() => {}} />);
    fireEvent.click(screen.getByTestId("voice-toggle"));
    act(() => { cb.error("no-speech"); cb.end(); });
    expect(screen.getByTestId("voice-error")).toBeTruthy();
    fireEvent.click(screen.getByTestId("voice-toggle"));
    expect(screen.queryByTestId("voice-error")).toBeNull();
  });

  it("bahasa: default id-ID, ganti ke en-US dipakai start berikutnya dan disimpan", () => {
    const { engine } = fakeEngine();
    render(<Harness engine={engine} onFinalText={() => {}} />);
    const sel = screen.getByTestId("voice-lang") as HTMLSelectElement;
    expect(sel.value).toBe("id-ID");
    fireEvent.change(sel, { target: { value: "en-US" } });
    expect(localStorage.getItem("hanoman.voice.lang")).toBe("en-US");
    fireEvent.click(screen.getByTestId("voice-toggle"));
    expect(engine.starts).toEqual(["en-US"]);
  });

  it("unmount memanggil stop() pada engine", () => {
    const { engine } = fakeEngine();
    const { unmount } = render(<Harness engine={engine} onFinalText={() => {}} />);
    unmount();
    expect(engine.stops).toBe(1);
  });
});
