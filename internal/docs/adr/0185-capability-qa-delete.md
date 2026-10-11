# ADR-0185 — Capability `qa:delete`: hapus laporan/test case/temuan/lampiran QA dipisah dari `qa:write`

Tanggal: 2026-10-11 · Status: diterima (permintaan pemilik repo)

Mengikuti pola [ADR-0155](0155-mcp-cakupan-penuh-capability-danger.md) (akses ketiga `danger`, tak
diimplikasikan `:write`). Mengamandemen pengecualian "hapus QA dilakukan manusia di dashboard" pada
`server/test/mcp-coverage.test.ts` (Workspace QA, [ADR-0174](0174-workspace-qa.md)) dan pemetaan
`DELETE …/qa/**` → `qa:write` pada `capabilityForRoute`. Bagian dari [ADR-0183](0183-transfer-berkas-lewat-tool-mcp.md).

## Konteks

Empat route `DELETE` QA menghapus laporan beserta anaknya, test case, temuan, dan lampiran
(byte di disk), dan penghapusannya ikut menyebar ke mesin tersync (`deleteSynced`). Tool yang
membungkusnya akan hidup di bawah `qa:write` — capability yang diberikan manusia agar agen
MENULIS laporan. Itu menyamakan "menyunting" dengan "memusnahkan", persis yang ADR-0155 pisahkan
untuk `backlog:lifecycle`.

## Keputusan

- Capability baru **`qa:delete`**, domain `qa`, akses `danger`, `risk: "exec"` (badge kotak
  berbahaya di Settings → Akses AI Agent). **Opt-in**: tak ada di token yang sudah terbit, tak
  diimplikasikan `qa:write`, dan ia sendiri tidak mengimplikasikan `qa:read`/`qa:write`.
- `capabilityForRoute`: di bawah `/projects/:id/qa/**`, **method `DELETE`** → `qa:delete`; method
  lain tetap `qa:read|qa:write` menurut method (kelas bug SPEC-405 dihindari: dipetakan menurut
  method, bukan prefix).
- Empat tool, semuanya `mode: "danger"` (tersembunyi dari tingkat default): `hanoman_qa_report_delete`,
  `hanoman_qa_case_delete`, `hanoman_qa_finding_delete`, `hanoman_qa_attachment_delete`.
  Deskripsinya diawali `BERBAHAYA`, menyebut `qa:delete`, dan menyebut batasan server (laporan
  `closed` menolak 409; backlog yang lahir dari temuan tidak ikut terhapus).
- Panel Settings: kolom "berbahaya" otomatis memuat kotak `qa:delete`. Token yang punya `qa:write`
  tanpa `qa:delete` mendapat kalimat hak yang menyempit ("dulu bisa menghapus laporan, test case,
  temuan & lampiran QA") di `LOST_RIGHTS`.

## Dampak (BREAKING terbatas)

Agent token yang sudah terbit dengan `qa:write` **kehilangan** hak menghapus QA lewat REST; manusia
harus mencentang `qa:delete`. Ini penyempitan, bukan pelebaran. Tidak ada migrasi DB.

## Penerimaan

- [x] `server/test/qa-capabilities.test.ts`: DELETE → `qa:delete`; `qa:write` ditolak 403 dengan
  `need: "qa:delete"`; `qa:delete` saja tak membaca/menulis.
- [x] Uji nyata: token `qa:write` → 403 `qa:delete`; token `qa:delete` → 200 untuk keempat DELETE.
- [x] `DANGER_CAPS` pada `shared/src/mcp-catalog.test.ts` dan `server/test/mcp-capability.test.ts`
  memuat `qa:delete`; jumlah katalog capability di `agent-tokens.route.test.ts` 34 → 35.
