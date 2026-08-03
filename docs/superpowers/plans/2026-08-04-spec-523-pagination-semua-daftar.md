# SPEC-523 — Pagination pada semua daftar · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Meratakan pola paginasi yang sudah ada (ADR-0038) ke seluruh daftar utama dashboard, sehingga tak ada lagi daftar yang memuat seluruh baris sekaligus atau menyembunyikan data lama di balik plafon hardcode.

**Architecture:** Amplop `Paginated<T>` = `{items,total,page,pageSize}` + query `page`/`limit` di server (`services/paginate.ts` atau `skip`/`take` DB bila daftarnya tanpa overlay), `serverPage()` + `<Pager>` design system di UI. Tak ada komponen paginator baru dan tak ada pola kedua. Tiga pengecualian dinyatakan eksplisit di ADR-0106: git graph tetap jendela tumbuh (lane butuh commit kontigu), docs tetap pohon, error sudah dicabut ADR-0092.

**Tech Stack:** Fastify + Prisma 6 (SQLite) di server, React 18 + TS strict di web, Zod DTO di `shared`, vitest.

**Spec:** [`docs/superpowers/specs/2026-08-04-spec-523-pagination-semua-daftar-design.md`](../specs/2026-08-04-spec-523-pagination-semua-daftar-design.md)

## Global Constraints

- **TypeScript strict** + `noUncheckedIndexedAccess`. Jangan mengindeks objek dengan kunci dinamis untuk field berkunci tetap — tulis kuncinya apa adanya (pola `srcView` di `routes/scheduler.ts`).
- **Bahasa komentar & teks UI: Indonesia.** Kode, nama simbol, dan output tetap apa adanya.
- **Setiap task diakhiri commit** dengan trailer `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Test server WAJIB** `--no-file-parallelism` **dan** `TEST_DATABASE_URL` sendiri — mesin ini menjalankan beberapa sesi sekaligus dan `<db>.test.db` diturunkan dari `HANOMAN_HOME` (bersama antar-worktree), dihapus `global-setup.ts` di awal tiap run. Bentuk perintah baku:
  ```bash
  TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism <path>
  ```
- **Test web WAJIB** `env -u NODE_ENV` — shell sesi ini punya `NODE_ENV=production` yang membuat RTL `act` gagal massal:
  ```bash
  env -u NODE_ENV pnpm vitest --run <path>
  ```
- **Scope verifikasi = hanya berkas yang berubah.** Jangan `pnpm test`, `vitest run` polos, `pnpm -r typecheck`, atau build penuh.
- **Jangan membunuh proses lewat pola** (`pkill -f`, `killall`) — korbannya selalu sesi tetangga. Bunuh per-PID.
- Worktree ini sudah `pnpm install` + `prisma generate`. Bila `prisma.<model>` tiba-tiba `undefined`, jalankan ulang `pnpm --filter ./server exec prisma generate`.
- **Tanpa migration.** Tak ada perubahan skema Prisma di seluruh plan ini.

---

### Task 1: Notifikasi — server menerima `page`/`limit` dan menyatakan `total`

`notificationsFeed()` hari ini `take: 50` hardcode tanpa `total`: 287 baris di DB hidup → 237 tak terjangkau, dan bell mengklaim 50 itu semuanya. Fungsi ini **juga** memberi makan frame siar WebSocket tiap 3 detik (`services/events.ts`), jadi perilaku tanpa argumen harus tetap 50 — menyiarkan 287 baris tiap 3 detik adalah regresi biaya, bukan perbaikan.

**Files:**
- Modify: `server/src/services/notifications.ts` (fungsi `notificationsFeed`, baris ~115)
- Modify: `server/src/routes/notifications.ts:8`
- Modify: `shared/src/dto.ts:518` (varian `EventMsg` `notifications`)
- Test: `server/test/notifications.route.test.ts` (buat bila belum ada)

**Interfaces:**
- Produces: `notificationsFeed(p?: { page?: string; limit?: string }): Promise<{ items: Notification[]; unread: number; total: number; page: number; pageSize: number }>` — dipakai Task 2 (UI) dan Task 12 (test kontrak).
- Produces: `DEFAULT_FEED_TAKE = 50` (diekspor untuk test).

- [x] **Step 1: Tulis test yang gagal**

Buat `server/test/notifications.route.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";

const app = buildApp({ requireAuth: false });
const clean = async () => { await prisma.notification.deleteMany(); };
beforeEach(clean); afterAll(clean);

// 60 baris: melampaui plafon 50 lama, jadi "tanpa limit" dan "total" tak bisa tertukar.
async function seed(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await prisma.notification.create({
      data: {
        type: "done", key: `done:SPEC-${i}`, specId: `SPEC-${i}`, title: `judul ${i}`,
        projectId: null, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
      },
    });
  }
}

describe("GET /notifications (SPEC-523)", () => {
  it("tanpa limit: 50 teratas seperti sebelum SPEC-523, tapi total menyatakan seluruhnya", async () => {
    await seed(60);
    const r = await app.inject({ method: "GET", url: "/api/notifications" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.items.length).toBe(50);
    expect(b.total).toBe(60);
    expect(b.page).toBe(1);
    expect(b.pageSize).toBe(50);
    // terbaru dulu: detik ke-59 adalah yang paling baru
    expect(b.items[0].specId).toBe("SPEC-59");
  });

  it("page/limit memotong dengan benar dan total tetap penuh", async () => {
    await seed(60);
    const r = await app.inject({ method: "GET", url: "/api/notifications?page=2&limit=10" });
    const b = r.json();
    expect(b.items.length).toBe(10);
    expect(b.total).toBe(60);
    expect(b.page).toBe(2);
    expect(b.pageSize).toBe(10);
    expect(b.items[0].specId).toBe("SPEC-49");   // halaman 1 = 59..50
  });

  it("page melampaui halaman terakhir: items kosong, total tetap benar", async () => {
    await seed(60);
    const b = (await app.inject({ method: "GET", url: "/api/notifications?page=99&limit=10" })).json();
    expect(b.items).toEqual([]);
    expect(b.total).toBe(60);
  });

  it("unread dihitung dari seluruh baris, bukan dari halaman yang diminta", async () => {
    await seed(60);
    const b = (await app.inject({ method: "GET", url: "/api/notifications?page=1&limit=5" })).json();
    expect(b.items.length).toBe(5);
    expect(b.unread).toBe(60);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan MERAH**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/notifications.route.test.ts
```
Diharapkan: GAGAL — `b.total` `undefined` (`expected undefined to be 60`).

- [x] **Step 3: Implementasi di `server/src/services/notifications.ts`**

Ganti `notificationsFeed` yang ada dengan:

```ts
// SPEC-523 · plafon feed siar. Frame WebSocket `notifications` (services/events.ts) lahir tiap 3
// detik; menyiarkan seluruh riwayat tiap kali adalah regresi biaya, bukan perbaikan. Jadi
// "tanpa limit" TETAP 50 di sini — berbeda dari paginate() (ADR-0038) yang tanpa limit berarti
// seluruh item. Yang ditambahkan SPEC-523 adalah `total`: 50 tak lagi berpura-pura jadi semuanya.
export const DEFAULT_FEED_TAKE = 50;

// SPEC-199 · cermin GET /notifications: scan marker dulu, lalu daftar + hitungan unread.
// Dipakai route HTTP dan hub siar (services/events.ts). Tipe di-infer (baris Prisma, tanggal
// Date) — sama seperti route lain; JSON serialize Date→string sesuai wire type shared.
// SPEC-523 · `skip`/`take` di query DB SAH di sini: larangan ADR-0038 mengikat GET /specs yang
// overlay stage live-nya bergantung set penuh. Notifikasi adalah baris mati tanpa overlay.
export async function notificationsFeed(p: { page?: string; limit?: string } = {}) {
  await scanDecisions();
  const pageSize = p.limit ? Math.max(1, Math.floor(+p.limit) || 1) : DEFAULT_FEED_TAKE;
  const page = p.page ? Math.max(1, Math.floor(+p.page) || 1) : 1;
  const total = await prisma.notification.count();
  const items = await prisma.notification.findMany({
    orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize,
  });
  // `unread` selalu dihitung dari SELURUH baris, tak pernah dari halaman yang diminta —
  // lencana bell yang mengecil saat operator membuka halaman 2 adalah kebohongan.
  const unread = await prisma.notification.count({ where: { readAt: null } });
  return { items, unread, total, page, pageSize };
}
```

- [x] **Step 4: Teruskan query di route**

Di `server/src/routes/notifications.ts`, ganti baris 8:

```ts
  app.get("/notifications", async (req) =>
    notificationsFeed(req.query as { page?: string; limit?: string }));
```

- [x] **Step 5: Perluas wire type frame siar**

Di `shared/src/dto.ts` baris 518, ganti varian `notifications`:

```ts
  // SPEC-523 · `total` ikut disiarkan: bell menampilkan 50 teratas, dan tanpa angka ini 50 itu
  // terbaca sebagai "semuanya". Bentuk daftar frame tak berubah (tetap 50 teratas).
  | { t: "notifications"; items: Notification[]; unread: number; total: number; page: number; pageSize: number }
```

- [x] **Step 6: Jalankan test, pastikan HIJAU**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/notifications.route.test.ts
```
Diharapkan: 4 test lulus.

- [x] **Step 7: Typecheck paket yang tersentuh**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck
```
Diharapkan: nol error.

- [x] **Step 8: Commit**

```bash
git add server/src/services/notifications.ts server/src/routes/notifications.ts shared/src/dto.ts server/test/notifications.route.test.ts
git commit -m "$(cat <<'EOF'
feat(spec-523): GET /notifications menerima page/limit dan menyatakan total

287 baris di DB hidup, 50 terjangkau. Tanpa `limit` perilakunya TETAP 50 teratas
supaya frame siar WebSocket tiap 3 detik tak berubah biaya; yang ditambahkan
adalah `total`, sehingga 50 berhenti berpura-pura jadi semuanya.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Notifikasi — modal arsip ber-`Pager`, bell tetap live

Bell datanya **didorong WebSocket**, bukan HTTP, jadi Task 1 sendirian tak memberi operator halaman. Arsip hidup di modal terpisah (cermin `SessionHistoryModal`); bell hanya menambah tautan ke sana.

**Files:**
- Create: `src/src/notifications/NotificationsArchiveModal.tsx`
- Modify: `src/src/notifications/NotificationsContext.tsx` (tambah `total` ke ctx)
- Modify: `src/src/notifications/NotificationBell.tsx` (kaki "Lihat semua")
- Modify: `src/src/api/client.ts:183` (`listNotifications` menerima params)
- Test: `src/test/notifications-archive.test.tsx`

**Interfaces:**
- Consumes: amplop `{items, unread, total, page, pageSize}` dari Task 1.
- Produces: `NotificationsArchiveModal({ onClose, onOpen })`.
- Impor DS **wajib** dari `../ds/kit` (bukan `../ds`): `ds/index.ts` mengekspor `shell.tsx` yang mengimpor `NotificationBell` → impor dari barrel melahirkan siklus. `kit.tsx` hanya mengimpor `./icon`, jadi aman.

- [x] **Step 1: Tulis test yang gagal**

Buat `src/test/notifications-archive.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NotificationsArchiveModal } from "../src/notifications/NotificationsArchiveModal";

const rows = (from: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `n${from + i}`, type: "done", key: `done:SPEC-${from + i}`,
    specId: `SPEC-${from + i}`, sessionId: null, projectId: null,
    title: `judul ${from + i}`, readAt: null, createdAt: "2026-08-04T00:00:00.000Z",
  }));

const listNotifications = vi.fn(async (p: { page?: number; limit?: number } = {}) => ({
  items: rows((p.page ?? 1) === 1 ? 0 : 20, 20),
  unread: 0, total: 60, page: p.page ?? 1, pageSize: 20,
}));

vi.mock("../src/api/client", () => ({ api: { listNotifications: (p?: never) => listNotifications(p ?? {}) } }));

beforeEach(() => vi.clearAllMocks());

describe("NotificationsArchiveModal (SPEC-523)", () => {
  it("merender halaman pertama dan kontrol halaman saat total > pageSize", async () => {
    render(<NotificationsArchiveModal onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("judul 0")).toBeInTheDocument());
    expect(screen.getByText("1–20 dari 60 notifikasi")).toBeInTheDocument();
  });

  it("menekan Berikutnya MENGGANTI isi daftar, bukan menambahnya", async () => {
    render(<NotificationsArchiveModal onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("judul 0")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Berikutnya"));
    await waitFor(() => expect(screen.getByText("judul 20")).toBeInTheDocument());
    expect(screen.queryByText("judul 0")).not.toBeInTheDocument();
    expect(listNotifications).toHaveBeenLastCalledWith({ page: 2, limit: 20 });
  });
});
```

- [x] **Step 2: Jalankan test, pastikan MERAH**

```bash
env -u NODE_ENV pnpm vitest --run src/test/notifications-archive.test.tsx
```
Diharapkan: GAGAL — modul `NotificationsArchiveModal` tak ada.

- [x] **Step 3: Longgarkan `listNotifications` di api client**

Di `src/src/api/client.ts` baris 183, ganti:

```ts
  // SPEC-523 · tanpa params → 50 teratas (perilaku bell yang didorong WS). Dengan page/limit →
  // halaman arsip. `total` selalu ada di kedua bentuk.
  listNotifications: (p: { page?: number; limit?: number } = {}) =>
    j<Paginated<Notification> & { unread: number }>(paths.notifications + qs(p)),
```

- [x] **Step 4: Buat modal arsip**

Buat `src/src/notifications/NotificationsArchiveModal.tsx`:

```tsx
/* SPEC-523 · arsip notifikasi. Bell adalah BAKI yang didorong WebSocket (50 teratas, live);
   arsip adalah DAFTAR yang ditarik HTTP dan berhalaman. Dua peran, dua permukaan — menaruh
   halaman 2+ di dalam dropdown 320px berarti satu komponen memegang dua sumber data hidup. */
import React from "react";
import type { Notification } from "@hanoman/shared";
import { api } from "../api/client";
// Impor dari ds/kit LANGSUNG, bukan dari barrel ../ds: barrel mengekspor shell.tsx yang
// mengimpor NotificationBell, dan itu menutup siklus impor.
import { Modal, Pager, serverPage } from "../ds/kit";
import { Icon } from "../ds/icon";

const PAGE = 20;

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "baru saja";
  const m = Math.round(s / 60); if (m < 60) return `${m}m lalu`;
  const h = Math.round(m / 60); if (h < 24) return `${h}j lalu`;
  return `${Math.round(h / 24)}h lalu`;
}

export function NotificationsArchiveModal({ onClose, onOpen }:
  { onClose: () => void; onOpen?: (n: Notification) => void }) {
  const [items, setItems] = React.useState<Notification[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    api.listNotifications({ page, limit: PAGE })
      .then((r) => { if (alive) { setItems(r.items); setTotal(r.total); } })
      .catch(() => { if (alive) { setItems([]); setTotal(0); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [page]);

  const sp = serverPage(total, page, PAGE);

  return (
    <Modal open title="Semua notifikasi" icon="bell" onClose={onClose} width={720}>
      <div style={{ display: "flex", flexDirection: "column", maxHeight: "60vh", overflowY: "auto" }}>
        {loading && items.length === 0
          ? <div style={{ padding: "18px 10px", textAlign: "center", color: "var(--text-subtle)", fontSize: 13 }}>memuat…</div>
          : items.length === 0
            ? <div style={{ padding: "18px 10px", textAlign: "center", color: "var(--text-subtle)", fontSize: 13 }}>Belum ada notifikasi</div>
            : items.map((n) => (
              <div key={n.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 8px",
                borderBottom: "1px solid var(--border-hair)" }}>
                <Icon name="bell" size={14} color="var(--text-subtle)" />
                <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--text-strong)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {n.specId ? `${n.specId} · ${n.title}` : n.title}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-subtle)" }}>
                  {timeAgo(n.createdAt)}
                </span>
                {onOpen && (
                  <button onClick={() => { onOpen(n); onClose(); }} style={{ border: "none", background: "transparent",
                    cursor: "pointer", color: "var(--text-muted)", fontSize: 12, fontFamily: "var(--font-ui)" }}>Buka</button>
                )}
              </div>
            ))}
      </div>
      <Pager page={sp.page} pageCount={sp.pageCount} total={total} from={sp.from} to={sp.to}
        onPage={setPage} unit="notifikasi" />
    </Modal>
  );
}
```

- [x] **Step 5: Jalankan test, pastikan HIJAU**

```bash
env -u NODE_ENV pnpm vitest --run src/test/notifications-archive.test.tsx
```
Diharapkan: 2 test lulus.

- [x] **Step 6: Sambungkan `total` dan tautannya ke bell**

Di `src/src/notifications/NotificationsContext.tsx`:

- Baris 43, perluas `Ctx`:
```ts
type Ctx = { items: Notification[]; unread: number; total: number; markAllRead: () => void; clear: () => void; onOpen?: (n: Notification) => void };
```
- Baris 46, perluas nilai default:
```ts
export const NotificationsContext = React.createContext<Ctx>({ items: [], unread: 0, total: 0, markAllRead: () => { }, clear: () => { } });
```
- Baris 50-51, tambah state:
```ts
  const [total, setTotal] = React.useState(0);
```
- Baris 71-72, `handle` menerima `total`:
```ts
  const handle = React.useCallback((data: { items: Notification[]; unread: number; total?: number }) => {
    setItems(data.items); setUnread(data.unread); setTotal(data.total ?? data.items.length);
```
- Baris 86, teruskan dari frame:
```ts
    const unsub = subscribe((m) => { if (m.t === "notifications") handle({ items: m.items, unread: m.unread, total: m.total }); });
```
- Baris 103-106, `clear` juga menolkan total:
```ts
  const clear = React.useCallback(() => {
    setItems([]); setUnread(0); setTotal(0);
    api.clearNotifications().catch(() => { });
  }, []);
```
- Baris 109, sertakan di provider:
```ts
    <NotificationsContext.Provider value={{ items, unread, total, markAllRead, clear, onOpen }}>
```

Di `src/src/notifications/NotificationBell.tsx`:

- Baris 14, ambil `total`:
```tsx
  const { items, unread, total, markAllRead, clear, onOpen } = useNotifications();
```
- Baris 15, tambah state modal:
```tsx
  const [archive, setArchive] = React.useState(false);
```
- Baris 96-100, ganti kaki dropdown (tombol "Tandai semua dibaca") dengan dua baris:
```tsx
          {items.length > 0 && (
            <div style={{ display: "flex", marginTop: 4, borderTop: "1px solid var(--border-hair)" }}>
              <button onClick={markAllRead} style={{ flex: 1, padding: "8px", border: "none",
                background: "transparent", cursor: "pointer",
                color: "var(--text-muted)", fontSize: 12.5, fontFamily: "var(--font-ui)" }}>Tandai semua dibaca</button>
              {/* SPEC-523 · bell menampilkan 50 teratas. Tanpa angka ini, 50 terbaca sebagai
                  "semuanya" — persis salah baca yang melahirkan backlog ini. */}
              <button onClick={() => { setArchive(true); setOpen(false); }} style={{ flex: 1, padding: "8px", border: "none",
                borderLeft: "1px solid var(--border-hair)", background: "transparent", cursor: "pointer",
                color: "var(--brass-600)", fontSize: 12.5, fontFamily: "var(--font-ui)" }}>
                Lihat semua{total > items.length ? ` (${total})` : ""}
              </button>
            </div>
          )}
```
- Sebelum `</div>` penutup terluar (baris ~103), render modalnya:
```tsx
      {archive && <NotificationsArchiveModal onClose={() => setArchive(false)} onOpen={onOpen} />}
```
- Tambah impor di baris 3:
```tsx
import { NotificationsArchiveModal } from "./NotificationsArchiveModal";
```

- [x] **Step 7: Jalankan test bell + arsip, pastikan HIJAU**

```bash
env -u NODE_ENV pnpm vitest --run src/test/notifications-archive.test.tsx src/test/notifications.test.tsx
```
Diharapkan: seluruh test lulus. Bila `src/test/notifications.test.tsx` tak ada, jalankan yang pertama saja dan lanjutkan:
```bash
env -u NODE_ENV pnpm vitest --run src/test/notifications-archive.test.tsx
```

- [x] **Step 8: Typecheck web**

```bash
pnpm --filter ./src typecheck
```
Diharapkan: nol error.

- [x] **Step 9: Commit**

```bash
git add src/src/notifications/ src/src/api/client.ts src/test/notifications-archive.test.tsx
git commit -m "$(cat <<'EOF'
feat(spec-523): arsip notifikasi ber-Pager, bell tetap live

Bell adalah baki yang didorong WebSocket; arsip adalah daftar yang ditarik HTTP
dan berhalaman. Dua peran, dua permukaan — dropdown 320px tak jadi pemegang dua
sumber data hidup sekaligus.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Scheduler — antrean jadi endpoint daftar sendiri

`GET /scheduler/state` mengirim seluruh `queue` (56 baris hari ini, tumbuh tanpa batas) lalu klien memfilternya jadi tiga daftar. Antrean dipindah ke endpoint daftar berhalaman; state hanya membawa hitungannya.

**Files:**
- Modify: `server/src/services/scheduler/queue.ts` (tambah `listQueuePage`, `queueCounts`)
- Modify: `server/src/routes/scheduler.ts:18-40`
- Modify: `shared/src/dto.ts:144-151` (`zSchedulerState`)
- Modify: `shared/src/api.ts:127` (path baru)
- Modify: `shared/src/scheduler-state.test.ts:13-17,26`
- Test: `server/test/scheduler.route.test.ts`

**Interfaces:**
- Produces: `listQueuePage(f: { status?: string; page?: string; limit?: string }): Promise<Paginated<SchedulerQueueItem>>`
- Produces: `queueCounts(): Promise<{ queued: number; launched: number; done: number; failed: number }>`
- Produces: path `paths.schedulerQueue` → `/api/scheduler/queue`
- Produces: `zSchedulerState` tanpa `queue`, dengan `queueCounts`.

- [ ] **Step 1: Tulis test yang gagal**

Di `server/test/scheduler.route.test.ts`, **ganti** test `GET /state exposes cap, queue contents, ...` dengan dua test berikut (pertahankan test lain apa adanya):

```ts
  it("GET /state membawa queueCounts, tak lagi membawa queue penuh (SPEC-523)", async () => {
    await enqueue({ specId: "SPEC-1", projectId: "p1", source: "backlog", priority: "tinggi" });
    await enqueue({ specId: "SPEC-2", projectId: "p1", source: "backlog", priority: "sedang" });
    const r = await app.inject({ method: "GET", url: "/api/scheduler/state" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.cap).toBe(2);
    expect(b.queue).toBeUndefined();
    expect(b.queueCounts).toEqual({ queued: 2, launched: 0, done: 0, failed: 0 });
    expect(b.sources.map((s: { id: string }) => s.id)).toEqual(["backlog", "triase"]);
  });

  it("GET /scheduler/queue berhalaman & tersaring status (SPEC-523)", async () => {
    for (let i = 0; i < 5; i++) {
      await enqueue({ specId: `SPEC-${i}`, projectId: "p1", source: "backlog", priority: "sedang" });
    }
    const all = await app.inject({ method: "GET", url: "/api/scheduler/queue?page=1&limit=2" });
    expect(all.statusCode).toBe(200);
    const b = all.json();
    expect(b.items.length).toBe(2);
    expect(b.total).toBe(5);
    expect(b.page).toBe(1);
    expect(b.pageSize).toBe(2);

    const none = await app.inject({ method: "GET", url: "/api/scheduler/queue?status=failed" });
    expect(none.json().total).toBe(0);
    expect(none.json().items).toEqual([]);
  });
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/scheduler.route.test.ts
```
Diharapkan: GAGAL — `queueCounts` `undefined` dan `/api/scheduler/queue` 404.

- [ ] **Step 3: Tambah helper di `server/src/services/scheduler/queue.ts`**

Tambahkan setelah `listQueue` (baris ~35):

```ts
// SPEC-523 · antrean sebagai DAFTAR berhalaman. `skip`/`take` di query DB sah: baris antrean tak
// punya overlay apa pun (larangan ADR-0038 mengikat GET /specs, yang stage live-nya butuh set penuh).
export async function listQueuePage(f: { status?: string; page?: string; limit?: string } = {}):
  Promise<{ items: SchedulerQueueItem[]; total: number; page: number; pageSize: number }> {
  const where = f.status ? { status: f.status } : undefined;
  const total = await prisma.schedulerQueueItem.count({ where });
  const pageSize = f.limit ? Math.max(1, Math.floor(+f.limit) || 1) : (total || 1);
  const page = f.page ? Math.max(1, Math.floor(+f.page) || 1) : 1;
  const items = await prisma.schedulerQueueItem.findMany({
    where, orderBy: { enqueuedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize,
  });
  return { items, total, page, pageSize };
}

// SPEC-523 · hitungan per status untuk `GET /scheduler/state`. Kunci ditulis apa adanya (bukan
// index dinamis) agar tetap tertype di bawah noUncheckedIndexedAccess — pola `srcView` di route.
export async function queueCounts(): Promise<{ queued: number; launched: number; done: number; failed: number }> {
  const [queued, launched, done, failed] = await Promise.all([
    prisma.schedulerQueueItem.count({ where: { status: "queued" } }),
    prisma.schedulerQueueItem.count({ where: { status: "launched" } }),
    prisma.schedulerQueueItem.count({ where: { status: "done" } }),
    prisma.schedulerQueueItem.count({ where: { status: "failed" } }),
  ]);
  return { queued, launched, done, failed };
}
```

- [ ] **Step 4: Ubah route scheduler**

Di `server/src/routes/scheduler.ts`:

- Baris 4, ganti impor:
```ts
import { listQueue, listQueuePage, queueCounts } from "../services/scheduler/queue";
```
- Di handler `GET /scheduler/state`, ganti `const queue = await listQueue();` dan baris `return { ... }` (baris 21 & 36-39):
```ts
    // SPEC-523 · `queue` tak lagi ikut respons: ia daftar tanpa batas dan sudah punya endpoint
    // sendiri (`GET /scheduler/queue`). Kandidat "kirim yang dipotong diam-diam" DITOLAK —
    // daftar terpotong yang tampak utuh persis kelas bug SPEC-431/451/475.
    const counts = await queueCounts();
    // Sesi scheduler = sesi live yang punya item antrean 'launched' (marker asal-scheduler).
    const launchedSpecs = new Set((await listQueue("launched")).map((q) => q.specId));
    const sessions = live.filter((s) => s.specId && launchedSpecs.has(s.specId));
    return { config: cfg, cap: cfg.maxConcurrent, liveCount: live.length, sources, queueCounts: counts, sessions };
```
(hapus baris `const queue = await listQueue();` dan baris `const launchedSpecs = new Set(queue.filter(...)...)` yang lama)

- Tambah endpoint baru sesudah handler `state`:
```ts
  // SPEC-523 · daftar antrean berhalaman. Penyaring `status` diterapkan di query DB, bukan di klien.
  app.get("/scheduler/queue", async (req) => {
    const { status, page, limit } = req.query as Record<string, string | undefined>;
    const r = await listQueuePage({ status, page, limit });
    return {
      items: r.items.map((q) => ({
        id: q.id, specId: q.specId, projectId: q.projectId, source: q.source,
        priority: q.priority, status: q.status, sessionId: q.sessionId, note: q.note,
        enqueuedAt: q.enqueuedAt.toISOString(),
        launchedAt: q.launchedAt ? q.launchedAt.toISOString() : null,
      })),
      total: r.total, page: r.page, pageSize: r.pageSize,
    };
  });
```

- [ ] **Step 5: Perbarui DTO & path di `shared`**

Di `shared/src/dto.ts` baris 144-150, ganti `zSchedulerState`:

```ts
// SPEC-523 · `queue` DICABUT dari state: ia daftar tanpa batas dan kini punya endpoint sendiri
// (`GET /scheduler/queue`, amplop Paginated). State membawa hitungannya saja.
export const zSchedulerQueueCounts = z.object({
  queued: z.number().int(), launched: z.number().int(),
  done: z.number().int(), failed: z.number().int(),
});
export type SchedulerQueueCounts = z.infer<typeof zSchedulerQueueCounts>;

export const zSchedulerState = z.object({
  config: zScheduler,
  cap: z.number(), liveCount: z.number(),
  sources: z.array(zSchedulerSourceView),
  queueCounts: zSchedulerQueueCounts,
  sessions: z.array(zSchedulerSessionView),
});
```

Di `shared/src/api.ts` baris 127 (setelah `schedulerState`):
```ts
  // SPEC-523 · antrean sebagai daftar berhalaman (page/limit + status), lepas dari `state`.
  schedulerQueue: `${API}/scheduler/queue`,
```

- [ ] **Step 6: Perbarui test kontrak DTO**

Di `shared/src/scheduler-state.test.ts`, ganti blok `queue: [...]` (baris 13-17) dengan:
```ts
      queueCounts: { queued: 1, launched: 0, done: 1, failed: 0 },
```
dan ganti assert baris 26:
```ts
    expect(parsed.queueCounts.done).toBe(1);
```

- [ ] **Step 7: Jalankan test, pastikan HIJAU**

```bash
pnpm vitest --run shared/src/scheduler-state.test.ts
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/scheduler.route.test.ts
```
Diharapkan: keduanya lulus.

- [ ] **Step 8: Typecheck**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck
```
Diharapkan: nol error.

- [ ] **Step 9: Commit**

```bash
git add server/src/services/scheduler/queue.ts server/src/routes/scheduler.ts shared/src/dto.ts shared/src/api.ts shared/src/scheduler-state.test.ts server/test/scheduler.route.test.ts
git commit -m "$(cat <<'EOF'
feat(spec-523): antrean scheduler jadi endpoint daftar berhalaman

GET /scheduler/state berhenti mengirim `queue` penuh dan mengirim `queueCounts`;
antrean pindah ke GET /scheduler/queue (status + page/limit, amplop Paginated).
Alternatif "kirim queue yang dipotong diam-diam" ditolak: daftar terpotong yang
tampak utuh persis kelas bug SPEC-431/451/475.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Scheduler — UI tiga daftar berhalaman

**Files:**
- Modify: `src/src/screens/SchedulerScreen.tsx:133-139` (`Section`), `225-245` (load), `268-297` (render)
- Modify: `src/src/api/client.ts:421` (tambah `getSchedulerQueue`)
- Test: `src/test/scheduler-queue-pager.test.tsx`

**Interfaces:**
- Consumes: `GET /scheduler/queue` (Task 3), `state.queueCounts` (Task 3).
- Produces: `api.getSchedulerQueue(p: { status?: string; page?: number; limit?: number }): Promise<Paginated<SchedulerQueueItemView>>`

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/test/scheduler-queue-pager.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SchedulerScreen } from "../src/screens/SchedulerScreen";
import { SCHEDULER_DEFAULTS } from "@hanoman/shared";

const item = (i: number) => ({
  id: `q${i}`, specId: `SPEC-${i}`, projectId: "p1", source: "backlog", priority: "sedang",
  status: "queued", sessionId: null, note: null,
  enqueuedAt: "2026-08-04T00:00:00.000Z", launchedAt: null,
});

const getSchedulerQueue = vi.fn(async (p: { status?: string; page?: number; limit?: number } = {}) => ({
  items: p.status === "queued" ? [item((p.page ?? 1) === 1 ? 1 : 99)] : [],
  total: p.status === "queued" ? 30 : 0, page: p.page ?? 1, pageSize: 10,
}));

vi.mock("../src/api/client", () => ({
  api: {
    getSchedulerState: vi.fn(async () => ({
      config: SCHEDULER_DEFAULTS, cap: 2, liveCount: 0,
      sources: [{ id: "backlog", enabled: false, everyMin: 15, lastRunAt: null, nextRunAt: null }],
      queueCounts: { queued: 30, launched: 0, done: 0, failed: 0 },
      sessions: [],
    })),
    getSchedulerQueue: (p?: never) => getSchedulerQueue(p ?? {}),
    putSchedulerConfig: vi.fn(),
    updateProject: vi.fn(),
  },
}));

const props = {
  projects: [], backlog: [], onProjectChanged: vi.fn(), onToast: vi.fn(), onGotoTerminal: vi.fn(),
} as never;

beforeEach(() => vi.clearAllMocks());

describe("SchedulerScreen antrean berhalaman (SPEC-523)", () => {
  it("meminta antrean per status lewat endpoint daftar, bukan dari state", async () => {
    render(<SchedulerScreen {...props} />);
    await waitFor(() => expect(screen.getByText("SPEC-1")).toBeInTheDocument());
    expect(getSchedulerQueue).toHaveBeenCalledWith({ status: "queued", page: 1, limit: 10 });
  });

  it("menekan Berikutnya meminta halaman 2 untuk status itu saja", async () => {
    render(<SchedulerScreen {...props} />);
    await waitFor(() => expect(screen.getByText("SPEC-1")).toBeInTheDocument());
    fireEvent.click(screen.getAllByLabelText("Berikutnya")[0]!);
    await waitFor(() => expect(getSchedulerQueue).toHaveBeenCalledWith({ status: "queued", page: 2, limit: 10 }));
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

```bash
env -u NODE_ENV pnpm vitest --run src/test/scheduler-queue-pager.test.tsx
```
Diharapkan: GAGAL — `state.queue` `undefined` / `getSchedulerQueue` bukan fungsi.

- [ ] **Step 3: Tambah metode api client**

Di `src/src/api/client.ts` setelah baris `getSchedulerState` (baris 421):

```ts
  // SPEC-523 · antrean scheduler sebagai daftar berhalaman (lepas dari `state`).
  getSchedulerQueue: (p: { status?: string; page?: number; limit?: number } = {}) =>
    j<Paginated<SchedulerQueueItemView>>(paths.schedulerQueue + qs(p)),
```

Pastikan `SchedulerQueueItemView` ada di daftar impor tipe dari `@hanoman/shared` di berkas itu.

- [ ] **Step 4: Ganti `Section` jadi berhalaman**

Di `src/src/screens/SchedulerScreen.tsx`, ganti fungsi `Section` (baris 133-139) dengan komponen baru yang memuat datanya sendiri:

```tsx
const QUEUE_PAGE = 10;

/* SPEC-523 · satu bagian antrean = satu daftar berhalaman yang memuat datanya sendiri.
   Sebelumnya ketiganya adalah `filter()` di klien atas array `state.queue` yang tak berbatas. */
function QueueSection({ title, status, count, empty, nonce, render }: {
  title: string; status: string; count: number; empty: string; nonce: number;
  render: (q: SchedulerQueueItemView) => React.ReactNode;
}) {
  const [items, setItems] = React.useState<SchedulerQueueItemView[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);

  React.useEffect(() => {
    let alive = true;
    api.getSchedulerQueue({ status, page, limit: QUEUE_PAGE })
      .then((r) => { if (alive) { setItems(r.items); setTotal(r.total); } })
      .catch(() => { if (alive) { setItems([]); setTotal(0); } });
    return () => { alive = false; };
  }, [status, page, nonce]);

  const sp = serverPage(total, page, QUEUE_PAGE);
  return (
    <Card eyebrow="scheduler" title={`${title}${count ? ` · ${count}` : ""}`}>
      {count === 0
        ? <div style={{ fontSize: "var(--text-sm)", color: "var(--text-subtle)" }}>{empty}</div>
        : <>
          {items.map((q) => render(q))}
          <Pager page={sp.page} pageCount={sp.pageCount} total={total} from={sp.from} to={sp.to}
            onPage={setPage} unit="item" />
        </>}
    </Card>
  );
}

// Bagian non-antrean (sesi berjalan) tetap daftar biasa: sumbernya pane tmux hidup, berbatas cap.
function Section({ title, count, empty, children }: { title: string; count: number; empty: string; children?: React.ReactNode }) {
  return (
    <Card eyebrow="scheduler" title={`${title}${count ? ` · ${count}` : ""}`}>
      {count === 0 ? <div style={{ fontSize: "var(--text-sm)", color: "var(--text-subtle)" }}>{empty}</div> : children}
    </Card>
  );
}
```

Tambahkan `Pager, serverPage` ke impor DS di berkas ini, dan `SchedulerQueueItemView` ke impor tipe `@hanoman/shared`.

- [ ] **Step 5: Ganti pemakaiannya di badan `SchedulerScreen`**

Ganti baris 268-297 (`const queued = ...` sampai `</Section>` terakhir untuk "Gagal") dengan:

```tsx
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, minHeight: 0 }}>
      <ControlBar cfg={state.config} cap={state.cap} liveCount={state.liveCount} onWrite={writeConfig} busy={busy} />

      <Card eyebrow="scheduler · observabilitas" title="Status per source">
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {state.sources.map((s) => <SourceCard key={s.id} s={s} />)}
        </div>
      </Card>

      <QueueSection title="Antrean" status="queued" count={state.queueCounts.queued} empty="Antrean kosong."
        nonce={nonce} render={(q) => <QueueRow key={q.id} q={q} backlog={backlog} />} />

      <Section title="Sesi berjalan" count={state.sessions.length} empty="Tak ada sesi scheduler berjalan.">
        {state.sessions.map((s) => <SessionRow key={s.id} s={s} backlog={backlog} onGotoTerminal={onGotoTerminal} />)}
      </Section>

      <QueueSection title="Selesai (done)" status="done" count={state.queueCounts.done} empty="Belum ada hasil selesai."
        nonce={nonce} render={(q) => <DoneRow key={q.id} q={q} backlog={backlog} onToast={onToast} />} />

      <QueueSection title="Gagal" status="failed" count={state.queueCounts.failed} empty="Tak ada sesi gagal."
        nonce={nonce} render={(q) => <FailedRow key={q.id} q={q} backlog={backlog} />} />

      <SettingsPanel cfg={state.config} onWrite={writeConfig} busy={busy} />
      <OptInPanel projects={projects} onToggle={toggleOptIn} busyId={busyId} />
    </div>
  );
```

Tambahkan `nonce` di badan `SchedulerScreen` (di dekat state lain, baris ~229) agar poll ikut menyegarkan daftar antrean:

```tsx
  // Poll state tiap POLL_MS; `nonce` menaikkan penanda supaya QueueSection ikut memuat ulang
  // halamannya yang sedang tampil — tanpa mengubah halaman yang sedang dilihat operator.
  const [nonce, setNonce] = React.useState(0);
```
dan di dalam `load`, pada cabang sukses, tambahkan `setNonce((n) => n + 1);`.

- [ ] **Step 6: Jalankan test, pastikan HIJAU**

```bash
env -u NODE_ENV pnpm vitest --run src/test/scheduler-queue-pager.test.tsx
```
Diharapkan: 2 test lulus.

- [ ] **Step 7: Jalankan test scheduler UI lama bila ada**

```bash
ls src/test | grep -i scheduler
env -u NODE_ENV pnpm vitest --run $(ls src/test/*scheduler* 2>/dev/null | tr '\n' ' ')
```
Diharapkan: lulus. Bila ada yang menegakkan `state.queue`, perbarui ke `queueCounts` + mock `getSchedulerQueue`.

- [ ] **Step 8: Typecheck web**

```bash
pnpm --filter ./src typecheck
```

- [ ] **Step 9: Commit**

```bash
git add src/src/screens/SchedulerScreen.tsx src/src/api/client.ts src/test/
git commit -m "$(cat <<'EOF'
feat(spec-523): tiga daftar antrean scheduler berhalaman

Antrean/selesai/gagal berhenti jadi filter() klien atas array tak berbatas; tiap
bagian memuat halamannya sendiri lewat GET /scheduler/queue dan memakai Pager DS.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Lead — `page`/`limit` + amplop, tanpa mencabut `take`/`skip`

393 baris `LeadDecision` di DB hidup dibalas `{items}` tanpa `total`, berplafon `take ?? 50`.

**Files:**
- Modify: `server/src/services/lead/trail.ts:76-92` (`listDecisions`)
- Modify: `server/src/services/lead/flow.ts:86-98` (`listFlows`)
- Modify: `server/src/routes/lead.ts:71-94`
- Test: `server/test/lead-list-pagination.test.ts`

**Interfaces:**
- Produces: `listDecisions(f): Promise<{ rows: LeadDecision[]; total: number; page: number; pageSize: number }>`
- Produces: `listFlows(f): Promise<{ rows: LeadFlow[]; total: number; page: number; pageSize: number }>`
- Keduanya menerima `page?: string | number` dan `limit?: string | number` **selain** `take`/`skip`. Bila keduanya dikirim, `page`/`limit` menang.

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/lead-list-pagination.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";

const app = buildApp({ requireAuth: false });
const clean = async () => { await prisma.leadDecision.deleteMany(); };
beforeEach(clean); afterAll(clean);

async function seed(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await prisma.leadDecision.create({
      data: {
        projectId: "p1", gate: "detected", kind: "keputusan",
        question: `q${i}`, answer: `a${i}`, reason: "r", confidence: "tinggi",
        action: "none", status: "berlaku", weighty: false,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
      },
    });
  }
}

describe("GET /lead/decisions & /lead/flows — paginasi (SPEC-523)", () => {
  it("page/limit memotong dan total menyatakan seluruh baris tersaring", async () => {
    await seed(25);
    const b = (await app.inject({ method: "GET", url: "/api/lead/decisions?page=2&limit=10" })).json();
    expect(b.items.length).toBe(10);
    expect(b.total).toBe(25);
    expect(b.page).toBe(2);
    expect(b.pageSize).toBe(10);
  });

  it("take/skip lama tetap berperilaku sama (kompatibilitas)", async () => {
    await seed(25);
    const b = (await app.inject({ method: "GET", url: "/api/lead/decisions?take=5&skip=5" })).json();
    expect(b.items.length).toBe(5);
    expect(b.total).toBe(25);
  });

  it("page/limit menang bila dikirim bersama take/skip", async () => {
    await seed(25);
    const b = (await app.inject({ method: "GET", url: "/api/lead/decisions?take=5&skip=5&page=1&limit=3" })).json();
    expect(b.items.length).toBe(3);
    expect(b.page).toBe(1);
    expect(b.pageSize).toBe(3);
  });

  it("total menghormati penyaring, bukan seluruh tabel", async () => {
    await seed(25);
    const b = (await app.inject({ method: "GET", url: "/api/lead/decisions?projectId=lain&page=1&limit=5" })).json();
    expect(b.total).toBe(0);
    expect(b.items).toEqual([]);
  });

  it("GET /lead/flows juga beramplop", async () => {
    const b = (await app.inject({ method: "GET", url: "/api/lead/flows?page=1&limit=5" })).json();
    expect(b).toMatchObject({ items: [], total: 0, page: 1, pageSize: 5 });
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/lead-list-pagination.test.ts
```
Diharapkan: GAGAL — `total` `undefined`.

- [ ] **Step 3: Helper bersama untuk kedua daftar lead**

Buat `server/src/services/lead/page.ts`:

```ts
// SPEC-523 · satu penurunan `skip`/`take` untuk kedua daftar lead. Ditaruh di berkas sendiri
// karena `trail.ts` dan `flow.ts` sama-sama memakainya, dan menyalinnya ke dua tempat adalah
// kelas bug yang sudah menggigit repo ini (SPEC-431 `baseSha`, SPEC-448 `rootBypassEnv`,
// SPEC-475 `headSha`): dua salinan yang tak sepakat.
//
// `page`/`limit` MENANG atas `take`/`skip` bila keduanya dikirim — bentuk baru adalah kontrak
// yang dituju; `take`/`skip` bertahan hanya sebagai kompatibilitas pemanggil lama.
export const LEAD_MAX_TAKE = 200;
export const LEAD_DEFAULT_TAKE = 50;

export function leadWindow(f: { take?: number; skip?: number; page?: number; limit?: number }):
  { skip: number; take: number; page: number; pageSize: number } {
  if (f.limit !== undefined || f.page !== undefined) {
    const pageSize = Math.min(Math.max(1, Math.floor(f.limit ?? LEAD_DEFAULT_TAKE) || 1), LEAD_MAX_TAKE);
    const page = Math.max(1, Math.floor(f.page ?? 1) || 1);
    return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
  }
  const take = Math.min(f.take ?? LEAD_DEFAULT_TAKE, LEAD_MAX_TAKE);
  const skip = f.skip ?? 0;
  return { skip, take, page: Math.floor(skip / Math.max(1, take)) + 1, pageSize: take };
}
```

- [ ] **Step 4: Pakai helper di `trail.ts`**

Di `server/src/services/lead/trail.ts`, ganti `listDecisions` (baris ~76-92):

```ts
/** AC-24 · urut waktu (terbaru dulu), disaring per project & per backlog.
 *  SPEC-523 · mengembalikan amplop: `total` adalah hitungan SELURUH baris tersaring, bukan halaman. */
export async function listDecisions(f: TrailFilter = {}):
  Promise<{ rows: LeadDecision[]; total: number; page: number; pageSize: number }> {
  const where = {
    ...(f.projectId ? { projectId: f.projectId } : {}),
    ...(f.specId ? { specId: f.specId } : {}),
    ...(f.sessionId ? { sessionId: f.sessionId } : {}),
    ...(f.flowId ? { flowId: f.flowId } : {}),
    ...(f.status ? { status: f.status } : {}),
  };
  const w = leadWindow(f);
  const total = await prisma.leadDecision.count({ where });
  const rows = await prisma.leadDecision.findMany({
    where,
    // SPEC-485 · satu RANTAI dibaca dari awal: urutan pertanyaannya adalah isi jejaknya. Daftar
    // umum tetap terbaru-dulu (AC-24) — dua pertanyaan yang berbeda, dua urutan yang berbeda.
    orderBy: { createdAt: f.flowId ? "asc" : "desc" },
    take: w.take, skip: w.skip,
  });
  return { rows, total, page: w.page, pageSize: w.pageSize };
}
```

Tambah impor `import { leadWindow } from "./page";` dan perluas tipe `TrailFilter` dengan `page?: number; limit?: number;`.

- [ ] **Step 5: Pakai helper di `flow.ts`**

Di `server/src/services/lead/flow.ts`, ganti `listFlows` (baris ~86-98):

```ts
// SPEC-523 · amplop, bukan array telanjang. `total` menghormati penyaring.
export async function listFlows(f: {
  projectId?: string; status?: string; take?: number; skip?: number; page?: number; limit?: number;
} = {}): Promise<{ rows: LeadFlow[]; total: number; page: number; pageSize: number }> {
  const where = {
    ...(f.projectId ? { projectId: f.projectId } : {}),
    ...(f.status ? { status: f.status } : {}),
  };
  const w = leadWindow(f);
  const total = await prisma.leadFlow.count({ where });
  const rows = await prisma.leadFlow.findMany({
    where, orderBy: { createdAt: "desc" }, take: w.take, skip: w.skip,
  });
  return { rows, total, page: w.page, pageSize: w.pageSize };
}
```

Tambah impor `import { leadWindow } from "./page";`.

- [ ] **Step 6: Ubah route lead**

Di `server/src/routes/lead.ts`, ganti handler baris 71-94:

```ts
  // AC-24 · jejak urut waktu, disaring per project & per backlog.
  // SPEC-523 · amplop `Paginated`. `take`/`skip` lama tetap diterima; `page`/`limit` menang.
  app.get("/lead/decisions", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const r = await listDecisions({
      projectId: q.projectId, specId: q.specId, sessionId: q.sessionId, status: q.status,
      // SPEC-485 · satu rantai dibaca lewat filter ini, urut NAIK (lihat `listDecisions`).
      flowId: q.flowId,
      take: q.take ? Number(q.take) : undefined,
      skip: q.skip ? Number(q.skip) : undefined,
      page: q.page ? Number(q.page) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    return { items: r.rows.map(toDecisionView), total: r.total, page: r.page, pageSize: r.pageSize };
  });

  // SPEC-485 · ADR-0102 · daftar RANTAI. Langkahnya dibaca lewat `GET /lead/decisions?flowId=`,
  // sengaja bukan bersarang di sini: langkah adalah baris jejak biasa, dan menyalinnya ke
  // serializer kedua berarti dua bentuk yang bisa berselisih diam-diam.
  app.get("/lead/flows", async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const r = await listFlows({
      projectId: q.projectId, status: q.status,
      take: q.take ? Number(q.take) : undefined,
      skip: q.skip ? Number(q.skip) : undefined,
      page: q.page ? Number(q.page) : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
    });
    return { items: r.rows.map(toFlowView), total: r.total, page: r.page, pageSize: r.pageSize };
  });
```

- [ ] **Step 7: Jalankan test, pastikan HIJAU**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/lead-list-pagination.test.ts
```
Diharapkan: 5 test lulus.

- [ ] **Step 8: Jalankan test lead lain yang bisa tersentuh**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism $(ls server/test/*lead* | tr '\n' ' ')
```
Diharapkan: lulus. Bila ada yang memanggil `listDecisions()`/`listFlows()` langsung dan mengharapkan array, perbarui ke `.rows`.

- [ ] **Step 9: Typecheck + commit**

```bash
pnpm --filter ./server typecheck
git add server/src/services/lead/ server/src/routes/lead.ts server/test/lead-list-pagination.test.ts
git commit -m "$(cat <<'EOF'
feat(spec-523): daftar lead beramplop Paginated, take/skip tetap diterima

393 baris LeadDecision dibalas tanpa `total`. `leadWindow()` jadi satu-satunya
penurunan skip/take untuk kedua daftar — menyalinnya ke dua berkas adalah kelas
bug SPEC-431/448/475. page/limit menang bila dikirim bersama take/skip.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Lead — `Pager` di layar keputusan & rantai

**Files:**
- Modify: `src/src/screens/LeadScreen.tsx:263-285` (state + load), `416-460` (render dua Card)
- Modify: `src/src/api/client.ts:427,437` (tipe balasan + params)
- Test: `src/test/lead-pager.test.tsx`

**Interfaces:**
- Consumes: amplop dari Task 5.
- Produces: `api.getLeadDecisions(p)` / `api.getLeadFlows(p)` mengembalikan `Paginated<...>`.

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/test/lead-pager.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { LeadScreen } from "../src/screens/LeadScreen";

const decision = (i: number) => ({
  id: `d${i}`, projectId: "p1", specId: null, sessionId: null,
  gate: "detected", kind: "keputusan", question: `pertanyaan ${i}`, answer: `jawaban ${i}`,
  reason: "r", refs: [], confidence: "tinggi", action: "none",
  choice: null, choiceIndex: null, options: [], missing: [], choices: [], select: null,
  flowId: null, step: null, status: "berlaku", weighty: false, supersededById: null,
  createdAt: "2026-08-04T00:00:00.000Z",
});

const getLeadDecisions = vi.fn(async (p: { page?: number; limit?: number } = {}) => ({
  items: [decision((p.page ?? 1) === 1 ? 1 : 99)], total: 30, page: p.page ?? 1, pageSize: 20,
}));

vi.mock("../src/api/client", () => ({
  api: {
    getLeadStatus: vi.fn(async () => ({
      config: { enabled: false }, projects: [], deciding: [], queued: [], waiting: [],
      lastPulseAt: null, gate: { inFlight: 0, waiting: 0, capacity: 2 },
    })),
    getLeadDecisions: (p?: never) => getLeadDecisions(p ?? {}),
    getLeadFlows: vi.fn(async () => ({ items: [], total: 0, page: 1, pageSize: 20 })),
    putLeadConfig: vi.fn(), updateProject: vi.fn(),
  },
}));

const props = { projects: [], backlog: [], onProjectChanged: vi.fn(), onToast: vi.fn(), onGotoTerminal: vi.fn() } as never;

beforeEach(() => vi.clearAllMocks());

describe("LeadScreen paginasi jejak keputusan (SPEC-523)", () => {
  it("meminta halaman lewat page/limit, bukan take", async () => {
    render(<LeadScreen {...props} />);
    await waitFor(() => expect(screen.getByText("pertanyaan 1")).toBeInTheDocument());
    expect(getLeadDecisions).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 20 }));
  });

  it("Berikutnya mengganti isi jejak dengan halaman 2", async () => {
    render(<LeadScreen {...props} />);
    await waitFor(() => expect(screen.getByText("pertanyaan 1")).toBeInTheDocument());
    fireEvent.click(screen.getAllByLabelText("Berikutnya")[0]!);
    await waitFor(() => expect(screen.getByText("pertanyaan 99")).toBeInTheDocument());
    expect(screen.queryByText("pertanyaan 1")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

```bash
env -u NODE_ENV pnpm vitest --run src/test/lead-pager.test.tsx
```
Diharapkan: GAGAL — `getLeadDecisions` dipanggil dengan `take: 50`, tak ada kontrol halaman.

- [ ] **Step 3: Perbarui tipe api client**

Di `src/src/api/client.ts`, ganti dua metode (baris 427 & 437):

```ts
  // SPEC-523 · amplop Paginated. `take` lama masih diterima server, tapi klien memakai page/limit.
  getLeadDecisions: (params: { projectId?: string; specId?: string; sessionId?: string; status?: string; page?: number; limit?: number } = {}) =>
    j<Paginated<LeadDecisionView>>(paths.leadDecisions + qs(params)),
```
```ts
  getLeadFlows: (params: { projectId?: string; status?: string; page?: number; limit?: number } = {}) =>
    j<Paginated<LeadFlowView>>(paths.leadFlows + qs(params)),
```

- [ ] **Step 4: Tambah state halaman di `LeadScreen`**

Di `src/src/screens/LeadScreen.tsx`, setelah baris 264 tambahkan:

```tsx
  const [decTotal, setDecTotal] = React.useState(0);
  const [decPage, setDecPage] = React.useState(1);
  const [flowTotal, setFlowTotal] = React.useState(0);
  const [flowPage, setFlowPage] = React.useState(1);
```

Tambahkan konstanta di dekat `POLL_MS`:
```tsx
const LIST_PAGE = 20;
```

Ganti isi `load` (baris 270-284):

```tsx
  const load = React.useCallback((silent = false) => {
    if (!silent) setPhase("loading");
    Promise.all([
      api.getLeadStatus(),
      api.getLeadDecisions({ projectId: filter === "all" ? undefined : filter, page: decPage, limit: LIST_PAGE }),
      // SPEC-485 · rantai. Instance lama tak punya endpoint ini; kegagalannya tak boleh menjatuhkan
      // seluruh panel (ADR-0087: dashboard bisa lebih baru daripada server yang dilayaninya).
      api.getLeadFlows({ projectId: filter === "all" ? undefined : filter, page: flowPage, limit: LIST_PAGE })
        .catch(() => ({ items: [] as LeadFlowView[], total: 0, page: 1, pageSize: LIST_PAGE })),
    ])
      .then(([s, d, f]) => {
        setState(s);
        setDecisions(d.items ?? []); setDecTotal(d.total ?? 0);
        setFlows(f.items ?? []); setFlowTotal(f.total ?? 0);
        setPhase("ready");
      })
      .catch(() => { if (!silent) setPhase("error"); });   // silent poll tak pernah mem-blank layar
  }, [filter, decPage, flowPage]);
```

Ganti filter agar reset ke halaman 1 — tambahkan efek di bawah `React.useEffect(() => { load(); }, [load]);`:

```tsx
  // AC-15 · ganti penyaring = kembali ke halaman 1. Tanpa ini, halaman 5 dari filter lama
  // menjawab daftar filter baru yang cuma punya 2 halaman → daftar kosong tanpa sebab.
  React.useEffect(() => { setDecPage(1); setFlowPage(1); }, [filter]);
```

- [ ] **Step 5: Render `Pager` di kedua Card**

Di Card rantai (baris ~416), ganti judul dan tambahkan pager sebelum `</Card>`:

```tsx
      <Card eyebrow="lead · rantai keputusan" title={`Rantai (${flowTotal})`}>
```
dan tepat sebelum penutup Card itu:
```tsx
        <LeadPager total={flowTotal} page={flowPage} onPage={setFlowPage} unit="rantai" />
```

Di Card jejak keputusan (baris ~439):
```tsx
      <Card eyebrow="lead · jejak keputusan" title={`Keputusan (${decTotal})`}>
```
dan sebelum penutupnya:
```tsx
        <LeadPager total={decTotal} page={decPage} onPage={setDecPage} unit="keputusan" />
```

Tambahkan komponen kecil di berkas yang sama (di atas `LeadScreen`):

```tsx
/* SPEC-523 · pembungkus tipis Pager DS supaya kedua daftar lead memakai ukuran halaman yang sama
   dan tak ada duplikasi perhitungan `serverPage`. */
function LeadPager({ total, page, onPage, unit }:
  { total: number; page: number; onPage: (n: number) => void; unit: string }) {
  const sp = serverPage(total, page, LIST_PAGE);
  return <Pager page={sp.page} pageCount={sp.pageCount} total={total} from={sp.from} to={sp.to} onPage={onPage} unit={unit} />;
}
```

Tambahkan `Pager, serverPage` ke impor DS di berkas ini.

- [ ] **Step 6: Jalankan test, pastikan HIJAU**

```bash
env -u NODE_ENV pnpm vitest --run src/test/lead-pager.test.tsx
```
Diharapkan: 2 test lulus.

- [ ] **Step 7: Jalankan test lead UI lain**

```bash
env -u NODE_ENV pnpm vitest --run $(ls src/test/*lead* | tr '\n' ' ')
```
Diharapkan: lulus. Bila ada mock yang mengembalikan `{ items }` tanpa `total`, tambahkan `total`.

- [ ] **Step 8: Typecheck + commit**

```bash
pnpm --filter ./src typecheck
git add src/src/screens/LeadScreen.tsx src/src/api/client.ts src/test/lead-pager.test.tsx src/test/
git commit -m "$(cat <<'EOF'
feat(spec-523): Pager di jejak keputusan & rantai lead

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Tiket triase — `Pager` di UI

Server sudah beramplop sejak SPEC-253; UI memanggilnya tanpa `page`/`limit` sehingga memuat seluruh baris.

**Files:**
- Modify: `src/src/screens/TriageScreen.tsx:310-377`
- Test: `src/test/triage-pager.test.tsx`

**Interfaces:**
- Consumes: `GET /tickets` (sudah ada, `routes/tickets.ts:33`). `unreviewed` dihitung server dari set penuh → tetap benar berapa pun halamannya.

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/test/triage-pager.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TriageScreen } from "../src/screens/TriageScreen";

const ticket = (i: number) => ({
  id: `t${i}`, projectId: "p1", number: i, category: "bug", title: `keluhan ${i}`,
  reporterEmail: "a@b.c", status: "new", specId: null, attachmentCount: 0,
  createdAt: "2026-08-04T00:00:00.000Z",
});

const listTickets = vi.fn(async (p: { page?: number; limit?: number } = {}) => ({
  items: [ticket((p.page ?? 1) === 1 ? 1 : 99)],
  total: 45, page: p.page ?? 1, pageSize: 20, unreviewed: 45,
}));

vi.mock("../src/api/client", () => ({ api: { listTickets: (p?: never) => listTickets(p ?? {}) } }));

const props = { projects: [], onAccepted: vi.fn(), onToast: vi.fn() } as never;

beforeEach(() => vi.clearAllMocks());

describe("TriageScreen paginasi tiket (SPEC-523)", () => {
  it("meminta halaman lewat page/limit", async () => {
    render(<TriageScreen {...props} />);
    await waitFor(() => expect(screen.getByText(/keluhan 1/)).toBeInTheDocument());
    expect(listTickets).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 20 }));
    expect(screen.getByText("1–20 dari 45 tiket")).toBeInTheDocument();
  });

  it("Berikutnya mengganti isi daftar", async () => {
    render(<TriageScreen {...props} />);
    await waitFor(() => expect(screen.getByText(/keluhan 1/)).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Berikutnya"));
    await waitFor(() => expect(screen.getByText(/keluhan 99/)).toBeInTheDocument());
    expect(screen.queryByText(/keluhan 1$/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

```bash
env -u NODE_ENV pnpm vitest --run src/test/triage-pager.test.tsx
```
Diharapkan: GAGAL — tak ada kontrol halaman, `listTickets` dipanggil tanpa `page`.

- [ ] **Step 3: Tambah state halaman & kirim ke API**

Di `src/src/screens/TriageScreen.tsx`, tambahkan konstanta di dekat `POLL_MS`:
```tsx
const TICKET_PAGE = 20;
```

Di badan `TriageScreen` setelah baris `const [list, setList] = ...`:
```tsx
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
```

Ganti `load` (baris 324-330):
```tsx
  const load = React.useCallback((silent = false) => {
    if (!silent) setState("loading");
    api.listTickets({
      project: project || undefined, status: status || undefined, q: q || undefined,
      page: String(page), limit: String(TICKET_PAGE),
    })
      .then((r) => { setList(r.items); setTotal(r.total); setUnreviewed(r.unreviewed); setState("ready"); })
      .catch(() => { if (!silent) setState("error"); });
  }, [project, status, q, page]);
```

Tambahkan reset halaman saat penyaring berubah, tepat di bawah `React.useEffect(() => { load(); }, [load]);`:
```tsx
  // AC-15 · ganti penyaring = kembali ke halaman 1.
  React.useEffect(() => { setPage(1); }, [project, status, q]);
```

- [ ] **Step 4: Render `Pager`**

Ganti cabang daftar tiket (baris ~371-374):
```tsx
        : <>
            <div style={{ overflowY: "auto", minHeight: 0 }}>
              {list.map((t) => <TicketRow key={t.id} t={t} onOpen={setOpenId} />)}
            </div>
            <TicketPager total={total} page={page} onPage={setPage} />
          </>}
```

Tambahkan komponen di atas `TriageScreen`:
```tsx
/* SPEC-523 · Pager DS untuk daftar tiket. `unreviewed` tetap datang dari server yang
   menghitungnya atas SET PENUH, jadi lencana "belum ditinjau" tak ikut mengecil per halaman. */
function TicketPager({ total, page, onPage }: { total: number; page: number; onPage: (n: number) => void }) {
  const sp = serverPage(total, page, TICKET_PAGE);
  return <Pager page={sp.page} pageCount={sp.pageCount} total={total} from={sp.from} to={sp.to} onPage={onPage} unit="tiket" />;
}
```

Tambahkan `Pager, serverPage` ke impor DS di berkas ini.

- [ ] **Step 5: Jalankan test, pastikan HIJAU**

```bash
env -u NODE_ENV pnpm vitest --run src/test/triage-pager.test.tsx
```
Diharapkan: 2 test lulus.

- [ ] **Step 6: Jalankan test triase lain**

```bash
env -u NODE_ENV pnpm vitest --run $(ls src/test/*triage* src/test/*ticket* 2>/dev/null | tr '\n' ' ')
```
Diharapkan: lulus. Mock `listTickets` yang mengembalikan `{items, unreviewed}` tanpa `total` perlu ditambahi `total`.

- [ ] **Step 7: Typecheck + commit**

```bash
pnpm --filter ./src typecheck
git add src/src/screens/TriageScreen.tsx src/test/
git commit -m "$(cat <<'EOF'
feat(spec-523): Pager di daftar tiket triase

Server sudah beramplop sejak SPEC-253; UI-lah yang memanggilnya tanpa page/limit
dan karena itu memuat seluruh baris. `unreviewed` tetap dari set penuh.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Issue GitHub — server beramplop + `Pager` di UI

**Files:**
- Modify: `server/src/routes/github-issues.ts:54-64`
- Modify: `src/src/api/client.ts:394` (`listGithubIssues`)
- Modify: `src/src/screens/TriageScreen.tsx:216-307` (`GithubIssuesPanel`)
- Test: `server/test/github-issues.route.test.ts` (tambah kasus), `src/test/github-issues-pager.test.tsx`

**Interfaces:**
- Produces: `GET /projects/:id/github/issues?status&page&limit` → `Paginated<GithubIssueView>`
- Produces: `api.listGithubIssues(projectId, p: { status?: string; page?: number; limit?: number })`

- [ ] **Step 1: Tulis test server yang gagal**

Tambahkan di `server/test/github-issues.route.test.ts` (buat berkas dengan pola `buildApp` bila belum ada):

```ts
  it("GET issues beramplop Paginated dan menghormati page/limit (SPEC-523)", async () => {
    await prisma.project.create({ data: { id: "p1", name: "p1" } });
    for (let i = 1; i <= 5; i++) {
      await prisma.githubIssue.create({
        data: { projectId: "p1", number: i, title: `issue ${i}`, url: `u${i}`,
          authorLogin: "a", labels: [], status: "new", body: "" },
      });
    }
    const r = await app.inject({ method: "GET", url: "/api/projects/p1/github/issues?page=1&limit=2" });
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.items.length).toBe(2);
    expect(b.total).toBe(5);
    expect(b.page).toBe(1);
    expect(b.pageSize).toBe(2);
  });
```

Bila berkasnya belum ada, buat dengan kepala:
```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";

const app = buildApp({ requireAuth: false });
const clean = async () => { await prisma.githubIssue.deleteMany(); await prisma.project.deleteMany(); };
beforeEach(clean); afterAll(clean);

describe("GET /projects/:id/github/issues", () => {
  // …test di atas…
});
```
Sesuaikan field `githubIssue.create` dengan kolom wajib di `server/prisma/schema.prisma` bila berbeda (cek dengan `grep -A 20 "model GithubIssue" server/prisma/schema.prisma`).

- [ ] **Step 2: Jalankan test, pastikan MERAH**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/github-issues.route.test.ts
```
Diharapkan: GAGAL — `total` `undefined`, 5 item dikembalikan.

- [ ] **Step 3: Implementasi di route**

Di `server/src/routes/github-issues.ts`, ganti handler baris 54-64:

```ts
  app.get("/projects/:id/github/issues", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { status, page, limit } = req.query as Record<string, string | undefined>;
    const project = await prisma.project.findUnique({ where: { id }, select: { id: true } });
    if (!project) return reply.code(404).send({ error: "not found" });
    // SPEC-523 · amplop Paginated. Cermin routes/tickets.ts; issue adalah baris mati tanpa overlay,
    // jadi memotong di layer response (paginate) sudah memadai dan menjaga satu bentuk.
    const items = await prisma.githubIssue.findMany({
      where: { projectId: id, ...(status ? { status } : {}) },
      orderBy: [{ number: "desc" }],
    });
    return reply.send(paginate(items.map(view), page, limit));
  });
```
Tambah impor `import { paginate } from "../services/paginate";`.

- [ ] **Step 4: Jalankan test, pastikan HIJAU**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/github-issues.route.test.ts
```

- [ ] **Step 5: Tulis test UI yang gagal**

Buat `src/test/github-issues-pager.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GithubIssuesPanel } from "../src/screens/TriageScreen";

const issue = (i: number) => ({
  id: `g${i}`, projectId: "p1", number: i, title: `issue ${i}`, url: `https://x/${i}`,
  authorLogin: "rekan", labels: [], status: "new", specId: null,
  createdAt: "2026-08-04T00:00:00.000Z", updatedAt: "2026-08-04T00:00:00.000Z",
});

const listGithubIssues = vi.fn(async (_id: string, p: { page?: number; limit?: number } = {}) => ({
  items: [issue((p.page ?? 1) === 1 ? 1 : 99)], total: 45, page: p.page ?? 1, pageSize: 20,
}));

vi.mock("../src/api/client", () => ({
  api: { listGithubIssues: (id: string, p?: never) => listGithubIssues(id, p ?? {}) },
}));

beforeEach(() => vi.clearAllMocks());

describe("GithubIssuesPanel paginasi (SPEC-523)", () => {
  it("Berikutnya mengganti isi dengan halaman 2", async () => {
    render(<GithubIssuesPanel projectId="p1" />);
    await waitFor(() => expect(screen.getByText("issue 1")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Berikutnya"));
    await waitFor(() => expect(screen.getByText("issue 99")).toBeInTheDocument());
    expect(listGithubIssues).toHaveBeenLastCalledWith("p1", { page: 2, limit: 20 });
  });
});
```

- [ ] **Step 6: Jalankan test UI, pastikan MERAH**

```bash
env -u NODE_ENV pnpm vitest --run src/test/github-issues-pager.test.tsx
```

- [ ] **Step 7: Implementasi UI**

Di `src/src/api/client.ts` baris 394:
```ts
  // SPEC-523 · amplop Paginated (cermin listTickets).
  listGithubIssues: (projectId: string, p: { status?: string; page?: number; limit?: number } = {}) =>
    j<Paginated<GithubIssueView>>(paths.githubIssues(projectId) + qs(p)),
```

Di `src/src/screens/TriageScreen.tsx`, di dalam `GithubIssuesPanel`:
- tambah state setelah `const [picked, ...]`:
```tsx
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
```
- ganti `load` (baris 225-228):
```tsx
  const load = React.useCallback(async () => {
    try {
      const r = await api.listGithubIssues(projectId, { page, limit: TICKET_PAGE });
      setItems(r.items); setTotal(r.total); setState("ready");
    } catch { setState("error"); }
  }, [projectId, page]);
```
- ganti penutup cabang daftar (baris ~300-303) agar `Pager` ikut terender:
```tsx
        : <>
            <div style={{ overflowY: "auto", minHeight: 0 }}>
              {items.map((i) => (
                /* …baris issue APA ADANYA, tak berubah… */
              ))}
            </div>
            <TicketPager total={total} page={page} onPage={setPage} />
          </>}
```
(gunakan kembali `TicketPager` dari Task 7; ganti `unit="tiket"` menjadi prop supaya bisa dipakai keduanya:
```tsx
function TicketPager({ total, page, onPage, unit = "tiket" }:
  { total: number; page: number; onPage: (n: number) => void; unit?: string }) {
  const sp = serverPage(total, page, TICKET_PAGE);
  return <Pager page={sp.page} pageCount={sp.pageCount} total={total} from={sp.from} to={sp.to} onPage={onPage} unit={unit} />;
}
```
dan panggil dengan `unit="issue"` di panel issue.)

- [ ] **Step 8: Jalankan kedua test, pastikan HIJAU**

```bash
env -u NODE_ENV pnpm vitest --run src/test/github-issues-pager.test.tsx src/test/triage-pager.test.tsx
```

- [ ] **Step 9: Typecheck + commit**

```bash
pnpm --filter ./server typecheck && pnpm --filter ./src typecheck
git add server/src/routes/github-issues.ts server/test/github-issues.route.test.ts src/src/api/client.ts src/src/screens/TriageScreen.tsx src/test/github-issues-pager.test.tsx
git commit -m "$(cat <<'EOF'
feat(spec-523): daftar issue GitHub beramplop + Pager

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Changelog — `Pager` di panel tersimpan

`ChangelogPanel.tsx:30` memanggil `{limit: 10}` **tanpa `page`**: item ke-11 dst permanen tak terjangkau. Ini satu-satunya cacat di plan ini yang membuat data hilang **karena** ada `limit`, bukan meski ada.

**Files:**
- Modify: `src/src/screens/ChangelogPanel.tsx:27-31,166-178`
- Test: `src/src/screens/ChangelogPanel.test.tsx` (tambah kasus)

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di `src/src/screens/ChangelogPanel.test.tsx`, dan ubah mock `listChangelogs` di kepala berkas jadi:

```tsx
const changelog = (i: number) => ({
  id: `c${i}`, projectId: "p1", mode: "backlog", title: `changelog ${i}`, params: {},
  body: "# x", generator: "agent", warning: null, itemCount: 1,
  createdAt: "2026-08-03T00:00:00.000Z",
});
const listChangelogs = vi.fn(async (_id: string, p: { page?: number; limit?: number } = {}) => ({
  items: [changelog((p.page ?? 1) === 1 ? 1 : 99)], total: 25, page: p.page ?? 1, pageSize: 10,
}));
```
lalu di blok `vi.mock` ganti `listChangelogs: vi.fn(async () => ({...}))` dengan
`listChangelogs: (id: string, p?: never) => listChangelogs(id, p ?? {})`.

Tambahkan test:

```tsx
  it("mengirim page saat meminta daftar tersimpan (SPEC-523)", async () => {
    render(<ChangelogPanel {...props} />);
    await waitFor(() => expect(screen.getByText("changelog 1")).toBeInTheDocument());
    expect(listChangelogs).toHaveBeenCalledWith("p1", { page: 1, limit: 10 });
  });

  it("Berikutnya mengganti daftar tersimpan dengan halaman 2 (SPEC-523)", async () => {
    render(<ChangelogPanel {...props} />);
    await waitFor(() => expect(screen.getByText("changelog 1")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Berikutnya"));
    await waitFor(() => expect(screen.getByText("changelog 99")).toBeInTheDocument());
    expect(screen.queryByText("changelog 1")).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

```bash
env -u NODE_ENV pnpm vitest --run src/src/screens/ChangelogPanel.test.tsx
```
Diharapkan: dua test baru GAGAL — `listChangelogs` dipanggil tanpa `page` (kontrol negatif atas cacat hari ini).

- [ ] **Step 3: Implementasi**

Di `src/src/screens/ChangelogPanel.tsx`:
- tambahkan konstanta di atas komponen:
```tsx
const SAVED_PAGE = 10;
```
- tambah state setelah baris 27:
```tsx
  const [savedTotal, setSavedTotal] = React.useState(0);
  const [savedPage, setSavedPage] = React.useState(1);
```
- ganti `reloadSaved` (baris 29-31):
```tsx
  // SPEC-523 · `page` ikut dikirim. Tanpa itu, `limit: 10` bukan halaman melainkan PLAFON:
  // changelog ke-11 dan seterusnya permanen tak terjangkau dari UI.
  const reloadSaved = React.useCallback(async () => {
    try {
      const r = await api.listChangelogs(p.id, { page: savedPage, limit: SAVED_PAGE });
      setSaved(r.items); setSavedTotal(r.total);
    } catch { /* daftar opsional */ }
  }, [p.id, savedPage]);
```
- render `Pager` di blok "Tersimpan" (setelah `saved.map(...)`, sebelum `</div>` penutupnya):
```tsx
          <SavedPager total={savedTotal} page={savedPage} onPage={setSavedPage} />
```
- ganti gerbang `saved.length > 0` (baris 166) menjadi `savedTotal > 0` agar pager tetap tampil saat halaman terakhir kosong sesudah penghapusan.
- tambahkan komponen di atas `ChangelogPanel`:
```tsx
function SavedPager({ total, page, onPage }: { total: number; page: number; onPage: (n: number) => void }) {
  const sp = serverPage(total, page, SAVED_PAGE);
  return <Pager page={sp.page} pageCount={sp.pageCount} total={total} from={sp.from} to={sp.to} onPage={onPage} unit="changelog" />;
}
```
- tambahkan `Pager, serverPage` ke impor `../ds`.

- [ ] **Step 4: Jalankan test, pastikan HIJAU**

```bash
env -u NODE_ENV pnpm vitest --run src/src/screens/ChangelogPanel.test.tsx
```
Diharapkan: seluruh test lulus (termasuk yang lama).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter ./src typecheck
git add src/src/screens/ChangelogPanel.tsx src/src/screens/ChangelogPanel.test.tsx
git commit -m "$(cat <<'EOF'
fix(spec-523): changelog tersimpan berhalaman, bukan berplafon

`{limit: 10}` tanpa `page` bukan halaman melainkan plafon: changelog ke-11 dan
seterusnya permanen tak terjangkau dari UI.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Riwayat sesi — muat-lebih diganti `Pager`

Servernya sudah beramplop penuh (`services/session-history.ts:82-87`); perubahan murni UI.

**Files:**
- Modify: `src/src/screens/SessionHistoryModal.tsx:39-76,124-133`
- Test: `src/test/session-history-pager.test.tsx` (atau tambah ke test riwayat yang ada)

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/test/session-history-pager.test.tsx`:

```tsx
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SessionHistoryModal } from "../src/screens/SessionHistoryModal";

const row = (i: number) => ({
  id: `h${i}`, sessionId: `spec-${i}`, projectId: "p1", specId: `SPEC-${i}`,
  kind: "backlog", title: `sesi ${i}`, branch: null,
  startedAt: "2026-08-04T00:00:00.000Z", endedAt: "2026-08-04T00:10:00.000Z",
  exitCode: 0, transcriptBytes: null,
});

const listSessionHistory = vi.fn(async (p: { page?: number } = {}) => ({
  items: [row((p.page ?? 1) === 1 ? 1 : 99)], total: 45, page: p.page ?? 1, pageSize: 20,
}));

vi.mock("../src/api/client", () => ({ api: { listSessionHistory: (p?: never) => listSessionHistory(p ?? {}) } }));

const props = { projects: [{ id: "p1", name: "p1" }], onClose: vi.fn(), onRestart: vi.fn() };

beforeEach(() => vi.clearAllMocks());

describe("SessionHistoryModal berhalaman (SPEC-523)", () => {
  it("Berikutnya MENGGANTI isi, bukan menambah (muat-lebih dicabut)", async () => {
    render(<SessionHistoryModal {...props} />);
    await waitFor(() => expect(screen.getByText("sesi 1")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Berikutnya"));
    await waitFor(() => expect(screen.getByText("sesi 99")).toBeInTheDocument());
    expect(screen.queryByText("sesi 1")).not.toBeInTheDocument();
    expect(screen.queryByText("Muat lebih")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

```bash
env -u NODE_ENV pnpm vitest --run src/test/session-history-pager.test.tsx
```
Diharapkan: GAGAL — "sesi 1" masih ada (append) dan tombol "Muat lebih" masih terender.

- [ ] **Step 3: Implementasi**

Di `src/src/screens/SessionHistoryModal.tsx`:

- ganti blok efek fetch (baris 54-68) agar halaman **mengganti** isi:
```tsx
  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    api.listSessionHistory({
      projectId: project || undefined, kind: kind || undefined, q: dq || undefined, page, limit: PAGE,
    })
      .then((r) => {
        if (!alive) return;
        setTotal(r.total);
        // SPEC-523 · halaman MENGGANTI isi. Muat-lebih (append) dicabut demi satu pola paginasi
        // yang sama dengan backlog/project/tiket — objective SPEC-523.
        setItems(r.items);
      })
      .catch(() => { if (alive) { setItems([]); setTotal(0); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [project, kind, dq, page]);
```
- hapus `hasMore`, `sentinel`, dan efek `IntersectionObserver` (baris 69-79).
- ganti baris penutup daftar (baris 124-133) dengan:
```tsx
          {loading && (
            <div style={{ padding: "10px 8px", textAlign: "center", fontSize: 11, color: "var(--text-subtle)" }}>memuat…</div>
          )}
        </div>
      )}
      <Pager page={sp.page} pageCount={sp.pageCount} total={total} from={sp.from} to={sp.to}
        onPage={setPage} unit="sesi" />
```
- hitung `sp` sebelum `return`:
```tsx
  const sp = serverPage(total, page, PAGE);
```
- tambahkan `Pager, serverPage` ke impor DS di berkas ini.
- efek reset filter (baris 52) cukup jadi `React.useEffect(() => { setPage(1); }, [project, kind, dq]);` — `setItems([])` tak lagi perlu karena halaman selalu mengganti isi.

- [ ] **Step 4: Jalankan test, pastikan HIJAU**

```bash
env -u NODE_ENV pnpm vitest --run src/test/session-history-pager.test.tsx
```

- [ ] **Step 5: Jalankan test riwayat sesi lain**

```bash
env -u NODE_ENV pnpm vitest --run $(ls src/test/*history* src/test/*session* 2>/dev/null | tr '\n' ' ')
```
Diharapkan: lulus. Test lama yang menegakkan "Muat lebih" harus diperbarui — pola SPEC-433: test yang mengunci perilaku lama sebagai kontrak.

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm --filter ./src typecheck
git add src/src/screens/SessionHistoryModal.tsx src/test/
git commit -m "$(cat <<'EOF'
feat(spec-523): riwayat sesi memakai Pager, bukan muat-lebih

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Git graph — jendela dipertahankan, sisa dinyatakan

Graph **tidak** dikonversi ke halaman diskrit (lane butuh commit kontigu; SPEC-351 sudah membuat seluruh riwayat terjangkau). Yang ditambahkan hanya `total` supaya "sisa" terbaca.

**Files:**
- Modify: `server/src/services/git-ide.ts:115-142` (`listGraph`)
- Modify: `src/src/screens/GitGraph.tsx:263,465-472`
- Test: `server/test/ide-graph-total.test.ts`

**Interfaces:**
- Produces: `listGraph(...)` → `{ commits: GraphCommit[]; current: string; total: number }`

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/ide-graph-total.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { listGraph } from "../src/services/git-ide";

let dir = "";
const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "graph-total-"));
  git("init", "-q");
  git("config", "user.email", "t@t.t");
  git("config", "user.name", "t");
  for (let i = 0; i < 5; i++) {
    writeFileSync(join(dir, `f${i}.txt`), String(i));
    git("add", "-A");
    git("commit", "-q", "-m", `c${i}`);
  }
});
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

describe("listGraph total (SPEC-523)", () => {
  it("menyatakan jumlah commit terjangkau meski jendelanya lebih kecil", async () => {
    const g = await listGraph(dir, 2);
    expect(g.commits.length).toBe(2);
    expect(g.total).toBe(5);
  });

  it("repo tak ada → total 0, bukan galat", async () => {
    const g = await listGraph(join(dir, "tak-ada"), 10);
    expect(g.commits).toEqual([]);
    expect(g.total).toBe(0);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/ide-graph-total.test.ts
```
Diharapkan: GAGAL — `g.total` `undefined`.

- [ ] **Step 3: Implementasi di `listGraph`**

Di `server/src/services/git-ide.ts`, ubah tanda tangan & badan `listGraph`:

```ts
export async function listGraph(repoDir: string | null, limit = 200, opts: GraphOpts = {}): Promise<{ commits: GraphCommit[]; current: string; total: number }> {
  if (!repoDir || !existsSync(repoDir)) return { commits: [], current: "", total: 0 };
  try {
    // …blok fmt/refArgs/exec/commits APA ADANYA…

    // SPEC-523 · graph SENGAJA tetap jendela tumbuh (SPEC-351), bukan halaman diskrit: lane
    // dihitung dari daftar commit KONTIGU, jadi memenggalnya per halaman memutus tautan
    // induk–anak di batas halaman. Yang kurang selama ini bukan halamannya melainkan angkanya —
    // "200 dimuat" tak memberi tahu apakah tersisa 3 atau 30.000. `rev-list --count` menjawabnya
    // dengan ref selector yang SAMA, jadi angkanya tak pernah menghitung ref yang tak digambar.
    let total = commits.length;
    try {
      const c = await exec("git", ["rev-list", "--count", ...refArgs], { cwd: repoDir, ...GIT });
      const n = Number(c.stdout.trim());
      if (Number.isFinite(n)) total = n;
    } catch { /* repo tanpa commit / ref aneh: jatuh ke jumlah yang benar-benar dimuat */ }

    return { commits, current: await currentBranch(repoDir), total };
  } catch { return { commits: [], current: "", total: 0 }; }
}
```

Catatan: `rev-list --count` dengan `--all` menghitung commit unik seluruh ref; dengan `--end-of-options <branch>` menghitung yang terjangkau dari branch itu. Ini persis himpunan yang digambar `git log`, jadi kedua angka sebanding.

- [ ] **Step 4: Jalankan test, pastikan HIJAU**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/ide-graph-total.test.ts
```

- [ ] **Step 5: Tampilkan sisanya di UI**

Di `src/src/screens/GitGraph.tsx`:
- tambah state di dekat `hasMore`:
```tsx
  const [total, setTotal] = React.useState(0);
```
- di `.then` pada `load` (baris 263), tambahkan `setTotal(g.total ?? 0);`
- ganti label baris penutup (baris ~466-468):
```tsx
          <span style={{ fontSize: 11.5, color: "var(--text-subtle)" }}>
            {/* SPEC-523 · sisa dinyatakan. "200 commit dimuat" tak memberi tahu apakah tersisa
                3 atau 30.000 — dan itulah yang membuat plafonnya terbaca sebagai bug. */}
            {total > 0 ? `${rows.length} dari ${total} commit` : `${rows.length} commit dimuat`}
            {hasMore ? "" : " · seluruh history"}
          </span>
```

- [ ] **Step 6: Jalankan test git graph UI bila ada**

```bash
env -u NODE_ENV pnpm vitest --run $(ls src/test/*graph* 2>/dev/null | tr '\n' ' ')
```
Diharapkan: lulus. Mock `ideGraph` yang mengembalikan `{commits, current}` tanpa `total` tetap aman (`?? 0`).

- [ ] **Step 7: Typecheck + commit**

```bash
pnpm --filter ./server typecheck && pnpm --filter ./src typecheck
git add server/src/services/git-ide.ts server/test/ide-graph-total.test.ts src/src/screens/GitGraph.tsx
git commit -m "$(cat <<'EOF'
feat(spec-523): git graph menyatakan total commit, jendela SPEC-351 dipertahankan

Lane dihitung dari commit kontigu, jadi halaman diskrit memutus tautan induk-anak
di batas halaman dan mencabut auto-scroll SPEC-351. Yang kurang bukan halamannya
melainkan angkanya: "200 dimuat" tak memberi tahu apakah tersisa 3 atau 30.000.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Test kontrak lintas-daftar + docs (ADR-0106)

Kunci hasilnya supaya daftar baru tak diam-diam lahir tanpa halaman, lalu perbarui Source of Truth.

**Files:**
- Create: `server/test/pagination-contract.test.ts`
- Create: `internal/docs/adr/0106-paginasi-seragam-daftar-dashboard.md`
- Modify: `internal/docs/README.md:57` (tautan ADR)
- Modify: `internal/docs/adr/README.md` (narasi ADR)
- Modify: `internal/docs/architecture/api-contract.md` (notifications, scheduler, lead, github issues, graph)

- [ ] **Step 1: Tulis test kontrak**

Buat `server/test/pagination-contract.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";

const app = buildApp({ requireAuth: false });

// SPEC-523 · daftar utama dashboard. Konstanta di sini bukan hiasan: daftar BARU yang lahir tanpa
// halaman harus punya satu tempat yang menolaknya. Yang SENGAJA tak ada di sini:
//   · `/projects/:id/graph` — jendela tumbuh, bukan halaman (ADR-0106, lane butuh commit kontigu)
//   · `/projects/:id/docs`  — pohon kategori→file, bukan daftar rata
//   · error monitoring      — dicabut ADR-0092
const LIST_ENDPOINTS = [
  "/api/specs",
  "/api/projects",
  "/api/tickets",
  "/api/notifications",
  "/api/terminal/history",
  "/api/scheduler/queue",
  "/api/lead/decisions",
  "/api/lead/flows",
  "/api/projects/p-pagination/changelog",
  "/api/projects/p-pagination/github/issues",
] as const;

beforeAll(async () => {
  await prisma.project.upsert({
    where: { id: "p-pagination" }, update: {}, create: { id: "p-pagination", name: "pagination" },
  });
});
afterAll(async () => { await prisma.project.deleteMany({ where: { id: "p-pagination" } }); });

describe("kontrak paginasi daftar utama (SPEC-523 · ADR-0106)", () => {
  for (const url of LIST_ENDPOINTS) {
    it(`${url} menerima page/limit dan membalas amplop Paginated`, async () => {
      const r = await app.inject({ method: "GET", url: `${url}${url.includes("?") ? "&" : "?"}page=1&limit=1` });
      expect(r.statusCode, `${url} balas ${r.statusCode}`).toBe(200);
      const b = r.json();
      expect(Array.isArray(b.items), `${url} tak punya items[]`).toBe(true);
      expect(typeof b.total, `${url} tak punya total`).toBe("number");
      expect(typeof b.page, `${url} tak punya page`).toBe("number");
      expect(typeof b.pageSize, `${url} tak punya pageSize`).toBe("number");
      expect(b.items.length, `${url} tak menghormati limit=1`).toBeLessThanOrEqual(1);
    });
  }
});
```

- [ ] **Step 2: Jalankan test kontrak**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/pagination-contract.test.ts
```
Diharapkan: 10 test lulus. Bila ada yang merah, perbaiki endpointnya — bukan test-nya.

- [ ] **Step 3: Tulis ADR-0106**

Sebelum menulis, **verifikasi nomornya belum diklaim** worktree/branch tetangga:
```bash
ls internal/docs/adr | grep -E '^010[6-9]'
for w in /Users/denameidina/Documents/Nafanesia/hanoman/.worktrees/*/internal/docs/adr; do ls "$w" 2>/dev/null | grep -E '^010[6-9]'; done
git ls-remote --heads origin
```
Bila 0106 sudah dipakai, naikkan ke nomor bebas berikutnya dan sesuaikan seluruh rujukan di task ini.

Buat `internal/docs/adr/0106-paginasi-seragam-daftar-dashboard.md`:

```markdown
# ADR-0106 — Paginasi seragam seluruh daftar dashboard, berikut pengecualian yang dinyatakan

**Status:** aktif (SPEC-523). Memperluas [ADR-0038](0038-paginasi-di-response-layer.md) dari dua daftar ke seluruh daftar utama.

## Konteks

ADR-0038 menetapkan pola paginasi hanoman: amplop `{items,total,page,pageSize}`, dipotong di layer
response, dengan `serverPage()` + `Pager` di design system. Yang tak ditetapkannya adalah
**jangkauan** — dan tiga tahun fitur kemudian, pola itu baru dipakai `GET /specs` dan `GET /projects`.

Audit SPEC-523 atas instalasi hidup (2026-08-04): notifikasi `take: 50` hardcode dengan **287 baris
di DB** (237 tak terjangkau), `GET /lead/decisions` `{items}` tanpa `total` atas **393 baris**,
antrean scheduler ikut utuh di dalam `GET /scheduler/state` lalu difilter di klien, dan tiket serta
changelog punya server beramplop yang UI-nya tak pernah memakai. Changelog paling tajam: UI memanggil
`{limit: 10}` **tanpa `page`**, jadi `limit` di sana bukan halaman melainkan **plafon**.

## Keputusan

**Setiap daftar utama dashboard memakai amplop dan paginator yang sama.** Server menerima
`page`/`limit` dan membalas `Paginated<T>`; UI memakai `Pager` design system — tak ada paginator
kedua, karena paginator kedua persis melahirkan inkonsistensi yang ADR ini hapus.

`skip`/`take` di query DB **sah** untuk daftar tanpa overlay (notifikasi, antrean scheduler, lead,
riwayat sesi). Larangan ADR-0038 mengikat `GET /specs` secara spesifik — overlay stage live +
write-through + notifikasi `done` di sana bergantung pada set penuh, dan itulah alasan larangannya.
Ia bukan aturan umum "jangan pernah `skip`/`take`".

### Tiga pengecualian, dinyatakan supaya tak "diperbaiki" audit berikutnya

1. **Git graph tetap jendela tumbuh (SPEC-351), bukan halaman diskrit.** Lane dihitung dari daftar
   commit **kontigu**; memenggalnya per halaman memutus tautan induk–anak di batas halaman dan
   mencabut auto-scroll. Yang ditambahkan: `total` (`git rev-list --count` dengan ref selector yang
   sama dengan `git log`-nya) → "N dari T commit". Plafon yang tak terlihat itulah keluhan aslinya,
   bukan ketiadaan tombol halaman.
2. **Docs project tetap pohon.** `GET /projects/:id/docs` mengembalikan `{coverage, tree}`
   (kategori → berkas) untuk file-tree, bukan daftar rata. Memenggal pohon memutus navigasinya.
3. **Error monitoring tak punya daftar.** Dicabut [ADR-0092](0092-cabut-error-monitoring-sdk-cross-audit.md);
   brief SPEC-523 menyebutnya karena ditulis dari ingatan permukaan lama.

### Perubahan kontrak yang menghapus field

`GET /scheduler/state` berhenti mengirim `queue` dan mengirim `queueCounts`; antrean pindah ke
`GET /scheduler/queue?status&page&limit`. Alternatif "kirim `queue` yang dipotong diam-diam"
**ditolak**: daftar terpotong yang tampak utuh adalah kelas bug yang sudah menggigit repo ini
berulang kali (SPEC-431/451/475).

`GET /lead/decisions` & `/lead/flows` **menambah** `page`/`limit` tanpa mencabut `take`/`skip`;
bila keduanya dikirim, `page`/`limit` menang.

## Konsekuensi

- Data lama terjangkau di seluruh daftar utama; tak ada lagi plafon yang berpura-pura jadi total.
- Dijaga `server/test/pagination-contract.test.ts`: satu daftar konstanta endpoint yang wajib
  beramplop. Daftar baru yang lahir tanpa halaman punya satu tempat yang menolaknya.
- **Ceiling (ponytail):** `paginate()` tak menjepit `limit` dari atas. Bila agen mulai meminta
  `limit=999999`, jepit di satu tempat itu — tanpa ADR baru.
- Bell notifikasi tetap 50 teratas yang didorong WebSocket: ia **baki**, bukan arsip. Arsipnya
  hidup di modal terpisah. Menyiarkan seluruh riwayat tiap 3 detik adalah regresi biaya.
```

- [ ] **Step 4: Tautkan ADR di kedua index**

Di `internal/docs/README.md`, tepat di atas baris 0105 (baris 57):
```markdown
- [0106 — Paginasi seragam seluruh daftar dashboard: amplop tunggal, `skip`/`take` sah tanpa overlay, tiga pengecualian dinyatakan](adr/0106-paginasi-seragam-daftar-dashboard.md)
```

Di `internal/docs/adr/README.md`, tambahkan entri narasi di posisi yang sama (paling atas daftar),
mengikuti gaya entri 0105 di berkas itu: apa yang diperluas (ADR-0038), apa yang dicabut
(`queue` dari `/scheduler/state`), dan gotcha-nya (git graph sengaja bukan halaman; `limit` tanpa
`page` adalah plafon, bukan halaman).

- [ ] **Step 5: Perbarui `api-contract.md`**

Di `internal/docs/architecture/api-contract.md`, perbarui bagian yang tersentuh:
- **Settings / notifications / limits** (baris 361): `GET /notifications` menerima `page`/`limit`,
  balas `{items, unread, total, page, pageSize}`; tanpa `limit` → 50 teratas (frame siar WS).
- **Scheduler** (baris 835): `state` tanpa `queue`, dengan `queueCounts`; endpoint baru
  `GET /scheduler/queue?status&page&limit`.
- **hanoman-lead** (baris 883): `decisions`/`flows` beramplop; `take`/`skip` kompatibilitas.
- **Issue GitHub** (baris 794): beramplop.
- **Git graph parity** (baris 317): balasan `graph` membawa `total`; jendela, bukan halaman
  (rujuk ADR-0106).

- [ ] **Step 6: Jalankan seluruh test yang tersentuh plan ini**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism \
  server/test/pagination-contract.test.ts server/test/notifications.route.test.ts \
  server/test/scheduler.route.test.ts server/test/lead-list-pagination.test.ts \
  server/test/github-issues.route.test.ts server/test/ide-graph-total.test.ts
env -u NODE_ENV pnpm vitest --run src/test/ src/src/screens/ChangelogPanel.test.tsx
pnpm vitest --run shared/src/scheduler-state.test.ts
```
Diharapkan: seluruhnya hijau. **Jangan menerima "no test files" sebagai bukti** — pastikan
jumlah test yang berjalan masuk akal.

- [ ] **Step 7: Typecheck ketiga paket yang tersentuh**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck && pnpm --filter ./src typecheck
```

- [ ] **Step 8: Smoke nyata endpoint yang tersentuh (sekali, di akhir)**

```bash
HANOMAN_HOME="$(mktemp -d)" HANOMAN_PORT=8799 node server/dist/server.js &
# atau: pnpm dev  (bila dist belum dibangun)
sleep 5
curl -s "http://localhost:8799/api/notifications?page=1&limit=5" | head -c 300; echo
curl -s "http://localhost:8799/api/scheduler/state" | head -c 300; echo
curl -s "http://localhost:8799/api/scheduler/queue?page=1&limit=5" | head -c 300; echo
curl -s "http://localhost:8799/api/lead/decisions?page=1&limit=5" | head -c 300; echo
# matikan per-PID, JANGAN pkill -f
lsof -ti:8799 | xargs -r kill
```
Diharapkan: keempatnya membalas JSON beramplop (`total`/`page`/`pageSize` terlihat), `state`
memuat `queueCounts` dan tidak memuat `queue`. Bila server butuh auth, tambahkan
`-H "Authorization: Bearer $HANOMAN_AGENT_TOKEN"` atau boot dengan auth mati sesuai
`internal/docs/operations/production.md`.

- [ ] **Step 9: Commit**

```bash
git add server/test/pagination-contract.test.ts internal/docs/
git commit -m "$(cat <<'EOF'
docs(spec-523): ADR-0106 paginasi seragam + test kontrak lintas-daftar

Satu daftar konstanta endpoint yang wajib beramplop, sehingga daftar baru yang
lahir tanpa halaman punya satu tempat yang menolaknya. Tiga pengecualian —
git graph, pohon docs, error yang sudah dicabut — dinyatakan agar audit
berikutnya tak "memperbaikinya".

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review

**Cakupan spec → task**

| Keputusan spec | Task |
|---|---|
| K1 amplop & paginator tunggal | 1–11, dikunci Task 12 |
| K2 notifikasi: bell live + arsip berhalaman | 1, 2 |
| K3 scheduler: antrean jadi endpoint sendiri | 3, 4 |
| K4 lead: `page`/`limit` tanpa mencabut `take`/`skip` | 5, 6 |
| K5 git graph: jendela + `total` | 11 |
| K6 sesi/history: muat-lebih → `Pager` | 10 |
| K7 pengecualian dinyatakan | 12 (ADR-0106) |
| Tiket | 7 |
| Changelog | 9 |
| GitHub issues | 8 |
| AC-1…AC-3 (kontrak amplop) | 12 |
| AC-4…AC-7 (notifikasi) | 1, 2 |
| AC-8, AC-9 (scheduler) | 3, 4 |
| AC-10, AC-11 (lead) | 5 |
| AC-12, AC-13 (graph) | 11 |
| AC-14 (`Pager` diam saat `total ≤ pageSize`) | perilaku bawaan `Pager` (`kit.tsx:190` `total === 0`) + `pageCount` 1 → tombol nonaktif |
| AC-15 (ganti filter → halaman 1) | 6, 7, 10 |
| AC-16 (satu paginator DS) | seluruh task UI |

**Konsistensi tipe:** `Paginated<T>` dari `@hanoman/shared` dipakai seragam;
`listQueuePage`/`queueCounts` (Task 3) dikonsumsi Task 4 dengan nama yang sama;
`leadWindow` (Task 5) dipakai `trail.ts` dan `flow.ts`; `TicketPager` (Task 7) dipakai ulang
Task 8 dengan prop `unit`.

**Ponytail yang sengaja tak dikerjakan:** plafon `limit` di `paginate()` — dicatat di ADR-0106.
