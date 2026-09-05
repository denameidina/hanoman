# App support agents implementation plan

**Goal:** Membuat delapan agent aplikasi yang disetujui dan tersedia bagi pengguna.
**Architecture:** Data katalog shared memakai seed/renderer/CRUD yang sudah ada.
**Tech Stack:** TypeScript, Vitest, Prisma SQLite, native Claude/Codex agent configs.
**Spec:** ../specs/2026-09-05-app-support-agents-design.md

## Global Constraints

- Pertahankan delapan definisi lama, urutan dan tiga enabled default lama.
- Tambah delapan nama dan policy sesuai spec; semua baru opt-in/smart/mentions kosong.
- Katalog data murni tanpa node I/O. Model recommendation sonnet/gpt-5.6-terra.
- Lima isolated dibatasi 40 turn; tiga read-only 30 turn; timeout null.
- Effort medium, kecuali solution-architect/performance-engineer high.
- Klaim hasil harus punya bukti; tool yang tidak tersedia dilaporkan sebagai gap.
- Jangan menjalankan suite penuh; test server serial dengan DB dan HANOMAN_HOME unik.
- Tidak menyentuh worktree lain, langsung menulis DB operasional, merge atau deploy.

### Task 1: Katalog, seed dan native contract

Ownership implementer: shared/src/builtin-agents.ts, shared/src/builtin-app-agents.ts
(baru), shared/src/builtin-agent-types.ts (baru bila perlu), shared/test/builtin-agents.test.ts,
server/test/builtin-agents.test.ts, runner/test/custom-agent-eval.test.ts, serta
runner/test/builtin-app-agents.test.ts (baru). Jangan mengubah docs milik parent.

- [ ] Baca spec di atas dan project skill/doc ADR-0136/0159 yang relevan.
- [ ] Tambah test yang gagal untuk 16 nama unik, delapan profile baru valid dan
  upgrade instalasi delapan lama: baru lahir sekali, edit/enabled/tombstone lama bertahan.
- [ ] Definisikan delapan peran persis tabel spec, dengan prompt Indonesia konkret
  dan alat minimum. Lima isolated boleh Read/Glob/Grep/Bash/Write/Edit dan WebFetch/WebSearch
  hanya jika tugas perlu referensi. Tiga read-only Read/Glob/Grep/WebFetch/WebSearch,
  tanpa Bash/Write/Edit, jangan menjanjikan akses live support atau browser bawaan.
- [ ] Pisahkan prompt baru ke builtin-app-agents.ts dan append melalui array spread.
  Type-only import boleh; jika ekstrak tipe, re-export BuiltinAgentDef dari modul
  lama agar API publik tetap sama. Perbaiki komentar kedelapan/kesembilan yang usang.
- [ ] Prompt wajib memuat ownership/acceptance/bukti/ketidakpastian/handoff.
  Designer memeriksa state dan render; builder membatasi patch pada mandat parent;
  performance mengukur baseline berulang sebelum/after setara dan mendokumentasikan
  noise/regresi; analyst membedakan asumsi dari kebutuhan tervalidasi; architect
  membandingkan pilihan termasuk memakai solusi yang ada; ops memisahkan worktree
  dari akses produksi; support memakai severity berbukti dan draf tanpa pengiriman;
  knowledge membedakan perilaku terverifikasi dari rencana belum dirilis.
- [ ] Uji definisi melewati native render: Claude memiliki isolation worktree untuk
  lima isolated; tidak ada Task pada semua leaf; read-only tidak memperoleh alat tulis;
  Codex hanya mematerialisasi tiga read-only dari kelompok baru; policy/model efektif
  tetap benar. Pakai fungsi produksi, bukan mock renderer. Test bermakna jangan
  sekadar assert semua string prompt.
- [ ] Ubah nama test evaluator yang mengklaim semua builtin menjadi delapan audit
  yang memiliki fixture. Tambah test permintaan eval agent baru gagal jelas karena
  tidak memiliki kasus, tanpa memanggil executor. Jangan membuat benchmark semu.
- [ ] Jalankan focused tests serta typecheck shared/runner/server sesuai perubahan;
  laporkan perintah dan hasil, commit hanya file ownership.

### Task 2: Dokumentasi, verifikasi dan registrasi

Ownership parent: spec/plan ini, internal/docs/operations/app-support-agents.md,
internal/docs/README.md, ADR-0136/0159 dan internal/skills/hanoman/SKILL.md.

- [ ] Dokumentasikan delapan peran, routing/handoff, tools yang masih diperlukan,
  default opt-in, lima hanya Claude dan batas benchmark.
- [ ] Review task 1 untuk spec/quality, perbaiki temuan melalui implementer.
- [ ] Jalankan verifikasi akhir yang relevan dan review seluruh perubahan.
- [ ] Ekspor delapan definisi menjadi payload API global enabled=true; lima isolated
  runtime=claude/model=sonnet, tiga read-only runtime=null/model=null. Jangan sertakan
  field internal models/enabledByDefault. Jangan menimpa baris existing yang berbeda.
- [ ] POST melalui API resmi, baca ulang delapan profile dan runtime availability.
  Simpan bukti registrasi tanpa credential di luar repo. Custom rows sementara
  belum mendapat badge builtin sampai kode katalog diintegrasikan; jangan ubah stamp DB.
- [ ] Commit docs, catat status integrasi dan batas verifikasi secara jujur.
