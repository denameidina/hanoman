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
