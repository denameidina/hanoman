import { describe, it, expect } from "vitest";
import { NO_DRIFT, trackServerVersion, reloadNoticeText } from "../src/api/update";

// SPEC-868 · tab yang sudah terbuka tak punya cara tahu bundle-nya basi. Reducer ini satu-satunya
// tempat "basi atau tidak" diputuskan, jadi keadaan-keadaan liciknya diuji di sini — bukan lewat UI.
describe("trackServerVersion (SPEC-868)", () => {
  it("frame pertama menetapkan versi tab ini, belum basi", () => {
    expect(trackServerVersion(NO_DRIFT, "0.1.53")).toEqual({ boot: "0.1.53", restartedTo: null });
  });

  it("versi server berubah → tab basi, versi barunya ikut dilaporkan", () => {
    const boot = trackServerVersion(NO_DRIFT, "0.1.53");
    expect(trackServerVersion(boot, "0.1.54")).toEqual({ boot: "0.1.53", restartedTo: "0.1.54" });
  });

  it("versi sama → objek yang SAMA dipulangkan (getSnapshot useSyncExternalStore harus stabil)", () => {
    const boot = trackServerVersion(NO_DRIFT, "0.1.53");
    expect(trackServerVersion(boot, "0.1.53")).toBe(boot);
    const stale = trackServerVersion(boot, "0.1.54");
    expect(trackServerVersion(stale, "0.1.54")).toBe(stale);
  });

  it("versi kosong tak pernah dianggap drift — dev/bundle belum ter-stamp memulangkan ''", () => {
    expect(trackServerVersion(NO_DRIFT, "")).toBe(NO_DRIFT);
    const boot = trackServerVersion(NO_DRIFT, "0.1.53");
    expect(trackServerVersion(boot, "")).toBe(boot);
  });

  it("server kembali ke versi tab ini → tak basi lagi", () => {
    const stale = trackServerVersion(trackServerVersion(NO_DRIFT, "0.1.53"), "0.1.54");
    expect(trackServerVersion(stale, "0.1.53")).toEqual({ boot: "0.1.53", restartedTo: null });
  });

  it("restart kedua melaporkan versi terakhir, bukan yang pertama", () => {
    const stale = trackServerVersion(trackServerVersion(NO_DRIFT, "0.1.53"), "0.1.54");
    expect(trackServerVersion(stale, "0.1.55").restartedTo).toBe("0.1.55");
  });
});

describe("reloadNoticeText (SPEC-868)", () => {
  it("menyebut versi baru DAN bahwa halaman ini masih yang lama", () => {
    const s = reloadNoticeText("0.1.54");
    expect(s).toContain("0.1.54");
    expect(s).toMatch(/muat ulang/i);
  });
});
