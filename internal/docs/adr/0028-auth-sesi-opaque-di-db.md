# ADR-0028 — Auth: sesi opaque revocable di DB, bind 127.0.0.1 di belakang reverse proxy TLS

**Status:** accepted · **Date:** 2026-07-11 · **Spec:** SPEC-169

> **Amendment SPEC-761 / [ADR-0117](0117-boundary-deployment-publik-otoritas-efektif-sandbox-sesi.md):**
> allowlist auth di bawah hanya berlaku **sesudah** exact ingress role. Host publik kini hanya
> melayani health/Help; auth/setup hidup di host control ber-access proxy. Bootstrap bukan lagi
> first-user-wins: token console 0600 one-time/15 menit dan create atomik wajib. Production selalu
> bind loopback, trusted proxy explicit, limiter bounded, dan WebSocket memakai exact Origin + tiket.

## Context
hanoman tidak punya auth apa pun. `server.ts` sengaja bind `127.0.0.1` karena `/api/terminal`
(dan sejak SPEC-164 `/api/vps`) menyerahkan eksekusi shell sungguhan — mengekspos itu ke jaringan
tanpa autentikasi sama dengan RCE terbuka. Untuk bisa deploy ke VPS, dibutuhkan lapisan auth.
Brief SPEC-169: login email/password, invite user lain dengan menetapkan password langsung (tanpa
email invitation), ganti password. Constraint: **tanpa RBAC — semua user setara**.

## Decision
- **Password**: hash `crypto.scrypt` (Node stdlib, nol dependency) + salt acak 16-byte,
  disimpan `"<saltHex>:<hashHex>"`; verifikasi `timingSafeEqual`.
- **Sesi**: token opaque acak 256-bit (`randomBytes(32)`) dikirim di cookie `httpOnly`. Yang
  disimpan di tabel `Session` adalah **`sha256(token)`** sebagai id, bukan token mentah — bocornya
  DB tak langsung memberi sesi yang bisa dipakai. Sesi **bisa dicabut**: logout menghapus barisnya,
  ganti password menghapus semua sesi user (re-issue yang sekarang → perangkat lain ter-logout),
  hapus user meng-cascade sesinya. Dipilih ketimbang JWT: single-server, tak perlu verifikasi
  stateless, dan JWT menambah permukaan serangan (algorithm confusion) tanpa manfaat di sini.
- **Gate**: satu hook `onRequest` di scope `/api` menolak (401) semua request tanpa sesi valid,
  kecuali allowlist publik `GET /health`, `GET /auth/status`, `POST /auth/login`, `POST /auth/setup`.
  Hook yang sama menutup upgrade WebSocket `/api/terminal/**` (cookie ikut terkirim same-origin).
  `buildApp({ requireAuth })` default `true` (prod selalu tergerbang); test route yang tak menguji
  auth mem-build dengan `requireAuth: false`.
- **Bootstrap**: user pertama tak bisa di-invite (ayam-telur). Saat 0 user, `POST /auth/setup`
  terbuka membuat akun pertama; setelah ada user ia 409. Frontend menampilkan layar Setup saat
  `needsSetup`, lalu Login.
- **Cookie**: `httpOnly`, `sameSite=strict`, `secure` hanya di production, `maxAge` 7 hari.
  Karena `Secure` butuh TLS, pola deploy tetap **bind `127.0.0.1` di belakang reverse proxy**
  (Caddy/nginx) yang menerminasi TLS — bukan mengekspos app langsung. `HOST=0.0.0.0` hanya bila
  ada TLS di depannya.
- **Throttle login (historis):** keputusan awal memakai Map per IP. ADR-0117 menggantinya dengan
  store bounded TTL/LRU berdasarkan alamat yang hanya berasal dari proxy terpercaya.

## Consequences
- Postur keamanan `/terminal` dan `/vps` berubah: sebelumnya "tanpa auth, bergantung bind
  127.0.0.1"; kini tergerbang sesi. Bind 127.0.0.1 + reverse proxy tetap direkomendasikan karena
  TLS (dan karenanya cookie `Secure`) diterminasi di proxy.
- Tanpa RBAC: setiap user bisa invite/menghapus user lain dan mengubah setting. `DELETE
  /auth/users/:id` menolak menghapus user terakhir agar instance tak terkunci total.
- Tanpa reset-password-lupa dan tanpa email invitation (tak ada infra email) — di luar cakupan,
  konsisten dengan brief. Password di-reset lewat ganti-password (butuh password lama) atau, bila
  terkunci, dengan menghapus baris user via DB dan `setup` ulang saat 0 user.
- Tak ada secret env baru wajib: token sesi adalah rahasianya, DB verifikatornya. Rotasi paksa =
  `DELETE FROM "Session"` (semua ter-logout).
- Throttle in-memory tak berbagi antar-instance; bila kelak multi-instance, pindahkan ke store
  bersama (Redis).
