# ADR-0195 — Portal klien dilihat agen atas nama akun klien eksplisit: `portal:read` (baca-saja)

Tanggal: 2026-10-11
Status: diterima (permintaan pemilik repo)
**Mengamandemen ADR-0110** (portal cookie-only) **sebagian**: hanya method BACA, dan hanya lewat identitas klien yang disebut eksplisit. ADR-0111 (kirim tiket) dan ADR-0129/0130 (chat) tetap berlaku untuk tulis.
Terkait: ADR-0194 · ADR-0157 §"tidak diputuskan" (chat portal memuat percakapan klien) · ADR-0062 (404 seragam: tak ada enumerasi)

## Konteks

`/portal/**` bukan permukaan "baca data project" biasa. Setiap handler menurunkan project yang
boleh dilihat dari **`req.user.id`** — id akun KLIEN pada sesi cookie. Agent token tidak punya
`req.user`; membungkus route itu "apa adanya" berarti handler melempar `TypeError` (500) atau,
bila dipaksa, menjawab daftar kosong yang berpura-pura bermakna. Itu sebabnya ADR-0110 memberinya
`COOKIE_ONLY` dengan alasan "tak ada capability yang bisa berarti apa pun di sana".

Alasan itu benar untuk capability yang tak menyebut siapa. Tapi ada bentuk yang jujur: pemanggil
**menyebut akun klien yang dilihat**, server memvalidasinya, dan hanya membaca. Gunanya nyata —
operator/agen memeriksa persis apa yang diekspos portal kepada klien X (proyeksi sempit,
allowlist field, scope project, status kuota chat) tanpa login sebagai klien itu.

## Keputusan

### 1. Capability BARU `portal:read` — tidak ada `portal:write`

`capabilityForRoute`: `GET` di bawah `portal` → `portal:read`; **method lain tetap `COOKIE_ONLY`**.
`zCapability` menolak `portal:write`.

### 2. Handler menurunkan identitas lewat satu fungsi, dengan urutan prioritas yang dikunci

`services/portal-principal.ts#portalUserId(req, reply)`:

1. `req.user` ada → **id itu, selalu**. `?asClient=` diabaikan. Tanpa aturan ini parameter tersebut
   jadi IDOR antar-klien (klien A menyisipkan id B). Test mengikat.
2. Tak ada user dan tak ada agen → 401 (dulu: `req.user!` melempar → 500).
3. Agen: method selain GET/HEAD → 403 (defense in depth di atas peta); `asClient` kosong → 400;
   `asClient` bukan akun `role="client"` (id operator, id karangan) → 404 `akun klien tidak
   ditemukan`; selain itu id akun itulah sudut pandangnya.

Seluruh logika scope sesudahnya (`clientProjectIds`, `hasProjectAccess`, `ownSession`, 404 seragam
untuk project tak ditugaskan) **tidak diubah** — ia hanya menerima id dari sumber yang lain.

### 3. Yang TIDAK dibungkus, dan kenapa (kejujuran, bukan kelalaian)

- `POST /portal/projects/:id/tickets` — multipart (tak ada bentuk wajar lewat tool teks) **dan**
  bertindak sebagai klien: tiket tertulis atas email klien itu.
- `POST /portal/projects/:id/chat/sessions` dan `.../messages` — mereka membuat sesi, menghabiskan
  kuota bulanan klien, memanggil proses agen, dan menyimpan teks yang tertulis sebagai ucapan
  klien. Itu peniruan identitas, bukan capability. Tetap `COOKIE_ONLY`; test mengikat bahwa agen
  ber-`portal:read` + `support:write` + `clients:write` pun tetap 403 `cookie session required`.

### 4. Tool: lima, semuanya baca-saja

`hanoman_portal_projects`, `_backlog` (daftar/satu item), `_tickets` (daftar/satu tiket),
`_chat_quota`, `_chat_sessions` (daftar/satu sesi beserta transkrip). Semuanya mode `read` (terlihat di
`--read-only`), `asClient` WAJIB di skema. Tiga route detail dicatat di `COVERED_BY_BRANCH` pada
`mcp-coverage.test.ts` dengan nama tool-nya.

### 5. Privasi chat

`portal:read` membuka **transkrip percakapan klien dengan hanoman**. ADR-0157 menandai ini perlu
pertimbangan sendiri; keputusannya di sini: boleh, karena operator manusia sudah bisa membacanya di
dashboard (`/portal-chat/**`), pemilihannya opt-in per token, dan deskripsi capability + tool
menyebutnya terang. Memecahnya jadi capability chat terpisah dinilai berlebihan untuk satu kolom
baca-saja.

## Konsekuensi

- Capability **+1** (`portal:read`); tool **+5**; route baca portal tidak lagi `COOKIE_ONLY` —
  `server/test/portal.route.test.ts` dan `agent-doc-contract.test.ts` diperbarui.
- Perilaku sesi cookie klien tidak berubah satu bit pun (dibuktikan oleh seluruh suite portal lama).
- `/api/portal-chat/**` (permukaan operator) tidak disentuh.

## Yang TIDAK diputuskan di sini

- Tulis atas nama klien dengan cara apa pun (mis. "operator mengirim tiket untuk klien"). Bila
  kelak dibutuhkan, itu bentuk yang berbeda (tiket ber-penulis operator, bukan ber-email klien) dan
  menuntut ADR sendiri.
