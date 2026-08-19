// SPEC-847 · AC-1..AC-3 untuk cabut device token di Settings — salah satu dari empat flow
// yang diminta issue diuji lewat RTL (batal, konfirmasi, Escape, focus restore, klik ganda).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import React from "react";

const { listDeviceTokens, revokeDeviceToken, createDeviceToken } = vi.hoisted(() => ({
  listDeviceTokens: vi.fn(async () => [
    { id: "d1", name: "macbook", createdAt: "2026-07-01T00:00:00Z", lastUsedAt: null, revokedAt: null },
  ]),
  revokeDeviceToken: vi.fn(async () => ({ ok: true })),
  createDeviceToken: vi.fn(),
}));
vi.mock("../src/api/client", () => ({
  api: { listDeviceTokens, revokeDeviceToken, createDeviceToken },
  ApiError: class extends Error {},
}));

import { DeviceTokensPanel } from "../src/screens/SettingsScreen";

beforeEach(() => { revokeDeviceToken.mockClear(); });

const open = async () => {
  render(<DeviceTokensPanel />);
  const btn = await screen.findByRole("button", { name: "Cabut" });
  btn.focus(); fireEvent.click(btn);
  await screen.findByRole("dialog");
  return btn;
};

describe("Settings · cabut device token (SPEC-847)", () => {
  it("dialog menyebut nama token dan dampaknya, dan tak memakai ikon trash", async () => {
    await open();
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText(/macbook/)).toBeTruthy();
    expect(dialog.getByText(/tak bisa sync lagi/i)).toBeTruthy();
    expect(screen.getByRole("dialog").querySelector('[data-icon="key-round"]')).toBeTruthy();
    expect(screen.getByRole("dialog").querySelector('[data-icon="trash-2"]')).toBeNull();
  });

  it("Batal tak mencabut", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(revokeDeviceToken).not.toHaveBeenCalled();
  });

  it("Escape tak mencabut", async () => {
    await open();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(revokeDeviceToken).not.toHaveBeenCalled();
  });

  it("konfirmasi mencabut sekali walau diklik dua kali, fokus kembali ke pemicu", async () => {
    const trigger = await open();
    const ok = screen.getByRole("button", { name: "Cabut token" });
    fireEvent.click(ok); fireEvent.click(ok);
    await waitFor(() => expect(revokeDeviceToken).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
