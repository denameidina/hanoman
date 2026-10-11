# ADR-0190 — Dialog sesi dibungkus MCP di balik capability `sessions:decide`

Tanggal: 2026-10-11
Status: diterima (permintaan eksplisit pemilik repo)
**Mengamandemen ADR-0142 / SPEC-899** ("dialog sesi sengaja di luar katalog MCP"), **ADR-0146 / SPEC-909** (rebut sesi dari lead) dan **ADR-0099 §4**. Melanjutkan **ADR-0155** (batas ada di capability, bukan di ketiadaan tool) · Dilengkapi **ADR-0192** (gerbang self-decision) · Terkait: ADR-0091 (lead), SPEC-405 (prefix tanpa lihat method/segmen)

## Konteks

Tiga route `GET /terminal/sessions/:id/dialog`, `POST …/dialog/answer`, `POST …/dialog/takeover`
sengaja tak punya tool MCP sejak SPEC-899: agen yang bisa menjawab `AskUserQuestion` bisa menjawab
pertanyaannya SENDIRI, dan gerbang "manusia yang terakhir memutuskan" runtuh lewat pintu itu.
`mcp-capability.test.ts` menegakkannya dengan assert bahwa tak ada `samplePath` memuat `/dialog`.

Pemilik repo meminta ketiganya dibungkus. Larangan itu karenanya dibalik secara sadar — tetapi
**ketiadaan tool tidak pernah menjadi gerbangnya**. Tiga fakta di kode:

1. Dialog dipetakan `rw("sessions")`: token ber-`sessions:write` — capability yang cukup untuk
   steer/interrupt — SUDAH bisa memanggil ketiga route lewat REST hari ini.
2. `POST …/steer` memanggil `sendToPane`, yang menjawab dialog `AskUserQuestion` (kolom bebas,
   multi-select, catatan) dan menekan `Enter` di dialog trust/izin. Klaim deskripsi tool steer
   "tak bisa dipakai menjawab dialog" salah terhadap kodenya sendiri.
3. Konsekuensinya: menyembunyikan tool tak melindungi apa pun; yang perlu dibangun adalah gerbang
   di SERVER.

## Keputusan

1. **Capability baru `sessions:decide`**, akses `danger`, opt-in. `grantsCapability` tak diubah
   sehingga `sessions:write` / `sessions:spawn` tak mengimplikasikannya. Dipetakan pada SELURUH
   sub-pohon `/terminal/sessions/:id/dialog*` untuk SEMUA method — membaca ikut digerbangi karena
   `screenHash` dari GET adalah satu-satunya jalan menuju jawaban dan pertanyaan sesi bisa memuat
   rahasia. Dicocokkan ke segmen (`seg[3] === "dialog"`), bukan prefix: `steer`/`phases` tak bergeser.
2. **Domain tampilan `decisions`**, bukan `sessions`. Grid Settings → Akses AI Agent hanya memiliki
   SATU sel `berbahaya` per domain (`caps.find(domain && access === "danger")`), dan `sessions`
   sudah dipakai `sessions:spawn` — capability kedua di domain yang sama tak akan punya kotak centang
   dan manusia tak bisa memberikannya. Test baru menjaga invariannya (satu danger per domain tampilan).
3. **Tiga tool** di `shared/src/mcp-catalog/gates.ts`: `hanoman_session_dialog_get|answer|takeover`,
   semuanya `danger` (hanya muncul dengan `--danger`), semuanya `sessions:decide`.
4. **`steer` digerbangi di server** bila pane sedang menampilkan dialog (kind `question`/`review`):
   principal agen wajib `sessions:decide` dan lolos gerbang ADR-0192; selain itu `steer` tak berubah
   satu byte. Pengecualian: token gateway Telegram — setiap requestnya sudah wajib membawa korelasi
   update dari manusia Telegram yang tervalidasi (`telegram/security.ts`), ia perantara operator.
5. **Operator hub (relay) tak dirugikan.** `capabilityForRoute` dipakai juga oleh gate relay terhadap
   grant `REMOTE_CAPABILITIES`, yang tak (dan tak boleh) memuat `sessions:decide`. `remoteCapabilityFor`
   mendapat pengecualian: `…/dialog` = `sessions:read`, `…/dialog/{answer,takeover}` = `sessions:write` —
   persis seperti sebelum ADR ini. Operator hub adalah manusia, bukan agen.
6. 409 `deciding` / `answering` / `stale` tetap berlaku tanpa perubahan.

## Konsekuensi

- Token yang sudah terbit TIDAK kehilangan hak apa pun yang dilindungi ADR lama selain menjawab
  dialog — yang justru disengaja: `sessions:write` tak lagi cukup. Integrasi eksternal yang menjawab
  dialog dengan `sessions:write` mendapat 403 `need: sessions:decide`.
- Nol endpoint baru, nol migration (`capabilities` bertipe Json).
- Panel Settings mendapat satu baris domain baru; `settings-agent-danger.test.tsx` kini menuntut lima
  kotak berbahaya.
- Batas yang tetap terbuka dinyatakan di ADR-0192.
