# ADR-0198 — Tool MCP untuk metrik custom agent, dan daftar jujur yang TIDAK bisa dibungkus

Tanggal: 2026-10-11
Status: diterima (permintaan eksplisit pemilik repo)
**Mengamandemen SPEC-950 / ADR-0159** (`/custom-agents/metrics` dan `/custom-agents/invocations/:id`
"local-only, cookie-only"). Menutup rangkaian ADR-0196 (kredensial & akun) dan ADR-0197 (jarak jauh,
relay, log, presence).

## Konteks

Metrik custom agent (jumlah invokasi, durasi, disposisi) dan `PATCH …/invocations/:id` (vonis
`accepted`/`partial`/`rejected`/`false-positive`) dipetakan `COOKIE_ONLY` di dalam cabang
`custom-agents`. Pemilik repo meminta keduanya terjangkau agen.

## Keputusan

Domain capability **TERSENDIRI** `metrics`, bukan menumpang `agents`:

- `metrics:read` — `GET /custom-agents/metrics`.
- `metrics:write` — `PATCH /custom-agents/invocations/:id`.

Alasan memisahkan dari `agents:*`: `agents:write` mengubah *definisi* agen, sementara disposisi adalah
vonis MANUSIA atas mutu agen. Menumpangkan penilaian pada `agents:write` berarti agen yang boleh menulis
definisinya otomatis boleh menilai pekerjaannya sendiri — merusak sinyal yang justru ingin diukur SPEC-950.
Dipetakan MENURUT METHOD (kelas bug SPEC-405). (Nama `agents:metrics` yang disarankan semula tidak dipakai:
grid Settings menaruh satu kotak baca/tulis per domain, dan id berdomain `agents` akan tersembunyi di balik
`agents:read`.)

Tool: `hanoman_agent_metrics` (baca) dan `hanoman_agent_invocation_disposition` (**danger**; deskripsinya
melarang agen menilai pekerjaannya sendiri). Perubahan disposisi oleh agen dicatat
(`admin.invocation.disposition`).

## Daftar jujur: route yang TIDAK dibungkus, dan alasan teknisnya

| Route | Alasan |
|---|---|
| `GET /auth/status` | PUBLIK tanpa auth; `user` selalu null untuk agent token — tak ada isi untuk agen (probe host memakai `/health`) |
| `POST /auth/setup` | bootstrap akun pertama + cookie sesi + setup token di `HANOMAN_HOME` |
| `POST /auth/login`, `POST /auth/logout` | menerbitkan/menghapus cookie sesi browser; agen tak punya sesi cookie |
| `GET\|PUT /terminal/workspace` | tata letak tab/pane BROWSER per akun, diturunkan dari `req.user.id`; agent token tak punya `req.user` (handler jatuh di `request.user!.id`), dan menulisnya hanya merusak layout operator tanpa nilai bagi agen. **Ditinjau ulang, tetap cookie-only** |
| `POST /session-events` | kredensial = token HMAC turunan per sesi (header `x-hanoman-session`), diverifikasi di route; gate cookie mem-bypass path-nya dan agent token dijawab **401**. Memalsukan "sesi X bertanya Y" adalah peniruan identitas — dibungkus pun akan selalu ditolak |
| `/sync/*` | Bearer device token mesin-ke-mesin |
| `…/relay/**/ws` | WebSocket, bukan request-response |

Alasan-alasan ini dituliskan di `UNWRAPPED` (`server/test/mcp-coverage.test.ts`), di komentar
`capabilityForRoute`, dan di `docs/agent-integration.md` §5.

## Konsekuensi

- Rangkaian ADR-0196..0198 menambah **14 capability** (34 → 48; 15 → 23 domain; `danger` 4 → 7) dan **22
  tool** (178 → 200; tingkat default 152; baca-saja 79; danger = semuanya).
- Panel Settings menampilkan domain baru lewat grid yang sama; tak ada UI baru.
- Tidak ada migration. Tripwire angka (`agent-tokens.route.test.ts`, `shared/test/agent.test.ts`) dinaikkan
  sadar-sadaran, dan `agent.test.ts` sekaligus dikoreksi (ia basi sejak ADR-0182: 36/16 → nilai nyata 34/15).

## Verifikasi

`admin-surface.route.test.ts` (metrik: `metrics:read` membaca, `agents:write` TIDAK cukup untuk disposisi,
404 untuk invokasi tak ada, audit tercatat), `agent-capabilities.test.ts` (pemisahan `agents`/`metrics`),
kontrak cakupan (`mcp-coverage.test.ts`: route yang dibungkus punya tool, yang tidak terdaftar dengan alasan).
