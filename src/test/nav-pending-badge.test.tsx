import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { EMPTY_PENDING, type PendingCounts } from "@hanoman/shared";

// Widget topbar yang self-fetch / butuh provider → di-noop agar Shell bisa dirender terisolasi
// (pola yang sama dengan `changelog-nav.test.tsx`).
vi.mock("../src/notifications/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("../src/screens/LimitIndicator", () => ({ LimitBadge: () => null, CodexLimitBadge: () => null }));
vi.mock("../src/screens/UpdateIndicator", () => ({ UpdateBadge: () => null, ReloadBadge: () => null }));
vi.mock("../src/auth/AccountMenu", () => ({ AccountMenu: () => null }));

import { Shell, NavPending } from "../src/ds/shell";

const renderNav = (counts: PendingCounts | null) =>
  render(
    <NavPending.Provider value={counts}>
      <Shell active="overview" title="x" onNavigate={() => {}}><div /></Shell>
    </NavPending.Provider>,
  );

const badges = () => screen.queryAllByTestId("nav-badge").map((b) => b.textContent);

describe("SPEC-961 · badge butuh pengajuan di sidebar", () => {
  it("merender angka hanya pada permukaan yang punya antrean", () => {
    renderNav({ ...EMPTY_PENDING, triage: 3, backlog: 12, prd: 0, lead: 0 });
    expect(badges()).toEqual(["12", "3"]);   // urutan HN_NAV: PRD · Backlog · … · Triase
  });

  // Nol adalah keadaan paling sering; badge "0" di seluruh sidebar membuat kolom angka itu berisik
  // justru saat tak ada yang perlu dikerjakan.
  it("nol tak merender badge apa pun", () => {
    renderNav(EMPTY_PENDING);
    expect(badges()).toEqual([]);
  });

  // ADR-0087 · server yang lebih tua tak pernah mengirim frame `pending`; sidebar-nya harus
  // terlihat persis seperti sebelum SPEC ini, bukan seperti instalasi yang antreannya kosong.
  it("tanpa frame dari server, sidebar tak berubah", () => {
    renderNav(null);
    expect(badges()).toEqual([]);
  });

  // Di lebar tablet label nav disembunyikan CSS, jadi angka yang hanya hidup sebagai teks badge
  // tak punya cara diumumkan. Namanya karena itu ikut membawa angka.
  it("angka masuk ke nama tombol yang dibacakan", () => {
    renderNav({ ...EMPTY_PENDING, triage: 3 });
    expect(screen.getByRole("button", { name: "Triase, 3 butuh pengajuan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Backlog" })).toBeInTheDocument();
  });

  it("angka besar dipangkas supaya lebar badge tetap", () => {
    renderNav({ ...EMPTY_PENDING, backlog: 128 });
    expect(badges()).toEqual(["99+"]);
  });
});

/* Kontras badge diukur, bukan diasumsikan (regresi rilis 0.2.5).

   Badge pertama memakai `color: var(--text-on-brass)` — nama yang terbaca seperti "warna teks di
   ATAS brass". Nilainya `var(--ink-900)`: tinta gelap, dirancang untuk `--accent` (brass-500) yang
   TERANG. Di atas brass tua hasilnya gelap-di-atas-gelap dan angkanya tak terbaca sama sekali di
   layar sungguhan. Typecheck, build, dan kelima test render di atas semuanya hijau — tak satu pun
   dari mereka pernah melihat warna.

   Karena itu yang dijaga di sini adalah rasio WCAG yang dihitung dari nilai token yang BERLAKU,
   bukan nama tokennya: mengganti pasangan warna dengan pasangan buruk lain akan merah, dan
   mengganti dengan pasangan bagus lain tetap hijau. */
const cssVars = (() => {
  const src = readFileSync(resolve(import.meta.dirname, "../src/ds/tokens/colors.css"), "utf8");
  const map = new Map<string, string>();
  for (const m of src.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) map.set(m[1]!, m[2]!.trim());
  // Satu tingkat indireksi sudah cukup untuk token warna repo ini (`--x: var(--y)`), dan lebih
  // jujur daripada resolver umum yang tak pernah diuji.
  const resolve1 = (v: string): string => {
    const m = /^var\((--[\w-]+)\)$/.exec(v);
    return m ? (map.get(m[1]!) ?? v) : v;
  };
  return (name: string) => resolve1(resolve1(map.get(name) ?? ""));
})();

const luminance = (hex: string): number => {
  const n = hex.replace("#", "");
  const ch = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const lin = ch.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
};
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe("SPEC-961 · angka badge harus terbaca", () => {
  const css = readFileSync(resolve(import.meta.dirname, "../src/app.css"), "utf8");
  const rule = css.slice(css.indexOf(".hn-nav-badge {"), css.indexOf("}", css.indexOf(".hn-nav-badge {")));
  const decl = (prop: string) => {
    const m = new RegExp(`(?:^|\\n)\\s*${prop}:\\s*([^;]+);`).exec(rule);
    return cssVars(m![1]!.trim().replace(/^var\((--[\w-]+)\)$/, "$1"));
  };

  it("aturan badge memang menyatakan latar dan warna tulisannya", () => {
    expect(rule).toMatch(/background:/);
    expect(rule).toMatch(/color:/);
  });

  it("rasio kontras teks : latar lolos WCAG AA (>= 4.5:1)", () => {
    const ratio = contrast(decl("color"), decl("background"));
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  // Kontrol negatif: pasangan yang benar-benar dikirim di 0.2.5. Tanpa ini, test di atas bisa lulus
  // karena rumusnya salah, bukan karena warnanya benar.
  it("pasangan lama (ink-900 di atas brass-600) memang gagal gerbang yang sama", () => {
    expect(contrast(cssVars("--ink-900"), cssVars("--brass-600"))).toBeLessThan(4.5);
  });
});
