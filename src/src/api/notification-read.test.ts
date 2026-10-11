import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./client";

// ADR-0204 · method per item: id di-encode (id dari klien tak boleh menggeser path), POST, 204 → undefined.
describe("api.markNotificationRead", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("POST /api/notifications/:id/read dengan id yang di-encode", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(api.markNotificationRead("a b/c")).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/notifications/a%20b%2Fc/read",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("galat 404 dilempar sebagai ApiError agar toast bisa menyebut alasannya", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "notifikasi tak ada" }), { status: 404 })));
    await expect(api.markNotificationRead("tak-ada")).rejects.toMatchObject({ status: 404 });
  });
});
