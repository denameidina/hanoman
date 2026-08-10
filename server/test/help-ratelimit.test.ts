// SPEC-352 · rate-limit Help Center publik: satu IP yang sudah kehabisan jatah tak boleh ikut
// menguras bucket per-project yang dipakai bersama semua pelapor lain (amplifikasi penolakan).
import { describe, it, expect, beforeEach } from "vitest";
import { helpRateOk, portalTicketRateOk, __resetHelpBuckets } from "../src/services/help-ratelimit";

const NOW = 1_000_000; // jam beku: tanpa isi ulang di tengah pengujian
const IP_CAP = 5;      // default HANOMAN_HELP_RATE_PER_MIN_IP
const PROJ_CAP = 20;   // default HANOMAN_HELP_RATE_PER_MIN_PROJECT

beforeEach(() => { __resetHelpBuckets(); });

describe("SPEC-352 · helpRateOk", () => {
  it("membanjiri dari satu IP hanya memakan jatah project sebanyak yang benar-benar lolos", () => {
    // Satu IP mencoba 12x: 5 pertama lolos, 7 sisanya ditolak karena jatah IP habis.
    let lolosDariPembanjir = 0;
    for (let i = 0; i < 12; i++) if (helpRateOk("p", "1.1.1.1", NOW)) lolosDariPembanjir++;
    expect(lolosDariPembanjir).toBe(IP_CAP);

    // Pelapor sah dari IP berbeda harus masih kebagian sisa jatah project (20 − 5 = 15),
    // bukan 20 − 12 = 8. Tiap IP baru punya bucket sendiri, jadi yang membatasi murni project.
    let lolosDariPelaporLain = 0;
    for (let i = 0; i < PROJ_CAP; i++) if (helpRateOk("p", `2.2.2.${i}`, NOW)) lolosDariPelaporLain++;
    expect(lolosDariPelaporLain).toBe(PROJ_CAP - IP_CAP);
  });

  it("tetap menegakkan batas per-IP dan per-project pada pemakaian wajar", () => {
    for (let i = 0; i < IP_CAP; i++) expect(helpRateOk("p", "9.9.9.9", NOW)).toBe(true);
    expect(helpRateOk("p", "9.9.9.9", NOW)).toBe(false);          // jatah IP habis
    expect(helpRateOk("p", "8.8.8.8", NOW)).toBe(true);           // IP lain masih boleh
    expect(helpRateOk("proj-lain", "9.9.9.9", NOW)).toBe(false);  // bucket IP lintas project
  });
});

// SPEC-626 · ADR-0111 · jalur portal: pelapornya sesi ber-login, jadi identitasnya AKUN.
describe("SPEC-626 · portalTicketRateOk", () => {
  const ACCT_CAP = 5; // default HANOMAN_PORTAL_TICKET_RATE_PER_MIN

  it("membatasi per akun, bukan per IP", () => {
    for (let i = 0; i < ACCT_CAP; i++) expect(portalTicketRateOk("u1", "p", NOW), `ke-${i}`).toBe(true);
    expect(portalTicketRateOk("u1", "p", NOW)).toBe(false);
    // Akun lain di project yang sama tak ikut terkunci — membatasi per IP justru menghukum
    // satu kantor bersama-sama.
    expect(portalTicketRateOk("u2", "p", NOW)).toBe(true);
  });

  // SPEC-352 · short-circuit yang sama: percobaan yang sudah pasti ditolak jatah akun tak boleh
  // ikut menguras bucket per-project yang dipakai BERSAMA pelapor publik.
  it("akun yang jatahnya habis tak menguras bucket project", () => {
    for (let i = 0; i < ACCT_CAP + 10; i++) portalTicketRateOk("u1", "p", NOW);
    let lolos = 0;
    for (let i = 0; i < PROJ_CAP; i++) if (helpRateOk("p", `3.3.3.${i}`, NOW)) lolos++;
    expect(lolos).toBe(PROJ_CAP - ACCT_CAP);
  });

  it("jatah terisi ulang seiring waktu", () => {
    for (let i = 0; i < ACCT_CAP; i++) portalTicketRateOk("u1", "p", NOW);
    expect(portalTicketRateOk("u1", "p", NOW)).toBe(false);
    expect(portalTicketRateOk("u1", "p", NOW + 60_000)).toBe(true);
  });
});
