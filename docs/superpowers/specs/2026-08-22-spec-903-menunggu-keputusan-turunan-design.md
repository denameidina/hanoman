# "Menunggu keputusan" sebagai keadaan turunan, bukan latch marker

Tanggal: 2026-08-22 · Sumber: qa · Prioritas: tinggi · Backlog **SPEC-903** (project `hanoman`)
· **ADR-0143** (lihat §4).

Audit: `docs/superpowers/audits/2026-08-22-spec-903-menunggu-keputusan-turunan.md` — seluruh angka
yang dikutip di sini diukur di sana, bukan diperkirakan.

## 1. Masalah

`SessionInfo.decision` mengaku sebagai **keadaan** ("sesi ini sedang menunggu manusia") padahal ia
membaca sebuah **pemberitahuan** ("sesi ini pernah minta masukan"): satu bit dari ukuran berkas
marker `.worktrees/.decisions/<id>` (`pty.ts:46,297`).

Marker itu dipasang hook agen (claude `Notification`, codex `Stop`) dan dilepas oleh **satu**
peristiwa saja — `UserPromptSubmit`, yakni manusia mengetik prompt polos — plus jalur rantai lead
(`lead/detect.ts:306`). Empat cara episode menunggu berakhir tak melepasnya:

| jalur | kenapa marker tetap terisi |
|---|---|
| (a) memilih opsi `AskUserQuestion`/izin di TUI | jawabannya *tool result*, bukan prompt |
| (b) `POST /terminal/sessions/:id/dialog/answer` (SPEC-899) | handler-nya tak menyentuh marker |
| (c) Esc | bukan event hook apa pun |
| (d) codex melanjutkan sendiri | marker dipasang di **tiap** akhir turn |

Akibatnya, terukur 2026-08-22: pane `hanoman-spec-901` memutar `✢ Creating… (28m 3s)` dan
`hanoman-spec-902` memutar `✶ Manifesting… (25m 12s)` sementara pil "Menunggu keputusan" menyala
pada keduanya.

Menambal keempat jalur satu per satu tak akan pernah selesai: jalur keluar bertambah tiap kali ada
permukaan baru (tombol layar SPEC-800, panel pet SPEC-899, mesin agen ketiga). Yang perlu diperbaiki
adalah **artinya**.

## 2. Hasil yang dituju

1. Pil "Menunggu keputusan" di sel Terminal padam dalam ≤ 3 detik setelah agen kembali bekerja —
   apa pun jalur yang mengakhiri episode menunggunya, claude maupun codex.
2. Pet mengatakan hal yang sama pada detik yang sama. Bukan karena dua rumus dijaga tetap mirip,
   tetapi karena keduanya membaca satu bit yang sama.
3. Notifikasi `decision` dan daftar `waiting` panel lead ikut memakai arti yang sama.
4. "Menunggu sejak" (`decisionAt`) menunjuk awal episode yang **sedang** berlangsung, bukan episode
   marker yang bisa jauh lebih tua.
5. Nol invokasi tmux tambahan per sesi per poll.

## 3. Keputusan yang mengikat

1. **`decision` menjadi turunan:** `!exited && markerFilled(f) && paneQuiet(pane)`.
2. **`paneQuiet` diturunkan dari `#{window_activity}`**, variabel format yang ikut di `FMT` milik
   `tmux list-panes -a` yang sudah dipanggil hari ini — pola yang persis dipakai SPEC-863 untuk
   `#{alternate_on}`. Tak ada `capture-pane` baru, tak ada invokasi kedua.
3. **`PANE_QUIET_MS = 3000`.** Terukur: pane claude yang bekerja punya `window_activity == now` pada
   22/22 sampel 1 Hz (jeda keluaran maksimum ≤ 1 dtk), pane yang diam beku 317 dtk. Ambangnya 3×
   margin di atas jeda terukur dan di atas lag pembulatan detik.
4. **Fail-open.** `window_activity` tak terbaca / bukan angka → `paneQuiet = true` → perilaku persis
   hari ini. Ragu selalu berarti pil tetap menyala: pil yang menyala kelewat lama itu mengganggu,
   pil yang padam saat ada pertanyaan sungguhan membuat manusia kehilangan pertanyaannya.
5. **Marker tetap durable.** Tak ada jalur yang mengosongkan marker berdasarkan tebakan "pane
   sedang sibuk" (alasan di §4.2). Satu-satunya penghapus baru adalah bukti positif manusia sudah
   menjawab: `POST /terminal/sessions/:id/dialog/answer` yang berhasil.
6. **`decisionAt = ISO(max(onset di marker, window_activity))`** saat `decision` true. Isi marker
   tetap "epoch onset, ditulis sekali" — semantik ADR-0141 tak disentuh, hanya turunannya.
7. **Satu sumber untuk empat permukaan.** `liveDecisions()` mengembalikan bit turunan yang sama,
   dipakai `scanDecisions` (notifikasi) dan panel lead. Terminal & pet sudah membaca
   `SessionInfo.decision` yang sama, jadi tak ada rumus kedua yang perlu dijaga.
8. **Pintu lead (`lead/detect.ts`) tidak disentuh.** Ia sudah punya gerbang pane sendiri yang lebih
   kuat (`AGENT_TURN_LINE`, SPEC-487, pemisahan terukur 6/6 vs 0/16).

## 4. Keputusan yang butuh alasan panjang

### 4.1 Kenapa `#{window_activity}`, bukan isi layar

Arah perbaikan yang diminta backlog menyebut contoh berbasis isi pane ("readDialogScreen terbaca =
memang menunggu; pane memutar spinner kerja = tidak"). Isi pane **bisa** dibaca tanpa invokasi
tambahan — tmux 3.7b mendukung `#{C/ri:pola}` dan biayanya terukur +0,21 ms untuk dua variabel atas
empat pane. Tetap ditolak sebagai sumber utama, karena tiga hal:

1. **Lebar pane memotong penandanya.** Pane sesi di mesin dev berukuran 52 kolom, dan di sana baris
   kerja claude terbaca `✳ Manifesting… (32m 13s · ↓ 130.3k tokens)` — `esc to interrupt` sudah
   terpotong habis. Penanda kerja yang paling jelas justru yang paling dulu hilang.
2. **Bentuknya kontrak tampilan agen, bukan kontrak kita.** Nama verb claude berganti tiap rilis;
   codex punya baris statusnya sendiri. `window_activity` berlaku sama untuk keduanya dan untuk
   mesin agen ketiga yang belum ada.
3. **Footer dialog sebagai gerbang positif justru menahan pil menyala di jalur (a).** Sesudah
   manusia memilih opsi, footer bisa masih terlihat di layar sementara agen sudah kembali bekerja —
   persis jalur utama laporan ini.

Yang dibeli `window_activity`: pemisahan terukur 0 dtk vs 317 dtk, tanpa satu pun regex atas teks
milik orang lain. Yang dibayar: ia buta terhadap "pane berisik tapi menunggu" (mis. keluaran tugas
latar belakang selagi dialog terbuka). Harga itu diterima karena arah gagalnya sudah dijaring:
notifikasi `decision` untuk episode itu lahir lebih dulu, dan pil kembali menyala 3 dtk sesudah
keluarannya berhenti.

Diverifikasi bahwa `window_activity` berdetak **tanpa klien tmux terpasang** (audit §3.2) — penting,
karena hanoman baru memasang klien saat ada yang menonton.

### 4.2 Kenapa marker TIDAK ikut dikosongkan saat pane terbaca sibuk

Godaan yang wajar: sekalian truncate markernya, supaya latch-nya benar-benar lepas dan onset ikut
segar. **Ditolak.**

`Notification` claude mengisi marker **sekali per dialog** dan tak pernah menembak lagi selama
dialog itu terbuka — terukur di SPEC-452: 0 B selama 120 detik dengan dialognya masih terbuka
(`lead/detect.ts:300-305`). Bila satu keluaran latar belakang membuat kita menghapus marker
sementara dialognya masih menunggu, pertanyaan itu **hilang permanen** dari pil, pet, notifikasi,
dan panel lead. Tak ada yang akan menulisnya kembali.

Jadi pembagiannya tegas: **marker = sinyal masuk yang durable** (hanya agen dan bukti positif
jawaban manusia yang boleh mengubahnya), **`decision` = pembacaan yang digerbangi**. Heuristik hanya
boleh menggerbangi pembacaan, tak pernah merusak sinyalnya.

### 4.3 Kenapa `decisionAt` harus ikut diturunkan

Dengan `decision` turunan, satu episode marker bisa memuat beberapa episode menunggu: menunggu →
dijawab di TUI → agen bekerja 20 menit → agen diam lagi. `decisionAt` yang tetap menunjuk onset
marker akan melaporkan "menunggu 20 menit" untuk tunggu yang baru berumur 1 menit, dan
`PET_URGENT_MS` (10 menit) menjerit palsu. Membiarkannya berarti memperbaiki pil sambil merusak
gelembung pet — batas (2) backlog dilanggar lewat pintu belakang.

Awal episode yang sekarang **adalah** `window_activity`: detik terakhir pane mengeluarkan sesuatu.
Operator `max` dipakai (bukan "pakai activity saja") supaya kasus langka onset > activity — hook
menembak sesudah keluaran terakhir — tetap memberi angka yang lebih benar.

Dua konsekuensi yang disengaja, dan keduanya perbaikan:

- Marker pra-ADR-0141 (isi `waiting`; dua marker seperti ini masih hidup di mesin dev) hari ini
  memberi `decisionAt: undefined`; kini mereka punya jawaban.
- Manusia yang mulai mengetik di pane yang menunggu (echo → activity) me-reset "menunggu sejak".
  Itu benar: pet tak perlu mendesak sesi yang sedang dilayani orang.

### 4.4 Kenapa dedup notifikasi tetap dikunci pada marker, bukan pada bit turunan

`scanDecisions` menghindari notifikasi ganda lewat `Set` id yang sedang menunggu. Bila set itu
dikunci pada bit turunan, satu kedipan (manusia mengetik jawabannya dengan jeda > 3 dtk → sibuk →
diam) melahirkan notifikasi "menunggu keputusan" **kedua** untuk pertanyaan yang sama.

Jadi dua peran dipisah: **kapan menotifikasi** memakai bit turunan (sehingga codex yang terus
bekerja tak lagi menotifikasi di tiap akhir turn — perbaikan atas jalur (d)), sedangkan **berapa
kali** tetap dikunci pada marker terisi. Id keluar dari set hanya saat markernya kosong atau
sesinya hilang, persis seperti hari ini.

### 4.5 Alternatif yang ditolak: menambal keempat jalur

Menghapus marker di route `dialog/answer`, di handler Esc, di jalur tombol layar, dan mengganti hook
codex. Ditolak sebagai *solusi*: daftar jalurnya terbuka, dan tiap permukaan baru harus ingat
menambal. Tambalan (b) tetap **dikerjakan** — batas (5) backlog, dan ia benar sendiri: jawaban lewat
`dialog/answer` adalah bukti positif manusia sudah menjawab, kembaran `UserPromptSubmit` untuk jalur
SPEC-899. Yang ditolak adalah menganggap tambalan itu cukup.

### 4.6 Kenapa `lead/detect.ts` tidak ikut digerbangi

Pintu deteksi lead sudah menolak sesi yang layarnya berakhir pada baris giliran agen (SPEC-487).
Gerbang itu **lebih kuat** dari milik kita (berbasis isi, bukan waktu) dan sudah punya test-nya
sendiri. Menumpuk gerbang kedua di sana menambah permukaan kegagalan tanpa menutup satu pun jalur
yang belum tertutup. `liveDecisions()` tetap mengembalikan bit turunan untuk pemakai lain; `detect`
memakai `deps.filled` seperti hari ini.

## 5. Kontrak server

### 5.1 `server/src/services/pty.ts`

```ts
/** Pane yang tak mengeluarkan apa pun selama ini dibaca sebagai "tidak sedang bekerja". */
export const PANE_QUIET_MS = 3_000;

/** `activityAt` = `#{window_activity}` (detik epoch). NaN / tak terbaca → true (fail-open). */
export const paneQuiet = (activityAt: number, now?: number): boolean;
```

`FMT` bertambah satu kolom di **ujung**: `#{window_activity}`. `Pane` bertambah
`activityAt: number`.

`parsePanes`:

```
decision: !exited && !!decisionFile && markerFilled(decisionFile) && paneQuiet(activityAt)
```

`toSessionInfo`:

```
...(decision && decisionFile ? { decisionAt: decisionOnset(decisionFile, activityAt) } : {})
decisionOnset = ISO(max(onset epoch di marker ?? 0, activityAt ?? 0)), undefined bila 0
```

`liveDecisions()` mengembalikan `{ id, specId, projectId, decisionFile, waiting }` — `waiting`
adalah `Pane.decision` yang sama. Bentuk lama tetap ada, jadi `DetectDeps.live` (tipe struktural yang
lebih sempit) tetap cocok tanpa perubahan.

### 5.2 `server/src/services/notifications.ts`

`DecisionSession` bertambah `waiting: boolean`. `scanDecisions`:

```
for (const s of read()) {
  if (!markerFilled(s.decisionFile)) continue;   // marker kosong → keluar dari set (seperti hari ini)
  if (awaiting.has(s.id)) { next.add(s.id); continue; }   // sudah dinotifikasi: latch dedup
  if (!s.waiting) continue;                      // marker terisi tapi agen masih bekerja
  next.add(s.id); fresh.push(s);
}
```

### 5.3 `server/src/routes/lead.ts`

```
waiting = liveDecisions().filter((d) => d.waiting).map((d) => d.id);
```

(menggantikan `.filter((d) => markerFilled(d.decisionFile))`)

### 5.4 `server/src/routes/terminal.ts`

`POST /terminal/sessions/:id/dialog/answer`: sesudah `answerSessionDialog` mengembalikan `ok`,
kosongkan marker sesi bila ia punya (`clearDecisionMarker(s.decisionFile)`). Gagal menulis diabaikan
— marker lenyap sama artinya dengan marker kosong. Respons tak berubah (`202 {accepted:true}`).

## 6. Kontrak frontend

**Nihil.** `TerminalScreen.tsx:796` (`awaiting = !exited && !!decision`) dan `pet-state.ts:140`
(`decision && !deciding`) tetap apa adanya; `SchedulerScreen.tsx:122` idem. Bentuk DTO
(`zTerminalSession.decision: boolean`, `decisionAt?: string`) tak berubah → nol migrasi, nol dampak
sync. Prioritas lead (`deciding` menang, ADR-0091) dan gerbang SPEC-433 (`finished`/`complete`
menang) hidup di atas bit ini dan tetap berlaku.

## 7. Test

Bit ini kini bergantung waktu, jadi test-nya dipecah dua lapis.

**Murni (cepat, deterministik):**
- `paneQuiet`: NaN → true; `now - act < 3s` → false; `>= 3s` → true; tepat di ambang.
- `scanDecisions`: marker terisi + `waiting:false` → nol notifikasi; lalu `waiting:true` → satu;
  kedipan `true→false→true` dalam satu episode marker → tetap satu; marker dikosongkan lalu diisi
  lagi → dua.

**Integrasi tmux sungguhan (`server/test/pty.test.ts`, pola `pty-altscreen.test.ts`):**
- pane yang **berisik** (fixture mencetak terus) + marker terisi → `decision === false`;
  setelah keluarannya berhenti → `decision === true`. Ini test regresi SPEC-903.
- `decisionAt` mengikuti `window_activity`, bukan epoch tua di marker — dua asertion lama di
  `pty.test.ts:669-682` diperbarui, karena artinya memang berubah (ADR-0143 §konsekuensi).

**Route:** `terminal-dialog.route.test.ts` — jawaban yang diterima mengosongkan marker.

## 8. Yang TIDAK dikerjakan

- Mengubah hook agen (`runner/src/settings.ts`, `runner/src/codex-settings.ts`). Marker tetap ditulis
  seperti hari ini; sesi yang sudah berjalan ikut terperbaiki tanpa dilahirkan ulang.
- Mengubah `lead/detect.ts` (§4.6).
- Membaca isi pane untuk gerbang ini (§4.1). `#{C/ri:}` dicatat di audit sebagai jalan yang tersedia
  bila suatu saat dibutuhkan.
- Menyentuh isi marker / semantik ADR-0141.
- Skema, DTO, migrasi, sync.

## 9. Docs yang tersentuh

- `internal/docs/adr/0143-menunggu-keputusan-keadaan-turunan.md` (baru) + catatan amandemen di
  `internal/docs/adr/0141-onset-menunggu-di-marker-keputusan.md`
- `internal/docs/adr/README.md`, `internal/docs/README.md` (index)
- `internal/docs/architecture/api-contract.md` — arti `decision` / `decisionAt`
- `internal/docs/frontend/frontend-implementation.md` — kosakata status sesi
- `internal/skills/hanoman/SKILL.md` — bila ia menjelaskan marker sebagai sumber langsung pil
