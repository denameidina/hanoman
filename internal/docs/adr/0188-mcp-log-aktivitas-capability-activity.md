# ADR-0188 — Log aktivitas terjangkau agen: domain capability `activity`, dan purge sebagai tool `danger`

Tanggal: 2026-10-11
Status: diterima
SPEC: — (permintaan eksplisit pemilik: route REST yang belum jadi tool MCP dibungkus)
**Mengamandemen ADR-0047** ("read/purge = cookie-authed (dashboard)") dan melengkapi **ADR-0065** (kosakata capability)
Terkait: ADR-0119 (tombstone sync), ADR-0155 (mode `danger` vs capability `danger`), SPEC-405 (peta menurut method), ADR-0157 (domain sendiri alih-alih menumpang)

## Konteks

`GET /session-results` dan `DELETE /session-results` (SPEC-213, ADR-0047) membaca dan membersihkan
**log aktivitas**: baris `SessionResult` append-only berisi perpindahan stage, `commitSha`, `branch`,
`prUrl`, `status`, `author`, `deviceId` lintas device. Keduanya jatuh ke `null` di `capabilityForRoute`
(prefix tak dikenal) sehingga cookie-only; ADR-0047 hanya menulis "cookie-authed (dashboard)" tanpa
menimbang agen.

Mengapa agen perlu membacanya: "apa yang terjadi di project ini minggu ini, di device mana, commit
apa" adalah pertanyaan laporan yang kini hanya bisa dijawab manusia di dashboard.

## Pemeriksaan handler

`routes/session-results.ts` tak memakai `req.user`/`req.agent`. Baris tidak per-akun: `author`
hanyalah teks yang ditulis saat baris lahir (whitelist ketat ADR-0047 — transkrip dan kredensial tak
pernah masuk log). `GET` memangkas `limit` ke 1–1000 (default 200), terbaru dulu. **Capability
bermakna; tak ada yang perlu dilaporkan sebagai per-akun.**

Satu sifat `DELETE` yang menentukan keputusan: tiap baris dihapus lewat `deleteSynced` (ADR-0119),
yaitu **hard-delete + tombstone yang menyeberang ke semua mesin tersinkron**. Purge dari satu
instance menghapus log di hub dan di setiap device. Tidak ada jalan pulang.

## Keputusan

### 1. Domain capability BARU: `activity:read` / `activity:write`

`capabilityForRoute`: `session-results` → `rw("activity")`, diturunkan DARI METHOD (kelas bug SPEC-405).
Domain tersendiri, tidak menumpang `sessions:*`:

- `sessions:write` rutin dicentang untuk pekerjaan sehari-hari (steer/interrupt sesi). Menumpangkan
  purge-menyeberang-mesin ke sana diam-diam memberi setiap token itu hak menghapus log seluruh
  cluster — pelebaran yang tak disadari siapa pun yang mencentangnya.
- Opt-in: tak ikut default, tak diwarisi capability lama. `grantsCapability` tak berubah; `write`
  mengimplikasikan `read` hanya di domain `activity` sendiri.

Bukan akses `danger` (ADR-0155): `danger` dikhususkan untuk operasi yang **memulai pekerjaan di luar
proses hanoman** (spawn sesi, VPS exec, git yang mengubah sejarah, siklus hidup backlog). Purge log
menghapus baris di DB sendiri — destruktif, tapi bukan eksekusi. Preseden: `hanoman_session_history_purge`.

### 2. Dua tool

| Tool | Mode | Capability |
|---|---|---|
| `hanoman_activity_list` | baca | `activity:read` |
| `hanoman_activity_purge` | `danger` | `activity:write` |

`hanoman_activity_list` memaginasi di sisi wrapper dengan meminta `page*limit + 1` baris dari server
(plafon server 1000) — baris ekstra itu satu-satunya bukti ada kelanjutan, ditandai `hasMore`. Jujur
soal batas: halaman yang jauh ke belakang tak terjangkau.

`hanoman_activity_purge` bermode `danger` (hilang dari tingkat default) dan namanya masuk
`DESTRUCTIVE_BUT_WRITE` di `mcp-catalog.test.ts` — destruktif dengan capability bukan-`danger`, mode
`danger`-nya ergonomi seperti `hanoman_session_history_purge`. Deskripsinya menyebut penghapusan
menyeberang ke semua mesin. Server tetap menolak 400 tanpa `projectId`/`before`; tool tidak
menambah gerbang kedua.

### 3. Tidak ikut kendali jarak jauh

`activity:*` tidak masuk `REMOTE_CAPABILITIES` (relay lintas mesin, ADR-0165): subset itu tertutup
dan eksplisit; log aktivitas tak pernah relevan untuk kendali jarak jauh.

## Konsekuensi

- Nol endpoint baru, nol migration. Capability +2 (`activity:read|write`); bersama ADR-0189 total 34 → 38 dan domain 15 → 17.
- Token yang sudah terbit TIDAK berubah (default-deny): mereka tetap 403 `need: activity:read` sampai
  manusia mencentangnya di Settings → Akses AI Agent.
- Test: `agent-capabilities.test.ts` (peta menurut method), `mcp-observability.route.test.ts` (token
  dengan SEMUA capability lama tetap 403; `activity:read` tak bisa purge; purge ber-scope nyata),
  `mcp-catalog.observability.test.ts` (paginasi `hasMore`, bentuk query).
