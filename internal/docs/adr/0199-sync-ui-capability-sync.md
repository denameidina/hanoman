# ADR-0199 — Permukaan UI sync dibuka lewat capability `sync:*`; kanal mesin-ke-mesin tetap tertutup

Tanggal: 2026-10-11
Status: diterima (permintaan pemilik repo)
SPEC: —
**Mengamandemen ADR-0066** (`POST /sync/now` cookie-only), **ADR-0067** (antrean konflik cookie-only), **ADR-0119** (`GET /sync/pending` cookie-only) dan bagian `sync` dari **ADR-0065/0099**
Terkait: ADR-0044/0046 (sync mesin-ke-mesin ber-device-token) · ADR-0155 (akses `danger`) · ADR-0165 (relay) · ADR-0200 (operasi instance)

## Konteks

`capabilityForRoute` memetakan SELURUH prefix `/api/sync` ke `COOKIE_ONLY`. Penyebabnya benar untuk
sebagian besar isinya, tetapi prefix itu mencampur dua hal yang sifatnya berlawanan:

1. **Tiga permukaan UI** yang dipanggil dashboard dengan cookie manusia: `POST /sync/now` (tombol sync
   manual, SPEC-268), `GET /sync/conflicts` + `POST /sync/conflicts/:entity/:recordId/resolve` (modal
   rekonsil, SPEC-270) dan `GET /sync/pending` (umpan balik hapus-tertunda, SPEC-799). Mereka ber-cookie
   hanya karena prefixnya, bukan karena kredensialnya.
2. **Kanal mesin-ke-mesin** — `pull`, `bootstrap`, `push`, `logs`, `attachments/:key`,
   `qa-attachments/:id` (GET/PUT), `ws`, `relay/ws` — yang auth-nya **Bearer device-token** (atau tiket
   WS) dan ditegakkan route-nya sendiri; `app.ts` sengaja mem-bypass gerbang cookie untuknya.

Pemilik repo meminta permukaan (1) dibungkus jadi tool MCP.

## Keputusan

1. **Dua capability baru yang opt-in** (tak ikut default, tak diwarisi capability lama), domain `sync`:
   - `sync:read` — `GET /sync/conflicts`, `GET /sync/pending`.
   - `sync:write` — `POST /sync/now` (siklus sync manual; `full:true` = tarik ulang dari kursor 0).
   - `sync:resolve` (akses **`danger`**, `risk: "data"`) — `POST /sync/conflicts/:entity/:recordId/resolve`.
   `write` mengimplikasikan `read` seperti domain lain; **`sync:write` tidak mengimplikasikan
   `sync:resolve`** (`grantsCapability` sudah menjamin: akses `danger` hanya dipenuhi dirinya sendiri).
   Memutuskan konflik MEMBUANG data satu sisi tanpa jalan pulang (`local` menimpa hub, `server` membuang
   edit lokal) — itu bukan "menulis lebih banyak", jadi dipisah, mengikuti logika ADR-0155. Ini lebih
   ketat dari bunyi permintaan awal ("`sync:read|write`, resolve = danger"): resolve diberi capability
   sendiri, bukan hanya tool bermode `danger`, karena mode CLI bukan kontrol keamanan (ADR-0155).
2. **Pemetaan dicocokkan ke method + PANJANG segmen persis**, bukan prefix (kelas bug SPEC-405).
   `GET /sync/now`, `POST /sync/pending`, `POST /sync/conflicts`, `GET …/resolve`, dan semua path lain di
   bawah `/sync/*` tetap `COOKIE_ONLY`. Tes `agent-capabilities.test.ts` mengunci tiap tetangga.
3. **Tool**: `hanoman_sync_conflicts` + `hanoman_sync_pending` (read), `hanoman_sync_now` (write),
   `hanoman_sync_conflict_resolve` (**danger**, `sync:resolve`). Konflik diringkas: hanya field yang
   BERBEDA, tiap sisi dipotong 300 karakter, `accessKeyHash` tiket disembunyikan — dua `data` utuh akan
   membanjiri konteks dan memaparkan record entitas lain di luar capability domainnya.
4. **Tidak dibungkus, dengan alasan teknis (bukan kelalaian)** — dicatat di `UNWRAPPED` mcp-coverage:
   `GET /sync/pull`, `GET /sync/bootstrap`, `POST /sync/push`, `POST /sync/logs`,
   `GET /sync/attachments/:storageKey`, `GET|PUT /sync/qa-attachments/:id`, `GET /sync/ws`,
   `GET /sync/relay/ws`, dan `POST /ws-tickets`. Auth-nya Bearer **device-token** / tiket WS sekali
   pakai. Agent token BUKAN device token: route-route itu menolaknya dengan 401, jadi tool di atasnya
   pasti gagal — dan satu-satunya cara membuatnya berfungsi adalah menyerahkan device-token (kredensial
   mesin, ADR-0044) atau tiket WS ke agen. Itu eskalasi, bukan pembungkusan. `POST /ws-tickets` menerbitkan
   kredensial (tiket) untuk sesi cookie; tiket itu sendiri adalah rahasia, bukan data. Semuanya tetap
   `COOKIE_ONLY` di peta, dan tes gerbang nyata (`instance-sync-gate.test.ts`) membuktikan token berisi
   SEMUA capability tetap 401/403 di sana.
5. **Inventaris cakupan diperbaiki.** Regex `routeInventory()` hanya mengenal receiver `app.`, sehingga
   `logs.post("/sync/logs")` dan `qb.get|put("/sync/qa-attachments/:id")` (scope bersarang di `sync.ts`)
   serta `app.route({ method, url })` di `devices-relay.ts` tak pernah masuk inventaris. Kini receiver
   apa pun diterima asal path berawalan `/`, dan `.route({ method, url })` dibaca (method non-literal →
   semua method mutasi, supaya tak ada yang lolos). Memperluasnya tidak memunculkan route tak tercakup
   baru; route mesin-ke-mesin yang kini terlihat dicatat di `UNWRAPPED`.

## Konsekuensi

- `CAPABILITY_IDS` bertambah tiga (`sync:read|write|resolve`); panel Settings → Akses AI Agent
  menampilkannya otomatis (satu sel di kolom `berbahaya` untuk `sync:resolve`). Token yang ada tidak
  berubah — tak ada yang mewarisi.
- Token yang HANYA diberi `sync:resolve` tidak bisa membaca antrean (danger tak mengimplikasikan read);
  pemanggil perlu mencentang `sync:read` juga bila ingin melihat apa yang diputuskannya.
- 403 "cookie session required" untuk path sync lain tetap benar; teksnya di `cli/src/mcp/errors.ts`
  masih menyebut "sync" sebagai cookie-only secara umum — akurat untuk kanal mesin-ke-mesin.

## Penerimaan

- [x] `capabilityForRoute` memetakan keempat route UI, semua path sync lain tetap `COOKIE_ONLY`.
- [x] Token bercapability penuh selain `sync:*` ditolak di keempat route; token `sync:*` ditolak di kanal mesin.
- [x] Tool + tes katalog (bentuk permintaan, ringkasan konflik tanpa `accessKeyHash`).
- [x] Inventaris cakupan menangkap scope bersarang dan `.route()`.
