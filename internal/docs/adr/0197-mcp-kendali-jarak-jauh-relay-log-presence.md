# ADR-0197 — Tool MCP untuk kendali jarak jauh, relay perangkat, log terpusat, dan presence

Tanggal: 2026-10-11
Status: diterima (permintaan eksplisit pemilik repo)
**Mengamandemen ADR-0165 §4** (`/remote-control` dan `/devices/:id/relay/*` cookie-only), **ADR-0166**
(`/logs*` cookie-only: "agen bisa menyembunyikan atau memalsukan jejak") dan **ADR-0147**
(`/presence` cookie-only). Melanjutkan ADR-0155 · Kembar: ADR-0196, ADR-0198.

## Konteks

Empat permukaan lintas-mesin dipetakan `COOKIE_ONLY` karena alasan yang masing-masing nyata: grant
kendali jarak jauh adalah eskalasi RCE (hub menjalankan agen di mesin ini), relay menjalankan aksi di mesin
LAIN, log adalah jejak audit, dan presence adalah peta seluruh mesin operator. Pemilik repo meminta
semuanya dibungkus. Alasan lamanya tetap benar sebagai **risiko** — yang berubah adalah bahwa risiko itu
kini dikelola capability opt-in dan pagar di server, bukan dengan menutup pintu.

## Keputusan

### Capability

| Capability | Akses | Membuka |
|---|---|---|
| `remote:read` | baca | `GET /remote-control` |
| `remote:control` | **danger** (`rce`) | `PUT /remote-control` |
| `relay:exec` | **danger** (`rce`) | `ANY /devices/:id/relay/*` — semua method |
| `logs:read` / `logs:write` | baca / tulis | `GET /logs`, `/logs/:id/transcript`, `/logs/retention` / `PUT /logs/retention` |
| `presence:read` | baca | `GET /presence` |

`remote` dan `relay` adalah DOMAIN terpisah (bukan dua danger dalam satu domain): grid Settings
merender satu kotak danger per domain, dan keduanya memang beda bahaya — grant mesin INI vs eksekusi di
mesin LAIN. `relay:exec` mencakup SEMUA method termasuk GET (membaca isi sesi mesin lain sama sensitifnya),
karena itu ia tak dibagi baca/tulis.

### Pagar di server

- **`PUT /remote-control`** — `control.capabilities` ⊆ capability pemanggil (`exceedingCapabilities`, 403
  `exceeds`). Tanpa ini pemegang `remote:control` bisa memberi hub `sessions:spawn` yang tak ia miliki.
  Blok `logs` (mengirim transkrip/log server ke hub = data keluar) hanya boleh berubah bila pemanggil juga
  memegang `logs:write` (403 `need: logs:write`); mengirim nilai yang SAMA bukan perubahan. Aktor audit
  `grant.changed` = `agent:<id>` (dulu `req.user?.email`). `validateRemoteGrant` tetap berlaku.
- **Relay** — handler menerima `req.agent`; aktor yang diteruskan ke klien ditandai `agent:<id>` (klaim hub,
  seperti sebelumnya), jadi audit di mesin tujuan tak mengira ada manusia. Allowlist route (`RELAY_ROUTES`)
  dan `relayBodyAllowed` tetap ditegakkan **mesin tujuan** — lapis kedua yang tak disentuh ADR ini. Principal
  `remote` (relay masuk) tetap tak bisa berantai (401). **WebSocket relay tidak tersedia untuk agen**: tool
  menolak path `…/ws`, dan handler WS tetap menuntut `req.user`.
- **`PUT /logs/retention`** — memendekkan retensi menghapus jejak audit. Bila pelakunya agen, perubahan
  dicatat (`admin.log-retention.updated`, memuat nilai lama dan baru) **sebelum** nilainya berubah, supaya
  perubahan itu sendiri tak ikut terhapus oleh pemangkasan yang dicatatnya.
- `GET /logs` tetap dibatasi rentang ≤ 31 hari dan wajib `from`/`to` (ADR-0107 exc. #4).

### Tool (8)

Baca: `hanoman_remote_control_get`, `hanoman_logs_search`, `hanoman_log_transcript`,
`hanoman_logs_retention_get`, `hanoman_presence_get`. **Danger**: `hanoman_remote_control_set`,
`hanoman_device_relay`, `hanoman_logs_retention_set`. (`hanoman_device_relay` merakit
`/devices/:id/relay/<path>`; path berbahaya — `..`, `%2e`, `?`, `#`, `\`, `/ws` — ditolak sebelum dikirim.)

## Yang TETAP tidak dibungkus

- `/devices/:id/relay/**/ws` (WebSocket) — bukan request-response; tool MCP tak punya bentuk untuknya.
- Frame siar `presence` di `/events/ws` — tetap tak dikirim ke principal non-cookie; agen memakai `GET /presence`.
- `/terminal/workspace` — lihat ADR-0198.
- `POST /session-events` — lihat ADR-0198.

## Konsekuensi

- 6 capability dari ADR ini: `remote:*` 2, `relay:exec` 1, `logs:*` 2, `presence:read` 1 (dua `danger`:
  `remote:control`, `relay:exec`; `access:admin` ada di ADR-0196 → `danger` total 4 → 7).
- Katalog MCP 178 → 200 tool bersama ADR-0196 (12) dan ADR-0198 (2): 8 di sini.
- Nol migration. Semua aditif bagi token yang sudah terbit.

## Verifikasi

`admin-surface.route.test.ts` (remote: grant ⊆ hak, `logs:write` untuk lajur log, aktor `agent:<id>`;
relay: 403 tanpa `relay:exec`, sampai handler dengan `relay:exec`, aktor audit agen; retensi: audit
sebelum perubahan), `agent-capabilities.test.ts` (capability lama tak membuka apa pun di sini), uji nyata
di server lokal (relay ke device offline = 503, tak dikenal = 404, grant melebihi hak = 403).
