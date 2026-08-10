# SPEC-626 — Portal klien: scroll, kirim tiket dari portal, warna badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portal klien bisa digulir penuh, punya satu pintu kirim tiket help desk untuk klien yang sudah login, dan badge warnanya mengikuti keadaan yang diwakilinya.

**Architecture:** Tiga perubahan yang tak saling bergantung di atas permukaan SPEC-617/ADR-0110. (1) Rantai gulir dipasang di dalam `ClientPortal` sendiri memakai konstanta design-system yang sudah dipakai layar operator — `app.css` dan `Shell` tak disentuh. (2) Badan submit tiket `routes/help.ts` diangkat jadi service `services/ticket-intake.ts` yang dipanggil DUA route (publik & portal), jadi tiket kedua jalur identik secara konstruksi, bukan karena dua salinan kebetulan sepakat. (3) Pemetaan status→warna jadi dua fungsi murni total di `src/src/portal/status-pill.ts` yang dipakai baris daftar DAN modal.

**Tech Stack:** React 18 + TS (Vite) · Fastify + Prisma 6 (SQLite) · Vitest + Testing Library · `@fastify/multipart`.

## Global Constraints

- **Jalur tulis dibuka setepat mungkin.** `clientRouteAllowed` menerima **satu bentuk path** untuk tulis: `POST` + segmen persis `portal/projects/<id>/tickets`. Bukan "portal boleh POST".
- **Satu pipeline pembuatan tiket.** `createTicket()` + `notifySynced()` + `recordNewTicket()` + `pruneOldTickets()` dipanggil dari SATU service; tak boleh ada salinan kedua.
- **Scope project ditegakkan `hasProjectAccess()`**; penolakannya **404 generik** (`{ error: "not found" }`), bukan 403 — portal tak boleh jadi alat enumerasi nama project.
- **Tiket dari portal TIDAK bergantung `project.helpEnabled`** (keputusan eksplisit, ADR-0111). Jalur publik tetap bergantung.
- **Batas lampiran sama dengan publik:** ≤3 berkas, ≤5 MB, `image/png|image/jpeg|image/webp`; berkas yang ditolak **di-skip tanpa membatalkan submit**.
- **Nol warna baru.** Hanya status `StatusPill` yang sudah ada (`src/src/ds/components/feedback.tsx:83-97`). Nol warna literal di `ClientPortal`.
- **Pemetaan TOTAL:** status/stage tak dikenal → `idle`, bukan crash dan bukan warna yang menyesatkan.
- **Perilaku halaman Help Center publik tak berubah.** Kodenya boleh pindah berkas; responsnya tidak.
- **Kosakata teks tetap kosakata klien** (`STAGE_LABEL`, `publicStatus()` SPEC-293) — bukan istilah internal.
- **Test server WAJIB** `--no-file-parallelism` **dan** `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"` (AGENTS.md · SPEC-397/479).
- **Test web WAJIB** `env -u NODE_ENV` (memori: `NODE_ENV=production` di shell bikin RTL `act` gagal massal).

---

### Task 1: Rantai gulir portal

**Files:**
- Modify: `src/src/portal/ClientPortal.tsx:51-70` (root + header + main)
- Test: `src/test/portal-scroll.test.tsx` (create)

**Interfaces:**
- Consumes: `LIST_SCROLL_STYLE`, `FIXED_ROW_STYLE` dari `../ds` (`src/src/ds/kit.tsx:142-144`).
- Produces: `data-testid="portal-root"`, `data-testid="portal-scroll"`, `data-testid="portal-list"` di `ClientPortal` — dipakai test Task 1 saja.

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/portal-scroll.test.tsx`:

```tsx
/* SPEC-626 · portal klien harus BENAR-BENAR bisa digulir.
   `#root { height: 100vh; overflow: hidden }` (app.css:5) benar untuk `Shell` operator yang
   mengelola scroll di panel dalamnya — tapi `ClientPortal` sengaja tidak memakai `Shell`
   (fork App.tsx) dan pembungkusnya cuma `minHeight: 100%`, jadi tak satu pun kontainer di
   portal bisa digulir: daftar yang lebih tinggi dari viewport tak terjangkau sama sekali.

   jsdom tak melayout, jadi yang diuji adalah RANTAI-nya: harus ada leluhur yang benar-benar
   scroller, dan tiap mata rantai di antaranya harus meneruskan batas tinggi (kolom flex yang
   boleh menyusut). Idiom ini menyalin `scroll-chain.test.tsx` (SPEC-393). */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/api/portal", () => ({
  portalApi: {
    listProjects: vi.fn(), listBacklog: vi.fn(), listTickets: vi.fn(),
    getSpec: vi.fn(), getTicket: vi.fn(), logout: vi.fn(), createTicket: vi.fn(),
  },
}));
import { portalApi } from "../src/api/portal";
import { ClientPortal } from "../src/portal/ClientPortal";
import type { UserView } from "@hanoman/shared";

const USER: UserView = { id: "u1", email: "klien@x.co", role: "client", createdAt: "2026-08-01T00:00:00Z" };

const spec = (n: number) => ({
  id: `SPEC-${n}`, title: `Pekerjaan ${n}`, priority: "sedang", stage: "planned",
  objective: "x", createdAt: "2026-08-01T00:00:00Z", startedAt: null, doneAt: null,
});

beforeEach(() => {
  (portalApi.listProjects as any).mockResolvedValue({ items: [{ id: "p1", name: "Toko Mekar" }] });
  // Cukup panjang untuk melewati viewport mana pun — bug-nya justru tak terlihat di daftar pendek.
  (portalApi.listBacklog as any).mockResolvedValue({
    items: Array.from({ length: 60 }, (_, i) => spec(i + 1)), total: 60, page: 1, pageSize: 60 });
  (portalApi.listTickets as any).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 0 });
  (portalApi.getSpec as any).mockResolvedValue(spec(1));
});

const scrolls = (n: HTMLElement) => n.style.overflow === "auto" || n.style.overflow === "scroll"
  || n.style.overflowY === "auto" || n.style.overflowY === "scroll";

/* Leluhur yang tingginya sudah pasti dengan sendirinya (root portal, atau overlay `fixed`)
   adalah SUMBER batas tinggi — ia tak perlu bisa menyusut, cukup meneruskan. */
const isFrame = (n: HTMLElement) => n.style.position === "fixed" || !!n.style.height || !!n.style.maxHeight;

/** Naik dari `el` sampai `root`: scroller pertama yang ditemukan, plus mata rantai yang putus. */
function chainToScroller(el: HTMLElement, root: HTMLElement) {
  const broken: string[] = [];
  for (let n = el.parentElement; n; n = n.parentElement) {
    if (scrolls(n)) return { scroller: n, broken };
    const display = n.style.display;
    const why: string[] = [];
    if (display !== "flex" && display !== "grid") why.push(`display "${display || "block"}"`);
    if (!isFrame(n) && n.style.minHeight !== "0" && n.style.minHeight !== "0px")
      why.push(`min-height "${n.style.minHeight || "auto"}"`);
    if (why.length) broken.push(`<${n.tagName.toLowerCase()} style="${n.getAttribute("style") ?? ""}"> → ${why.join(" + ")}`);
    if (n === root) break;
  }
  return { scroller: null as HTMLElement | null, broken };
}

describe("portal klien bisa digulir (SPEC-626)", () => {
  it("daftar Pekerjaan punya leluhur yang benar-benar menggulir", async () => {
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    const list = await screen.findByTestId("portal-list");
    const { scroller, broken } = chainToScroller(list, screen.getByTestId("portal-root"));
    expect(broken).toEqual([]);
    expect(scroller, "tak ada satu pun leluhur ber-overflow auto/scroll").not.toBeNull();
  });

  it("daftar Help desk memakai scroller yang sama", async () => {
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    await screen.findByTestId("portal-list");
    fireEvent.click(screen.getByRole("tab", { name: /help desk/i }));
    const root = screen.getByTestId("portal-root");
    expect(chainToScroller(screen.getByTestId("portal-scroll"), root).broken).toEqual([]);
    expect(scrolls(screen.getByTestId("portal-scroll"))).toBe(true);
  });

  // Header di LUAR scroller adalah keputusan, bukan efek samping: itulah yang membuatnya tetap
  // terbaca saat daftar digulir.
  it("header tetap terbaca — ia bukan isi scroller", async () => {
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    await screen.findByTestId("portal-list");
    const header = screen.getByRole("banner");
    expect(screen.getByTestId("portal-scroll").contains(header)).toBe(false);
    expect(screen.getByTestId("portal-root").contains(header)).toBe(true);
  });

  // Modal SUDAH bisa digulir hari ini (Modal: panel maxHeight 88vh + body overflow auto, dan
  // overlay `position: fixed` tak diklip `#root{overflow:hidden}` karena #root tak membuat
  // containing block). Test ini mengunci kontraknya supaya tak hilang diam-diam.
  it("badan modal detail bisa digulir", async () => {
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    fireEvent.click(await screen.findByText("Pekerjaan 1"));
    await waitFor(() => expect(screen.getByTestId("modal-body")).toBeInTheDocument());
    expect(scrolls(screen.getByTestId("modal-body"))).toBe(true);
  });
});
```

- [x] **Step 2: Jalankan — harus MERAH**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest --run src/test/portal-scroll.test.tsx
```

Expected: gagal — "tak ada satu pun leluhur ber-overflow auto/scroll" (`scroller` null) pada dua test pertama, dan `portal-list`/`portal-scroll` belum ada.

- [x] **Step 3: Pasang rantai gulirnya**

Di `src/src/portal/ClientPortal.tsx`, ubah import DS:

```tsx
import { Button, Card, FIXED_ROW_STYLE, LIST_SCROLL_STYLE, Modal, StateBlock, StatusPill, Tabs } from "../ds";
```

Ganti pembungkus root + header + main (baris 51-70) jadi:

```tsx
  return (
    // SPEC-626 · `#root` (app.css) `height: 100vh; overflow: hidden` — benar untuk Shell operator
    // yang menggulir di panel dalamnya. Portal tidak memakai Shell, jadi ia harus memasang rantai
    // gulirnya SENDIRI: header di luar scroller (tetap terbaca), <main> yang menggulir. Konstanta
    // DS yang sama dengan layar operator — bukan angka baru, dan app.css tak disentuh.
    <div data-testid="portal-root" style={{
      height: "100%", minHeight: 0, display: "flex", flexDirection: "column",
      background: "var(--surface-page)", color: "var(--text-body)",
    }}>
      <header style={{
        ...FIXED_ROW_STYLE,
        display: "flex", alignItems: "center", gap: 14, padding: "0 22px",
        height: "var(--topbar-h)", borderBottom: "1px solid var(--border-hair)",
        background: "var(--bone-100)",
      }}>
        <span style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: 26, height: 26, borderRadius: "var(--radius-sm)", background: "var(--accent)",
        }}><Mark id="buntut" size={17} color="#fff" /></span>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 600, color: "var(--text-strong)" }}>
          Portal klien
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-subtle)" }}>{user.email}</span>
        <Button size="sm" variant="ghost" leftIcon="log-out" onClick={logout}>Keluar</Button>
      </header>

      <main data-testid="portal-scroll" style={LIST_SCROLL_STYLE}>
        <div style={{ maxWidth: "var(--content-max)", margin: "0 auto", padding: "24px 28px 32px" }}>
```

…dan tutup elemen tambahan itu di ujung `<main>` (baris ~130) — `</div></main>` menggantikan `</main>`.

Tambahkan `data-testid="portal-list"` pada `Card padding={0}` daftar backlog **dan** daftar tiket:

```tsx
                  : <Card padding={0} data-testid="portal-list">
```

- [x] **Step 4: Jalankan — harus HIJAU**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest --run src/test/portal-scroll.test.tsx src/test/client-portal.test.tsx
```

Expected: PASS keduanya (test SPEC-617 lama tak boleh ikut merah).

- [x] **Step 5: Commit**

```bash
git add src/src/portal/ClientPortal.tsx src/test/portal-scroll.test.tsx
git commit -m "fix(spec-626): portal klien punya rantai gulirnya sendiri"
```

---

### Task 2: Pemetaan status → warna badge

**Files:**
- Create: `src/src/portal/status-pill.ts`
- Modify: `src/src/portal/ClientPortal.tsx` (hapus `stageStatus` lokal; pakai `stagePill`/`ticketPill` di baris daftar & modal)
- Test: `src/test/portal-status-pill.test.ts` (create), `src/test/client-portal.test.tsx` (tambah)

**Interfaces:**
- Consumes: `publicStatus` dari `@hanoman/shared` (test saja), `zStage` dari `@hanoman/shared` (test saja).
- Produces: `stagePill(stage: string): string` dan `ticketPill(status: string): string` di `src/src/portal/status-pill.ts` — dipakai `ClientPortal` (baris daftar + modal).

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/portal-status-pill.test.ts`:

```ts
/* SPEC-626 · warna badge portal. Badge tiket dulu `status="idle"` HARDCODE di dua tempat
   sementara teksnya ikut berubah — jadi `new`/`accepted`/`rejected` semuanya abu-abu yang sama:
   warnanya berbohong, cuma hurufnya yang jujur. Nol test render bisa menangkap itu selama
   labelnya benar, jadi yang dipagari di sini adalah FUNGSI pemetaannya. */
import { describe, it, expect } from "vitest";
import { publicStatus, zStage } from "@hanoman/shared";
import { stagePill, ticketPill } from "../src/portal/status-pill";

describe("ticketPill (SPEC-626)", () => {
  it("tiap kosakata klien punya warnanya sendiri", () => {
    expect(ticketPill("Sedang ditinjau")).toBe("queued");
    expect(ticketPill("Diterima")).toBe("awaiting");
    expect(ticketPill("Sedang dikerjakan")).toBe("running");
    expect(ticketPill("Selesai")).toBe("done");
    expect(ticketPill("Ditutup")).toBe("failed");
  });

  // Inti bug yang diperbaiki: tiga status DB harus berujung di warna yang berbeda.
  it("new / accepted / rejected mendarat di warna yang berbeda", () => {
    const pills = ["new", "accepted", "rejected"].map((s) => ticketPill(publicStatus(s, null)));
    expect(new Set(pills).size).toBe(3);
  });

  // Diikat ke SUMBER kosakatanya (publicStatus, SPEC-293), bukan ke daftar hafalan: kosakata
  // yang berubah/bertambah di sana membuat test ini merah, bukan diam-diam jadi abu-abu.
  it("seluruh keluaran publicStatus punya pemetaan — tak ada yang jatuh ke idle", () => {
    const stages: (string | null)[] = [null, ...zStage.options];
    for (const s of ["new", "accepted", "rejected", "triaged"])
      for (const st of stages)
        expect(ticketPill(publicStatus(s, st)), `${s}/${st}`).not.toBe("idle");
  });

  it("status tak dikenal jatuh ke idle yang netral, bukan warna yang menyesatkan", () => {
    expect(ticketPill("Entah apa")).toBe("idle");
    expect(ticketPill("")).toBe("idle");
  });
});

describe("stagePill (SPEC-626)", () => {
  it("stage kerja dipetakan sesuai keadaannya", () => {
    expect(stagePill("brainstorming")).toBe("queued");
    expect(stagePill("objective")).toBe("queued");
    expect(stagePill("spec-ready")).toBe("queued");
    expect(stagePill("planned")).toBe("queued");
    expect(stagePill("executing")).toBe("running");
    expect(stagePill("done")).toBe("done");
  });

  it("seluruh zStage punya pemetaan eksplisit", () => {
    for (const s of zStage.options) expect(stagePill(s), s).not.toBe("idle");
  });

  // Versi lama memakai `else → queued`: stage asing diwarnai "antre" — percaya diri tentang
  // keadaan yang tak diketahui. Arah kegagalannya dibalik.
  it("stage tak dikenal jatuh ke idle", () => {
    expect(stagePill("blocked")).toBe("idle");
    expect(stagePill("")).toBe("idle");
  });
});
```

- [x] **Step 2: Jalankan — harus MERAH**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest --run src/test/portal-status-pill.test.ts
```

Expected: FAIL — `Failed to resolve import "../src/portal/status-pill"`.

- [x] **Step 3: Tulis fungsinya**

Buat `src/src/portal/status-pill.ts`:

```ts
// SPEC-626 · pemetaan keadaan → status `StatusPill` untuk portal klien. Fungsi murni supaya
// warnanya bisa dites langsung: nol test render bisa menangkap warna yang salah selama labelnya
// benar — persis jebakan yang membuat badge tiket abu-abu seragam lolos sampai 0.1.24.
//
// Keduanya TOTAL lewat tabel + fallback: nilai tak dikenal mendarat di `idle` yang netral, bukan
// di warna yang percaya diri tentang keadaan yang tak diketahui. Nol warna baru — hanya status
// yang sudah ada di `ds/components/feedback.tsx`.

// Domainnya adalah kosakata KLIEN (`publicStatus()`, SPEC-293), bukan `Ticket.status` mentah:
// `toPortalTicket()` sudah memetakannya sebelum dikirim, jadi inilah yang sampai ke layar.
const TICKET: Record<string, string> = {
  "Sedang ditinjau": "queued",     // wind — masuk antrean, belum ditriase
  "Diterima": "awaiting",          // amber — diterima, menunggu giliran kerja
  "Sedang dikerjakan": "running",  // brass — sesi berjalan
  "Selesai": "done",               // leaf
  "Ditutup": "failed",             // clay — tidak dilanjutkan
};

const STAGE: Record<string, string> = {
  brainstorming: "queued", objective: "queued", "spec-ready": "queued", planned: "queued",
  executing: "running", done: "done",
};

export const ticketPill = (status: string): string => TICKET[status] ?? "idle";
export const stagePill = (stage: string): string => STAGE[stage] ?? "idle";
```

- [x] **Step 4: Pakai di baris daftar DAN modal**

Di `src/src/portal/ClientPortal.tsx`: hapus `stageStatus` lokal (baris 20-21), tambahkan import:

```tsx
import { stagePill, ticketPill } from "./status-pill";
```

Empat call site:

```tsx
// baris daftar backlog
<StatusPill status={stagePill(s.stage)} size="sm">{STAGE_LABEL[s.stage] ?? s.stage}</StatusPill>
// baris daftar tiket
<StatusPill status={ticketPill(t.status)} size="sm">{t.status}</StatusPill>
// modal backlog
<StatusPill status={stagePill(openSpec.stage)} size="sm">{STAGE_LABEL[openSpec.stage] ?? openSpec.stage}</StatusPill>
// modal tiket
<StatusPill status={ticketPill(openTicket.status)} size="sm">{openTicket.status}</StatusPill>
```

- [x] **Step 5: Test kontrak "satu sumber, dua tempat"**

Tambahkan ke `src/test/client-portal.test.tsx` (di dalam `describe` yang sudah ada):

```tsx
  // Warna berbeda antara baris daftar dan modal untuk tiket yang SAMA adalah bug yang sedang
  // diperbaiki — dijaga di sini supaya tak direplikasi.
  it("badge tiket berwarna sama di baris daftar dan di modal detail", async () => {
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    await screen.findByText("Toko Mekar");
    fireEvent.click(screen.getByRole("tab", { name: /help desk/i }));
    const row = await screen.findByText("Tombol bayar mati");
    const rowPill = within(row.closest('[role="button"]') as HTMLElement)
      .getByText("Sedang dikerjakan");
    fireEvent.click(row);
    await waitFor(() => expect(screen.getByTestId("modal-body")).toBeInTheDocument());
    const modalPill = within(screen.getByTestId("modal-body")).getByText("Sedang dikerjakan");
    expect(modalPill.parentElement!.style.background).toBe(rowPill.parentElement!.style.background);
    // …dan bukan abu-abu `idle` yang lama.
    expect(rowPill.parentElement!.style.background).not.toBe("var(--bone-200)");
  });
```

Tambahkan `within` ke import Testing Library di berkas itu:

```tsx
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
```

- [x] **Step 6: Jalankan — harus HIJAU**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest --run src/test/portal-status-pill.test.ts src/test/client-portal.test.tsx src/test/portal-scroll.test.tsx
```

Expected: PASS semua.

- [x] **Step 7: Commit**

```bash
git add src/src/portal/status-pill.ts src/src/portal/ClientPortal.tsx src/test/portal-status-pill.test.ts src/test/client-portal.test.tsx
git commit -m "fix(spec-626): warna badge portal mengikuti keadaan yang diwakilinya"
```

---

### Task 3: Satu pipeline intake tiket (`services/ticket-intake.ts`)

**Files:**
- Create: `server/src/services/ticket-intake.ts`
- Modify: `server/src/routes/help.ts` (memanggil service, perilaku tak berubah)
- Test: `server/test/help.test.ts` (sudah ada — jaring pengaman refactor)

**Interfaces:**
- Consumes: `createTicket`, `pruneOldTickets` (`services/ticket`), `recordNewTicket` (`services/notifications`), `notifySynced` (`services/sync-notify`), `saveUpload` (`services/uploads`), `prisma`.
- Produces:
  - `type TicketUpload = { buf: Buffer; mime: string; name: string }`
  - `const TICKET_UPLOAD = { MAX_FILES: 3, MAX_BYTES: 5 * 1024 * 1024, OK_MIME: Set<string> }`
  - `parseTicketUpload(req: FastifyRequest): Promise<{ fields: Record<string,string>; files: TicketUpload[] } | null>` — `null` = unggahan tak valid (pemanggil balas 400).
  - `intakeTicket(input: { projectId: string; projectName: string; category: string; title: string; detail: string; reporterEmail: string; files: TicketUpload[] }): Promise<{ ticket: Ticket; key: string }>`

- [ ] **Step 1: Rekam perilaku publik yang harus tetap sama**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-626
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/help.test.ts
```

Expected: PASS (baseline sebelum kode dipindah). Catat jumlah test yang lulus.

- [ ] **Step 2: Tulis service-nya**

Buat `server/src/services/ticket-intake.ts`:

```ts
// SPEC-626 · SATU pipeline pembuatan tiket untuk DUA pintu: halaman Help Center publik
// (`routes/help.ts`, ADR-0062) dan portal klien yang sudah login (`routes/portal.ts`, ADR-0111).
// Diangkat dari badan `help.ts` supaya tiket kedua jalur identik SECARA KONSTRUKSI — bukan
// identik karena dua salinan kebetulan sepakat (kelas bug "satu definisi, N call site" yang sudah
// dibayar SPEC-431/448/475). Yang berbeda antar-pintu cuma otorisasi & asal `reporterEmail`.
import type { FastifyRequest } from "fastify";
import { prisma } from "../db";
import { createTicket, pruneOldTickets } from "./ticket";
import { recordNewTicket } from "./notifications";
import { notifySynced } from "./sync-notify";
import { saveUpload } from "./uploads";

export type TicketUpload = { buf: Buffer; mime: string; name: string };

export const TICKET_UPLOAD = {
  MAX_FILES: 3,
  MAX_BYTES: 5 * 1024 * 1024,
  OK_MIME: new Set(["image/png", "image/jpeg", "image/webp"]),
};

/** Multipart → field + lampiran. `null` = unggahan tak terbaca (pemanggil balas 400). */
export async function parseTicketUpload(
  req: FastifyRequest,
): Promise<{ fields: Record<string, string>; files: TicketUpload[] } | null> {
  const fields: Record<string, string> = {};
  const files: TicketUpload[] = [];
  try {
    for await (const part of (req as any).parts()) {
      if (part.type === "file") {
        const buf = await part.toBuffer(); // menguras stream file
        // truncated (fileSize terlampaui, throwFileSizeLimit:false) / mime salah / kelebihan →
        // skip, submit yang sisanya tetap jadi (AC PRD).
        if (part.file?.truncated || !TICKET_UPLOAD.OK_MIME.has(part.mimetype)
          || files.length >= TICKET_UPLOAD.MAX_FILES) continue;
        files.push({ buf, mime: part.mimetype, name: String(part.filename ?? "gambar") });
      } else {
        fields[part.fieldname] = String(part.value ?? "");
      }
    }
  } catch {
    return null;
  }
  return { fields, files };
}

export async function intakeTicket(input: {
  projectId: string; projectName: string; category: string; title: string; detail: string;
  reporterEmail: string; files: TicketUpload[];
}) {
  const { ticket, key } = await createTicket({
    projectId: input.projectId, category: input.category, title: input.title,
    detail: input.detail, reporterEmail: input.reporterEmail,
  });
  // SPEC-382 · INDUK dulu, baru ANAK. Feed diterapkan urut seq di client, dan
  // `TicketAttachment.ticketId` punya FK ke `Ticket.id` — memancarkan lampiran lebih dulu
  // membuat client menabrak FK, lalu barisnya hilang/menghentikan siklus (audit SPEC-382).
  await notifySynced("ticket", ticket.id); // SPEC-268 · tiket baru → feed (metadata)
  for (const f of input.files) {
    const { storageKey, size } = await saveUpload(f.buf, f.mime);
    const att = await prisma.ticketAttachment.create({
      data: {
        ticketId: ticket.id, projectId: input.projectId, filename: f.name.slice(0, 200),
        mimeType: f.mime, size, storageKey,
      },
    });
    await notifySynced("ticketAttachment", att.id); // SPEC-272 · metadata lampiran → feed
  }
  await recordNewTicket(ticket.id, input.projectId, input.projectName, input.category, input.title);
  void pruneOldTickets(); // retensi opportunistic-on-write (tanpa scheduler global)
  return { ticket, key };
}
```

- [ ] **Step 3: `help.ts` memanggil service**

Ganti `server/src/routes/help.ts` baris 1-101 sehingga: import `parseTicketUpload`/`intakeTicket`, hapus konstanta `OK_MIME`/`MAX_FILES`/`MAX_BYTES` dan `type ParsedPart`, hapus loop parse & loop lampiran. Badan `POST /help/:slug/tickets` jadi:

```ts
  app.post("/help/:slug/tickets", async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const p = await prisma.project.findUnique({ where: { id: slug } });
    if (!p || !p.helpEnabled) return reply.code(404).send({ error: "not found" });
    if (!helpRateOk(slug, req.ip)) return reply.code(429).send({ error: "terlalu banyak permintaan" });
    if (!(req as any).isMultipart?.()) return reply.code(400).send({ error: "butuh multipart/form-data" });

    const parsed = await parseTicketUpload(req);
    if (!parsed) return reply.code(400).send({ error: "unggahan tak valid" });
    const { fields, files } = parsed;

    // honeypot: bot → sukses palsu, tak buat tiket. Jejak log wajib — tanpa ini sebuah false
    // positive tak meninggalkan bukti apa pun (tak ada tiket, notifikasi, maupun baris feed).
    if (fields[HONEYPOT_FIELD]) {
      console.warn(`help: honeypot terpicu · project=${slug} ip=${req.ip}`);
      return reply.code(200).send({ ok: true });
    }

    const f = zField.safeParse({
      category: fields.category, title: fields.title, detail: fields.detail, email: fields.email,
    });
    if (!f.success) return reply.code(400).send({ error: "field wajib tak lengkap / tak valid" });

    const { ticket, key } = await intakeTicket({
      projectId: slug, projectName: p.name, category: f.data.category, title: f.data.title,
      detail: f.data.detail, reporterEmail: f.data.email, files,
    });

    const statusPath = `/help/${encodeURIComponent(slug)}/status/${encodeURIComponent(key)}`;
    return reply.code(201).send({ number: ticket.number, key, statusPath });
  });
```

Import yang dipakai `help.ts` sesudahnya: `hashAccessKey`, `publicStatus` dari `../services/ticket`; `helpRateOk`; `parseTicketUpload`, `intakeTicket` dari `../services/ticket-intake`. `createTicket`, `pruneOldTickets`, `recordNewTicket`, `notifySynced`, `saveUpload` **tak lagi** diimpor di sini.

- [ ] **Step 4: Jalankan — perilaku publik tak boleh bergeser**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/help.test.ts
pnpm --filter ./server typecheck
```

Expected: PASS dengan jumlah test yang sama seperti Step 1; typecheck bersih.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/ticket-intake.ts server/src/routes/help.ts
git commit -m "refactor(spec-626): satu pipeline intake tiket dipakai dua pintu"
```

---

### Task 4: Rate-limit berbasis akun

**Files:**
- Modify: `server/src/services/help-ratelimit.ts`
- Test: `server/test/help-ratelimit.test.ts`

**Interfaces:**
- Produces: `portalTicketRateOk(userId: string, projectId: string, now?: number): boolean`; `__resetHelpBuckets()` ikut mengosongkan bucket akun.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `server/test/help-ratelimit.test.ts`:

```ts
describe("portalTicketRateOk (SPEC-626)", () => {
  beforeEach(() => __resetHelpBuckets());

  // Sesi ber-login tak punya honeypot dan tak perlu per-IP: identitasnya AKUN, yang bisa dicabut
  // operator. Membatasi per IP justru menghukum satu kantor bersama-sama.
  it("membatasi per akun, bukan per IP", () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) expect(portalTicketRateOk("u1", "p1", now), `ke-${i}`).toBe(true);
    expect(portalTicketRateOk("u1", "p1", now)).toBe(false);
    // akun lain di project yang sama tak ikut terkunci
    expect(portalTicketRateOk("u2", "p1", now)).toBe(true);
  });

  // SPEC-352 · short-circuit: percobaan yang sudah pasti ditolak jatah akun tak boleh ikut
  // menguras bucket per-project yang dipakai BERSAMA pelapor publik.
  it("akun yang jatahnya habis tak menguras bucket project", () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) portalTicketRateOk("u1", "p1", now);
    for (let i = 0; i < 10; i++) portalTicketRateOk("u1", "p1", now); // semuanya ditolak
    // bucket project (kapasitas 20) masih penuh untuk pelapor publik
    for (let i = 0; i < 15; i++) expect(helpRateOk("p1", `10.0.0.${i}`, now), `ip-${i}`).toBe(true);
  });

  it("jatah terisi ulang seiring waktu", () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) portalTicketRateOk("u1", "p1", now);
    expect(portalTicketRateOk("u1", "p1", now)).toBe(false);
    expect(portalTicketRateOk("u1", "p1", now + 60_000)).toBe(true);
  });
});
```

Sesuaikan baris import berkas itu supaya memuat `portalTicketRateOk` (dan `helpRateOk`, `__resetHelpBuckets` yang sudah ada), serta `describe`/`beforeEach` dari vitest.

- [ ] **Step 2: Jalankan — harus MERAH**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/help-ratelimit.test.ts
```

Expected: FAIL — `portalTicketRateOk is not a function` / import tak ada.

- [ ] **Step 3: Implementasi**

Di `server/src/services/help-ratelimit.ts`, tambahkan map akun + fungsinya, dan ikutkan di reset:

```ts
const acctBuckets = new Map<string, Bucket>();
```

```ts
// SPEC-626 · ADR-0111 · jalur portal: pelapornya SESI BER-LOGIN, jadi identitasnya akun (yang
// bisa dicabut operator), bukan IP. Bucket per-project TETAP dipakai bersama jalur publik supaya
// satu project punya satu atap laju masuk tiket — dengan short-circuit SPEC-352 yang sama:
// percobaan yang sudah pasti ditolak jatah akun tak ikut mengurasnya.
export function portalTicketRateOk(userId: string, projectId: string, now = Date.now()): boolean {
  const acctCap = effectiveInt("HANOMAN_PORTAL_TICKET_RATE_PER_MIN") ?? 5;
  const projCap = effectiveInt("HANOMAN_HELP_RATE_PER_MIN_PROJECT") ?? 20;
  return take(acctBuckets, userId, acctCap, now) && take(projBuckets, projectId, projCap, now);
}
```

```ts
export function __resetHelpBuckets() { ipBuckets.clear(); projBuckets.clear(); acctBuckets.clear(); }
```

- [ ] **Step 4: Jalankan — harus HIJAU**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/help-ratelimit.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/help-ratelimit.ts server/test/help-ratelimit.test.ts
git commit -m "feat(spec-626): rate-limit tiket portal berbasis akun"
```

---

### Task 5: Allowlist — satu bentuk path tulis

**Files:**
- Modify: `server/src/services/client-access.ts:20`
- Test: `server/test/client-route-allowed.test.ts`

**Interfaces:**
- Produces: `clientRouteAllowed` menerima `POST /api/portal/projects/:id/tickets` dan **hanya** itu untuk method tulis.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `server/test/client-route-allowed.test.ts` (dan **ubah** test "portal TIDAK boleh ditulis" yang lama supaya tetap benar — pakai path `…/backlog` yang memang tetap tertutup; test itu sudah memakai path itu, jadi biarkan apa adanya):

```ts
  // SPEC-626 · ADR-0111 · SATU pintu tulis, dibuka sebagai BENTUK PATH, bukan sebagai
  // "portal boleh POST". Semua bentuk tulis lain tetap tertutup — termasuk yang lahir nanti.
  it("hanya kirim tiket portal yang boleh ditulis", () => {
    expect(clientRouteAllowed("POST", "/api/portal/projects/p1/tickets")).toBe(true);
    expect(clientRouteAllowed("POST", "/api/portal/projects/toko-mekar/tickets")).toBe(true);
  });

  it("bentuk tulis portal lain tetap ditolak", () => {
    const paths = [
      "/api/portal/projects/p1/tickets/t1", "/api/portal/projects/p1/backlog",
      "/api/portal/projects/p1/backlog/SPEC-1", "/api/portal/projects", "/api/portal/tickets",
      "/api/portal/projects/p1", "/api/portal/projects/p1/tickets/t1/attachments",
    ];
    for (const p of paths)
      for (const m of ["POST", "PATCH", "PUT", "DELETE"])
        expect(clientRouteAllowed(m, p), `${m} ${p}`).toBe(false);
    for (const m of ["PATCH", "PUT", "DELETE"])
      expect(clientRouteAllowed(m, "/api/portal/projects/p1/tickets"), m).toBe(false);
  });
```

- [ ] **Step 2: Jalankan — harus MERAH**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/client-route-allowed.test.ts
```

Expected: FAIL pada test pertama (`false` ≠ `true`).

- [ ] **Step 3: Buka satu bentuk saja**

Di `server/src/services/client-access.ts`, ganti baris `if (top === "portal") return read;` jadi:

```ts
  if (top === "portal") return read || isPortalTicketSubmit(method, seg);
```

…dan tambahkan di atas `clientRouteAllowed`:

```ts
// SPEC-626 · ADR-0111 · satu-satunya jalur TULIS di permukaan klien, dinyatakan sebagai BENTUK
// PATH yang persis — bukan "portal boleh POST". Route portal apa pun yang lahir nanti tetap
// tertutup sampai seseorang sengaja menambahkan bentuknya di sini (deny-by-default, ADR-0110).
const isPortalTicketSubmit = (method: string, seg: string[]): boolean =>
  method === "POST" && seg.length === 4 && seg[1] === "projects" && seg[3] === "tickets";
```

- [ ] **Step 4: Jalankan — harus HIJAU**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/client-route-allowed.test.ts server/test/client-gate.test.ts
```

Expected: PASS keduanya.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/client-access.ts server/test/client-route-allowed.test.ts
git commit -m "feat(spec-626): allowlist klien membuka satu bentuk path tulis"
```

---

### Task 6: `POST /api/portal/projects/:id/tickets`

**Files:**
- Modify: `server/src/routes/portal.ts`
- Test: `server/test/portal-ticket.route.test.ts` (create)

**Interfaces:**
- Consumes: `parseTicketUpload`, `intakeTicket` (Task 3); `portalTicketRateOk` (Task 4); `hasProjectAccess` (sudah ada); `toPortalTicket` (`@hanoman/shared`); `zTicketCategory` (`@hanoman/shared`).
- Produces: `POST /api/portal/projects/:id/tickets` → `201` berisi `PortalTicket`; `404 { error: "not found" }` bila project bukan haknya/tak ada; `400` field tak valid; `429` rate-limit.

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/portal-ticket.route.test.ts`:

```ts
/* SPEC-626 · ADR-0111 · jalur TULIS pertama di permukaan klien. Yang dipagari di sini: tiket
   dari portal identik di mata operator dengan tiket dari halaman publik, scope project ditegakkan,
   dan route ini tak bocor ke akun klien tanpa akses. */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { hashPassword } from "../src/services/auth";
import { __resetHelpBuckets } from "../src/services/help-ratelimit";
import { PORTAL_TICKET_KEYS } from "@hanoman/shared";

const app = buildApp();
const clean = async () => {
  await prisma.clientProjectAccess.deleteMany();
  await prisma.session.deleteMany(); await prisma.user.deleteMany();
  await prisma.ticketAttachment.deleteMany(); await prisma.ticket.deleteMany();
  await prisma.notification.deleteMany(); await prisma.syncLog.deleteMany();
  await prisma.project.deleteMany();
};
beforeEach(async () => { await clean(); __resetHelpBuckets(); });
afterAll(clean);

const cookieOf = (r: { headers: Record<string, unknown> }) => (r.headers["set-cookie"] as string).split(";")[0];

async function seed(opts: { helpEnabled?: boolean } = {}) {
  await prisma.project.create({ data: {
    id: "p1", name: "P1", desc: "", kind: "existing", helpEnabled: opts.helpEnabled ?? true } });
  await prisma.project.create({ data: { id: "p2", name: "P2", desc: "", kind: "existing" } });
  const c = await prisma.user.create({ data: {
    email: "klien@x.co", passwordHash: await hashPassword("password2"), role: "client" } });
  await prisma.clientProjectAccess.create({ data: { userId: c.id, projectId: "p1" } });
  const login = await app.inject({ method: "POST", url: "/api/auth/login",
    payload: { email: "klien@x.co", password: "password2" } });
  return { cookie: cookieOf(login), userId: c.id };
}

/** Body multipart field + (opsional) lampiran — idiom yang sama dengan `help.test.ts`,
    tanpa dependency baru. */
function body(fields: Record<string, string>, files: { name: string; mime: string; buf: Buffer }[] = []) {
  const boundary = "----spec626";
  const CRLF = "\r\n";
  const chunks: Buffer[] = [];
  for (const [k, v] of Object.entries(fields))
    chunks.push(Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="${k}"${CRLF}${CRLF}${v}${CRLF}`));
  for (const f of files) {
    chunks.push(Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="files"; filename="${f.name}"${CRLF}Content-Type: ${f.mime}${CRLF}${CRLF}`));
    chunks.push(f.buf);
    chunks.push(Buffer.from(CRLF));
  }
  chunks.push(Buffer.from(`--${boundary}--${CRLF}`));
  return { payload: Buffer.concat(chunks), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

const OK = { category: "bug", title: "Tombol bayar mati", detail: "Klik bayar tak terjadi apa-apa" };

describe("POST /api/portal/projects/:id/tickets (SPEC-626)", () => {
  it("membuat tiket yang identik dengan jalur publik di mata operator", async () => {
    const { cookie } = await seed();
    const b = body(OK);
    const r = await app.inject({ method: "POST", url: "/api/portal/projects/p1/tickets",
      headers: { ...b.headers, cookie }, payload: b.payload });
    expect(r.statusCode).toBe(201);
    expect(Object.keys(r.json()).sort()).toEqual([...PORTAL_TICKET_KEYS].sort());

    const t = await prisma.ticket.findFirst({ where: { projectId: "p1" } });
    expect(t).toBeTruthy();
    expect(t!.status).toBe("new");
    expect(t!.number).toBe(1);
    // Email pelapor datang dari AKUN, tak pernah diketik ulang.
    expect(t!.reporterEmail).toBe("klien@x.co");
    // …dan tiketnya tetap punya kunci akses seperti tiket publik.
    expect(t!.accessKeyHash).toBeTruthy();

    // Notifikasi operator + feed sync yang sama.
    expect(await prisma.notification.count({ where: { type: "ticket" } })).toBe(1);
    expect(await prisma.syncLog.count({ where: { entity: "ticket", recordId: t!.id } })).toBe(1);
  });

  it("langsung tampil di daftar tiket portal klien itu", async () => {
    const { cookie } = await seed();
    const b = body(OK);
    await app.inject({ method: "POST", url: "/api/portal/projects/p1/tickets",
      headers: { ...b.headers, cookie }, payload: b.payload });
    const list = await app.inject({ method: "GET", url: "/api/portal/projects/p1/tickets", headers: { cookie } });
    expect(list.json().total).toBe(1);
    expect(list.json().items[0].title).toBe("Tombol bayar mati");
    expect(list.json().items[0].status).toBe("Sedang ditinjau");
  });

  // Scope project: penolakannya 404 GENERIK, bukan 403 — portal tak boleh jadi alat enumerasi.
  it("project bukan haknya → 404 generik dan nol tiket tercipta", async () => {
    const { cookie } = await seed();
    const b = body(OK);
    const r = await app.inject({ method: "POST", url: "/api/portal/projects/p2/tickets",
      headers: { ...b.headers, cookie }, payload: b.payload });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: "not found" });
    expect(await prisma.ticket.count()).toBe(0);
  });

  it("project yang tak ada dijawab sama persis", async () => {
    const { cookie } = await seed();
    const b = body(OK);
    const r = await app.inject({ method: "POST", url: "/api/portal/projects/tak-ada/tickets",
      headers: { ...b.headers, cookie }, payload: b.payload });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: "not found" });
  });

  it("klien tanpa akses ke project mana pun tak bisa menulis", async () => {
    await seed();
    const other = await prisma.user.create({ data: {
      email: "lain@x.co", passwordHash: await hashPassword("password3"), role: "client" } });
    expect(other.id).toBeTruthy();
    const login = await app.inject({ method: "POST", url: "/api/auth/login",
      payload: { email: "lain@x.co", password: "password3" } });
    const b = body(OK);
    const r = await app.inject({ method: "POST", url: "/api/portal/projects/p1/tickets",
      headers: { ...b.headers, cookie: cookieOf(login) }, payload: b.payload });
    expect(r.statusCode).toBe(404);
    expect(await prisma.ticket.count()).toBe(0);
  });

  it("tanpa sesi sama sekali → tak bisa menulis", async () => {
    await seed();
    const b = body(OK);
    const r = await app.inject({ method: "POST", url: "/api/portal/projects/p1/tickets",
      headers: b.headers, payload: b.payload });
    expect(r.statusCode).toBe(401);
    expect(await prisma.ticket.count()).toBe(0);
  });

  // Keputusan eksplisit ADR-0111: portal punya otentikasinya sendiri + baris akses per project,
  // jadi ia tak disandera knob permukaan ANONIM.
  it("tidak bergantung helpEnabled — jalur publik tetap bergantung", async () => {
    const { cookie } = await seed({ helpEnabled: false });
    const b = body(OK);
    const r = await app.inject({ method: "POST", url: "/api/portal/projects/p1/tickets",
      headers: { ...b.headers, cookie }, payload: b.payload });
    expect(r.statusCode).toBe(201);

    const pub = body({ ...OK, email: "orang@luar.co", hc_trap: "" });
    const r2 = await app.inject({ method: "POST", url: "/api/help/p1/tickets",
      headers: pub.headers, payload: pub.payload });
    expect(r2.statusCode).toBe(404);
  });

  it("field wajib tak lengkap → 400, nol tiket", async () => {
    const { cookie } = await seed();
    const b = body({ category: "bug", title: "", detail: "" });
    const r = await app.inject({ method: "POST", url: "/api/portal/projects/p1/tickets",
      headers: { ...b.headers, cookie }, payload: b.payload });
    expect(r.statusCode).toBe(400);
    expect(await prisma.ticket.count()).toBe(0);
  });

  it("kategori di luar katalog ditolak", async () => {
    const { cookie } = await seed();
    const b = body({ ...OK, category: "apa-saja" });
    const r = await app.inject({ method: "POST", url: "/api/portal/projects/p1/tickets",
      headers: { ...b.headers, cookie }, payload: b.payload });
    expect(r.statusCode).toBe(400);
  });

  it("lampiran gambar tersimpan; berkas bertipe salah di-SKIP tanpa membatalkan submit", async () => {
    const { cookie } = await seed();
    const b = body(OK, [
      { name: "bukti.png", mime: "image/png", buf: Buffer.from("gambar-1") },
      { name: "virus.exe", mime: "application/octet-stream", buf: Buffer.from("nope") },
    ]);
    const r = await app.inject({ method: "POST", url: "/api/portal/projects/p1/tickets",
      headers: { ...b.headers, cookie }, payload: b.payload });
    expect(r.statusCode).toBe(201);
    const atts = await prisma.ticketAttachment.findMany();
    expect(atts.length).toBe(1);
    expect(atts[0]!.mimeType).toBe("image/png");
  });

  it("rate-limit per akun membalas 429, bukan membuat tiket", async () => {
    const { cookie } = await seed();
    for (let i = 0; i < 5; i++) {
      const b = body({ ...OK, title: `Keluhan ${i}` });
      const r = await app.inject({ method: "POST", url: "/api/portal/projects/p1/tickets",
        headers: { ...b.headers, cookie }, payload: b.payload });
      expect(r.statusCode, `ke-${i}`).toBe(201);
    }
    const b = body({ ...OK, title: "Kelebihan" });
    const r = await app.inject({ method: "POST", url: "/api/portal/projects/p1/tickets",
      headers: { ...b.headers, cookie }, payload: b.payload });
    expect(r.statusCode).toBe(429);
    expect(await prisma.ticket.count()).toBe(5);
  });

  // Permukaan tulis tetap SATU pintu — bukan pelonggaran pola.
  it("bentuk tulis portal lain tetap 403 bagi klien", async () => {
    const { cookie } = await seed();
    for (const url of ["/api/portal/projects/p1/backlog", "/api/portal/projects"]) {
      const r = await app.inject({ method: "POST", url, headers: { cookie }, payload: {} });
      expect(r.statusCode, url).toBe(403);
    }
  });
});
```

- [ ] **Step 2: Jalankan — harus MERAH**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism server/test/portal-ticket.route.test.ts
```

Expected: FAIL — route belum ada (404 dari not-found handler pada test pertama).

- [ ] **Step 3: Implementasi route**

Di `server/src/routes/portal.ts`, tambahkan import:

```ts
import { z } from "zod";
import { zTicketCategory } from "@hanoman/shared";
import { intakeTicket, parseTicketUpload } from "../services/ticket-intake";
import { portalTicketRateOk } from "../services/help-ratelimit";
```

…tambahkan skema field di dekat `NOT_FOUND`:

```ts
// Cermin `zField` help.ts MINUS `email`: pelapornya sudah terautentikasi, jadi emailnya diambil
// dari akun dan tak pernah dari body — tak ada yang bisa mengaku sebagai orang lain.
const zPortalTicket = z.object({
  category: zTicketCategory,
  title: z.string().min(1).max(200),
  detail: z.string().min(1).max(10_000),
});
```

…dan route-nya, sesudah `GET /portal/projects/:id/tickets/:ticketId`:

```ts
  // SPEC-626 · ADR-0111 · SATU-SATUNYA jalur tulis portal. `project.helpEnabled` sengaja TIDAK
  // digerbangi di sini: knob itu menjawab "boleh-kah orang asing tanpa login mengirim keluhan",
  // sedangkan klien portal sudah lewat dua gerbang yang lebih kuat (akun ber-password + baris
  // `ClientProjectAccess` yang diberikan operator). Mematikan Help Center publik tak boleh ikut
  // membungkam klien yang memang sengaja diundang.
  app.post("/portal/projects/:id/tickets", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await prisma.project.findUnique({ where: { id } });
    // Project tak ada dan project bukan haknya menjawab hal yang SAMA (ADR-0110 gotcha 6).
    if (!p || !(await hasProjectAccess(req.user!.id, id))) return reply.code(404).send(NOT_FOUND);
    if (!portalTicketRateOk(req.user!.id, id)) return reply.code(429).send({ error: "terlalu banyak permintaan" });
    if (!(req as any).isMultipart?.()) return reply.code(400).send({ error: "butuh multipart/form-data" });

    const parsed = await parseTicketUpload(req);
    if (!parsed) return reply.code(400).send({ error: "unggahan tak valid" });
    const f = zPortalTicket.safeParse({
      category: parsed.fields.category, title: parsed.fields.title, detail: parsed.fields.detail,
    });
    if (!f.success) return reply.code(400).send({ error: "field wajib tak lengkap / tak valid" });

    const { ticket } = await intakeTicket({
      projectId: id, projectName: p.name, category: f.data.category, title: f.data.title,
      detail: f.data.detail, reporterEmail: req.user!.email, files: parsed.files,
    });
    // Kunci opaque pelapor sengaja TIDAK dikembalikan: klien memantau tiketnya di portal ini,
    // bukan lewat link status publik. Proyeksi yang sama dengan route baca — allowlist field.
    return reply.code(201).send(toPortalTicket(ticket, null));
  });
```

- [ ] **Step 4: Jalankan — harus HIJAU**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" ./node_modules/.bin/vitest --run --no-file-parallelism \
  server/test/portal-ticket.route.test.ts server/test/portal.route.test.ts server/test/help.test.ts \
  server/test/client-gate.test.ts
pnpm --filter ./server typecheck
```

Expected: PASS semua; typecheck bersih.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/portal.ts server/test/portal-ticket.route.test.ts
git commit -m "feat(spec-626): klien kirim tiket help desk dari portal"
```

---

### Task 7: Form kirim keluhan di portal

**Files:**
- Modify: `src/src/api/portal.ts` (tambah `createTicket`)
- Create: `src/src/portal/TicketForm.tsx`
- Modify: `src/src/portal/ClientPortal.tsx` (tombol + modal + muat ulang sesudah kirim)
- Test: `src/test/client-portal.test.tsx`

**Interfaces:**
- Consumes: `portalApi.createTicket(projectId, form: FormData): Promise<PortalTicket>`.
- Produces: `<TicketForm projects={PortalProject[]} activeId={string} onCancel={() => void} onSent={(projectId: string) => void} />`.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `src/test/client-portal.test.tsx`:

```tsx
  it("klien mengirim keluhan dari dalam portal, tiketnya langsung tampak", async () => {
    (portalApi.createTicket as any).mockResolvedValue({
      id: "t9", number: 9, category: "bug", title: "Struk tak keluar",
      status: "Sedang ditinjau", createdAt: "2026-08-10T00:00:00Z" });
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    await screen.findByText("Toko Mekar");

    fireEvent.click(screen.getByRole("button", { name: /kirim keluhan/i }));
    fireEvent.change(screen.getByLabelText("Judul"), { target: { value: "Struk tak keluar" } });
    fireEvent.change(screen.getByLabelText("Detail"), { target: { value: "Setelah bayar, struk kosong" } });
    fireEvent.click(screen.getByRole("button", { name: /^kirim$/i }));

    await waitFor(() => expect(portalApi.createTicket).toHaveBeenCalled());
    const [projectId, form] = (portalApi.createTicket as any).mock.calls[0];
    expect(projectId).toBe("p1");
    expect(form.get("title")).toBe("Struk tak keluar");
    expect(form.get("detail")).toBe("Setelah bayar, struk kosong");
    expect(form.get("category")).toBe("bug");
    // Email tak pernah diketik ulang — server mengambilnya dari akun.
    expect(form.get("email")).toBeNull();
    // Sesudah terkirim: tab pindah ke Help desk dan daftarnya dimuat ulang dari server.
    await waitFor(() => expect((portalApi.listTickets as any).mock.calls.length).toBeGreaterThan(1));
    expect(await screen.findByText("Tombol bayar mati")).toBeTruthy();
  });

  it("hanya project yang boleh diakses yang bisa dipilih sebagai tujuan", async () => {
    (portalApi.listProjects as any).mockResolvedValue({
      items: [{ id: "p1", name: "Toko Mekar" }, { id: "p3", name: "Warung Sari" }] });
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    await screen.findByText("Toko Mekar");
    fireEvent.click(screen.getByRole("button", { name: /kirim keluhan/i }));
    const opts = Array.from((screen.getByLabelText("Project") as HTMLSelectElement).options).map((o) => o.value);
    expect(opts).toEqual(["p1", "p3"]);
  });

  it("gagal kirim menampilkan pesan, tak menutup form", async () => {
    (portalApi.createTicket as any).mockRejectedValue(new Error("boom"));
    render(<ClientPortal user={USER} onLoggedOut={() => {}} />);
    await screen.findByText("Toko Mekar");
    fireEvent.click(screen.getByRole("button", { name: /kirim keluhan/i }));
    fireEvent.change(screen.getByLabelText("Judul"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("Detail"), { target: { value: "y" } });
    fireEvent.click(screen.getByRole("button", { name: /^kirim$/i }));
    expect(await screen.findByText(/gagal mengirim/i)).toBeTruthy();
    expect(screen.getByLabelText("Judul")).toBeTruthy();
  });
```

Tambahkan `createTicket: vi.fn()` ke mock `portalApi` di puncak berkas itu.

- [ ] **Step 2: Jalankan — harus MERAH**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest --run src/test/client-portal.test.tsx
```

Expected: FAIL — tombol "Kirim keluhan" tak ada.

- [ ] **Step 3: Klien API**

Di `src/src/api/portal.ts`, tambahkan ke objek `portalApi`:

```ts
  // Multipart (lampiran gambar) — sengaja TANPA `content-type` manual: browser yang menyusun
  // boundary-nya. Cermin `helpApi.submit`, tapi ber-cookie sesi klien.
  createTicket: async (id: string, form: FormData): Promise<PortalTicket> => {
    const url = `${p(id)}/tickets`;
    const res = await fetch(url, { method: "POST", body: form });
    if (!res.ok) throw new ApiError(res.status, `POST ${url} → ${res.status}`);
    return res.json();
  },
```

- [ ] **Step 4: Komponen form**

Buat `src/src/portal/TicketForm.tsx`:

```tsx
import React from "react";
import { zTicketCategory } from "@hanoman/shared";
import type { PortalProject } from "@hanoman/shared";
import { Button, Field, HnTextarea, Modal, Select } from "../ds";
import { portalApi } from "../api/portal";

// SPEC-626 · ADR-0111 · jalur kedua pembuatan tiket, setara halaman Help Center publik tapi untuk
// klien yang SUDAH login: emailnya datang dari akun (tak diketik ulang), tak ada honeypot, dan
// tujuannya dibatasi project yang memang boleh ia akses.
const CAT_LABEL: Record<string, string> = {
  bug: "Bug", fitur: "Permintaan fitur", pertanyaan: "Pertanyaan", lainnya: "Lainnya",
};
const MAX_FILES = 3;

export function TicketForm({ projects, activeId, onCancel, onSent }: {
  projects: PortalProject[];
  activeId: string;
  onCancel: () => void;
  onSent: (projectId: string) => void;
}) {
  const [projectId, setProjectId] = React.useState(activeId);
  const [category, setCategory] = React.useState<string>(zTicketCategory.options[0]);
  const [title, setTitle] = React.useState("");
  const [detail, setDetail] = React.useState("");
  const [files, setFiles] = React.useState<File[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const submit = async () => {
    setErr(null); setBusy(true);
    try {
      const form = new FormData();
      form.set("category", category); form.set("title", title); form.set("detail", detail);
      for (const f of files.slice(0, MAX_FILES)) form.append("files", f, f.name);
      await portalApi.createTicket(projectId, form);
      onSent(projectId);
    } catch {
      setErr("Gagal mengirim keluhan. Coba lagi sebentar.");
    } finally { setBusy(false); }
  };

  return (
    <Modal open title="Kirim keluhan" icon="send" eyebrow="help desk" onClose={onCancel}>
      <Field label="Project">
        <Select aria-label="Project" value={projectId} onChange={(e) => setProjectId(e.target.value)}
          options={projects.map((p) => ({ value: p.id, label: p.name }))} style={{ width: "100%" }} />
      </Field>
      <Field label="Kategori">
        <Select aria-label="Kategori" value={category} onChange={(e) => setCategory(e.target.value)}
          options={zTicketCategory.options.map((c) => ({ value: c, label: CAT_LABEL[c] ?? c }))}
          style={{ width: "100%" }} />
      </Field>
      <Field label="Judul">
        <input aria-label="Judul" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200}
          placeholder="mis. Tombol Simpan tak berfungsi di HP" style={INPUT} />
      </Field>
      <Field label="Detail">
        <HnTextarea aria-label="Detail" value={detail} onChange={(e) => setDetail(e.target.value)} rows={5}
          placeholder="mis. Buka halaman Pesanan di HP, tekan Simpan — layar diam dan datanya tak tersimpan." />
      </Field>
      <Field label="Lampiran gambar" hint={`Opsional, maksimal ${MAX_FILES} berkas PNG/JPEG/WebP.`}>
        <input aria-label="Lampiran gambar" type="file" accept="image/png,image/jpeg,image/webp" multiple
          onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, MAX_FILES))} />
      </Field>
      {err && <div style={{ color: "var(--clay-600)", fontSize: 13, marginBottom: 8 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
        <Button size="sm" variant="secondary" onClick={onCancel}>Batal</Button>
        <Button size="sm" variant="primary" leftIcon="send" disabled={busy || !title.trim() || !detail.trim()}
          onClick={submit}>Kirim</Button>
      </div>
    </Modal>
  );
}

const INPUT: React.CSSProperties = {
  display: "block", width: "100%", boxSizing: "border-box", padding: "9px 11px",
  border: "1px solid var(--border-strong)", borderRadius: "var(--radius-sm)",
  background: "var(--surface-card)", color: "var(--text-strong)", fontSize: 13,
  fontFamily: "var(--font-ui)",
};
```

- [ ] **Step 5: Pasang di `ClientPortal`**

Import + state:

```tsx
import { TicketForm } from "./TicketForm";
```

```tsx
  const [composing, setComposing] = React.useState(false);
```

Muat ulang daftar jadi fungsi yang bisa dipanggil lagi — ganti efek `active` (baris 39-44) dengan:

```tsx
  const loadLists = React.useCallback((id: string) => {
    void Promise.all([portalApi.listBacklog(id), portalApi.listTickets(id)])
      .then(([b, t]) => { setBacklog(b.items); setTickets(t.items); })
      .catch(() => { setBacklog([]); setTickets([]); });
  }, []);

  React.useEffect(() => { if (active) loadLists(active); }, [active, loadLists]);
```

Tombol di baris `Tabs` — bungkus `Tabs` supaya tombolnya sebaris:

```tsx
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <Tabs value={tab} onChange={setTab} style={{ flex: 1, minWidth: 0 }} tabs={[
                  { value: "backlog", label: "Pekerjaan", count: backlog.length },
                  { value: "tickets", label: "Help desk", count: tickets.length },
                ]} />
                <Button size="sm" leftIcon="send" onClick={() => setComposing(true)}>Kirim keluhan</Button>
              </div>
```

Modal form, di dekat dua `Modal` yang sudah ada:

```tsx
      {composing && projects && projects.length > 0 && (
        <TicketForm projects={projects} activeId={active!} onCancel={() => setComposing(false)}
          onSent={(id) => {
            setComposing(false);
            setTab("tickets");
            // Dimuat ulang dari server, bukan disisipkan di klien: yang tampil adalah tiket
            // seperti yang dilihat operator, bukan tebakan bentuk baris.
            if (id === active) loadLists(id); else setActive(id);
          }} />
      )}
```

Perbarui hint keadaan kosong tab Help desk supaya tak lagi menyuruh klien keluar dari portal:

```tsx
                  ? <StateBlock kind="empty" icon="inbox" title="Belum ada tiket"
                      hint="Kirim keluhan lewat tombol Kirim keluhan di atas — atau lewat halaman Help Center project ini." />
```

- [ ] **Step 6: Jalankan — harus HIJAU**

```bash
env -u NODE_ENV ./node_modules/.bin/vitest --run src/test/client-portal.test.tsx src/test/portal-scroll.test.tsx src/test/portal-status-pill.test.ts
pnpm --filter ./src typecheck
```

Expected: PASS semua; typecheck bersih. (Bila nama paket web bukan `./src`, pakai path paketnya — cek `pnpm-workspace.yaml`.)

- [ ] **Step 7: Commit**

```bash
git add src/src/api/portal.ts src/src/portal/TicketForm.tsx src/src/portal/ClientPortal.tsx src/test/client-portal.test.tsx
git commit -m "feat(spec-626): tombol kirim keluhan di portal klien"
```

---

### Task 8: Docs Source of Truth

**Files:**
- Create: `internal/docs/adr/0111-portal-klien-kirim-tiket.md`
- Modify: `internal/docs/adr/0110-portal-klien-read-only.md` (tanda amandemen)
- Modify: `internal/docs/README.md` (baris ADR-0111 di puncak daftar adr)
- Modify: `internal/docs/adr/README.md` (narasi ADR-0111)
- Modify: `internal/docs/architecture/api-contract.md` (endpoint baru)
- Modify: `internal/docs/frontend/frontend-implementation.md` (rantai gulir portal + tabel status→pill)

**Interfaces:** —

- [ ] **Step 1: Tulis ADR-0111**

Isi wajib: konteks (portal lahir baca-saja; satu-satunya jalur lapor adalah halaman publik) ·
keputusan (1) satu route tulis `POST /api/portal/projects/:id/tickets` dengan allowlist berbentuk
**path**, (2) satu pipeline `services/ticket-intake.ts` dipakai dua pintu, (3) **tidak** bergantung
`helpEnabled` — beserta alasannya, (4) rate-limit per akun + bucket project bersama, honeypot
dicabut untuk jalur ini, email dari akun, (5) proyeksi respons = `toPortalTicket`, kunci opaque tak
dikembalikan · konsekuensi · alternatif yang ditolak (memakai `POST /api/help/:slug/tickets` yang
sudah ada) · gotcha (bentuk path, bukan method; 404 bukan 403; `helpEnabled` sengaja terpisah;
`parseTicketUpload` menguras stream sehingga urutan gerbang penting).

Nomor **0111** sudah diverifikasi bebas: `git branch -a` × `git ls-tree` atas `internal/docs/adr`
di seluruh branch **dan** `git worktree list` (2026-08-10) → tertinggi 0110.

- [ ] **Step 2: Tandai amandemen di ADR-0110**

Tambahkan di blok metadata ADR-0110: `- Diamandemen oleh: ADR-0111 (satu route tulis: kirim tiket dari portal)`,
dan di §"Konsekuensi" satu kalimat bahwa "tak ada satu pun aksi tulis" berlaku sampai ADR-0111.

- [ ] **Step 3: Tautkan di kedua index**

`internal/docs/README.md`, di puncak daftar `## adr`:

```markdown
- [0111 — Portal klien mengirim tiket help desk: satu route tulis, satu pipeline intake, lepas dari `helpEnabled`](adr/0111-portal-klien-kirim-tiket.md)
```

`internal/docs/adr/README.md`: entri naratif dengan gaya yang sama seperti tetangganya (apa yang
diamandemen, gotcha-nya).

- [ ] **Step 4: api-contract + frontend-implementation**

`api-contract.md`: tambahkan `POST /api/portal/projects/:id/tickets` (multipart; field
`category`/`title`/`detail` + `files`; 201 `PortalTicket`; 404 generik; 400; 429) di dekat lima GET
portal.

`frontend-implementation.md`: satu seksi pendek "Portal klien (SPEC-617/626)" berisi rantai gulir
(`portal-root` → header `FIXED_ROW_STYLE` → `<main>` `LIST_SCROLL_STYLE`) dan tabel pemetaan
status→`StatusPill` dari `src/src/portal/status-pill.ts`.

- [ ] **Step 5: Verifikasi index**

```bash
node cli/dist/index.js docs index --check 2>/dev/null || pnpm --filter ./cli exec tsx src/index.ts docs index --check
```

Expected: index konsisten (tak ada doc tak ter-link). Bila CLI belum ter-build, cukup pastikan
manual bahwa berkas ADR baru muncul di kedua README.

- [ ] **Step 6: Commit**

```bash
git add internal/docs
git commit -m "docs(spec-626): ADR-0111 kirim tiket dari portal klien + perbarui SoT tersentuh"
```

---

### Task 9: Verifikasi akhir & smoke endpoint

**Files:** —

- [ ] **Step 1: Jalankan seluruh test yang tersentuh**

```bash
cd /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/spec-626
env -u NODE_ENV TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  ./node_modules/.bin/vitest --run --no-file-parallelism --changed "$HANOMAN_BASE_SHA"
```

Expected: PASS. **Pastikan berkas test-nya memang berjalan** — `--changed` menyalakan
`passWithNoTests`, jadi "no test files" TERLIHAT hijau tapi tak membuktikan apa pun.

- [ ] **Step 2: Typecheck paket yang tersentuh**

```bash
pnpm --filter ./server typecheck
pnpm --filter ./src typecheck
```

Expected: bersih. JANGAN `pnpm -r typecheck`.

- [ ] **Step 3: Smoke endpoint nyata (sekali, di akhir)**

Boot server dengan `HANOMAN_HOME` khusus, buat project + akun klien + akses, lalu:

```bash
curl -i -c /tmp/spec626.jar -H 'content-type: application/json' \
  -d '{"email":"klien@x.co","password":"password2"}' http://127.0.0.1:<port>/api/auth/login
curl -i -b /tmp/spec626.jar -F category=bug -F title=Smoke -F detail=Detail \
  http://127.0.0.1:<port>/api/portal/projects/<pid>/tickets
curl -s -b /tmp/spec626.jar http://127.0.0.1:<port>/api/portal/projects/<pid>/tickets
# dan yang HARUS ditolak:
curl -i -b /tmp/spec626.jar -X POST http://127.0.0.1:<port>/api/portal/projects/<pid>/backlog
```

Expected: `201` + amplop `PortalTicket`; daftar memuat tiket itu ber-status `Sedang ditinjau`;
`POST …/backlog` → `403 { "error": "portal klien: baca-saja" }`.
Pakai `HANOMAN_HOME` sendiri (`mktemp -d`) — jangan DB test bersama (memori: run tetangga
menghapusnya di tengah smoke).

- [ ] **Step 4: Commit hasil verifikasi bila ada perbaikan**

```bash
git add -u && git commit -m "chore(spec-626): perbaikan dari verifikasi akhir"
```

(Lewati bila diff bersih.)
