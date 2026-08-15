# ADR-0118 — Workspace Terminal kanonik per user dengan optimistic concurrency

- Status: Accepted
- Tanggal: 2026-08-15
- SPEC: SPEC-786
- Terkait: **mengamandemen sebagian** [0115](0115-state-tampilan-dashboard-persisten.md): mapping
  kerja Terminal bukan lagi state tampilan browser; `terminal.project`, fullscreen, cell aktif,
  modal, dan state presentasional lain tetap lokal. **Menegakkan**
  [0016](0016-sesi-terminal-hidup-di-tmux.md): tmux tetap sumber sesi hidup, server hanya menyimpan
  susunan kerjanya. Tidak memakai sync antar-instance [0043](0043-device-token-bootstrap-sync.md)/
  [0045](0045-sync-scope-dan-resolusi-konflik.md) dan tidak menambah WebSocket.

## Konteks

Sejak SPEC-161/740, grup, ukuran grid, urutan sel, dan `sessionId` Terminal disimpan sebagai blob
`{groups,active}` di `localStorage` `hanoman.terminal.workspace`. Susunan itu selamat dari refresh
browser yang sama, tetapi desktop, tablet, dan ponsel mempunyai salinan berbeda. Operator yang sudah
menyusun sesi di desktop kehilangan orientasi saat membuka akun yang sama di perangkat lain.

Ini bukan sekadar preferensi presentasi: grup dan koordinat grid adalah peta kerja sesi tmux yang
sama. Last-write-wins tanpa revisi juga tidak cukup; dua tab dapat membaca snapshot sama lalu tab
yang terlambat menyimpan diam-diam menghapus perubahan tab lain.

## Keputusan

### State kanonik per akun

`User` mendapat tiga field LOCAL-only:

- `terminalWorkspace Json?` — null berarti akun belum mempunyai mapping server;
- `terminalWorkspaceRevision Int @default(0)` — token optimistic concurrency;
- `terminalWorkspaceUpdatedAt DateTime?` — waktu write sukses terakhir.

Field ini tidak masuk device sync/server-to-server, `PG_ORDER`, atau webhook. Akun adalah kredensial
per-instance; layout akun lain tidak pernah menjadi fallback.

Wire shape tervalidasi bernama `TerminalWorkspaceV1`:

```ts
type TerminalWorkspaceV1 = {
  version: 1;
  groups: Array<{
    id: string;
    name: string;
    layout: { rows: number; cols: number; cells: Array<string | null> };
  }>;
};
```

Urutan array adalah urutan grup dan `cells` row-major adalah koordinat kanonik. Batasnya: 1–24 grup,
id grup unik 1–128 karakter, nama trim 1–80, `rows`/`cols` 1–12, panjang `cells` tepat
`rows * cols`, dan `sessionId` trim 1–256 yang unik di seluruh grup. Versi/bentuk asing gagal aman;
server tidak menormalkan blob rusak menjadi workspace kosong.

`active` tidak masuk wire shape. Pilihan grup/cell, fullscreen/maximized, modal, viewport, dan panel
mobile yang terlihat adalah state presentasional per perangkat. Responsive hanya memproyeksikan
`TerminalWorkspaceV1`; ia dilarang memangkas sel atau menyimpan hasil proyeksinya.

### Kontrak HTTP dan konflik

Route cookie-only, selalu memakai `request.user.id`:

- `GET /api/terminal/workspace` → `{workspace,revision,updatedAt}`;
- `PUT /api/terminal/workspace` dengan `{baseRevision,workspace}` → snapshot revision berikutnya;
- stale `baseRevision` → `409 {code:"revision-conflict",current}` tanpa perubahan row;
- payload salah → 400; JSON tersimpan non-null yang tidak lolos schema → 422 dan tidak diperbaiki
  diam-diam.

CAS dilakukan oleh satu `UPDATE User ... WHERE id = userId AND terminalWorkspaceRevision =
baseRevision` dengan increment revision. Route berada sebelum mapping capability generik Terminal:
AgentToken selalu mendapat `COOKIE_ONLY`, karena capability sesi tidak membawa identitas akun admin.

Klien menserialkan semua GET/PUT. Setelah satu 409, fungsi mutasi yang sama diterapkan ulang ke
snapshot `current` dan dicoba tepat sekali. Konflik kedua menghentikan write, memuat snapshot terbaru,
dan menampilkan status; tidak ada retry tanpa batas atau last-write-wins tersembunyi.

### Bootstrap, migrasi, dan recovery

Mount selalu GET server **sebelum writer diaktifkan**. Urutannya mengikat:

1. Bila server punya `workspace`, adopsi dan hapus key legacy.
2. Bila server null dan browser punya legacy tervalidasi di `hanoman.terminal.workspace` (atau key
   lebih tua `hanoman.terminal.layout`), PUT dengan revision hasil GET sebagai seed satu kali.
3. Bila server null dan browser kosong, tampilkan workspace kosong lokal tanpa PUT. Browser kosong
   tidak pernah menjadi seed yang menimpa akun.
4. Bila seed berbalapan dan menerima 409, snapshot server menang; legacy tidak diterapkan ulang.

Sesudah migrasi, server adalah source of truth. Cache recovery
`hanoman.terminal.workspace.v2.<userId>` terisolasi per user dan hanya membantu paint saat GET gagal;
cache tidak pernah diunggah otomatis, writer tetap mati, dan kegagalan fetch tidak mereset server.
Tab me-refresh melalui HTTP saat mount, window kembali focus, document kembali visible, dan sesudah
mutasi. Tidak ada WebSocket baru.

Rekonsiliasi cell mati baru boleh berjalan setelah **dua** bukti tersedia: workspace server berhasil
dimuat dan `GET /terminal/sessions` berhasil membawa daftar tmux otoritatif. Rejection daftar sesi
tidak sama dengan daftar kosong. Hasil reconcile yang benar-benar berubah dipersistenkan lewat CAS.

## Alternatif yang ditolak

- **Tetap localStorage.** Tidak memenuhi lintas perangkat dan mempertahankan banyak salinan kanonik.
- **Device sync ADR-0043/0045.** Itu menyinkronkan entity antar-instance; masalah ini adalah dua
  browser untuk akun yang sama pada satu instance.
- **Last-write-wins timestamp.** Snapshot lama tetap dapat menghapus perubahan baru tanpa sinyal.
- **WebSocket baru.** Arsitektur membutuhkan refresh HTTP pada lifecycle/focus dan sesudah mutasi;
  stream baru menambah protokol tanpa menghilangkan CAS.
- **Simpan layout responsive per tier.** Membuat desktop/mobile berselisih tentang koordinat sesi dan
  memungkinkan viewport sempit menghapus cell kanonik.

## Konsekuensi & gotcha

1. `TerminalWorkspaceV1` hidup di `@hanoman/shared`; route, cache, legacy adapter, dan UI memakai
   validator yang sama.
2. Mutasi disimpan sebagai fungsi atas workspace, bukan hanya blob hasil akhir, agar dapat diterapkan
   ulang pada snapshot konflik terbaru tanpa menghapus perubahan perangkat lain.
3. Pemilihan grup aktif setelah add tetap lokal, tetapi mutasi harus membawa active hint saat respons
   PUT diadopsi; bila tidak, grup baru lahir lalu UI kembali ke grup lama.
4. Cache berkunci user. Key global lama hanya input migrasi satu kali dan baru dihapus setelah server
   state berhasil diadopsi atau seed diterima.
5. `sessions=[]` sebelum request selesai bukan fakta tmux. Flag sukses terpisah wajib; `.finally()`
   yang menyalakan loaded menghidupkan kembali penghapusan massal saat request gagal.
6. Resize desktop/tablet/mobile dan selector panel hanya mengubah DOM/`aria-hidden`; keduanya tidak
   boleh memanggil writer kanonik.
