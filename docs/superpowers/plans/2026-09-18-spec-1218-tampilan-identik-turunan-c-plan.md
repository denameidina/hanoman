# SPEC-1218 (turunan C SPEC-1215) — Tampilan identik: plan implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menutup AC-C1…AC-C10 (SPEC-1215 §S9) — `wsHandler` di route relay hub, tiket
`relay:<deviceId>:events|terminal:<id>`, principal `remote` di gate WS hub, dispatcher stream
`open`/`opened`/`data`/`credit`/`geometry`/`close` lewat `injectWS({onOpen})`, grup `/events/ws`
terbatas untuk `remote`, komponen frontend `RemoteInstanceView`/`RemoteBanner` memakai
`InstanceContext` remote di komponen yang **sudah ada** (`TerminalPane`, `SpecDocsModal`, panel IDE
baca) — sebagai test kontrak yang bisa dijalankan ulang, plus pengukuran Mac mini 8 GB dan update
`internal/docs` dalam commit yang sama dengan kode.

**Architecture:** Base `ba53e304` (turunan A/B/D sudah merge). `shared/src/relay.ts` sudah lengkap
sejak turunan A (`RELAY_MAX_STREAMS`/`RELAY_CREDIT_*`/`zHubToClientFrame`(`open`/`data`/`credit`/
`close`)/`zClientToHubFrame`(`opened`/`geometry`/`data`)) — plan ini murni **mengonsumsinya**.
`createApi`/`InstanceContext`/`useApi`/`useWsTarget` (`src/src/api/instance.tsx`) sudah lengkap dari
turunan B, termasuk `useWsTarget` yang sudah memulangkan `ticketTarget: relay:<deviceId>:events|
terminal:<id>` — dipakai apa adanya, tak diubah. Yang lahir di sini murni jalur WS/stream di atas
fondasi itu, mengikuti urutan dependensi teknis: skema tiket → principal `remote` (gate WS hub) →
peta stream/kredit di `relay/hub.ts` → `wsHandler` route → dispatcher klien `injectWS` → geometry
`pty.ts` → admisi WS klien untuk frame yang di-inject → grup terbatas `events.ts` → frontend
(`TerminalPane`/`SpecDocsModal`/`IdeReadPanel` → `RemoteInstanceView`/`RemoteBanner` →
`ClientsScreen`) → pengukuran 8 GB → docs.

**Tech Stack:** Fastify 5 + `@fastify/websocket` 11.3.0 (`app.injectWS`), Zod (`@hanoman/shared`),
Prisma 6 (SQLite, tanpa migration), Vitest, React 18 + TS + xterm.

## Global Constraints

- Kontrak (frame, kredit, kode tutup, kontrak frontend, grup `/events/ws`) sudah dikunci —
  `docs/superpowers/specs/2026-09-18-spec-1218-tampilan-identik-turunan-c-design.md` §T1–T12. Jangan
  mendesain ulang; setiap penyimpangan ditemukan saat implementasi dicatat sebagai koreksi kecil di
  pesan commit, bukan diputuskan sepihak. **Tiga koreksi sudah ditemukan menulis plan ini** (bukan
  tebakan — diverifikasi baris demi baris terhadap kode base ini) dan didokumentasikan di Task 5 dan
  Task 14 di bawah:
  1. `InjectableApp` (`relay/dispatcher.ts:17`) hanya membungkus `app.inject`, bukan `app.injectWS` —
     Task 5 menambah method itu ke tipe dan `injectableFrom`.
  2. WS route klien (`terminal.ts:/:id/ws`, `events.ts:/events/ws`) menuntut tiket lewat
     `admitBrowserWs` di preValidation; `injectWS` dispatcher **tak membawa tiket** (hanya header
     relay, pola `req`/A). Perlu cabang preValidation baru yang mengenali `req.remote` (sudah
     terisi gate `/api` `onRequest`, ADR-0165 §3) — lihat Task 7 untuk analisis lengkap kenapa ini
     TIDAK memakai `revalidateWsPrincipal`'s cabang `relayControlFor` (itu murni HUB-side).
  3. `api.getUpdateStatus()` yang disebut spec teknis §T7 untuk versi hub-lokal di `RemoteBanner`
     **tak ada** di `src/src/api/client.ts` (diverifikasi: nol hasil grep). Task 15 menambah
     `hubVersion` ke `PresenceView` (server, aditif) dan meneruskannya sebagai prop, bukan
     memanggil endpoint yang tak ada.
- Tak ada perubahan skema Prisma/migration.
- Tiap task ditutup dengan test yang **benar-benar tersentuh** perubahan itu, dijalankan:
  `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism <paths>`
  (CLAUDE.md + SPEC-479) — bukan suite penuh.
- Commit sering, satu task = satu (atau beberapa kecil) commit dengan pesan yang menyebut AC-nya.
- Task terakhir (docs) wajib mencabut penanda DIRANCANG di
  `internal/docs/frontend/frontend-implementation.md:52` dan menautkan doc yang berubah di
  `internal/docs/README.md`, dalam commit yang sama dengan kode fase Execute — bukan commit terpisah.
- Smoke manual (dua `HANOMAN_HOME`, dua port, hub + klien beneran) wajib dijalankan sekali di akhir
  Execute (Task 17), bukan diklaim dari test mock saja.

---

## File Structure

| Berkas | Peran |
|---|---|
| `server/src/routes/ws-tickets.ts` | `targetSchema` bertambah cabang `relay:<deviceId>:…` |
| `server/src/services/ws-admission.ts` | `WsTarget`/`WsPrincipal.kind` bertambah `"remote"` (HUB-side); `admitBrowserWs` cabang tiket relay; `revalidateWsPrincipal` cabang `remote` (`relayControlFor`) |
| `server/src/services/relay/hub.ts` | peta `streams`/kredit/plafon per `Link`; `openStream`/`onClientFrame`/`closeStream` (baru) |
| `server/src/routes/devices-relay.ts` | `wsHandler` baru bersanding `handler` HTTP yang sudah ada |
| `server/src/services/relay/dispatcher.ts` | `InjectableApp` + `injectWS`; jalur `open` menggantikan placeholder `close 4502`; kredit lokal |
| `server/src/services/pty.ts` | `FMT` + `#{pane_width}`/`#{pane_height}`; `paneGeometry(id)` baru |
| `server/src/routes/terminal.ts` | preValidation `/:id/ws` — cabang `req.remote` (in-process), lewati `revalidateWsPrincipal` untuk principal itu |
| `server/src/routes/events.ts` | preValidation `/events/ws` (klien) — cabang sama; principal `remote` → `attach({groups})` |
| `server/src/services/events.ts` | `attach(c, {maySubscribe?, groups?})`; `broadcast` per-klien |
| `server/src/services/presence/view.ts` (atau tempat `presenceView()` berada) | `PresenceView` bertambah `hubVersion` |
| `src/src/screens/TerminalPane.tsx` | prop `mode?: "local"\|"remote"`; buang `resize` remote; frame `geometry`; baca-saja tanpa `sessions:write` |
| `src/src/screens/SpecDocsModal.tsx` | `useApi()` menggantikan `api` langsung |
| `src/src/screens/IdeReadPanel.tsx` (baru) | subset baca `IdeScreen.tsx`, `useApi()` |
| `src/src/screens/RemoteInstanceView.tsx` (baru) | gate protocol + tabs Terminal/Dokumen/IDE |
| `src/src/screens/RemoteBanner.tsx` (baru) | banner + badge baca-saja + peringatan versi |
| `src/src/screens/ClientsScreen.tsx` | tombol "Buka" per `DeviceCard` |
| `server/test/relay-8gb-measurement.ts` (baru, skrip) | pengukuran AC-C10 |
| `internal/docs/**` | docs tersentuh (Task 17) |

---

## Task 1: Tiket `POST /api/ws-tickets` — cabang `relay:<deviceId>:events|terminal:<id>`

**Files:**
- Modify: `server/src/routes/ws-tickets.ts`
- Test: `server/test/ws-tickets.relay-target.test.ts` (baru)

**Interfaces:**
- Produces: `targetSchema` menerima `relay:<deviceId>:events` dan `relay:<deviceId>:terminal:<id>`
  selain `"events"`/`terminal:<id>` lama; hanya `req.user` boleh memintanya (agent → 401 default
  cookie-only tak berubah, `opts.allowTestPrincipal` tetap untuk test).
- Consumes: `issueWsTicket` (`ws-admission.ts`, sudah ada, tak berubah tanda tangannya sampai Task 2).

- [ ] **Step 1: Tulis test yang gagal**

```ts
// server/test/ws-tickets.relay-target.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";

const app = buildApp();
const clean = async () => { await prisma.user.deleteMany(); };
beforeEach(clean);

describe("POST /api/ws-tickets — target relay:<deviceId>:… (SPEC-1218 · prasyarat C1-C9)", () => {
  it("req.user → 200 untuk relay:dev1:events dan relay:dev1:terminal:abc", async () => {
    const u = await prisma.user.create({ data: { email: "op@d.co", passwordHash: "x:y" } });
    const r = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { email: "op@d.co", password: "password1" } });
    const cookie = (r.headers["set-cookie"] as string).split(";")[0]!;
    await prisma.user.deleteMany({ where: { NOT: { email: "op@d.co" } } });
    for (const target of ["relay:dev1:events", "relay:dev1:terminal:abc"]) {
      const res = await app.inject({ method: "POST", url: "/api/ws-tickets", headers: { cookie }, payload: { target } });
      expect(res.statusCode).toBe(200);
      expect(res.json().ticket).toEqual(expect.any(String));
    }
  });

  it("target relay malformed (dua titik dua/kosong deviceId) → 400", async () => {
    const u = await prisma.user.create({ data: { email: "op2@d.co", passwordHash: "x:y" } });
    const r = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { email: "op2@d.co", password: "password1" } });
    const cookie = (r.headers["set-cookie"] as string).split(";")[0]!;
    const res = await app.inject({ method: "POST", url: "/api/ws-tickets", headers: { cookie }, payload: { target: "relay::events" } });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/ws-tickets.relay-target.test.ts
```
Expected: FAIL (400 untuk kedua target relay valid — `targetSchema` menolaknya).

- [ ] **Step 3: Implementasi**

```ts
// ws-tickets.ts
const relayTarget = /^relay:[^:]+:(events|terminal:[^:]+)$/;
const targetSchema = z.string().refine((v) =>
  v === "events" || v.startsWith("terminal:") || relayTarget.test(v));
```

Cast di `issueWsTicket(principal, parsed.data.target as WsTarget)` (Task 2 memperluas `WsTarget`,
sampai saat itu gunakan `as any` bersyarat SEMENTARA — catat TODO Task 2 di komentar, ditutup di
Task 2 Step 3, bukan dibiarkan).

- [ ] **Step 4: Jalankan, pastikan lulus (mungkin type error `WsTarget` — sah, ditutup Task 2)**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/ws-tickets.relay-target.test.ts
```
Expected: PASS (runtime); TS type-check untuk `WsTarget` ditutup Task 2, jangan blokir commit ini
bila `tsc` project-wide belum dijalankan (SPEC-376 — hanya test tersentuh).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/ws-tickets.ts server/test/ws-tickets.relay-target.test.ts
git commit -m "feat(spec-1218): ws-tickets target relay:<deviceId>:events|terminal:<id> (AC-C prasyarat)"
```

---

## Task 2: `WsPrincipal`/`WsTarget` "remote" (HUB-side) + `admitBrowserWs` cabang relay + `revalidateWsPrincipal`

**Files:**
- Modify: `server/src/services/ws-admission.ts`
- Test: `server/test/ws-admission.test.ts` (berkas sudah ada, tambah `describe`)

**Interfaces:**
- Produces: `WsTarget` bertambah `` `relay:${string}:${"events" | `terminal:${string}`}` ``;
  `WsPrincipal.kind` bertambah `"remote"`; `admitBrowserWs(req, target, allowedOrigins)` untuk
  target relay memulangkan `{kind:"remote", id: deviceId}` (deviceId diparse dari target string,
  BUKAN dari body — target sudah dikonsumsi `consumeWsTicket` yang memverifikasi tiketnya sah);
  `revalidateWsPrincipal` cabang `remote` = `relayControlFor(deviceId) !== null`.
- **Catatan desain (ditemukan menulis plan ini, bukan re-desain):** kind `"remote"` di sini HANYA
  dipakai HUB mengadmisi socket **browser** yang menembak `wsHandler` `devices-relay.ts` (Task 4).
  Task 7 (admisi injectWS klien) SENGAJA tidak memakai kind ini — lihat alasannya di Task 7.

- [ ] **Step 1: Tulis test yang gagal**

```ts
// tambahan di server/test/ws-admission.test.ts
import { attachRelaySocket, __resetRelayHub } from "../src/services/relay/hub";

describe("admitBrowserWs — target relay:<deviceId>:… (SPEC-1218 · prasyarat C1-C9)", () => {
  beforeEach(() => __resetRelayHub());
  it("tiket relay valid → {kind:'remote', id: deviceId}", () => {
    const token = issueWsTicket({ kind: "user", id: "u1" }, "relay:dev1:events" as any);
    const req = { headers: { origin: "http://localhost", host: "localhost",
      "sec-websocket-protocol": `hanoman-ticket.${token}` } } as any;
    const p = admitBrowserWs(req, "relay:dev1:events" as any, new Set(["http://localhost"]));
    expect(p).toEqual({ kind: "remote", id: "dev1" });
  });

  it("revalidateWsPrincipal remote — link relay masih hidup → true, mati → false", async () => {
    const fakeSocket = { readyState: 1, send: () => {}, close: () => {} };
    attachRelaySocket("dev1", fakeSocket).onMessage(JSON.stringify({ t: "hello", v: 1, protocol: 1, version: "0.5.0", capabilities: [] }));
    await expect(revalidateWsPrincipal({} as any, { kind: "remote", id: "dev1" })).resolves.toBe(true);
    await expect(revalidateWsPrincipal({} as any, { kind: "remote", id: "dev2" })).resolves.toBe(false);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/ws-admission.test.ts
```
Expected: FAIL (TS: `"remote"` bukan anggota `WsPrincipal.kind`; `consumeWsTicket` menolak target
relay karena `WsTarget` belum memuatnya).

- [ ] **Step 3: Implementasi**

```ts
// ws-admission.ts
export type WsTarget = "events" | "sync" | `terminal:${string}` | `relay:${string}:${"events" | `terminal:${string}`}`;
export type WsPrincipal = { kind: "user" | "agent" | "device" | "test" | "remote"; id: string };
```

`admitBrowserWs`, sebelum baris `const principal = consumeWsTicket(token, target);` tetap sama —
`consumeWsTicket` sudah generik atas `WsTarget` sehingga menerima target relay tanpa perubahan.
Tambahkan SESUDAH baris itu, SEBELUM cabang `user`/`agent` mismatch:

```ts
if (target.startsWith("relay:")) {
  const deviceId = target.slice("relay:".length, target.indexOf(":", "relay:".length + 1));
  return { kind: "remote", id: deviceId };
}
if (principal.kind === "user" && req.user?.id !== principal.id) throw new Error("WebSocket principal mismatch");
// ... (tak berubah)
```

`revalidateWsPrincipal`, tambahkan cabang SEBELUM `if (principal.kind === "device")`:

```ts
if (principal.kind === "remote") {
  const { relayControlFor } = await import("./relay/hub");
  return relayControlFor(principal.id) !== null;
}
```

(Import dinamis untuk menghindari siklus `ws-admission.ts` ↔ `relay/hub.ts` — verifikasi Step 4
tak melempar; bila `relay/hub.ts` sudah aman diimpor statis di modul ini pakai import statis biasa
dan catat koreksi di commit.)

- [ ] **Step 4: Jalankan, pastikan lulus**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/ws-admission.test.ts server/test/ws-tickets.relay-target.test.ts
```
Expected: PASS (kedua berkas — Task 1 kini type-check bersih juga).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/ws-admission.ts server/test/ws-admission.test.ts
git commit -m "feat(spec-1218): WsPrincipal remote (HUB-side) + admitBrowserWs/revalidateWsPrincipal cabang relay (prasyarat C1-C9)"
```

---

## Task 3: `relay/hub.ts` — peta stream, kredit, plafon, resync, idle-close

**Files:**
- Modify: `server/src/services/relay/hub.ts`
- Test: `server/test/relay-hub.test.ts` (berkas sudah ada, tambah `describe` baru)

**Interfaces:**
- Produces: `openStream(deviceId, req: {path, mode, actor}, browserSocket): string | null` (null =
  plafon dilanggar); `onClientFrame(deviceId, frame: ClientToHubFrame)` menangani
  `opened`/`data`/`geometry`/`close` dari klien; `closeStream(deviceId, sid)`. `Link` bertambah
  `streams: Map<string, StreamState>`, `inflightOpens: number`.
- Consumes: `RELAY_MAX_STREAMS`/`RELAY_MAX_INFLIGHT`/`RELAY_CREDIT_INITIAL`/
  `RELAY_CREDIT_REFILL_BELOW`/`RELAY_SOCKET_MAX_BUFFERED`/`RELAY_RESYNC_MIN_MS`/
  `RELAY_IDLE_STREAM_CLOSE_MS` (`@hanoman/shared`, sudah ada).

- [ ] **Step 1: Tulis test tabel yang gagal (fixture `fake()`/`hello()`/`ready()` sudah ada di berkas)**

```ts
describe("relay/hub.ts — stream, kredit, plafon (SPEC-1218 · AC-C4/C5/C6)", () => {
  it("openStream ke-7 saat 6 aktif → null (4409 di pemanggil)", () => {
    ready();
    for (let i = 0; i < 6; i++) expect(openStream("dev1", { path: "/api/terminal/sessions/x/ws", mode: "read", actor }, fake().socket)).not.toBeNull();
    expect(openStream("dev1", { path: "/api/terminal/sessions/x/ws", mode: "read", actor }, fake().socket)).toBeNull();
  });

  it("inflightOpens ke-5 saat 4 belum 'opened' → null", () => {
    ready();
    const sids = Array.from({ length: 4 }, () => openStream("dev1", { path: "/api/terminal/sessions/x/ws", mode: "read", actor }, fake().socket));
    expect(sids.every((s) => s !== null)).toBe(true);
    expect(openStream("dev1", { path: "/api/terminal/sessions/x/ws", mode: "read", actor }, fake().socket)).toBeNull();
  });

  it("kredit habis → data berikutnya dibuang, tak diteruskan ke browser", () => {
    ready();
    const browser = fake();
    const sid = openStream("dev1", { path: "/api/terminal/sessions/x/ws", mode: "read", actor }, browser.socket)!;
    onClientFrame("dev1", { t: "opened", sid });
    // habiskan kredit awal (256 KiB) dengan satu frame data 256 KiB, lalu satu lagi harus dibuang
    onClientFrame("dev1", { t: "data", sid, d: "x".repeat(256 * 1024) });
    const before = browser.sent.filter((f) => f.t === "data").length;
    onClientFrame("dev1", { t: "data", sid, d: "y" });
    expect(browser.sent.filter((f) => f.t === "data").length).toBe(before); // dibuang, bukan diteruskan
  });

  it("refill di bawah 64 KiB DAN bufferedAmount browser rendah → kirim credit; dua refill <5dtk → resync ≤1×", () => {
    // ... spy browser.sent untuk {t:"credit"}; assert count sesuai RELAY_RESYNC_MIN_MS throttle
  });

  it("browser socket tertutup → close ke klien segera (≤2 dtk, bukan menunggu idle)", () => {
    ready();
    const browser = fake();
    const sid = openStream("dev1", { path: "/api/terminal/sessions/x/ws", mode: "read", actor }, browser.socket)!;
    onClientFrame("dev1", { t: "opened", sid });
    const link = ready(); // ambil onMessage/onClose handle asli dari attachRelaySocket
    closeStream("dev1", sid); // dipanggil pemanggil saat browser socket 'close' (Task 4)
    // assert frame {t:"close", sid, code:1000} terkirim ke klien lewat link.socket.send
  });
});
```

(Isi test kredit/resync/idle di atas adalah kerangka — implementor menyesuaikan assert konkret
dengan bentuk `StreamState`/`fake()` nyata saat menulisnya; jangan longgarkan assert `toBeNull`/
`toBe` di atas demi lulus.)

- [ ] **Step 2: Jalankan, pastikan gagal**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/relay-hub.test.ts
```
Expected: FAIL (`openStream`/`onClientFrame`/`closeStream` tak ada).

- [ ] **Step 3: Implementasi**

```ts
// relay/hub.ts — tambahan tipe & state
export type StreamState = {
  sid: string; browser: RelaySocket;
  credit: number; lastResyncAt: number; idleTimer: NodeJS.Timeout | null;
};
// Link bertambah: streams: Map<string, StreamState>; inflightOpens: number;
```

`openStream(deviceId, req, browserSocket)`:
1. `link = links.get(deviceId)`; tanpa link/`control` → return null (pemanggil Task 4 memutuskan
   status: sebenarnya `openStream` di sini TIDAK membedakan "offline" vs "plafon" lewat return
   value tunggal — Task 4 memanggil `relayControlFor(deviceId)` sendiri dulu untuk itu, jadi
   `openStream` hanya perlu menilai plafon SETELAH link dipastikan hidup oleh pemanggil).
2. `link.streams.size >= RELAY_MAX_STREAMS` atau `link.inflightOpens >= RELAY_MAX_INFLIGHT` →
   null.
3. `sid = `s${++counter}``; `link.streams.set(sid, {sid, browser: browserSocket, credit:
   RELAY_CREDIT_INITIAL, lastResyncAt: 0, idleTimer: null})`; `link.inflightOpens++`.
4. `link.socket.send(JSON.stringify({t:"open", sid, path: req.path, mode: req.mode, actor:
   req.actor}))`.
5. return `sid`.

`onClientFrame(deviceId, frame)`:
- `"opened"` → `link.inflightOpens--`; bila `frame.geometry` teruskan sebagai `{t:"geometry", ...}`
  bukan ke `data` — browser TerminalPane butuh event terpisah, bukan dibungkus `data` (cermin
  `zGeometry`, sudah berbeda `t` di kontrak — cukup teruskan `frame` apa adanya minus `sid` remap).
- `"data"` → `s = link.streams.get(sid)`; bila `s.credit < utf8Bytes(frame.d)` **buang** (tak
  forward, tak decrement negatif); else `s.credit -= n`; `s.browser.send(JSON.stringify({t:"data",
  sid, d: frame.d}))`; bila `s.credit < RELAY_CREDIT_REFILL_BELOW` **dan**
  `(s.browser as any).bufferedAmount < RELAY_SOCKET_MAX_BUFFERED` (opsional — beberapa
  implementasi `RelaySocket` test tak punya field ini, treat `undefined` sebagai "boleh") → kirim
  `{t:"credit", sid, n: RELAY_CREDIT_INITIAL - s.credit}` ke KLIEN (`link.socket.send`), reset
  `s.credit = RELAY_CREDIT_INITIAL`, dan bila `Date.now() - s.lastResyncAt >= RELAY_RESYNC_MIN_MS`:
  `s.browser.close(4009, "resync")`, `s.lastResyncAt = Date.now()`.
- `"geometry"` → teruskan apa adanya ke browser.
- `"close"` → hapus dari `link.streams`, teruskan `close` ke browser socket.

`closeStream(deviceId, sid)` (dipanggil Task 4 saat browser socket close):
`link.streams.delete(sid)`; kirim `{t:"close", sid, code:1000}` ke KLIEN lewat `link.socket.send`.

`attachRelaySocket`'s `onMessage`, ganti komentar baris 88 `// opened/geometry/data/close = stream,
milik SPEC-1218.` dengan pemanggilan nyata: `if (["opened","geometry","data","close"].includes(f.t))
{ onClientFrame(deviceId, f); return; }` (letakkan SEBELUM baris komentar itu, di dalam `onMessage`
yang sama — jangan buat handler kedua).

`attachRelaySocket`'s `onClose` — link lama diganti (`previous`) harus juga membersihkan
`previous.streams` (kirim close ke setiap browser socket yang masih terbuka) — tambahkan di blok
`if (previous)` yang sudah ada.

- [ ] **Step 4: Jalankan test, pastikan lulus**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/relay-hub.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/relay/hub.ts server/test/relay-hub.test.ts
git commit -m "feat(spec-1218): relay/hub.ts peta stream + kredit + plafon 6/4 + resync (AC-C4/C5/C6)"
```

---

## Task 4: `devices-relay.ts` — `wsHandler` bersanding `handler` HTTP yang sudah ada

**Files:**
- Modify: `server/src/routes/devices-relay.ts`
- Test: `server/test/devices-relay.wshandler.test.ts` (baru)

**Interfaces:**
- Consumes: `openStream`/`closeStream` (Task 3), `admitBrowserWs`/`relayControlFor` (Task 2/hub.ts
  sudah ada), `zRelayPath` (sudah ada).
- Produces: `GET /api/devices/:deviceId/relay/*` (upgrade) — Task 15 tak menyentuhnya lagi.

- [ ] **Step 1: Tulis test yang gagal**

Pola fixture: `app.injectWS` terhadap route ini (server test env), dengan tiket
`relay:<deviceId>:terminal:<id>` dari `POST /api/ws-tickets` (Task 1), lalu assert:

```ts
// server/test/devices-relay.wshandler.test.ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";
import { attachRelaySocket, __resetRelayHub } from "../src/services/relay/hub";
import { __resetDeviceSockets } from "../src/services/device-sockets";

const app = buildApp();
beforeEach(async () => { __resetRelayHub(); __resetDeviceSockets(); await prisma.user.deleteMany(); });
afterAll(async () => { await app.close(); });

async function loginAndTicket(target: string) {
  await prisma.user.create({ data: { email: "op@d.co", passwordHash: "x:y" } });
  const r = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { email: "op@d.co", password: "password1" } });
  const cookie = (r.headers["set-cookie"] as string).split(";")[0]!;
  await prisma.user.deleteMany({ where: { NOT: { email: "op@d.co" } } });
  const t = await app.inject({ method: "POST", url: "/api/ws-tickets", headers: { cookie }, payload: { target } });
  return t.json().ticket as string;
}

describe("devices-relay wsHandler (SPEC-1218 · AC-C5/AC-C6)", () => {
  it("device ber-relay hidup, 6 stream sudah aktif → koneksi ke-7 ditutup 4409", async () => {
    const u = await prisma.user.create({ data: { email: "d@d.co", passwordHash: "x:y" } });
    const t = await issueDeviceToken(u.id, "laptop");
    const fakeSocket = { readyState: 1, send: () => {}, close: () => {} };
    attachRelaySocket(t.id, fakeSocket).onMessage(JSON.stringify({ t: "hello", v: 1, protocol: 1, version: "0.5.0", capabilities: ["sessions:read"] }));
    const ticket = await loginAndTicket(`relay:${t.id}:events`);
    const opens = await Promise.all(Array.from({ length: 7 }, () =>
      app.injectWS(`/api/devices/${t.id}/relay/events/ws`, { headers: { "sec-websocket-protocol": `hanoman-ticket.${ticket}` } })));
    // 6 pertama terbuka; ws ke-7 ditutup 4409 — assert lewat event 'close' pada opens[6]
  });

  it("browser socket tutup → stream ditutup ≤2 dtk tanpa penonton, bukan menunggu idle timer", async () => {
    // fake timers; assert closeStream terpanggil segera saat 'close' event browser, bukan sesudah RELAY_IDLE_STREAM_CLOSE_MS
  });

  it("device tak dikenal/offline → 4409 atau close sebelum open terkirim ke klien", async () => {
    // deviceId asing → wsHandler tak pernah memanggil link.socket.send({t:'open'...})
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/devices-relay.wshandler.test.ts
```
Expected: FAIL (route belum punya `wsHandler`, upgrade gagal/404).

- [ ] **Step 3: Implementasi**

```ts
// devices-relay.ts — tambahan ke app.route({...}) yang SUDAH ADA (bukan route kedua)
import { openStream, closeStream } from "../services/relay/hub";

app.route({
  method: [...RELAY_METHODS] as any,
  url: "/devices/:deviceId/relay/*",
  handler: /* apa adanya, tak berubah */,
  wsHandler: async (socket, req) => {
    if (!req.user) { socket.close(4401, "unauthorized"); return; }
    const { deviceId } = req.params as { deviceId: string };
    const wildcard = (req.params as { "*"?: string })["*"] ?? "";
    const path = `/api/${wildcard}`;
    const mode = (req.query as { mode?: string })?.mode === "write" ? "write" : "read";
    if (!relayControlFor(deviceId)) { socket.close(4409, "device offline"); return; }
    const actor = { hubOrigin: /* sama pola handler HTTP */, userId: req.user.id, email: req.user.email };
    const sid = openStream(deviceId, { path, mode, actor }, { readyState: socket.readyState, send: (d) => socket.send(d), close: (c, r) => socket.close(c, r) });
    if (!sid) { socket.close(4409, "stream limit"); return; }
    socket.on("message", (raw) => forwardBrowserFrame(deviceId, sid, raw)); // in/resize dari browser → data ke klien (dibungkus {t:"data", sid, d: raw})
    socket.on("close", () => closeStream(deviceId, sid));
  },
});
```

`preValidation` (WAJIB tetap milik `app.route`, tak pindah ke `wsHandler` — mengunci tiket lewat
`admitBrowserWs` target `relay:<deviceId>:events|terminal:<id>` sebelum `wsHandler` dipanggil, pola
sama `terminal.ts:544`):

```ts
app.route({
  // ...
  preValidation: async (req, reply) => {
    if (!req.raw.url?.includes("/ws")) return; // hanya upgrade yang butuh tiket; handler HTTP tak berubah
    try {
      const { deviceId } = req.params as { deviceId: string };
      const wildcard = (req.params as { "*"?: string })["*"] ?? "";
      const inner = wildcard.startsWith("terminal/sessions/") ? `terminal:${wildcard.split("/")[2]}` : "events";
      req.wsPrincipal = admitBrowserWs(req, `relay:${deviceId}:${inner}` as any, opts.allowedOrigins ?? new Set());
    } catch { return reply.code(401).send({ error: "WebSocket admission rejected" }); }
  },
  // handler, wsHandler seperti di atas
});
```

(Sesuaikan deteksi `inner` dengan bentuk nyata `wildcard` yang diamati saat Step 2 gagal — jangan
menebak regex tanpa menjalankannya.)

- [ ] **Step 4: Jalankan, pastikan lulus**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/devices-relay.wshandler.test.ts server/test/devices-relay.route.test.ts
```
Expected: PASS (kedua — route HTTP lama tak boleh regresi).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/devices-relay.ts server/test/devices-relay.wshandler.test.ts
git commit -m "feat(spec-1218): wsHandler /api/devices/:id/relay/* bersanding handler HTTP (AC-C1/C5/C6)"
```

---

## Task 5: `InjectableApp` + `injectWS` di dispatcher — kerangka, belum jalur `open`

**Files:**
- Modify: `server/src/services/relay/dispatcher.ts`
- Modify: `server/src/server.ts` (tak berubah pemanggilan `injectableFrom(app)` — hanya tipe baru)
- Test: `server/test/relay-dispatcher.test.ts` (berkas sudah ada, tambah `describe`)

**Interfaces:**
- Produces: `InjectableApp` bertambah `injectWS?(path, opts: {headers}, hooks: {onOpen: (ws) =>
  void}): Promise<void>` opsional (opsional supaya mock lama yang cuma punya `inject` tak pecah);
  `injectableFrom(app)` mengisi `injectWS: (path, o, h) => app.injectWS(path, o, h)`.
- **Koreksi (dicatat di Global Constraints):** ini SATU-SATUNYA tempat `injectWS` sesungguhnya
  dipanggil di klien — spec teknis §T5 tak menyebut perluasan `InjectableApp` secara eksplisit
  karena kontraknya berhenti di level frame; perluasan tipe ini murni mekanis, bukan keputusan baru.

- [ ] **Step 1: Tulis test yang gagal (kerangka tipe, bukan perilaku jalur open — itu Task 6)**

```ts
// tambahan di relay-dispatcher.test.ts
import { injectableFrom } from "../src/services/relay/dispatcher";

it("injectableFrom mengekspos injectWS di atas app.injectWS asli (SPEC-1218 · prasyarat)", async () => {
  const calls: any[] = [];
  const fakeApp = {
    inject: async () => ({ statusCode: 200, headers: {}, body: "{}" }),
    injectWS: async (path: string, o: unknown, hooks: { onOpen: (ws: unknown) => void }) => {
      calls.push([path, o]); hooks.onOpen({ send: () => {}, on: () => {}, close: () => {} });
    },
  };
  const wrapped = injectableFrom(fakeApp as any);
  const ws = await wrapped.injectWS!("/api/events/ws", { headers: { host: "x" } }, { onOpen: () => {} });
  expect(calls[0][0]).toBe("/api/events/ws");
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/relay-dispatcher.test.ts
```
Expected: FAIL (TS: `injectWS` bukan properti `InjectableApp`).

- [ ] **Step 3: Implementasi**

```ts
export type InjectableApp = {
  inject(o: { method: string; url: string; headers: Record<string, string>; payload?: string }): Promise<InjectResponse>;
  injectWS?(path: string, o: { headers: Record<string, string> }, hooks: { onOpen: (ws: InjectedWs) => void }): Promise<void>;
};
export type InjectedWs = { send(data: string): void; on(ev: "message" | "close", cb: (...a: any[]) => void): void; close(code?: number, reason?: string): void };

export function injectableFrom(app: FastifyInstance): InjectableApp {
  return {
    async inject(o) { /* tak berubah */ },
    async injectWS(path, o, hooks) { return app.injectWS(path, o as any, hooks as any); },
  };
}
```

- [ ] **Step 4: Jalankan, pastikan lulus**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/relay-dispatcher.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/relay/dispatcher.ts server/test/relay-dispatcher.test.ts
git commit -m "feat(spec-1218): InjectableApp.injectWS + injectableFrom (prasyarat AC-C8)"
```

---

## Task 6: Dispatcher jalur `open` — gate, `injectWS({onOpen})`, buang resize/in, kredit lokal

**Files:**
- Modify: `server/src/services/relay/dispatcher.ts`
- Test: `server/test/relay-dispatcher.test.ts`

**Interfaces:**
- Consumes: `admitRemoteRequest`-setara murni (mirror `gate.ts`, TANPA `req.raw` — dipakai
  `relayRouteAllowed`/`remoteCapabilityFor`/`getSetting()` langsung, sesuai T5); `RELAY_HEADER`/
  `RELAY_ACTOR_HEADER` (sudah ada); `splitUtf8` (sudah ada).
- Produces: `onMessage` menangani `f.t === "open"` lewat `injectWS`, menggantikan placeholder
  `close 4502` (baris 134); buang `resize` selalu; buang `in`/`diag` bila mode bukan `"write"`.

- [ ] **Step 1: Tulis test regresi `onOpen` (mereplikasi 0/2→2/2 S0a, kasus TERPISAH — AC-C8) yang gagal**

```ts
it("jalur open: frame sinkron attach sampai HANYA lewat onOpen, 2/2 (AC-C8, replikasi S0a terpisah)", async () => {
  const synced: string[] = [];
  const fakeApp = {
    inject: async () => ({ statusCode: 200, headers: {}, body: "{}" }),
    injectWS: async (_p: string, _o: unknown, hooks: { onOpen: (ws: any) => void }) => {
      const ws = { send: (d: string) => synced.push(d), on: (ev: string, cb: any) => { if (ev === "message") setImmediate(() => cb(Buffer.from("scrollback"))); }, close: () => {} };
      hooks.onOpen(ws); // frame sinkron sesudah onOpen SEBELUM microtask lain — kontrak spike ADR-0165 §2
    },
  };
  const sent: any[] = [];
  const d = createRelayDispatcher({ app: fakeApp as any, send: (j) => sent.push(JSON.parse(j)) });
  await d.onMessage(JSON.stringify({ t: "open", sid: "s1", path: "/api/events/ws", mode: "read", actor }));
  // grant: (getSetting mock) remoteControl enabled, capabilities sessions:read
  expect(sent.filter((f) => f.t === "opened")).toHaveLength(1);
  expect(sent.some((f) => f.t === "data")).toBe(true); // frame 'scrollback' sampai
});

it("buang frame resize dari hub SELALU, mode read maupun write", async () => { /* handleStreamData({t:'data', sid, d: JSON.stringify({t:'resize',...})}) → ws.send TAK dipanggil */ });
it("buang in/diag saat mode read", async () => { /* ... */ });
it("gate: path relay tak diizinkan atau capability kurang → close 4403 sebelum injectWS dipanggil", async () => { /* injectWS mock TAK terpanggil sama sekali */ });
```

- [ ] **Step 2: Jalankan, pastikan gagal**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/relay-dispatcher.test.ts
```
Expected: FAIL (`f.t === "open"` masih menjawab `close 4502`).

- [ ] **Step 3: Implementasi** (ganti baris 132-134 `createRelayDispatcher`'s `onMessage`)

```ts
const streams = new Map<string, { mode: "read" | "write"; ws: InjectedWs }>();

async function handleOpen(f: RelayOpenFrame): Promise<void> {
  const grant = (await getSetting()).remoteControl;
  const override = remoteCapabilityFor(f.method ?? "GET", f.path, f.mode);
  const ok = override ? grantsCapability(grant.capabilities, override) : relayRouteAllowed("GET", f.path);
  if (!ok) { send({ t: "close", sid: f.sid, code: 4403, reason: "capability required" }); return; }
  if (!o.app.injectWS) { send({ t: "close", sid: f.sid, code: 4502, reason: "injectWS tak didukung" }); return; }
  await o.app.injectWS(f.path, {
    headers: { host: host(), [RELAY_HEADER]: relaySecret(), [RELAY_ACTOR_HEADER]: encodeRelayActor(f.actor) },
  }, {
    onOpen: (ws) => {
      streams.set(f.sid, { mode: f.mode, ws });
      send({ t: "opened", sid: f.sid, geometry: paneGeometryFor(f.path) });
      ws.on("message", (raw: Buffer) => {
        const parts = splitUtf8(raw.toString("utf8"));
        parts.forEach((part) => send({ t: "data", sid: f.sid, d: part }));
      });
      ws.on("close", (code: number, reason: Buffer) => { streams.delete(f.sid); send({ t: "close", sid: f.sid, code, reason: reason.toString() }); });
    },
  });
  void appendEvent({ kind: "remote.stream", level: "info", msg: `open ${f.path}`, data: { actor: f.actor, path: f.path, mode: f.mode, sid: f.sid } });
}

function handleStreamData(f: { sid: string; d: string }): void {
  const s = streams.get(f.sid); if (!s) return;
  let m: { t?: string }; try { m = JSON.parse(f.d); } catch { return; }
  if (m.t === "resize") return;
  if ((m.t === "in" || m.t === "diag") && s.mode !== "write") return;
  s.ws.send(f.d);
}
```

`onMessage`, ganti:

```ts
if (f.t === "open") { void handleOpen(f); return; }
if (f.t === "data") { handleStreamData(f); return; }
if (f.t === "credit" || f.t === "close") { /* Task 6 lanjutan bila perlu — close: streams.get(f.sid)?.ws.close(f.code, f.reason); streams.delete(f.sid); */ return; }
```

Import tambahan di header berkas: `getSetting` (`../settings`), `remoteCapabilityFor`,
`relayRouteAllowed`, `grantsCapability` (`@hanoman/shared`), `paneGeometryFor` (Task 8, sementara
stub `() => undefined` sampai Task 8 mendarat — catat TODO ditutup Task 8, bukan dibiarkan).

- [ ] **Step 4: Jalankan test, pastikan lulus**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/relay-dispatcher.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/relay/dispatcher.ts server/test/relay-dispatcher.test.ts
git commit -m "feat(spec-1218): dispatcher jalur open via injectWS({onOpen}) + buang resize/in (AC-C2/C3/C8)"
```

---

## Task 7: Admisi WS klien untuk `injectWS` — `terminal.ts:/:id/ws` + preValidation

**Files:**
- Modify: `server/src/routes/terminal.ts` (preValidation route `/:id/ws`)
- Test: `server/test/terminal.route.test.ts` (berkas sudah ada, tambah kasus)

**Analisis (kenapa TIDAK memakai `revalidateWsPrincipal` cabang `relayControlFor` Task 2):**
`revalidateWsPrincipal`'s cabang `remote` Task 2 memanggil `relayControlFor(principal.id)` —
fungsi itu membaca peta `links` **HUB** (`relay/hub.ts`), yang di mesin KLIEN kosong (klien bukan
hub bagi siapa pun secara default). Memakainya di sini akan menutup socket 60 dtk sesudah setiap
stream dibuka (P1008-kelas kegagalan senyap yang dikoreksi SPEC-761). `req.remote` (diisi gate
`/api` `onRequest` via `admitRemoteRequest`, ADR-0165 §3, SUDAH memverifikasi allowlist+capability
untuk `GET /api/terminal/sessions/:id/ws` sebelum preValidation ini berjalan) adalah sinyal yang
BENAR di sini. Revalidasi berkelanjutan grant yang dicabut selagi stream terbuka **bukan** tanggung
jawab route ini — itu milik watch terpisah di dispatcher sendiri (T8, Task 6 lanjutan/Task 9).

- [ ] **Step 1: Tulis test yang gagal**

```ts
it("preValidation /:id/ws mengenali req.remote in-process (mock RELAY_HEADER via inject) tanpa tiket (SPEC-1218 · prasyarat AC-C1-C9)", async () => {
  // fixture: relay-gate.test.ts punya cara memalsukan header x-hanoman-relay/x-hanoman-relay-actor
  // + RemoteControl grant enabled sessions:read; pakai app.inject WS upgrade langsung (bukan browser)
  // assert: preValidation TIDAK menjawab 401 "WebSocket admission rejected" (tiket tak ada tapi diterima)
});
it("revalidate interval TIDAK dipasang untuk principal remote (klien) — no setInterval leak", async () => {
  // assert socket close tak pernah dipicu 1008 'session revoked' sesudah advance timer 60dtk (fake timers)
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/terminal.route.test.ts
```
Expected: FAIL (401 tanpa tiket).

- [ ] **Step 3: Implementasi**

```ts
// terminal.ts — preValidation route /:id/ws
preValidation: async (req, reply) => {
  const { id } = req.params as { id: string };
  if (req.remote) { req.wsPrincipal = { kind: "remote", id: `client:${req.remote.actor.hubOrigin}:${req.remote.actor.userId}` }; return; }
  try { req.wsPrincipal = admitBrowserWs(req, `terminal:${id}`, opts.allowedOrigins ?? new Set()); }
  catch { return reply.code(401).send({ error: "WebSocket admission rejected" }); }
},
```

Di handler, ganti pemasangan interval revalidasi:

```ts
const isClientRemote = req.remote !== undefined;
const watch = isClientRemote ? null : createPrincipalWatch({
  check: () => revalidateWsPrincipal(req, principal), onRevoked: () => socket.close(1008, "session revoked"),
});
// socket.on("message", ...) — ganti `if (!watch.admit()) return;` → `if (watch && !watch.admit()) return;`
const revalidate = isClientRemote ? undefined : setInterval(() => watch!.refresh(), 60_000);
revalidate?.unref?.();
socket.on("close", () => { if (revalidate) clearInterval(revalidate); watch?.dispose(); release(); detach(id, client); });
```

`openWsConnection(principal)` tetap dipanggil apa adanya (plafon 8 koneksi per `kind:id` — dengan
`id` berprefiks `client:` ini otomatis memplafon stream per hub-origin+user, plafon TAMBAHAN yang
tak melanggar plafon 6/4 milik `relay/hub.ts`, murni pertahanan berlapis).

- [ ] **Step 4: Jalankan, pastikan lulus**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/terminal.route.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/terminal.ts server/test/terminal.route.test.ts
git commit -m "feat(spec-1218): admisi WS klien req.remote in-process di /:id/ws, lewati revalidate generik (prasyarat AC-C1-C9)"
```

---

## Task 8: `pty.ts` — `FMT` geometry + `paneGeometry(id)`

**Files:**
- Modify: `server/src/services/pty.ts`
- Modify: `server/src/services/relay/dispatcher.ts` (isi `paneGeometryFor`, TODO Task 6)
- Test: `server/test/pty-parse.test.ts` (berkas kemungkinan sudah ada — cek dulu)

**Interfaces:**
- Produces: `FMT` bertambah `#{pane_width}`/`#{pane_height}` di UJUNG (pola SPEC-919/ADR-0164, tak
  menggeser kolom lama); `paneGeometry(id): {cols, rows} | null` murni dari `listPanes()`.

- [ ] **Step 1: Cari test parser FMT yang ada**

```bash
grep -rln "parsePanes\|FMT" server/test
```

Tambahkan test yang gagal (di berkas yang ditemukan, atau `server/test/pty.test.ts` bila sudah
menguji `listPanes`/parser di sana):

```ts
it("FMT bertambah pane_width/pane_height di ujung, paneGeometry(id) murni dari listPanes (SPEC-1218 · AC-C2)", () => {
  const line = [SESSION_PREFIX + "x", "", "", "", "", "/cwd", "0", "0", "", "", "", "0", "0", "", "0", "", "", "", "", "", "", "80", "24"].join("\t");
  // sesuaikan indeks kolom dengan FMT NYATA sesudah Step 3 — jangan menebak sebelum menjalankan Step 2
  expect(paneGeometry("x")).toEqual({ cols: 80, rows: 24 });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/pty-parse.test.ts
```
Expected: FAIL (`paneGeometry` tak ada, atau kolom FMT tak cocok — sesuaikan test dengan urutan
FMT NYATA yang dibaca dari `pty.ts:352-364` sebelum mengunci assert).

- [ ] **Step 3: Implementasi**

```ts
// pty.ts — FMT (baris 352-364), tambah di UJUNG array (sebelum .join("\t"))
"#{pane_width}", "#{pane_height}",
```

`parsePanes`, tambah destructuring dua field baru di ujung (tanpa menggeser yang lama):

```ts
const [n, projectId, /* … (tak berubah) … */, doneAtBirth, paneWidth, paneHeight] = line.split("\t");
```

Simpan di objek `Pane` (tambah field opsional `width?: number; height?: number;` di tipe `Pane`)
atau langsung ekspor fungsi baru yang membaca ulang `listPanes()`:

```ts
export function paneGeometry(id: string): { cols: number; rows: number } | null {
  const p = listPanes().find((x) => x.id === id) as (Pane & { width?: string; height?: string }) | undefined;
  if (!p?.width || !p?.height) return null;
  const cols = Number(p.width); const rows = Number(p.height);
  return Number.isFinite(cols) && Number.isFinite(rows) ? { cols, rows } : null;
}
```

Di `relay/dispatcher.ts` (Task 6), ganti stub:

```ts
import { paneGeometry } from "../pty";
function paneGeometryFor(path: string): { cols: number; rows: number } | undefined {
  const m = path.match(/^\/api\/terminal\/sessions\/([^/]+)\/ws$/);
  return m ? paneGeometry(m[1]!) ?? undefined : undefined;
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/pty-parse.test.ts server/test/relay-dispatcher.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/pty.ts server/src/services/relay/dispatcher.ts server/test/pty-parse.test.ts
git commit -m "feat(spec-1218): FMT pane_width/pane_height + paneGeometry(id) untuk frame geometry (AC-C2)"
```

---

## Task 9: `services/events.ts` — `attach({groups})` terbatas per-klien

**Files:**
- Modify: `server/src/services/events.ts`
- Test: `server/test/events.test.ts` (berkas sudah ada, tambah `describe`)

**Interfaces:**
- Produces: `attach(c, {maySubscribe?, groups?: Set<EventMsg["t"]>})` — bila `groups` diisi,
  membatasi grup yang dikirim SEGERA (snapshot attach) maupun `broadcast` berikutnya ke anggota
  himpunan itu, **selain** gerbang `cookieOnly` yang sudah ada (dua gerbang, bukan pengganti).

- [ ] **Step 1: Tulis test yang gagal**

```ts
describe("attach({groups}) — grup terbatas (SPEC-1218 · AC-C9)", () => {
  it("groups diisi → hanya grup dalam himpunan yang dikirim saat attach, cookieOnly tetap nol", async () => {
    const sent: any[] = []; const client = { send: (m: string) => sent.push(JSON.parse(m)) };
    await attach(client as any, { maySubscribe: false, groups: new Set(["sessions"]) });
    const types = sent.map((f) => f.t);
    expect(types).toContain("hello");
    expect(types.some((t) => t === "models" || t === "presence")).toBe(false); // cookieOnly
    // grup non-cookieOnly TAPI di luar {sessions} (mis. "board"/"specs") juga tak boleh terkirim
  });

  it("groups tak diisi (undefined) → perilaku lama tak berubah (regresi)", async () => {
    // klien lokal cookie tetap menerima seluruh grup non-cookieOnly seperti sebelumnya
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/events.test.ts
```
Expected: FAIL (TS: `groups` bukan properti opsi `attach`; grup di luar `{sessions}` tetap
terkirim).

- [ ] **Step 3: Implementasi**

```ts
export async function attach(c: Client, o: { maySubscribe?: boolean; groups?: Set<EventMsg["t"]> } = {}): Promise<void> {
  clients.add(c);
  if (o.maySubscribe !== false) cookieClients.add(c);
  if (o.groups) clientGroups.set(c, o.groups); // Map<Client, Set<EventMsg["t"]>> baru, modul-level
  startLoop();
  const topics = o.maySubscribe === false ? [] : TOPIC_NAMES;
  try { c.send(JSON.stringify({ t: "hello", topics } satisfies EventMsg)); } catch { return; }
  for (const g of GROUPS) {
    if (g.cookieOnly && !cookieClients.has(c)) continue;
    let msg: WireMsg; try { msg = await g.build(); } catch { continue; }
    if (o.groups && !o.groups.has(msg.t)) continue;
    try { c.send(JSON.stringify(msg)); } catch { return; }
  }
}

export function detach(c: Client): void {
  clients.delete(c); cookieClients.delete(c); clientGroups.delete(c); dropClientSubs(c);
  if (clients.size === 0) stopLoop();
}
```

`broadcast`, tambah parameter opsional dan filter per-klien (bukan cabang global — beberapa klien
mungkin punya `groups`, sebagian tidak):

```ts
function broadcast(msg: WireMsg, cookieOnly = false): void {
  const s = JSON.stringify(msg);
  for (const c of clients) {
    if (cookieOnly && !cookieClients.has(c)) continue;
    const groups = clientGroups.get(c);
    if (groups && !groups.has(msg.t)) continue;
    sendTo(c, s);
  }
}
```

Tambahkan `const clientGroups = new WeakMap<Client, Set<EventMsg["t"]>>();` dekat `cookieClients`,
dan bersihkan di `__reset()` test-only (`clientGroups` `WeakMap` tak perlu `.clear()` eksplisit,
tapi catat di komentar kenapa aman).

- [ ] **Step 4: Jalankan, pastikan lulus**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/events.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/events.ts server/test/events.test.ts
git commit -m "feat(spec-1218): attach({groups}) membatasi grup broadcast per-klien (AC-C9)"
```

---

## Task 10: `routes/events.ts` (klien) — principal `remote` → `attach({groups})`

**Files:**
- Modify: `server/src/routes/events.ts`
- Test: `server/test/events.route.test.ts` (berkas sudah ada, tambah `describe`)

**Interfaces:**
- Produces: `remoteEventGroups(ideRead: boolean): Set<EventMsg["t"]>` (murni, `["sessions",
  "leadAsks", "cleanups", ...(ideRead ? ["git"] : [])]`); preValidation route ini bertambah cabang
  `req.remote` (pola SAMA Task 7).

- [ ] **Step 1: Tulis test yang gagal**

```ts
describe("/api/events/ws (klien) — principal remote grup terbatas (SPEC-1218 · AC-C9)", () => {
  it("req.remote tanpa ide:read → hanya sessions/leadAsks/cleanups, nol git, nol cookieOnly", async () => {
    // fixture relay-gate.test.ts pola header relay; grant sessions:read (tanpa ide:read)
    // assert lewat injectWS: transkrip frame masuk hanya {t in [hello,sessions,leadAsks,cleanups]}
  });
  it("req.remote DENGAN ide:read → git ikut terkirim", async () => { /* ... */ });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/events.route.test.ts
```
Expected: FAIL (401 tanpa tiket, sama seperti Task 7 sebelum diperbaiki).

- [ ] **Step 3: Implementasi**

```ts
// routes/events.ts
function remoteEventGroups(ideRead: boolean): Set<EventMsg["t"]> {
  return new Set(["sessions", "leadAsks", "cleanups", ...(ideRead ? ["git"] : [])]);
}

preValidation: async (req, reply) => {
  if (req.remote) return; // dites di handler bawah, bukan wsPrincipal — pola sama Task 7
  try { req.wsPrincipal = admitBrowserWs(req, "events", opts.allowedOrigins ?? new Set()); }
  catch { return reply.code(401).send({ error: "WebSocket admission rejected" }); }
},
```

Handler:

```ts
(socket, req) => {
  const client: Client = { send: (m) => socket.send(m), close: () => socket.close() };
  if (req.remote) {
    const ideRead = req.remote.capabilities.includes("ide:read");
    void attach(client, { maySubscribe: false, groups: remoteEventGroups(ideRead) });
    socket.on("close", () => detach(client));
    return; // principal remote tak butuh openWsConnection/revalidate generik — pola sama Task 7
  }
  const principal = req.wsPrincipal!;
  // ... (kode lama tak berubah)
}
```

- [ ] **Step 4: Jalankan, pastikan lulus**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/events.route.test.ts
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/events.ts server/test/events.route.test.ts
git commit -m "feat(spec-1218): principal remote /events/ws klien → attach groups terbatas (AC-C9)"
```

---

## Task 11: Frontend — `TerminalPane` mode `"remote"`

**Files:**
- Modify: `src/src/screens/TerminalPane.tsx`
- Test: `src/test/terminal-pane-remote.test.tsx` (baru)

**Interfaces:**
- Produces: prop baru `mode?: "local" | "remote"` (default `"local"`, 100% pemanggil lama tak
  berubah bentuk); remote: `connect()` (baris 230) memakai `useApi()`/`useWsTarget()` untuk
  tiket+URL alih-alih `api.issueWsTicket`+`paths.terminalWs`+`location.host`; TIGA titik `send({t:
  "resize", ...})` (baris 260, 494, 541/554) dipagari `mode !== "remote"`; frame masuk baru
  `t==="geometry"` (di `onmessage`, baris 266) memanggil `term.resize(f.cols, f.rows)`; tanpa
  `sessions:write` di `capabilities` → `onData`/`sendKey` tak terpasang + `showKeys` disembunyikan.

- [ ] **Step 1: Tulis test yang gagal**

```tsx
// src/test/terminal-pane-remote.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { TerminalPane } from "../src/screens/TerminalPane";
import { InstanceProvider } from "../src/api/instance";

const remoteInstance = { kind: "remote" as const, deviceId: "dev1", name: "laptop", version: "0.5.0", protocol: 1, capabilities: ["sessions:read"] as const };

describe("TerminalPane mode=remote (SPEC-1218 · AC-C2/AC-C3)", () => {
  it("resize kontainer tak pernah mengirim frame resize", () => {
    const sendSpy = vi.fn();
    // mock WebSocket global agar send terekam sendSpy; trigger ResizeObserver callback
    render(<InstanceProvider value={remoteInstance}><TerminalPane sessionId="s1" onExit={() => {}} mode="remote" /></InstanceProvider>);
    // ... resize kontainer, assert sendSpy tak pernah menerima {t:"resize"}
  });

  it("frame geometry masuk → term.resize(cols, rows), fit dilewati", () => { /* ... */ });

  it("tanpa sessions:write → tak ada TerminalComposer/TerminalKeys dirender walau showKeys=true", () => {
    render(<InstanceProvider value={remoteInstance}><TerminalPane sessionId="s1" onExit={() => {}} mode="remote" showKeys /></InstanceProvider>);
    // assert getByTestId untuk composer/keys TIDAK ada
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism src/test/terminal-pane-remote.test.tsx
```
Expected: FAIL (prop `mode` tak dikenal, resize tetap terkirim).

- [ ] **Step 3: Implementasi**

Tambah import `useApi, useWsTarget, useInstance` dari `../api/instance`; prop `mode = "local"`.

`connect()` (baris 230-235), cabang:

```ts
const connect = () => {
  const ticketPromise = mode === "remote"
    ? apiHook.issueWsTicket(wsTarget!.ticketTarget as any).then((r) => ({ ticket: r.ticket, url: wsTarget!.url }))
    : api.issueWsTicket(`terminal:${sessionId}`).then((r) => ({ ticket: r.ticket, url: `${scheme}//${location.host}${paths.terminalWs(sessionId)}` }));
  void ticketPromise.then(({ ticket, url }) => {
    if (disposed) return;
    const scheme2 = url.startsWith("/") ? (location.protocol === "https:" ? "wss:" : "ws:") : "";
    const socket = new WebSocket(url.startsWith("/") ? `${scheme2}//${location.host}${url}` : url, [`hanoman-ticket.${ticket}`]);
    // ... sisanya tak berubah
  });
};
```

(`wsTarget = mode === "remote" ? useWsTarget(`terminal:${sessionId}`) : null` dipanggil di level
komponen, bukan di dalam effect — hooks tak boleh dipanggil kondisional; deklarasikan di atas
`React.useEffect` yang memuat `connect`.)

Tiga titik `send({t:"resize",...})` (260/494/541/554): pagari

```ts
if (mode !== "remote") send({ t: "resize", cols: term.cols, rows: term.rows });
```

`onmessage` (baris 266-317), tambah cabang SEBELUM `else if (f.t === "ack")`:

```ts
else if (f.t === "geometry" && typeof f.cols === "number" && typeof f.rows === "number") {
  term.resize(f.cols, f.rows); // langsung, BUKAN lewat fit.fit()
}
```

Read-only gating: `term.onData(onTyped)` (baris 391) — pagari dengan
`capabilities.includes("sessions:write") || mode !== "remote"` di sekitar pemasangan `typed`; JSX
`showKeys && <TerminalComposer .../>`/`<TerminalKeys .../>` (baris 593/595) tambah kondisi
`(mode !== "remote" || instance.capabilities.includes("sessions:write"))`.

Close `4009` — `socket.onclose` (baris 319) sudah memanggil `retry()` untuk kode selain `4004`;
`4009` **sudah** jatuh ke `retry()` existing (baris 335) tanpa perubahan — verifikasi ini sebagai
bagian test Step 4, JANGAN tambahkan cabang kode baru untuk `4009` bila `retry()` sudah menutupnya.

- [ ] **Step 4: Jalankan test, pastikan lulus**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism src/test/terminal-pane-remote.test.tsx src/test/terminal-pane.test.tsx
```
Expected: PASS (keduanya — mode lokal tak boleh regresi).

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/TerminalPane.tsx src/test/terminal-pane-remote.test.tsx
git commit -m "feat(spec-1218): TerminalPane mode=remote — buang resize, geometry→resize, baca-saja (AC-C1/C2/C3/C7)"
```

---

## Task 12: `SpecDocsModal.tsx` → `useApi()`

**Files:**
- Modify: `src/src/screens/SpecDocsModal.tsx`
- Test: `src/test/spec-docs-modal-remote.test.tsx` (baru, atau tambah ke test `SpecDocsModal` yang
  ada bila ditemukan — `grep -rl "SpecDocsModal" src/test`)

**Interfaces:**
- Produces: `import { useApi } from "../api/instance"` menggantikan `import { api } from
  "../api/client"`; `const api = useApi();` di dalam komponen (nama lokal sama, nol perubahan
  pemanggilan `api.getSpecDocs`/`api.getSpecDocFile`/`api.specDocDownloadUrl` di bawahnya).

- [ ] **Step 1: Tulis test yang gagal**

```tsx
it("dalam InstanceContext remote, SpecDocsModal memanggil api instance remote (base /api/devices/:id/relay), bukan api singleton lokal (AC-C1)", () => {
  const spy = vi.fn().mockResolvedValue({ files: [] });
  // mock createApi agar instance remote punya getSpecDocs = spy; render dalam InstanceProvider kind="remote"
  // assert spy terpanggil, api singleton lokal TIDAK
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism src/test/spec-docs-modal-remote.test.tsx
```
Expected: FAIL (komponen selalu memakai singleton `api` lokal).

- [ ] **Step 3: Implementasi**

```tsx
import { useApi } from "../api/instance";
// ganti: import { api, type SpecDoc } from "../api/client";
import { type SpecDoc } from "../api/client";

export function SpecDocsModal({ specId, onClose }: { specId: string; onClose: () => void }) {
  const api = useApi();
  // sisanya identik — setiap `api.getSpecDocs`/`api.getSpecDocFile`/`api.specDocDownloadUrl` tak berubah
```

Tak ada aksi tulis di komponen ini sama sekali (murni baca) — tak ada yang perlu disembunyikan
untuk mode remote (AC-C1 memang tak menuntut itu untuk dokumen).

- [ ] **Step 4: Jalankan, pastikan lulus**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism src/test/spec-docs-modal-remote.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/SpecDocsModal.tsx src/test/spec-docs-modal-remote.test.tsx
git commit -m "feat(spec-1218): SpecDocsModal pakai useApi() untuk mode remote (AC-C1)"
```

---

## Task 13: `IdeReadPanel.tsx` (baru) — subset baca `IdeScreen.tsx`

**Files:**
- Create: `src/src/screens/IdeReadPanel.tsx`
- Test: `src/test/ide-read-panel.test.tsx` (baru)

**Interfaces:**
- Produces: `IdeReadPanel({projectId}: {projectId: string})` — `useApi()` untuk
  `ideTree`/`ideFile`/`ideWorkingStatus`/`ideFileDiff`/`ideGit(op:"graph"|"compare"|...)`; TANPA
  tombol tulis/commit/rename/delete/upload/remote-add.

- [ ] **Step 1: Tulis test yang gagal**

```tsx
it("IdeReadPanel merender tree+file+workingStatus dari useApi(), nol tombol tulis (AC-C1)", () => {
  // render dalam InstanceProvider kind="remote"; assert queryByRole("button", {name: /commit|hapus|rename|unggah/i}) === null
  // assert api.ideTree/ideFile/ideWorkingStatus terpanggil (via mock useApi)
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism src/test/ide-read-panel.test.tsx
```
Expected: FAIL (modul belum ada).

- [ ] **Step 3: Implementasi**

Salin kerangka baca `IdeScreen.tsx` (tree/file/workingStatus/fileDiff/graph/compare — baris
144-186/204 area query saja, BUKAN `runGit`/`api.putIdeFile`/`api.ideCreateEntry`/
`api.ideUpload`/`api.ideRenameEntry`/`api.ideDeleteEntry`/remote add-delete), ganti `import { api }
from "../api/client"` dengan `useApi()` dari `../api/instance`, dan hapus SELURUH tombol/handler
tulis serta import `RemoteManager`-nya (baris 60-90 area). Struktur: tree kiri (baca), preview
berkas kanan (MarkdownView/diff read-only), tab "Graph"/"Compare" baca. Tak ada `DocDownload` aksi
tulis — unduhan review tetap di luar (ADR-0165 §5), TAPI unduhan FILE IDE baca (`ideFileDownloadUrl`)
boleh tetap ada karena termasuk permukaan `GET` yang di-allowlist (`shared/src/relay.ts:154-155`).

- [ ] **Step 4: Jalankan test, pastikan lulus**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism src/test/ide-read-panel.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/IdeReadPanel.tsx src/test/ide-read-panel.test.tsx
git commit -m "feat(spec-1218): IdeReadPanel — subset baca IdeScreen via useApi() (AC-C1)"
```

---

## Task 14: `PresenceView.hubVersion` (aditif) — prasyarat `RemoteBanner`

**Files:**
- Modify: `shared/src/presence.ts` (`PresenceView` bertambah `hubVersion: string`)
- Modify: berkas yang membangun `PresenceView` di server (cari via `grep -rn "enabled:.*devices:"
  server/src/services/presence` — kemungkinan `presence/view.ts`)
- Test: berkas test `presenceView`/`presence/view` yang sudah ada

**Interfaces:**
- Produces: `PresenceView.hubVersion: string` = `runningVersion()` (server/src/services/update.ts,
  sudah ada, diimpor `relay/hub.ts`/`relay/client.ts` — pola sama).
- **Koreksi dicatat di Global Constraints:** menggantikan asumsi spec teknis §T7 `api.getUpdateStatus()`
  yang tak ada di `src/src/api/client.ts`.

- [ ] **Step 1: Cari fungsi pembangun `PresenceView` nyata**

```bash
grep -rln "PresenceView\b" server/src/services | grep -v test
```

- [ ] **Step 2: Tulis test yang gagal**

```ts
it("presenceView() menyertakan hubVersion = runningVersion() (SPEC-1218 · prasyarat RemoteBanner)", async () => {
  const v = await presenceView();
  expect(v.hubVersion).toEqual(expect.any(String));
});
```

- [ ] **Step 3: Jalankan, pastikan gagal**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/<berkas-ditemukan-Step-1>
```
Expected: FAIL (`hubVersion` undefined).

- [ ] **Step 4: Implementasi**

```ts
// shared/src/presence.ts
export type PresenceView = {
  enabled: boolean;
  devices: PresenceDeviceView[];
  hubVersion: string; // SPEC-1218 · versi instance INI, dibaca RemoteBanner untuk banding versi klien
};
```

Di pembangun server (`presence/view.ts` atau setara): `import { runningVersion } from
"../update";` lalu `return { enabled, devices, hubVersion: runningVersion() };`.

- [ ] **Step 5: Jalankan test, pastikan lulus**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism server/test/<berkas-ditemukan-Step-1> server/test/events.route.test.ts
```
Expected: PASS (`events.route.test.ts` yang menguji frame `presence` — pastikan tak regresi bentuk
frame lama, `hubVersion` aditif).

- [ ] **Step 6: Commit**

```bash
git add shared/src/presence.ts server/src/services/presence/*.ts
git commit -m "feat(spec-1218): PresenceView.hubVersion aditif, prasyarat RemoteBanner (koreksi atas api.getUpdateStatus yang tak ada)"
```

---

## Task 15: `RemoteBanner.tsx` + `RemoteInstanceView.tsx` (baru)

**Files:**
- Create: `src/src/screens/RemoteBanner.tsx`
- Create: `src/src/screens/RemoteInstanceView.tsx`
- Test: `src/test/remote-instance-view.test.tsx` (baru)

**Interfaces:**
- Produces: `RemoteBanner({device, hubVersion}: {device: PresenceDeviceView; hubVersion: string})`
  — banner "Sedang melihat klien X · vN" + badge baca-saja + peringatan bila
  `device.control!.version !== hubVersion`.
- `RemoteInstanceView({device, hubVersion, onClose}: {...})` — gate `device.control?.state ===
  "protocol-mismatch"` SEBELUM render apa pun (AC-C7); else `InstanceProvider` `kind:"remote"` +
  `Tabs` Terminal/Dokumen/IDE → `TerminalPane mode="remote"`/`SpecDocsModal`/`IdeReadPanel`.

- [ ] **Step 1: Tulis test yang gagal**

```tsx
describe("RemoteInstanceView (SPEC-1218 · AC-C1/AC-C7)", () => {
  it("control.state protocol-mismatch → gate error, TerminalPane/SpecDocsModal tak dirender", () => {
    const device = { deviceId: "d1", name: "laptop", control: { state: "protocol-mismatch", protocol: 2, version: "0.6.0", capabilities: [], since: "" } } as any;
    render(<RemoteInstanceView device={device} hubVersion="0.5.0" onClose={() => {}} />);
    expect(screen.getByText(/versi protokol tak cocok/i)).toBeInTheDocument();
    expect(screen.queryByTestId("terminal-link")).not.toBeInTheDocument();
  });

  it("control.version beda, protokol sama → banner peringatan versi, tampilan tetap terbuka", () => {
    const device = { deviceId: "d1", name: "laptop", control: { state: "available", protocol: 1, version: "0.6.0", capabilities: ["sessions:read"], since: "" } } as any;
    render(<RemoteInstanceView device={device} hubVersion="0.5.0" onClose={() => {}} />);
    expect(screen.getByTestId("remote-banner")).toHaveTextContent(/berbeda/);
  });

  it("identitas modul: TerminalPane dalam RemoteInstanceView adalah IMPORT YANG SAMA dengan layar lokal (AC-C1)", () => {
    // import * as Local from "../src/screens/TerminalPane"; import * as ViaRemote (re-export dari RemoteInstanceView module graph)
    // assert Local.TerminalPane === (fungsi yang sama dipakai RemoteInstanceView) — dicek lewat module resolution, bukan snapshot teks
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism src/test/remote-instance-view.test.tsx
```
Expected: FAIL (modul belum ada).

- [ ] **Step 3: Implementasi**

```tsx
// RemoteBanner.tsx
import { Badge } from "../ds";
import type { PresenceDeviceView } from "@hanoman/shared";

export function RemoteBanner({ device, hubVersion, onClose }:
  { device: PresenceDeviceView; hubVersion: string; onClose?: () => void }) {
  const mismatchVersion = device.control!.version !== hubVersion;
  return (
    <div role="status" data-testid="remote-banner" style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px" }}>
      <span>Sedang melihat klien {device.name} · v{device.control!.version}</span>
      <Badge tone="neutral" size="sm">baca-saja</Badge>
      {mismatchVersion && <Badge tone="warn" size="sm">versi hub berbeda dari klien</Badge>}
      {onClose && <button type="button" onClick={onClose}>Tutup</button>}
    </div>
  );
}
```

```tsx
// RemoteInstanceView.tsx
import React from "react";
import { StateBlock } from "../ds";
import { Tabs } from "../ds/components/ui";
import { InstanceProvider, type Instance } from "../api/instance";
import { RemoteBanner } from "./RemoteBanner";
import { TerminalPane } from "./TerminalPane";
import { SpecDocsModal } from "./SpecDocsModal";
import { IdeReadPanel } from "./IdeReadPanel";
import type { PresenceDeviceView } from "@hanoman/shared";

export function RemoteInstanceView({ device, hubVersion, sessionId, projectId, onClose }: {
  device: PresenceDeviceView; hubVersion: string; sessionId?: string; projectId?: string; onClose: () => void;
}) {
  if (device.control?.state === "protocol-mismatch")
    return <StateBlock kind="error" title="Versi protokol tak cocok"
      hint={`${device.name} · protokol ${device.control.protocol}`} />;
  if (!device.control) return <StateBlock kind="empty" title="Kendali jarak jauh tak tersedia" hint={device.name} />;
  const instance: Instance = { kind: "remote", deviceId: device.deviceId, name: device.name,
    version: device.control.version, protocol: device.control.protocol, capabilities: device.control.capabilities };
  const [tab, setTab] = React.useState<"terminal" | "docs" | "ide">("terminal");
  return (
    <InstanceProvider value={instance}>
      <RemoteBanner device={device} hubVersion={hubVersion} onClose={onClose} />
      <Tabs variant="pill" tabs={[{ value: "terminal", label: "Terminal" }, { value: "docs", label: "Dokumen" }, { value: "ide", label: "IDE" }]}
        value={tab} onChange={(v) => setTab(v as typeof tab)} />
      {tab === "terminal" && sessionId && <TerminalPane sessionId={sessionId} mode="remote" onExit={() => {}} />}
      {tab === "docs" && sessionId && <SpecDocsModal specId={sessionId} onClose={() => setTab("terminal")} />}
      {tab === "ide" && projectId && <IdeReadPanel projectId={projectId} />}
    </InstanceProvider>
  );
}
```

(Sesuaikan `sessionId`/`projectId` yang dibutuhkan tab masing-masing dengan data yang benar-benar
tersedia di `PresenceDeviceView.sessions[]` saat Task 16 memanggilnya dari `ClientsScreen` — kalau
device tak punya sesi aktif, tab Terminal/Dokumen menampilkan `StateBlock` kosong, bukan crash.)

- [ ] **Step 4: Jalankan test, pastikan lulus**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism src/test/remote-instance-view.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/RemoteBanner.tsx src/src/screens/RemoteInstanceView.tsx src/test/remote-instance-view.test.tsx
git commit -m "feat(spec-1218): RemoteInstanceView + RemoteBanner — gate protocol, tabs Terminal/Dokumen/IDE (AC-C1/C7)"
```

---

## Task 16: `ClientsScreen.tsx` — tombol "Buka" → `RemoteInstanceView`

**Files:**
- Modify: `src/src/screens/ClientsScreen.tsx`
- Test: `src/test/clients-screen.test.tsx` (cari — kemungkinan sudah ada, cek `grep -rl
  "ClientsScreen" src/test`)

**Interfaces:**
- Produces: `DeviceCard` bertambah tombol "Buka" → membuka `RemoteInstanceView` (state lokal
  `openDevice` di `ClientsScreen`); disabled + alasan bila `d.control?.state ===
  "protocol-mismatch"` atau `!d.control` (grant mati/offline).

- [ ] **Step 1: Cari test file yang ada**

```bash
grep -rl "ClientsScreen" src/test
```

Tambahkan test yang gagal:

```tsx
it("tombol Buka merender RemoteInstanceView untuk device dengan control tersedia (AC-C1)", () => {
  const view = { enabled: true, hubVersion: "0.5.0", devices: [{ deviceId: "d1", name: "laptop", local: false, online: true, lastSeenAt: null, sessions: [], control: { state: "available", protocol: 1, version: "0.5.0", capabilities: ["sessions:read"], since: "" } }] };
  render(<ClientsScreen view={view} specTitles={{}} onOpenSpec={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: /buka/i }));
  expect(screen.getByTestId("remote-banner")).toBeInTheDocument();
});

it("device control.state protocol-mismatch → tombol Buka disabled dengan alasan (AC-C7)", () => {
  // ...
  expect(screen.getByRole("button", { name: /buka/i })).toBeDisabled();
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism src/test/clients-screen.test.tsx
```
Expected: FAIL (tombol "Buka" tak ada).

- [ ] **Step 3: Implementasi**

```tsx
// ClientsScreen.tsx
import { RemoteInstanceView } from "./RemoteInstanceView";

function DeviceCard({ d, specTitles, onOpenSpec, now, onOpenRemote }: { /* + onOpenRemote: (d: PresenceDeviceView) => void */ }) {
  const mismatch = d.control?.state === "protocol-mismatch";
  return (
    <Card>
      {/* header tak berubah */}
      {!d.local && (
        <Button size="sm" disabled={mismatch || !d.control}
          onClick={() => onOpenRemote(d)}
          title={mismatch ? "Versi protokol tak cocok" : !d.control ? "Kendali jarak jauh tak menyala di klien ini" : undefined}>
          Buka
        </Button>
      )}
      {/* sisanya tak berubah */}
    </Card>
  );
}

export function ClientsScreen({ view, specTitles, onOpenSpec }: { ... }) {
  const [openDevice, setOpenDevice] = React.useState<PresenceDeviceView | null>(null);
  // ...
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {openDevice ? (
        <RemoteInstanceView device={openDevice} hubVersion={view.hubVersion}
          sessionId={openDevice.sessions[0]?.sessionId} onClose={() => setOpenDevice(null)} />
      ) : (
        <>{/* tabs + daftar device seperti sekarang, DeviceCard menerima onOpenRemote={setOpenDevice} */}</>
      )}
    </div>
  );
}
```

Perbarui komentar berkas baris 9-11 ("Tak ada isi terminal di sini … sengaja di luar lingkup") —
itu sudah basi sesudah C mendarat, ganti dengan catatan bahwa mirror terminal kini ADA lewat
`RemoteInstanceView` (dicatat juga di Task 17 docs, tapi kode diperbarui di SINI, commit yang sama).

- [ ] **Step 4: Jalankan test, pastikan lulus**

```bash
env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run --no-file-parallelism src/test/clients-screen.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/ClientsScreen.tsx src/test/clients-screen.test.tsx
git commit -m "feat(spec-1218): ClientsScreen tombol Buka → RemoteInstanceView, disabled protocol-mismatch (AC-C1/C7)"
```

---

## Task 17: Pengukuran Mac mini 8 GB (AC-C10)

**Files:**
- Create: `server/scripts/relay-8gb-measurement.ts` (pola `server/scripts/log-ingest-benchmark.ts`
  SPEC-1217, verifikasi nama file nyata dulu: `ls server/scripts/`)
- Create/append: `docs/superpowers/plans/2026-09-18-spec-1218-ac-c10-hasil-pengukuran.md` (pola
  `2026-09-18-spec-1217-ac-s9-hasil-pengukuran.md`)

**Interfaces:**
- Produces: skrip yang membuka 4 stream terminal ber-RTT 200 ms (simulasi lewat proxy/latency
  injector atau dua proses lokal dengan `tc`/sekadar `setTimeout` di socket palsu — tentukan
  metode konkret saat menulis skrip; catat metode yang dipakai di hasil, jangan diam-diam berbeda
  dari 200 ms yang diminta S0b), mencatat `process.cpuUsage()`/`process.memoryUsage().rss`/
  `bufferedAmount` per detik per stream, selama durasi tetap (mulai 60 dtk verifikasi cepat, lalu
  run penuh 10 menit sebagai langkah manusia terpisah — pola SPEC-1217 AC-S9 yang sudah membedakan
  run cepat vs run penuh).

- [ ] **Step 1: Cari pola skrip preseden**

```bash
ls server/scripts/ 2>/dev/null; cat docs/superpowers/plans/2026-09-18-spec-1217-ac-s9-hasil-pengukuran.md | head -40
```

- [ ] **Step 2: Tulis skrip**

Struktur mengikuti preseden AC-S9: boot server sungguhan (`node server/dist/server.js` atau
`tsx server/src/server.ts`) di HANOMAN_HOME terpisah, buka 4 koneksi `injectWS`/WebSocket nyata ke
`/api/terminal/sessions/:id/ws` (bukan mock), suntik RTT via delay buatan pada relay/dispatcher
test harness atau proxy TCP sederhana, cetak CSV per detik: `t,stream,cpuUserMs,cpuSysMs,rssMB,
bufferedAmount`.

- [ ] **Step 3: Jalankan run singkat verifikasi (60 dtk) DI MESIN NYATA (bukan CI)**

```bash
node --loader tsx server/scripts/relay-8gb-measurement.ts --duration 60 --streams 4 --rtt 200
```
Expected: skrip selesai, CSV tercatat, nol crash.

- [ ] **Step 4: Jalankan run penuh (10 menit) di Mac mini 8 GB — LANGKAH MANUSIA**

Catat di `docs/superpowers/plans/2026-09-18-spec-1218-ac-c10-hasil-pengukuran.md`: angka CPU/RSS
puncak & rata-rata, `bufferedAmount` maksimum teramati, apakah plafon S0b (6 stream/4 inflight/
256 KiB kredit/64 KiB refill/1 MiB bufferedAmount/32 KiB per frame/12.000 frame-menit) dilanggar.
Bila dilanggar, amandemen `internal/docs/adr/0165-*.md` §10 dengan angka baru + alasan (Task 18);
bila tidak, catat "plafon awal S0b lulus pengukuran 8 GB, tak diamandemen" — TETAP tercatat, bukan
diklaim tanpa berkas hasil.

- [ ] **Step 5: Commit**

```bash
git add server/scripts/relay-8gb-measurement.ts docs/superpowers/plans/2026-09-18-spec-1218-ac-c10-hasil-pengukuran.md
git commit -m "feat(spec-1218): skrip pengukuran 4 stream/RTT 200ms + hasil Mac mini 8GB (AC-C10)"
```

---

## Task 18: Docs — cabut penanda DIRANCANG, api-contract.md, ADR-0165, stack.md, README.md, smoke manual

**Files:**
- Modify: `internal/docs/frontend/frontend-implementation.md:52`
- Modify: `internal/docs/architecture/api-contract.md`
- Modify: `internal/docs/adr/0165-kendali-jarak-jauh-hub-lewat-socket-relay.md`
- Modify: `internal/docs/architecture/stack.md`
- Modify: `internal/docs/README.md`

- [ ] **Step 1: Cabut penanda DIRANCANG**

```bash
grep -n "DIRANCANG untuk SPEC-1218" internal/docs/frontend/frontend-implementation.md
```

Ganti kalimat itu (SC11) menjadi pernyataan bahwa turunan C (stream, resize, backpressure §S10)
sudah mendarat.

- [ ] **Step 2: `api-contract.md` — `wsHandler` + tiket relay**

Tambahkan entri: route `/api/devices/:deviceId/relay/*` kini juga `wsHandler` (upgrade), target
tiket `relay:<deviceId>:events|terminal:<id>` khusus `req.user`.

- [ ] **Step 3: ADR-0165 — mendarat, hasil pengukuran, catatan desain `revalidateWsPrincipal`**

Ganti header "**Menyusul:** stream, resize, dan §10 backpressure di SPEC-1218 (turunan C)" menjadi
"**Turunan C mendarat** (SPEC-1218): §2 stream `open`/`data`/`credit`/`geometry`/`close` via
`injectWS`, §6 grup `/events/ws` terbatas, §10 backpressure — plafon awal [lulus pengukuran /
diamandemen jadi X] (Task 17)." Tambahkan sub-catatan di §3 (principal `remote`) yang membedakan
penggunaan HUB-side (`admitBrowserWs`/`relayControlFor`, Task 2/4) dari klien-side (`req.remote`
in-process, Task 7/10) — dua mekanisme berbeda di bawah kata "remote" yang sama, supaya pembaca
ADR di masa depan tak menyangka satu fungsi generik menutup keduanya.

- [ ] **Step 4: `stack.md` — penanda turunan**

Perbarui diagram/prosa "A only, B/C/D menyusul" jadi "A/B/C/D mendarat".

- [ ] **Step 5: Tautkan di `internal/docs/README.md`**

Tambah baris plan (pola baris 27/30 yang sudah ada untuk SPEC-1216/1217) sesudah baris rancangan
SPEC-1218 (baris 28 sudah ada):

```markdown
- [plan SPEC-1218 turunan C — tampilan identik lewat stream relay](../../docs/superpowers/plans/2026-09-18-spec-1218-tampilan-identik-turunan-c-plan.md) — 18 task TDD menurunkan §T1–§T12 spec di atas: tiket `relay:<deviceId>:…` (T1), `WsPrincipal` remote HUB-side + admitBrowserWs/revalidateWsPrincipal (T2), peta stream/kredit/plafon `relay/hub.ts` (T3), `wsHandler` `devices-relay.ts` (T4), `InjectableApp.injectWS` (T5), dispatcher jalur `open` via `injectWS({onOpen})` (T6), admisi WS klien `req.remote` in-process — dibedakan dari kind "remote" HUB-side untuk menghindari `revalidateWsPrincipal` menutup stream palsu (T7), `pty.ts` geometry (T8), `events.ts` grup terbatas (T9-T10), `TerminalPane`/`SpecDocsModal`/`IdeReadPanel` mode remote (T11-T13), `PresenceView.hubVersion` aditif menggantikan `api.getUpdateStatus()` yang tak ada (T14), `RemoteBanner`/`RemoteInstanceView` (T15), tombol Buka `ClientsScreen` (T16), pengukuran Mac mini 8 GB (T17), dan docs (T18).
```

- [ ] **Step 6: `git grep` untuk memastikan tak ada sisa penanda**

```bash
git grep -n "DIRANCANG.*SPEC-1218\|SPEC-1218.*DIRANCANG" -- internal/docs/
```
Expected: nol hasil.

- [ ] **Step 7: Smoke manual — dua instance nyata (bukan mock)**

Dua `HANOMAN_HOME`, dua port, hub + klien beneran (pola smoke turunan A/B): grant `sessions:read`
di klien → dari hub buka `ClientsScreen` → tombol "Buka" → `RemoteInstanceView` → buktikan
`TerminalPane` menerima keluaran live tmux nyata, tak mengirim `resize` (DevTools Network WS
frames), dan `RemoteBanner` menolak render saat protokol klien sengaja dibedakan (matikan
`RELAY_PROTOCOL` sementara di satu sisi, rebuild, buktikan gate `AC-C7` menolak). Catat hasil
smoke (lulus/gagal + apa yang diperbaiki) di pesan commit Step 8 — bukan diklaim tanpa dijalankan.

- [ ] **Step 8: Commit BERSAMA (atau segera sesudah) commit kode terkait**

```bash
git add internal/docs/ server/scripts/ docs/superpowers/plans/2026-09-18-spec-1218-ac-c10-hasil-pengukuran.md
git commit -m "docs(spec-1218): cabut penanda DIRANCANG turunan C, api-contract/ADR-0165/stack.md, smoke manual (SC11)"
```

---

## Self-review (dicatat, sudah dijalankan penulis plan)

- **Cakupan AC:** C1 (Task 4/11/12/13/15/16), C2 (Task 3/6/8/11), C3 (Task 3/6/11), C4 (Task 3),
  C5 (Task 3/4), C6 (Task 3/4), C7 (Task 15/16), C8 (Task 6), C9 (Task 9/10), C10 (Task 17), SC11
  (Task 16 komentar berkas + Task 18 docs).
- **Tiga koreksi ditemukan menulis plan ini (bukan tebakan):** `InjectableApp` tak punya `injectWS`
  sebelum Task 5 (diverifikasi `grep` nol hasil); WS route klien menuntut tiket via `admitBrowserWs`
  sehingga `injectWS` dispatcher butuh jalur admisi baru berbasis `req.remote` in-process, BUKAN
  `WsPrincipal` kind `"remote"` HUB-side yang sama (risiko nyata: memakainya akan memanggil
  `relayControlFor(id)` yang selalu `null` di mesin klien, menutup setiap stream 60 dtk sesudah
  dibuka — dianalisis penuh di Task 7); `api.getUpdateStatus()` yang disebut spec teknis §T7 tak
  ada di `src/src/api/client.ts` (Task 14 menggantinya dengan `PresenceView.hubVersion` aditif).
- **Placeholder:** dua TODO sengaja ditinggal SATU task (Task 1 cast `as any` sementara → ditutup
  Task 2 Step 3; Task 6 `paneGeometryFor` stub → ditutup Task 8 Step 3) — keduanya ditutup di task
  yang eksplisit disebutkan, bukan dibiarkan sampai akhir plan.
- **Konsistensi tipe:** `StreamState`/`openStream`/`closeStream` (Task 3) dipakai identik oleh Task
  4 (`devices-relay.ts`); `InjectableApp.injectWS` (Task 5) dipakai identik Task 6; `paneGeometry`
  (Task 8) dipakai identik dispatcher (Task 6 lanjutan); `remoteEventGroups` (Task 10) murni dan
  diuji tabel positif+negatif (dengan/tanpa `ide:read`); `Instance`/`InstanceProvider` (sudah ada,
  turunan B) dipakai identik Task 11-16 tanpa modifikasi tipenya.

## Execution Handoff

Plan tersimpan di
`docs/superpowers/plans/2026-09-18-spec-1218-tampilan-identik-turunan-c-plan.md`. Dua opsi eksekusi:
1. **Subagent-Driven (disarankan)** — subagent segar per task, review dua tahap antar-task; Task
  1-10 (backend) sebelum Task 11-16 (frontend) karena dependensi teknis searah.
2. **Inline Execution** — eksekusi batch dalam sesi ini dengan checkpoint review, jalankan Task 17
  (pengukuran 8 GB) dan Task 18 Step 7 (smoke manual) di mesin nyata sebelum menutup Execute.
