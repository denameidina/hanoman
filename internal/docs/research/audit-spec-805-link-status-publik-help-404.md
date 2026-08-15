# Audit SPEC-805 — link status publik tiket Help Center 404 (`hnm_shr_…` tak bisa dibuka)

- **Sumber**: finding QA SPEC-805 · severity `major` · prioritas `tinggi`
- **Tanggal**: 2026-08-15
- **Menyentuh (Execute)**: `server/src/services/ingress-policy.ts` · `server/src/routes/tickets.ts` ·
  `server/src/routes/help.ts` · `server/src/app.ts` · test terkait · `internal/docs/operations/deploy-vps.md`
- **Keputusan fase**: **Spec dan Plan DILEWATI**. Akarnya terbukti tiga cacat kecil berconfidence tinggi
  dengan diff beberapa baris per berkas (§6). Dokumen ini jadi doc-of-record.
- **ADR**: [ADR-0117](../adr/0117-boundary-deployment-publik-otoritas-efektif-sandbox-sesi.md)
  **diamandemen** (sumber base URL link status + arti control-origin tanpa public origin). Invariant 5
  ("public host policy ditegakkan aplikasi") tetap utuh — lihat §5.

---

## 1. Gejala dan bukti

Tiga pengukuran, bukan dugaan:

| Probe | Hasil |
|---|---|
| `GET https://hanoman.nafanesia.id/api/health` | `200` |
| `GET https://hanoman.nafanesia.id/api/help/crm-tumbuh-ai` | `404 {"error":"not found"}` |
| `GET http://localhost:8787/api/help/crm-tumbuh-ai` (helpEnabled=1 di DB yang dipakai proses) | `404` |

Instance lokal menutup satu cabang dugaan finding: `lsof` pada PID server menunjukkan ia memang membuka
`~/.hanoman/hanoman.db`, dan `Project crm-tumbuh-ai` di berkas itu ber-`helpEnabled=1`. Jadi 404 lokal
**bukan** soal "DB mana yang dipakai", dan bukan pula gerbang `helpEnabled` di `help.ts:32`.

## 2. Akar #1 — permintaan tak pernah sampai ke `help.ts`

Body `{"error":"not found"}` punya **tiga** produsen; dua di antaranya bukan Help:

- `help.ts:32/40/76` — gerbang `helpEnabled` / tiket tak ketemu
- `app.ts:219` — `setNotFoundHandler`
- `app.ts:89` — hook `onRequest`: `classifyIngress(...) === "denied"`

Yang menembak adalah **`app.ts:89`**. `ingress-policy.ts:36-37`:

```ts
if (policy.controlHosts.has(host)) return publicPath(req.method, path) && path.startsWith("/api/help")
  ? "denied" : "control";
```

Pada host **control**, seluruh `/api/help*` ditolak 404 sebelum route Help dijalankan. Karena
`enforce` menyala begitu **salah satu** dari `HANOMAN_PUBLIC_ORIGINS`/`HANOMAN_CONTROL_ORIGINS` terisi
(`ingress-policy.ts:22`), instalasi yang hanya menyetel `HANOMAN_CONTROL_ORIGINS` — yaitu instance lokal
di mesin ini, dan setiap deployment tunnel/reverse-proxy yang mengikuti amandemen WS ADR-0117 —
kehilangan **seluruh** permukaan Help walau `helpEnabled=1`, tanpa pesan apa pun. Itu persis 404 lokal.

## 3. Akar #2 — link bagikan dibangun dari host control

`tickets.ts:52-53`:

```ts
const base = `${req.protocol}://${req.headers.host ?? "localhost"}`;
const publicStatusUrl = `${base}/help/${encodeURIComponent(t.projectId)}/status/${shareToken}`;
```

`req.headers.host` di sini **selalu** host dashboard, karena `GET /api/tickets/:id` hanya hidup di
belakang gate cookie, artinya hanya di ingress `control`. Jadi setiap link yang disalin operator
menunjuk ke host yang — menurut §2 — memang dirancang menolak `/api/help*`. Link pada finding,
`https://hanoman.nafanesia.id/help/crm-tumbuh-ai/status/hnm_shr_…`, lahir cacat sejak dibuat.

Gejalanya menipu karena **halamannya terbuka**: path SPA `/help/...` bukan `/api/`, jadi
`classifyIngress` meloloskannya sebagai `control` dan `index.html` tersaji; yang 404 adalah XHR-nya.
"Halaman tak bisa dibuka" = shell SPA + galat fetch, bukan 404 HTTP di address bar.

## 4. Akar #3 — host publik produksi tidak pernah ada

`/etc/hanoman.env` di hub:

```
HANOMAN_PUBLIC_ORIGINS=https://help-hanoman.nafanesia.id
HANOMAN_CONTROL_ORIGINS=https://hanoman.nafanesia.id
```

`help-hanoman.nafanesia.id` **tidak punya record DNS** dan **tidak punya vhost di Caddyfile**
(hanya blok `hanoman.nafanesia.id` yang ada). Nilai itu terisi semata agar `assertRuntimeBoundary`
(`session-sandbox.ts:8`) mengizinkan boot. Konsekuensinya permukaan Help produksi tak terjangkau lewat
host mana pun: host control menolaknya secara desain, host publik tak pernah di-resolve.

Ini **kerja operasional**, bukan kode — dicatat di §7 dan di `operations/deploy-vps.md`.

## 5. Dua gerbang yang terkonflasi

Finding meminta "bedakan gerbang form-submit dari gerbang lihat-status". Audit membenarkannya, dan
menemukan cacat kedua yang sejenis:

- `help.ts:71-83` men-scope pencarian tiket ke `projectId: slug`. `Project.id` dapat di-rename
  (SPEC-255), sedangkan link yang sudah tersebar membawa slug lama → 404 permanen untuk tiket yang
  masih ada. Slug tidak menyumbang keamanan apa pun di sini: otorisasinya adalah kunci opaque 48 hex
  (`accessKeyHash` pelapor atau `shareToken` operator) yang sudah dipegang pemanggil.
- Mematikan `helpEnabled` semestinya berarti "berhenti menerima keluhan baru", bukan "matikan status
  semua tiket yang sudah masuk". Info halaman + submit tetap digerbangi `helpEnabled`; **lihat-status
  tidak**, karena kuncinya sendiri yang mengotorisasi.

Invariant 5 ADR-0117 tetap dijaga: yang berubah bukan "siapa yang boleh memanggil dari host mana",
melainkan (a) daftar host mana yang dianggap sudah dipisah, dan (b) otorisasi di dalam route Help.
Ketika split origin memang dikonfigurasi (selalu, di produksi — `assertRuntimeBoundary` menolak boot
tanpanya), permukaan Help tetap **tidak** disajikan di host control.

## 6. Perbaikan yang diambil

1. `ingress-policy.ts` — `/api/help*` ditolak di host control **hanya bila** ada public origin yang
   dikonfigurasi. Tanpa split (dev, tunnel single-host), Help disajikan di host itu. Produksi tak
   ikut turun: split wajib di sana.
2. `app.ts` — bila split ADA, path SPA `/help/*` di host control **redirect 302** ke public origin
   pertama, alih-alih menyajikan shell yang XHR-nya pasti 404. Link yang terlanjur tersebar tetap
   hidup, dan permukaan API-nya tetap tidak pindah ke host control.
3. `tickets.ts` — `publicStatusUrl` dibangun dari public origin pertama bila `HANOMAN_PUBLIC_ORIGINS`
   terisi; fallback ke host request seperti sebelumnya. Operator berhenti menyalin link cacat.
4. `help.ts` — `GET /help/:slug/tickets/:key` mencari tiket **hanya** dengan kunci opaque, tanpa scope
   `projectId` dan tanpa gerbang `helpEnabled`. Info halaman & submit tak berubah.

Test regresi menutup keempatnya (`server/test/ingress-policy.test.ts`, `server/test/help.route.test.ts`,
`server/test/tickets.route.test.ts`).

## 7. Sisa kerja operasional (bukan kode)

Agar hub produksi benar-benar melayani Help di host publiknya:

1. Buat record DNS `help-hanoman.nafanesia.id` → VPS.
2. Tambahkan vhost Caddy `help-hanoman.nafanesia.id` yang mem-proxy ke `127.0.0.1:8787`.

Sampai itu dikerjakan, perbaikan #2 membuat link lama me-redirect ke host yang belum ada — sehingga
langkah ini **wajib** menyertai rilis. Alternatif tanpa DNS baru: hapus `HANOMAN_PUBLIC_ORIGINS` dan
jalankan single-origin, yang setelah perbaikan #1 menyajikan Help di `hanoman.nafanesia.id` — tetapi
itu membatalkan pemisahan trust boundary ADR-0117 dan hanya boleh diambil sadar.
