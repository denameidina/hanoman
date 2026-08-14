# ADR-0046 — Kanal WebSocket sync terpisah, token-authed pada upgrade

Status: diterima · SPEC-213 · 2026-07-14

> **Amendment SPEC-761 / [ADR-0117](0117-boundary-deployment-publik-otoritas-efektif-sandbox-sesi.md):**
> device token pada query dicabut; upgrade machine-to-machine wajib Bearer header dan query ditolak.

## Konteks
Realtime dashboard sudah lewat satu WS siar `/api/events/ws` (ADR-0039), auth diwarisi cookie
same-origin. Sync antar-mesin (ADR-0043) butuh siar changefeed ke instance lain, diautentikasi
device token — bukan cookie. Pertanyaan (OQ-3): pakai ulang WS siar atau kanal baru?

## Keputusan
**Kanal baru terpisah** `GET /api/sync/ws`. Auth = device token Bearer pada upgrade (bentuk query
di keputusan awal telah dicabut ADR-0117),
diverifikasi via `verifyDeviceToken`; gagal → socket ditutup. Hub menyiarkan tiap baris SyncLog
baru `{ t:"sync", entity, recordId, version, data }` ke klien terhubung. `/api/events/ws` tetap
read-only same-origin untuk dashboard lokal, tak berubah.

## Alasan
- Otorisasi berbeda (token vs cookie) dan payload berbeda (changefeed vs snapshot dashboard) →
  memisah kanal lebih bersih daripada mencampur auth di satu upgrade.
- Instance lokal mengonsumsi `/sync/ws` di sisi proses Node (server-to-server), lalu
  memantulkan perubahan ke browser-nya lewat `/events/ws` lokalnya sendiri.

## Konsekuensi
- Dua kanal WS di hub; keduanya lolos gerbang scope `/api` — path `/api/sync/*` di-bypass gate
  cookie lalu di-enforce device token per-route.
- Token muncul di query string upgrade → andalkan TLS (reverse proxy) agar tak bocor.
