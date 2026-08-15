# SPEC-786 — Workspace Terminal kanonik per akun admin

> Design doc · 2026-08-15 · sumber brief · prioritas tinggi
> ADR baru: **0118 — Workspace Terminal kanonik per-user dengan optimistic concurrency**

## Masalah

`TerminalScreen` saat ini membentuk `Workspace { groups, active }` langsung dari
`localStorage` melalui `screens/terminal-workspace.ts`. Kunci
`hanoman.terminal.workspace` bertahan melewati refresh pada satu browser, tetapi tiap desktop,
ponsel, tablet, profil browser, dan akun mempunyai salinan yang tidak saling mengetahui.

Akibatnya, grup, urutan grup, dimensi grid, urutan sel, dan pemetaan `sessionId` yang sudah disusun
operator di desktop hilang pada perangkat lain. Risiko terbesar bukan sekadar preferensi visual:
pemetaan sel adalah orientasi kerja terhadap sesi tmux yang hidup di server. Dua tab yang menulis
snapshot lama juga dapat saling menimpa tanpa tanda karena tidak ada revision.

ADR-0115 sengaja membiarkan kunci Terminal tetap lokal pada SPEC-740 karena scope saat itu adalah
state tampilan per-browser. SPEC-786 mengubah keputusan hanya untuk **pemetaan kerja Terminal**;
state presentasional tetap lokal.

## Objective

Akun admin yang sama selalu memperoleh identitas, nama, urutan grup, struktur grid, dan
`sessionId` pada koordinat yang sama dari server, di perangkat mana pun. Server menjadi source of
truth setelah migrasi satu kali dari key lama. Perangkat dengan snapshot stale tidak boleh
menimpa state terbaru, kegagalan fetch tidak boleh mereset server, dan render responsive tidak
boleh mengubah payload kanonik.

## Keputusan arsitektur

### 1. State hidup pada baris `User`, bukan sync antar-instance

Tambahkan tiga field LOCAL-only pada `User`:

```prisma
terminalWorkspace          Json?
terminalWorkspaceRevision  Int       @default(0)
terminalWorkspaceUpdatedAt DateTime?
```

`User` adalah boundary identitas yang sudah dipakai cookie session. Menaruh state dan revision pada
baris yang sama memberi satu CAS atomik tanpa model baru, join, atau identitas tambahan. Field ini
tidak masuk `SYNCED`, `FIELDS`, `WEBHOOK_ENTITIES`, maupun device sync ADR-0043/0045: sinkronisasi
yang diminta adalah browser ↔ instance yang sama, bukan server ↔ server.

Alternatif tabel `TerminalWorkspace` satu-ke-satu ditolak karena tidak ada riwayat, banyak workspace
per user, atau lifecycle terpisah yang membutuhkan entitas sendiri. Map per-user di `Setting`
ditolak karena isolasi akun dan revision akan menjadi konvensi di dalam JSON, bukan invariant data.

Migration additive menambah ketiga kolom. Baris lama memiliki `workspace = null`, `revision = 0`,
dan `updatedAt = null`; tidak ada backfill layout karena layout lama hanya ada di browser.

### 2. Bentuk kanonik terpisah dari state presentasional

Kontrak bersama di `@hanoman/shared`:

```ts
type TerminalWorkspaceV1 = {
  version: 1;
  groups: Array<{
    id: string;
    name: string;
    layout: {
      rows: number;
      cols: number;
      cells: Array<string | null>;
    };
  }>;
};
```

Urutan array `groups` adalah urutan tab; urutan `cells` adalah row-major (`r * cols + c`). Payload
tidak membawa `active`, `activeCell`, `maxed`, `fullId`, modal, ukuran viewport, atau tier
responsive. Semua itu tetap state perangkat.

Validator bersama menegakkan:

- `version` tepat `1`; versi asing ditolak, tidak dikoersi;
- 1–24 grup, id grup non-kosong dan unik, nama trim 1–80 karakter;
- `rows` dan `cols` integer 1–12 serta `cells.length === rows * cols`;
- cell hanya `null` atau id sesi non-kosong maksimum 256 karakter;
- satu `sessionId` muncul paling banyak sekali di seluruh grup.

Server memvalidasi setiap PUT dan juga memvalidasi JSON yang dibaca dari DB. Record DB rusak atau
versi masa depan menghasilkan respons fail-closed, bukan dianggap state kosong yang boleh di-seed.

`screens/terminal-workspace.ts` tetap memegang fungsi murni komposisi grup/grid, tetapi memperoleh
adapter `toCanonical`/`fromCanonical` dan parser legacy. `active` digabungkan hanya pada view lokal;
bila grup aktif sudah lenyap setelah refresh, jatuh ke grup pertama tanpa menulis perubahan kanonik.

### 3. Kontrak HTTP cookie-only dengan revision

Endpoint baru:

```text
GET /api/terminal/workspace
→ 200 {
    workspace: TerminalWorkspaceV1 | null,
    revision: number,
    updatedAt: string | null
  }

PUT /api/terminal/workspace
{ baseRevision: number, workspace: TerminalWorkspaceV1 }
→ 200 { workspace, revision: baseRevision + 1, updatedAt }
```

PUT memakai conditional update atas `User.id + terminalWorkspaceRevision`, lalu increment revision
di write yang sama. Bila tidak ada row yang cocok, respons:

```text
409 {
  code: "revision-conflict",
  error: "workspace terminal berubah di perangkat lain",
  current: { workspace, revision, updatedAt }
}
```

Kedua route **COOKIE_ONLY** karena respons bergantung `req.user.id`. Agent token dan device token
tidak mempunyai akun browser yang bisa dipakai sebagai owner. Client ber-role `client` tetap tidak
masuk dashboard operator dan ditolak allowlist portal seperti hari ini.

`workspace: null` hanya pernah dikembalikan GET untuk akun yang belum punya state. PUT tidak
menerima `null`, sehingga state yang sudah ada tidak dapat dikosongkan menjadi “belum pernah
diinisialisasi”. Empty layout sah sebagai `TerminalWorkspaceV1`, tetapi hanya ditulis akibat mutasi
operator atau seed legacy yang eksplisit—tidak otomatis saat mount.

### 4. State machine klien: load sebelum write

Controller/hook Terminal mempunyai empat keadaan:

1. `loading-server`: boleh menampilkan cache recovery, tetapi semua penulis kanonik ditahan;
2. `ready`: snapshot server dan revision sudah diketahui; mutasi boleh dikirim;
3. `recovering`: GET gagal; cache per-user boleh dirender read-only dan tombol retry/status terlihat;
4. `conflict`: stale write terdeteksi dan sedang/baru selesai dipulihkan; status terlihat operator.

Mount selalu memanggil GET lebih dulu. Tidak ada effect `save(emptyWorkspace())`. Peristiwa
`window.focus` dan `document.visibilitychange` ke `visible` memanggil GET lagi. Listener dibersihkan
saat unmount dan refresh yang tumpang-tindih tidak boleh membuat respons lama menang.

Setiap perubahan grup/grid/pemetaan sesi dikirim sebagai operasi murni atas snapshot kanonik:

1. hitung candidate dari snapshot+view aktif;
2. validasi candidate di client;
3. PUT dengan `baseRevision`;
4. adopsi snapshot/revision respons dan perbarui cache;
5. pada 409, ambil `current`, terapkan ulang **operasi yang sama satu kali pada snapshot terbaru**,
   lalu PUT lagi;
6. bila konflik kedua terjadi, GET terbaru, adopsi server, pertahankan status konflik, dan jangan
   mengklaim mutasi tersimpan.

Mutasi diantrikan per controller agar dua klik lokal tidak memakai revision yang sama. Reapply
berbasis operasi, bukan merge dua blob: `addRow`, `renameGroup`, atau `place(sessionId, cell)` dapat
dihitung ulang terhadap state terbaru dan tetap melewati invariant satu rumah. Operasi yang tidak
lagi punya target (grup/sel telah dihapus perangkat lain) menjadi no-op yang terlihat sebagai
konflik, bukan menebak target baru.

Respons PUT sendiri adalah refresh HTTP sesudah mutasi. Tidak ada WebSocket baru; refresh focus /
visible menutup jarak untuk perangkat lain sesuai arsitektur HTTP Hanoman.

### 5. Migrasi satu kali dan cache recovery per-user

Kunci lama `hanoman.terminal.workspace` dibaca hanya selama bootstrap:

- GET server berisi workspace → server menang; key lama dibuang;
- GET server `null` + key lama valid → kirim PUT `baseRevision: 0` sebagai seed;
- seed kalah 409 → snapshot server dari pemenang diadopsi; key lama dibuang;
- GET server `null` + browser tanpa key → tampilkan empty workspace lokal, **tanpa PUT**;
- GET gagal → jangan seed dan jangan buang key lama.

Parser legacy menerima bentuk `{groups, active}` yang dipakai SPEC-161, memvalidasi `groups` lewat
schema v1, dan membuang `active` dari payload kanonik. Key lebih tua
`hanoman.terminal.layout` tetap dimigrasikan ke satu grup “Utama” di memori sebelum aturan seed yang
sama, sehingga tidak ada dua writer localStorage bertingkat.

Sesudah bootstrap berhasil, cache recovery memakai key ber-scope user:

```text
hanoman.terminal.workspace.v2.<userId>
```

Nilainya `{workspace, revision, active}`. Cache hanya ditulis dari respons server yang valid,
tidak pernah menjadi input PUT kecuali jalur seed key legacy di atas. Pada fetch gagal cache boleh
menjaga orientasi visual, tetapi mutasi kanonik dinonaktifkan sampai server berhasil dimuat. Scope
user mencegah akun kedua pada browser yang sama melihat atau men-seed layout akun pertama.

### 6. Rekonsiliasi sesi menunggu daftar tmux otoritatif

`listTerminals()` dan GET workspace berjalan saat mount. Rekonsiliasi hanya boleh dimulai setelah
keduanya berhasil:

- `sessionsLoaded === true` membuktikan daftar tmux awal selesai;
- `workspaceStatus === ready` membuktikan revision server diketahui;
- `reconcileAll` mengosongkan hanya id yang tidak ada pada daftar tmux;
- bila hasil berbeda, persist melalui jalur PUT/CAS yang sama seperti mutasi operator;
- bila list sesi gagal, jangan mengganti `sessions` menjadi `[]` yang dianggap otoritatif dan jangan
  merekonsiliasi.

Pane `exited` masih berada pada `listSessions()` dan karena itu tetap terpetakan. Session close yang
baru terjadi akan direkonsiliasi setelah snapshot tmux berikutnya, bukan berdasarkan asumsi UI.

### 7. Responsive hanya proyeksi render

Desktop/tablet merender CSS grid lengkap; mobile menampilkan satu cell aktif sambil menjaga semua
cell mounted sesuai kontrak SPEC-767/771. Pergantian tier hanya mengubah proyeksi DOM dan
`activeCell` lokal. Tidak ada code path responsive yang memanggil `removeRow`, `removeColumn`,
`setCell`, atau PUT.

Payload kanonik yang dibaca sebelum dan sesudah desktop → tablet → mobile harus byte-equivalent
untuk `groups[].layout`: `sessionId` tetap pada group id dan koordinat row-major yang sama.

## Error handling dan affordance

- GET gagal: render cache/empty recovery dengan pesan “Layout server belum tersambung”; kontrol
  kanonik disabled, Retry tersedia. Tidak ada toast sukses dan tidak ada PUT.
- payload server rusak/versi asing: perlakukan seperti kegagalan server read-only; jangan seed.
- PUT 400: bug/invalid candidate; adopsi server tidak diubah dan tampilkan galat.
- PUT 409: tampilkan status “Layout berubah di perangkat lain”; reapply bounded seperti di atas.
- seed kalah race: bukan galat operator; adopsi `current` dan tandai sinkron.
- cache/localStorage gagal: aplikasi tetap memakai server; mode privat/kuota penuh tidak memblokir.

Status ditempatkan di toolbar Terminal, ringkas dan tidak mengubah ukuran grid secara permanen.

## Test wajib

**Shared / bentuk**

- schema menerima bentuk v1 sah dan menolak versi asing, cells tak cocok dimensi, grup/id duplikat,
  sessionId duplikat lintas grup, serta batas ukuran;
- adapter legacy memisahkan `active` dan mempertahankan urutan/koordinat.

**Server / API**

- GET akun baru menghasilkan `null, revision:0`;
- PUT valid menghasilkan revision 1; PUT stale menghasilkan 409 + current;
- dua user menyimpan layout berbeda dan tidak dapat membaca layout satu sama lain;
- payload rusak ditolak tanpa mengubah revision;
- stored JSON rusak/versi asing gagal-tertutup;
- capability map menandai `/terminal/workspace` COOKIE_ONLY;
- migration SQLite berangkat dari schema sebelumnya dan mempertahankan user lama.

**Frontend / orchestration**

- server state dimuat sebelum empty workspace dapat ditulis;
- legacy valid men-seed hanya saat server null; browser tanpa key tidak PUT;
- server non-null menang atas legacy; seed race 409 mengadopsi pemenang;
- cache per-user hanya dipakai read-only saat GET gagal dan tak pernah diunggah otomatis;
- focus/visible melakukan refetch; respons stale tidak menang;
- konflik dua device melakukan reapply sekali dan menampilkan status;
- rekonsiliasi tidak berjalan sebelum `listTerminals` resolve dan tidak berjalan saat ia gagal;
- rekonsiliasi sesudah daftar otoritatif mempersist sel sesi yang benar-benar lenyap;
- simulasi desktop → tablet → mobile mengubah proyeksi render saja: `sessionId` tetap di grup dan
  indeks sel yang sama serta tidak ada PUT akibat resize/tier.

## Dokumen yang berubah

- `internal/docs/architecture/data-model.md` — field User LOCAL-only;
- `internal/docs/architecture/api-contract.md` — GET/PUT + 409;
- `internal/docs/requirements/frd.md` — requirement Terminal lintas perangkat;
- `internal/docs/frontend/frontend-implementation.md` — state machine, migrasi, responsive;
- `internal/docs/adr/0115-*.md` — ditandai diamandemen untuk pemetaan kerja Terminal;
- `internal/docs/adr/0118-*.md` + kedua index ADR;
- `internal/skills/hanoman/SKILL.md` — invariant operasional baru.

## Yang tidak berubah

- tmux tetap source of truth sesi hidup; workspace hanya memetakan id ke sel;
- WebSocket tetap hanya untuk PTY dan snapshot sesi yang sudah ada; tidak ada kanal layout baru;
- state presentasional perangkat tidak disimpan server;
- device sync server-to-server ADR-0043/0045 tidak dipakai;
- role client tetap tidak memperoleh Terminal;
- menutup baris/kolom tetap tidak mematikan sesi; sesi jatuh ke tray.
