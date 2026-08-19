# PRD (detail) — hanoman

Turunan terukur dari `entrypoints/prd.md`.

## 1. Overview
- Tampilkan KPI: sesi aktif, perlu perhatian, docs on-convention (rata-rata coverage), spec di backlog, indikator limit.
- Panel: perlu perhatian, sesi live (stage), docs coverage per project, ringkas backlog, aktivitas.
- Semua baris deep-link ke bagian terkait.

## 2. Projects
- Daftar (list) project: nama, kind (from-scratch/existing), sesi aktif + stage, coverage docs, backlog + top stage, aktivitas.
- Cari (filter), pagination, tambah project, buka SoT project.

## 3. PRD (SPEC-210 · ADR-0041)
- PM/PO menulis brief + brainstorm interaktif → dokumen PRD `docs/prd/<slug>.md` (bukan entitas DB).
- **Create**: "PRD baru" membuka sesi `flow:"prd"` (project-level, worktree isolasi); brainstorm satu
  pertanyaan per giliran, lalu tulis PRD terstruktur, push branch `prd/<slug>`, manusia merge.
- **Preview**: daftar PRD per project (freshest-wins: worktree sesi hidup > repoDir), render markdown untuk review.
- **Take ke backlog**: satu klik → `NewSpecModal` (brief) ter-prefill dari PRD; tautan PRD di teks Konteks.

## 4. Backlog
- Spec dari brief/QA, badge sumber & prioritas, stage bar lifecycle.
- Filter by project + tab sumber, pagination.
- Aksi per spec sesuai tahap: kunci objective → tulis spec → buat plan → execute → buka sesi; hapus.

## 5. Terminal (sesi interaktif)
- Grid multi-pane sesi `claude` di tmux; ambil backlog; reopen sesi `done` (lanjut fase Execute).
- **Git worktree**: tiap sesi di `.worktrees/<spec>` dari `branchFrom` (default `main`); integrasi (rebase/merge) ke target dipicu manual.
- **Kendali manusia**: steer & interupsi langsung di TTY; sesi hidup lintas restart API (tmux, ADR-0016).
- **Stage live**: diturunkan dari phase-file sesi (`$HANOMAN_PHASE_FILE`), bukan status run.

## 6. Docs · SoT
- Index kategori (tree) + coverage; preview markdown ter-render (bukan plain text); edit + simpan (persist).
- Render file non-markdown (JSON/TOML) sebagai blok kode. Sertakan agents/ (AGENTS.md, CLAUDE.md, README.md, .claude, .codex).

## 7. VPS
- Daftar VPS + audit/harden (script bash deterministik, `sudo -n bash -s` lewat ssh); `hardened` = semua check kritis pass.
- Buka sesi `claude` berkonteks VPS (cwd `$HOME`). Bootstrap key sekali pakai dari password (dibuang setelah dipasang).
- Test connection (`ssh true` key-only, transien) & Open Console (shell ssh mentah di tmux hanoman, ADR-0042) per VPS (SPEC-211).

## 8. Settings
- **Model & effort** satu per sesi, default opus · effort x-high; manusia bisa `/model` di terminal.
- auto-default; auto-scaffold doc index; notifikasi gagal & selesai (+ sound). Tanpa anggaran harian / konkuren maks (hilang bersama runner headless).

## 9. Telegram gateway (SPEC-476 · ADR-0096)
- Satu bot, private chat, allowlist user id, text-first; group/media/multi-bot/webhook di luar MVP.
- Satu chat/operator diikat ke satu session operator tmux persisten. Natural text, command, dan
  callback masuk session yang sama; Telegram bukan runtime agen atau command executor kedua.
- Operator dapat memilih project/backlog/session, membaca status, start/stop/resume/interrupt/steer,
  serta menerima progress ringkas, final, failure, decision, dan confirmation inline.
- Personality memakai katalog CustomAgent; summary + curated memory bertahan restart dan dapat
  diperiksa/dilupakan/reset.
- Secret env-only; action lewat API ber-AgentToken/capability/audit; raw PTY/reasoning/ANSI tidak
  pernah dijadikan reply Telegram.

## 10. Obrolan portal klien (SPEC-854 · [ADR-0129](../adr/0129-mesin-chat-portal-klien.md) · [ADR-0130](../adr/0130-kuota-chat-portal-klien.md))

Satu permukaan chat di portal klien, dijawab hanoman sendiri — beda dari Help Center yang antrean
tiket ke manusia. Acceptance criteria (huruf A–F brief SPEC-854):

**A. Dua tipe sesi.** Klien memilih saat memulai. *Brainstorming* menggali aktif ala grill-me
dengan bekal dokumen project dan berakhir dengan PRD. *Bertanya* menjawab seputar project klien
itu sendiri, langsung di percakapan. Tipe tak bisa diubah setelah sesi lahir.

**B. Keluaran brainstorming = PRD berstatus draft.** Tersimpan di baris sesi, muncul di dashboard
operator dengan asal yang terbaca (sesi mana, kapan, dari akun klien mana). **Tidak** otomatis jadi
backlog dan **tidak** memicu pekerjaan apa pun; materialisasi jadi `docs/prd/<slug>.md` adalah aksi
operator.

**C. Kuota.** Per project, terpisah untuk brainstorming dan pertanyaan, nilainya di Settings,
periode bulanan. Habis = tak bisa memulai sesi baru sampai periode berikutnya. Klien melihat sisa
jatah & tanggal reset dalam bahasa biasa — bukan pesan galat. Operator membaca angka yang sama.

**D. Rekaman & ringkasan.** Setiap giliran (masukan klien maupun jawaban hanoman) tersimpan
berurutan, terikat project + akun klien + tipe sesi. Tiap sesi punya ringkasan yang bisa dibaca
cepat. Transkrip bisa diambil untuk training (`GET /api/portal-chat/export`, NDJSON).

**E. Penjagaan.** Klien hanya pernah melihat isi projectnya sendiri; percakapan tetap pada topik;
instruksi yang diselipkan klien tak mengubah perilaku hanoman; klien tak pernah melihat kode, nama
berkas, nama tabel, jejak galat, perintah, atau konfigurasi; bahasanya awam; dan klien tak punya
jalan menjalankan apa pun. Ditegakkan **empat lapis** (gerbang masukan · workspace dokumen ·
argv+sandbox · gerbang keluaran), bukan oleh prompt.

**F. Bukti.** Keempat lapis adalah fungsi murni, jadi huruf E dibuktikan test tanpa memanggil agen
— termasuk korpus injeksi yang sungguh-sungguh mencoba menembus dan percobaan memancing isi project
lain. Kuota diuji sampai perilaku di batas, lintas akun di project yang sama, dan sesudah reset.
