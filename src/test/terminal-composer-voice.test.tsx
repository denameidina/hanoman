import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalComposer } from "../src/screens/TerminalComposer";
import { DEBOUNCE_MS } from "../src/screens/terminal-composer";

const Q = { n: 0, held: false };
function setup(extra: { onDraft?: (b: boolean) => void } = {}) {
  const send = vi.fn();
  const external = { current: () => {} };
  const voiceAppend = { current: (_: string) => {} };
  render(<TerminalComposer sessionId="s1" send={send} external={external} linkState="open"
    queue={Q} voiceAppend={voiceAppend} {...extra} />);
  const input = () => screen.getByTestId("terminal-composer") as HTMLInputElement;
  return { send, voiceAppend, input };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("TerminalComposer · teks suara", () => {
  it("voiceAppend menambahkan teks final ke kolom", () => {
    const { voiceAppend, input } = setup();
    act(() => voiceAppend.current("halo dunia"));
    expect(input().value).toBe("halo dunia");
    act(() => voiceAppend.current("apa kabar"));
    expect(input().value).toBe("halo dunia apa kabar");
  });

  it("menyambung ke teks yang sudah diketik operator", () => {
    const { voiceAppend, input } = setup();
    fireEvent.change(input(), { target: { value: "jalankan" } });
    act(() => voiceAppend.current("pnpm test"));
    expect(input().value).toBe("jalankan pnpm test");
  });

  it("mengalir ke pty lewat debounce yang ada, sebagai delta, TANPA \\r", () => {
    const { voiceAppend, send } = setup();
    act(() => voiceAppend.current("halo"));
    expect(send).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(DEBOUNCE_MS + 10); });
    expect(send).toHaveBeenCalledWith("halo");
    for (const call of send.mock.calls) expect(call[0]).not.toContain("\r");
  });

  it("teks kosong dari suara tak mengubah kolom", () => {
    const { voiceAppend, input } = setup();
    act(() => voiceAppend.current("  "));
    expect(input().value).toBe("");
  });

  it("onDraft: true saat kolom berisi, false saat Enter mengosongkannya", () => {
    const onDraft = vi.fn();
    const { voiceAppend, input } = setup({ onDraft });
    expect(onDraft).toHaveBeenLastCalledWith(false);
    act(() => voiceAppend.current("halo"));
    expect(onDraft).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onDraft).toHaveBeenLastCalledWith(false);
  });
});
