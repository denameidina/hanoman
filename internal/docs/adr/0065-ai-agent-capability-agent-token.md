# ADR-0065 — AI agent capability: agent token + capability scope per-domain gating `/api`

**Status:** accepted · **Tanggal:** 2026-07-21 · **Spec:** SPEC-257
**Terkait:** [ADR-0028](0028-auth-sesi-opaque-di-db.md) (auth sesi — **diperluas** di sini) · [ADR-0044](0044-device-token-machine-identity.md) (device token — pola dicerminkan) · [ADR-0037](0037-cabut-guardrail-safety.md) (isolasi worktree = batas eksekusi) · **ADR-0060** (dicabut, [ADR-0092](0092-cabut-error-monitoring-sdk-cross-audit.md))/[0062](0062-help-center-tiket-publik-triase.md) (pengecualian gate ber-otorisasi sendiri)
**Design-of-record:** [`docs/superpowers/specs/2026-07-21-spec-257-ai-agent-capability-design.md`](../../../docs/superpowers/specs/2026-07-21-spec-257-ai-agent-capability-design.md)

> **Amendment SPEC-761 / [ADR-0117](0117-boundary-deployment-publik-otoritas-efektif-sandbox-sesi.md):**
> credential query WebSocket dicabut; browser memakai tiket one-time di subprotocol dan agent HTTP
> memakai Bearer header. Capability route tidak lagi cukup untuk efek launch: hanya cookie admin atau
> `sessions:write` menulis approval LOCAL-only, lalu launcher memeriksa approval pada choke point akhir.
> `SYNC_SERVER_URL`/credential destination juga cookie-admin-only.

## Konteks

Brief SPEC-257 meminta **AI agent eksternal** dapat "full control" atas hanoman — setiap fitur bisa
dilakukan agen — dengan aksesnya **dibukakan manusia via Settings**. Wawasan kunci: **seluruh permukaan
fitur hanoman sudah berupa REST API di bawah `/api`** (projects, backlog, sesi/terminal, docs, ide/git, vps,
settings, errors, help/tickets, notifications). Dashboard React hanyalah satu klien, digerbang cookie sesi
(`onRequest` di `server/src/app.ts`). Maka "full control untuk agen" **bukan** menulis ulang fitur — melainkan
(1) kredensial non-interaktif agar agen bisa auth ke `/api`, (2) kontrol akses **per-fitur** yang dibuka
manusia, dan (3) master switch tingkat workspace.

Sudah ada tiga precedent auth non-cookie: **DeviceToken** (Bearer, `sha256` hash-at-rest, revocable —
mesin-ke-mesin sync), kunci **ingest DSN** (hash-at-rest, per-project), dan cookie sesi (opaque, revocable).

## Keputusan

1. **Agent Token = jalur auth kedua ke seluruh `/api`.** Model baru `AgentToken` (server-local, TANPA
   `version`/sync — cermin DeviceToken): `tokenHash = sha256(hnm_agt_<hex>)` hash-at-rest (plaintext hanya
   sekali saat create), `tokenPrefix` hint UI, `capabilities` (Json string[]), `enabled`, `createdBy`,
   `lastUsedAt`, `revokedAt`. Agen mengirim `Authorization: Bearer <token>`; bentuk query historis
   dicabut ADR-0117 agar token tidak masuk access log.

2. **Capability per-domain read/write.** `"<domain>:<access>"`, `access ∈ {read,write}`, **write⊇read**.
   9 domain: `projects, backlog, sessions, docs, ide, vps, settings, support, notifications` (18 capability;
   katalog `CAPABILITIES` + `zCapability` di `@hanoman/shared` = satu sumber untuk gate & UI). Peta
   route→capability deterministik di `server/src/services/agent-capabilities.ts`: GET/HEAD → `:read`, selainnya
   → `:write`; sub-path `/projects/:id/{docs,prds}` → `docs`, `/projects/:id/{tree,file,git,status,graph,…}` →
   `ide`; WS terminal → `sessions:write`.

3. **Gate (perluasan `onRequest`).** Cookie user → **akses penuh** (tak ada RBAC, konsisten model sekarang).
   Tanpa cookie: agent token valid + `Setting.agentAccessEnabled` + `enabled` + tak-revoked → resolve
   capability route; punya → lanjut, tidak → **403** `{ need }`; token invalid / master off → **401**.

4. **Master switch** `Setting.agentAccessEnabled` (default **false**) — kill-switch workspace: off menolak
   semua agent token apa pun capability-nya.

5. **Tak-boleh-didelegasikan (cookie-only; agent token → 403):** `/auth/*` (kelola user & password),
   `/agent-tokens*` (**anti privilege-escalation** — agen tak mencetak/menaikkan token), `/device-tokens*`,
   `/sync*`. Route tak dikenal peta → default cookie-only (aman). Endpoint `/agent-tokens` (CRUD + katalog)
   & master switch dikelola **manusia** lewat cookie.

6. **UI Settings "Akses AI Agent"** (`SettingsScreen.tsx`): master switch + daftar token + modal buat
   (checkbox capability per-domain, plaintext token sekali) + revoke/disable per-token.

## Konsekuensi

- Agent token **memperluas permukaan auth**, bukan hak launch transitif. `sessions:write` adalah
  capability high-risk yang dapat memberi approval; eksekusi production dibatasi rootless OS sandbox
  ADR-0117, bukan worktree saja. `vps:write` tetap remote exec high-risk.
- Tanpa privilege escalation: kelola token cookie-only + capabilities di token (bukan di Setting) → agen dengan
  `settings:write` bisa mematikan master switch (self-DoS, tak berbahaya) tapi tak bisa mencetak/menaikkan token
  atau menyalakan master switch saat off (ia tak bisa auth).
- Revoke/disable/master **instan**. `lastUsedAt` = audit ringan.
- **Non-goal (MVP):** MCP server (follow-on — lapisan tipis ber-agent-token); audit log per-aksi; RBAC /
  scoping per-project (satu workspace); rate-limit khusus agent token.

## Alternatif ditolak

- **MCP server saja / juga di spec ini** — mengunci ke klien MCP dan menggandakan permukaan (skema tool per
  fitur) tanpa nilai tambah atas HTTP; token+capability adalah fondasi yang dibutuhkan MCP juga. Ditunda.
- **Satu toggle per domain (tanpa read/write)** — tak bisa memberi akses baca-saja; per-endpoint terlalu rumit
  untuk UI & skema. Per-domain read/write adalah titik seimbang.
- **Reuse DeviceToken** — device token = identitas mesin untuk sync (per-user, tanpa capability); mencampur
  peran mengaburkan revoke & audit. Model terpisah lebih jelas.
