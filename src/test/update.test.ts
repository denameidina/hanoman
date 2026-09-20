import { describe, it, expect } from "vitest";
import {
  updateHeadline, updateBadgeLabel, updateVersionLine, updateRegistryLine,
  applyConfirmMessage, applyErrorMessage, waitForServerBack,
} from "../src/api/update";
import type { UpdateStatus } from "@hanoman/shared";

const mk = (o: Partial<UpdateStatus>): UpdateStatus => ({
  currentVersion: "0.1.0", latestVersion: "0.1.0",
  registry: { status: "ok", checkedAt: null }, updateAvailable: false, command: "", canApply: false, ...o,
});

describe("updateHeadline", () => {
  it("up-to-date", () => expect(updateHeadline(mk({}))).toMatch(/terbaru/));
  it("ada update → menyebut versi terbaru & restart", () =>
    expect(updateHeadline(mk({ updateAvailable: true, latestVersion: "0.4.2" }))).toMatch(/0\.4\.2.*restart/));
});

describe("updateBadgeLabel", () => {
  it("menyebut versi terbaru", () =>
    expect(updateBadgeLabel(mk({ updateAvailable: true, latestVersion: "0.4.2" }))).toBe("Update · 0.4.2"));
  it("versi terbaru tak terbaca → 'Update' saja", () =>
    expect(updateBadgeLabel(mk({ updateAvailable: true, latestVersion: null }))).toBe("Update"));
});

describe("updateVersionLine", () => {
  it("terpasang → tersedia", () =>
    expect(updateVersionLine(mk({ currentVersion: "0.1.0", latestVersion: "0.2.0" })))
      .toBe("terpasang 0.1.0 · tersedia 0.2.0"));
  it("versi kosong jadi '?', bukan string kosong yang membingungkan", () =>
    expect(updateVersionLine(mk({ currentVersion: "", latestVersion: null })))
      .toBe("terpasang ? · tersedia ?"));
});

describe("updateRegistryLine (SPEC-906)", () => {
  it("registry terbaca tanpa stempel waktu → kalimat polos, bukan 'Invalid Date'", () =>
    expect(updateRegistryLine(mk({}))).toBe("Registry npm terbaca."));
  it("registry terbaca dengan stempel waktu → menyebut kapan diperiksa", () =>
    expect(updateRegistryLine(mk({ registry: { status: "ok", checkedAt: "2026-08-22T03:00:00.000Z" } })))
      .toMatch(/^Registry npm diperiksa .+\.$/));
  it("registry tak terbaca → bilang versi tersedia tak bisa dipastikan", () =>
    expect(updateRegistryLine(mk({ registry: { status: "unavailable", checkedAt: null } })))
      .toMatch(/tak bisa dipastikan/));
});

describe("applyConfirmMessage (SPEC-405 · ADR-0088)", () => {
  it("tanpa sesi hidup: menyebut tak ada yang berjalan", () => {
    expect(applyConfirmMessage(0)).toMatch(/tak ada sesi/i);
  });
  it("ada sesi: menyebut jumlahnya DAN bahwa sesi selamat", () => {
    const s = applyConfirmMessage(3);
    expect(s).toContain("3");
    expect(s).toMatch(/tetap hidup/i);
    expect(s).toMatch(/tmux/i);
  });
  it("satu sesi tetap menyebut angkanya", () => {
    expect(applyConfirmMessage(1)).toContain("1");
  });
});

describe("applyErrorMessage (SPEC-405 · ADR-0088)", () => {
  it("unsupervised menjelaskan sebabnya, bukan kode mentah", () => {
    expect(applyErrorMessage("unsupervised")).toMatch(/hanoman start/);
  });
  it("up-to-date terbaca manusia", () => {
    expect(applyErrorMessage("up-to-date")).toMatch(/terkini/i);
  });
  it("kode tak dikenal tetap tampil, jangan ditelan", () => {
    expect(applyErrorMessage("bad-body")).toContain("bad-body");
  });
});

// Mulai ulang manual tak mengganti versi, jadi tak ada drift yang memicu "muat ulang": tanpa
// menunggu server kembali lalu memuat ulang, popover diam selamanya di "Menjalankan ulang…".
describe("waitForServerBack", () => {
  const clock = () => { let t = 0; return { sleep: async (ms: number) => { t += ms; }, now: () => t }; };

  it("server mati lalu hidup → true begitu probe pulih", async () => {
    const c = clock(); const answers = [false, false, true];
    const ok = await waitForServerBack(async () => answers.shift() ?? true, c.sleep, { intervalMs: 1000 });
    expect(ok).toBe(true); expect(c.now()).toBe(3000);
  });
  it("tak pernah terlihat mati (restart lebih cepat dari polling) → true setelah minWait", async () => {
    const c = clock();
    expect(await waitForServerBack(async () => true, c.sleep, { intervalMs: 1000, minWaitMs: 3000 })).toBe(true);
    expect(c.now()).toBe(3000);
  });
  it("probe yang melempar dianggap mati", async () => {
    const c = clock(); let n = 0;
    const ok = await waitForServerBack(async () => { if (n++ < 2) throw new Error("ECONNREFUSED"); return true; }, c.sleep, { intervalMs: 1000 });
    expect(ok).toBe(true);
  });
  it("tak kunjung kembali → false di batas waktu", async () => {
    const c = clock();
    expect(await waitForServerBack(async () => false, c.sleep, { intervalMs: 1000, timeoutMs: 5000 })).toBe(false);
    expect(c.now()).toBe(5000);
  });
});
