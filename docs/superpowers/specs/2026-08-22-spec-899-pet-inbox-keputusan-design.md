# Pet inbox keputusan — menjawab `AskUserQuestion` agen langsung dari panel pet (spec D)

Tanggal: 2026-08-22 · Sumber: brief · Prioritas: sedang · Backlog **SPEC-899** (project `hanoman`)
· **ADR-0142** (lihat §4).

Spec **penutup** program "Pet hidup" (A→B→C→D, roadmap di spec A §13:
`docs/superpowers/specs/2026-08-22-pet-hidup-atlas-sprite-design.md`). A memberi pet **tubuh**
(atlas sprite, pipeline aset, mesin berkeliaran). B memberi pet **kejujuran** (status koneksi,
lencana hitungan, panel multi-kondisi, pose `deciding` & tidur). C memberi pet **suara** (gelembung
ber-template, rekap "selama kamu pergi", urgensi menurut umur, pose `thanks`). D memberi pet
**tangan**: pertanyaan agen bisa dijawab di tempat pet mengatakannya.

## 1. Masalah

1. **Pet menunjuk, lalu menyerah.** Kondisi `waiting` sudah dihitung, dinamai, diberi umur, dan
   diucapkan lewat gelembung — tetapi satu-satunya tombolnya adalah **"Buka Terminal"**. Operator
   harus pindah layar, mencari pane yang benar di antara grid workspace, membaca ulang pertanyaan
   yang tadi sudah dibacakan pet, lalu menjawabnya lewat keyboard. Pet mengubah "cari tahu apa yang
   perlu perhatianmu" jadi satu pandangan, tetapi tak mengubah satu pun langkah **sesudah** itu.
2. **Seluruh mekanismenya sudah ada — untuk agen, bukan untuk manusia.**
   `server/src/services/tui-dialog.ts` (SPEC-452/474/485, ADR-0102) sudah mem-parse teks pane jadi
   `ChoiceDialog` dan menjawabnya lewat primitif `PaneIO` yang disuntikkan, lengkap dengan empat
   jebakan yang **sudah terukur in-vivo**: burst > 1 karakter ditelan, digit memilih seketika,
   kolom bebas ada di nomor `opsi+1`, dan `Submit` multiSelect tak punya nomor. Yang memakainya
   hari ini hanya `hanoman-lead` lewat `sendToPane`. Tak ada satu pun pintu HTTP yang membungkusnya
   untuk manusia di dashboard.
3. **Jawaban manusia tak punya gerbang.** `POST /terminal/sessions/:id/steer` mengetik prosa apa
   adanya ke pane — ia benar untuk "steer", tetapi ia **tidak** memberi tahu klien apa
   pertanyaannya, apa opsinya, atau apakah layar yang dijawab masih layar yang sama. Sebuah dialog
   yang sudah dijawab orang lain 200 ms sebelumnya akan tetap menerima ketikan.

## 2. Hasil yang dituju

Panel pet menjadi **inbox keputusan**: untuk tiap sesi `waiting` ia menampilkan pertanyaan agen
beserta opsinya dan menjawabnya dengan satu klik, dengan gerbang yang memastikan yang dijawab
memang layar yang ditampilkan. Gelembung C menawarkan "Jawab di sini". Tanpa skema DB baru, tanpa
channel realtime baru, tanpa satu byte pun perubahan pada `sendToPane`, dan tanpa merusak jaminan
A/B/C (reduced-motion, a11y, gerbang tap SPEC-763, mesin berkeliaran, gerbang lead).

## 3. Keputusan yang mengikat

1. **Dua endpoint, keduanya di bawah `/api/terminal/sessions/:id/`** — `GET …/dialog` dan
   `POST …/dialog/answer`. Prefix itu sudah dipetakan `capabilityForRoute` (§5.1), jadi tak ada
   satu baris pun yang perlu ditambahkan ke peta capability.
2. **`screenHash` = hash dari `dialogKey(paneText)`, bukan dari teks pane mentah.** Teks pane
   memuat kursor berkedip dan spinner; hash atasnya akan berubah antar dua `capture-pane`
   berturut-turut dan setiap jawaban akan ditolak 409. `dialogKey` adalah jawaban kanonik repo ini
   atas pertanyaan "layar mana ini" dan sudah membawa dua gotcha ADR-0102 (§4.2).
3. **Jalur menulisnya PERSIS dispatch `sendToPane`,** tanpa cabang baru: `multi && submit.present`
   → `answerMultiSelectDialog`; `freeIndex !== null` → `answerChoiceDialog`; `notes` →
   `answerNotesDialog`. Layar yang tak memenuhi satu pun dari ketiganya (dialog trust, prompt izin)
   **tak pernah dilaporkan sebagai bisa dijawab** — GET menjawab `204` (§4.4).
4. **Jawaban single-select disampaikan lewat KOLOM BEBAS, bukan dengan menekan digit opsinya.**
   Ini yang diminta objective (`answerChoiceDialog`) dan ia satu-satunya jalur yang **fail-closed**:
   ia membuktikan teksnya mendarat sebelum menekan `Enter`. Alternatif "tekan digit" ditolak di
   §4.5.
5. **Gerbang lead ditegakkan apa adanya.** Sesi `isDeciding(id)` → `409`. `lead/gate.ts` dan
   `lead/deciding.ts` tak disentuh satu baris pun.
6. **Satu jawaban pada satu waktu per sesi.** Kunci in-memory (`Set<string>`), cermin
   `lead/deciding.ts`: dua POST berbarengan pada satu pane akan menyilangkan keystroke jadi sampah
   yang tak bisa ditarik kembali. Ditolak `409 reason:"answering"`.
7. **Tanpa polling baru.** Dialog diambil saat panel dibuka dan saat sesi `waiting` berganti —
   bukan interval. Keadaan "terjawab" datang dari siaran `sessions` yang sudah ada (marker
   keputusan dikosongkan hook yang sudah ada, SPEC-184/ADR-0141).
8. **DTO-nya hidup di `shared`, `ChoiceDialog` tidak.** `tui-dialog.ts` adalah modul **server**
   yang tahu soal tmux dan teks pane; frontend tak boleh mengimpornya. Server memetakan
   `DialogScreen` → `SessionDialog` (shared) satu kali, di satu tempat.
9. **UI-nya komponen sendiri (`PetAnswer.tsx`), bukan tambahan di `HanomanPet.tsx`.** Komponen pet
   sudah 532 baris dan memegang mesin berkeliaran, gelembung, panel, dan a11y; kotak jawaban punya
   siklus hidup sendiri (fetch, kirim, terkirim, 409 → muat ulang).
10. **ADR-0142, kecil.** Yang arsitektural hanya: dua endpoint yang MENGGERAKKAN agen atas nama
    manusia, gerbang `screenHash`, dan alasan ia berada di luar katalog MCP. ADR-0091 (gerbang
    lead), ADR-0102 (jebakan multiSelect), ADR-0099 (MCP tak mengeksekusi), ADR-0039 (tanpa
    realtime baru), ADR-0065 (peta capability) semuanya **ditegakkan**; tak ada yang dicabut.

## 4. Keputusan yang butuh alasan panjang

### 4.1 Kenapa endpoint baru, bukan `steer`

`POST …/steer` sudah bisa mengetik ke pane, dan sejak SPEC-452 ia bahkan sudah melewati
`tui-dialog.ts`. Tiga hal yang **tak** bisa ia berikan:

- **Klien tak tahu apa pertanyaannya.** `steer` menerima prosa; ia tak pernah mengembalikan bentuk
  layar. Panel yang mau menampilkan opsi harus membaca pane sendiri — yang berarti
  mengekspos `capture-pane` ke browser, jauh lebih luas dari yang dibutuhkan.
- **Tak ada gerbang kesegaran.** `steer` mengetik ke layar apa pun yang kebetulan sedang tampil.
  Untuk aksi yang lahir dari **daftar** (panel pet menampilkan snapshot beberapa detik lalu) itu
  salah bentuk: yang ditampilkan dan yang dijawab bisa berbeda.
- **`choices` tak bisa dinyatakan.** `sendToPane(id, text, chunkMs, choices)` menerima **label**
  untuk multiSelect dan mencocokkannya lewat `resolveChoices` — kecocokan fuzzy yang benar untuk
  agen yang menalar dengan bahasa, dan mubazir untuk manusia yang **menunjuk baris nomor sekian**.

Endpoint baru karena itu bukan duplikasi: ia adalah `steer` **plus** kontrak layar.

### 4.2 Kenapa `dialogKey`, bukan hash teks pane

`dialogKey(paneText)` menghasilkan `q|multi?|tabs|judul-atau-opsi`, `review`, atau `none`. Ia sudah
memikul dua pelajaran mahal:

- **Label kolom bebas sengaja tak masuk** (SPEC-474): begitu prosa mendarat di sana labelnya
  berubah tanpa satu pun pertanyaan berpindah — kunci yang ikut berubah membaca layar yang MACET
  sebagai layar yang MAJU.
- **Untuk layar `multi`, tanda `☐/☒` tab strip dibuang** (gotcha ADR-0102 #1): mencentang satu opsi
  sudah membalik tab yang sedang tampil jadi `☒`, terukur in-vivo, tanpa satu pun pertanyaan
  berpindah.

Keduanya persis sifat yang dibutuhkan gerbang kesegaran: hash **tidak** boleh berubah karena
kursor, spinner, atau centang yang sedang berjalan; ia **harus** berubah begitu dialognya terjawab
(layar berhenti jadi dialog → `none`) atau rantainya maju ke pertanyaan berikutnya (judul berganti).

`screenHash = sha256(dialogKey(paneText)).slice(0, 16)`. Di-hash, bukan mentah, supaya klien
memperlakukannya sebagai token buram: nilai mentah memuat judul pertanyaan dan mengundang klien
menyusunnya sendiri.

Konsekuensi yang diterima sadar: **dua pertanyaan berbeda dengan judul yang sama persis di satu
rantai punya hash yang sama.** Itu bentuk fail-*open* yang sempit — dan jawaban yang mendarat tetap
jawaban atas pertanyaan berjudul sama yang dilihat operator. Menutupnya butuh identitas layar yang
lebih kuat dari yang dipakai lead sendiri, dan dua definisi "layar mana ini" yang bisa berselisih
adalah kelas kegagalan SPEC-431/448.

### 4.3 Kenapa hitungan waktu jawaban tidak dijaga timeout

`answerMultiSelectDialog` bisa memakan waktu: tiap toggle dibuktikan lewat `capture-pane` dengan
jeda `DIALOG_SETTLE_MS` (250 ms), dan navigasi ke kolom bebas/tombol kirim berbatas `NAV_TRIES`
(24). Batas atasnya karena itu sudah **struktural** — bukan tak berhingga — dan menambahkan timeout
HTTP di atasnya hanya memindahkan kegagalan ke tempat yang tak bisa membereskan pane yang
setengah tercentang. Kunci in-flight (§3.6) yang menjaga agar POST kedua tak masuk ke tengah.

### 4.4 Kenapa layar tanpa kolom bebas dan tanpa catatan dilaporkan `204`

Dialog trust codex dan prompt izin claude adalah layar pilihan yang sah: `readChoiceDialog`
mengenalinya. Tetapi di sana `sendToPane` **sengaja tak menyentuh apa pun** — komentarnya di
`pty.ts` menyebutnya lugas: "`Enter` memilih baris 1 yang memang berarti 'ya', dan mengubahnya
menukar bug ini dengan regresi".

Melaporkan layar itu ke panel berarti memasang tombol dashboard yang menjawab **prompt izin**.
Itu tepat kebalikan dari batas yang ditetapkan ADR-0037 (agen dipercaya penuh, isolasi murni lewat
worktree — bukan lewat tombol izin yang bisa diklik dari jauh). Fail-closed: `204`, dan panel
berkata "buka Terminal".

Layar rekap rantai (`kind: "review"`) juga `204`. Ia tak punya pertanyaan — hanya tombol
`Submit answers` — dan jalur mekanisnya sudah dimiliki lead (`submitPaneDialog`). Menambahkannya di
sini berarti tombol kedua untuk pekerjaan yang sama tanpa satu pun keputusan di dalamnya.

### 4.5 Alternatif yang ditolak: menekan digit opsi

Untuk single-select, "digit memilih seketika" — jadi menekan `2` adalah cara paling harfiah
menjawab "opsi 2", dan agen menerimanya sebagai opsi terstruktur, bukan sebagai teks bebas.
Ditolak karena satu sifat: **ia tak bisa dibatalkan dan tak bisa diverifikasi sebelum terjadi.**
`answerChoiceDialog` membuktikan teksnya mendarat (`freeTextFilled`) **sebelum** menekan `Enter`;
menekan digit langsung tak punya titik pembatalan sama sekali — begitu byte-nya keluar, sesi sudah
bergerak. Untuk aksi yang menggerakkan agen sungguhan atas satu klik di dashboard, jalur yang bisa
gagal dengan aman menang atas jalur yang lebih harfiah.

Harganya nyata dan disebut di sini supaya tak jadi kejutan: jawaban single-select tiba di agen
sebagai **teks kolom bebas yang isinya label opsi**, bukan sebagai "opsi ke-n dipilih". Untuk
`AskUserQuestion` keduanya sampai ke model sebagai kalimat yang sama.

### 4.6 Kenapa di luar katalog MCP

ADR-0099 sudah menetapkan MCP tak mengekspos tool yang **mengeksekusi**; SPEC-646/ADR-0112
menegaskannya lagi untuk cron ("sebuah baris cron adalah `POST /terminal/sessions` yang ditunda").
Endpoint ini melangkah satu petak lebih jauh: ia **menjawab pertanyaan yang secara desain ditujukan
kepada manusia**. Sebuah agen yang bisa memanggilnya bisa menjawab pertanyaannya sendiri — dan
seluruh gerbang "manusia terakhir yang memutuskan" (Aturan Produk, dan ADR-0091 yang
mengamandemennya khusus untuk lead) runtuh lewat pintu belakang.

Ia tetap punya capability (`sessions:read`/`sessions:write`) karena peta itu berlaku untuk
**seluruh** permukaan HTTP, bukan hanya untuk yang muncul di MCP — dan `sessions:write` memang
sudah berarti "boleh menjalankan sesi agen". Yang tidak dilakukan: menambahkannya ke
`shared/src/mcp-catalog.ts`. Katalog itu hari ini memuat tepat satu tool bersentuhan terminal,
`hanoman_sessions_list`, dan ia read-only.

## 5. Kontrak server

### 5.1 Capability — koreksi terhadap kalimat objective

Objective menyebut domain **`terminal:write`**. Domain itu tak ada. `capabilityForRoute`
(`server/src/services/agent-capabilities.ts`) memetakan seluruh top-level `terminal` ke
`rw("sessions")` — yaitu `sessions:read` untuk GET/HEAD dan `sessions:write` untuk selainnya,
**diturunkan dari method** (pola anti-SPEC-405). Dua sub-path baru karena itu:

| Route | Capability | Dari |
| --- | --- | --- |
| `GET /api/terminal/sessions/:id/dialog` | `sessions:read` | `rw("sessions")`, method baca |
| `POST /api/terminal/sessions/:id/dialog/answer` | `sessions:write` | `rw("sessions")`, method tulis |

**Nol baris perubahan** di peta capability. Yang dibutuhkan hanyalah test yang mengunci pemetaan
itu supaya seseorang yang kelak menambahkan cabang `seg[1]` di bawah `terminal` (seperti yang sudah
terjadi untuk `workspace`) tak diam-diam melonggarkannya.

### 5.2 `GET /api/terminal/sessions/:id/dialog`

| Keadaan | Respons |
| --- | --- |
| Sesi tak ada | `404 { error: "not found" }` |
| Sesi ada tetapi pane mati | `204` |
| Layar bukan dialog pilihan | `204` |
| Layar rekap rantai (`review`) | `204` |
| Dialog tanpa kolom bebas & tanpa catatan (trust/izin) | `204` |
| Dialog yang bisa dijawab | `200 { dialog, screenHash }` |

`dialog: SessionDialog` (shared):

```ts
export type SessionDialogOption = { n: number; label: string; checked: boolean | null };
export type SessionDialog = {
  title: string;                 // judul pertanyaan; "" bila layar tak punya (dialog tanpa tab strip)
  multi: boolean;                // widget multiSelect: centang + tombol kirim
  freeIndex: number | null;      // nomor baris kolom jawaban bebas
  notes: boolean;                // varian ber-preview: jalan masuk prosa lewat kolom catatan
  options: SessionDialogOption[];// baris yang boleh dipilih — tanpa baris bebas & "Chat about this"
  tabs: { header: string; answered: boolean }[];   // strip pertanyaan dialog berantai; [] bila tunggal
};
```

`title` ikut karena `ChoiceDialog` **tak memuat pertanyaannya** — panel yang hanya punya `options`
akan menampilkan daftar tombol tanpa satu pun kalimat yang menjelaskan sedang menjawab apa.
`tabs` ikut supaya panel bisa berkata "pertanyaan 2 dari 3" alih-alih memberi kesan dialog selesai
setelah satu jawaban.

`sessions:read` sudah cukup: isinya adalah teks yang sama yang sudah bisa dibaca lewat WebSocket
terminal dengan capability yang sama.

### 5.3 `POST /api/terminal/sessions/:id/dialog/answer`

Body (`zSessionDialogAnswer`, shared):

```ts
{ screenHash: string; choice?: number; choices?: number[]; text?: string }
```

- `choice` dan `choices` **saling eksklusif**; salah satu dari ketiga field harus ada.
- Nomor selalu **nomor baris yang dipancarkan GET** (`SessionDialogOption.n`), bukan indeks array.

| Keadaan | Respons |
| --- | --- |
| Body tak valid | `400 { error: "invalid body" }` |
| Sesi tak ada / pane mati | `404 { error: "live session not found" }` |
| `isDeciding(id)` | `409 { error, reason: "deciding" }` |
| Jawaban lain sedang berjalan untuk sesi ini | `409 { error, reason: "answering" }` |
| Layar bukan lagi dialog yang bisa dijawab | `409 { error, reason: "stale" }` |
| `screenHash` tak cocok | `409 { error, reason: "stale" }` |
| Bentuk jawaban tak cocok layar (mis. `choices` di layar single) | `409 { error, reason: "shape" }` |
| Primitif `tui-dialog` mengembalikan `false` | `409 { error, reason: "not-landed" }` |
| Berhasil | `202 { accepted: true }` |

`reason` ada supaya klien bisa membedakan "muat ulang lalu tampilkan lagi" (`stale`) dari
"jangan sentuh, lead yang berhak" (`deciding`) tanpa mem-parsing prosa.

**Pemetaan jawaban → primitif** (cermin dispatch `sendToPane`, tanpa cabang tambahan):

| Layar | Masukan | Primitif |
| --- | --- | --- |
| `multi && submit.present` | `choices` (boleh kosong) + `text?` | `answerMultiSelectDialog(io, { pick, line, freeIndex })` |
| `freeIndex !== null` | `text` — atau label baris `choice` bila `text` kosong | `answerChoiceDialog(io, freeIndex, line)` |
| `notes` | idem | `answerNotesDialog(io, line)` |

`chunkMs` memakai default yang sama dengan `sendToPane` (50).

### 5.4 Modul baru: `server/src/services/session-dialog.ts`

Satu modul, tiga hal, semuanya bisa diuji tanpa tmux:

```ts
export function screenHashOf(paneText: string): string;
export function readSessionDialog(io: PaneIO): { dialog: SessionDialog; screenHash: string } | null;
export async function answerSessionDialog(
  io: PaneIO, input: SessionDialogAnswer, chunkMs?: number,
): Promise<{ ok: true } | { ok: false; reason: "stale" | "shape" | "not-landed" }>;
```

`PaneIO` disuntikkan, persis pola `tui-dialog.ts` sendiri. Route membangunnya lewat `paneIO(id)`
yang diekspor `pty.ts` — hari ini `dialogIO` sudah ada di sana sebagai satu-satunya titik tulis
dialog; ia hanya perlu diekspor, bukan ditulis ulang (dua titik tulis yang tak sepakat adalah pola
kegagalan SPEC-431/448).

Kunci in-flight dan seam test (`__setPaneIO` / `__resetPaneIO`, cermin `__resetDeciding` &
`__resetReaper`) tinggal di modul ini.

## 6. Kontrak frontend

### 6.1 Klien API

```ts
sessionDialog: (id: string) => Promise<SessionDialogPayload | null>,   // 204 → null
answerSessionDialog: (id: string, b: SessionDialogAnswer) => Promise<{ accepted: true }>,
```

`j()` sudah memetakan `204` ke `undefined`; pembungkusnya menormalkannya ke `null` supaya pemanggil
tak perlu membedakan "tak ada dialog" dari "belum dimuat".

### 6.2 Panel pet

Baris kondisi `waiting` di panel menumbuhkan **satu kotak jawaban per sesi**, bukan satu untuk
kondisi. Daftar sesinya lahir dari `waitingSessions(sessions, backlog)` — helper baru di
`pet-state.ts` yang memakai `sessionKind` + `doneSpecIds` yang **sudah** diekspor (tabel yang
disalin ke pemakai kedua adalah kelas bug SPEC-431/448; `pet-speech.ts` sudah memakai jalur yang
sama sejak C).

`PetAnswer.tsx` per sesi:

- **Memuat** saat mount → `api.sessionDialog(id)`.
- **Tanpa dialog** (`null`): "Pertanyaannya tak terbaca dari sini" + tombol Buka Terminal.
- **Single-select**: judul, lalu satu tombol per opsi (satu klik = terkirim). Bila `freeIndex`
  ada, tambahan satu `<input>` + tombol "Kirim".
- **multiSelect**: judul, checkbox per opsi (nilai awal dari `checked` layar), input teks opsional,
  satu tombol "Submit".
- **Terkirim**: kotak diganti "Terkirim — menunggu sesi bergerak". Ia hilang sendiri saat sesi
  berhenti `waiting` (komponen ter-unmount lewat siaran `sessions` biasa).
- **409 `stale`**: muat ulang otomatis satu kali dan tampilkan "Layarnya sudah berubah".
- **409 `deciding`**: "hanoman-lead sedang memutuskan" tanpa tombol.

### 6.3 Gelembung C

Gelembung pose `waiting` menumbuhkan tombol **"Jawab di sini"** yang membuka panel (jalur yang sama
dengan tombol "Lihat" milik rekap: `setSpeech(null)` → `showPanel()`).

A11y (menegakkan keputusan C #3/#4, bukan mencabutnya): bungkus gelembung berhenti `aria-hidden`
begitu ia punya aksi — elemen di dalam `aria-hidden` tak bisa difokuskan sama sekali — sementara
**teks**-nya pindah ke `<span aria-hidden="true">` supaya region `role="status"` di `pet-stage`
tetap satu-satunya yang membacakan kabar. Tombolnya membawa kalimatnya di `aria-label`, persis
pola tombol "Lihat".

## 7. Test

| Berkas | Isi |
| --- | --- |
| `server/test/session-dialog.test.ts` | `PaneIO` palsu: parse layar single/multi/notes/trust/review; `screenHashOf` stabil terhadap kursor & berubah saat terjawab; single lewat kolom bebas; multi mencentang lalu Submit; `stale`; `shape`; `not-landed` |
| `server/test/terminal-dialog.route.test.ts` | route lewat seam `__setPaneIO`: `200` + bentuk payload, `204`, `202`, `409 stale`, `409 deciding`, `409 answering`, `404`, `400` |
| `server/test/mcp-capability.test.ts` | pemetaan `sessions:read`/`sessions:write` untuk kedua path; keduanya **tidak** ada di katalog MCP |
| `src/test/api-client.test.ts` | `sessionDialog` memetakan `204` → `null`; `answerSessionDialog` mengirim body & method yang benar |
| `src/test/pet-state.test.ts` | `waitingSessions` memakai klasifikasi `sessionKind` (sesi `deciding` tak ikut) |
| `src/test/hanoman-pet.test.tsx` | panel merender opsi untuk sesi `waiting`; klik opsi mengirim `{screenHash, choice}`; keadaan "Terkirim"; multiSelect mengirim `choices`; gelembung `waiting` punya "Jawab di sini" dan membuka panel |

**Uji nyata sekali di akhir** (bukan rutin per task): boot server, buat sesi tmux uji yang
menampilkan dialog tiruan — bukan `POST /terminal/sessions`, yang akan melahirkan agen sungguhan —
lalu `curl` GET (`200` + payload) dan POST dengan `screenHash` basi (`409`). Jalur POST yang
berhasil tak bisa diuji terhadap `cat`: layarnya statis, `freeTextFilled` tak akan pernah benar,
dan itu memang jawaban yang benar (fail-closed) — jalur suksesnya dikunci test ber-`PaneIO` palsu.

## 8. Yang TIDAK dikerjakan

- Tak ada tool MCP (§4.6), tak ada permukaan Telegram.
- Tak ada tombol untuk layar rekap rantai, dialog trust, atau prompt izin (§4.4).
- Tak ada jawaban otomatis, tak ada jawaban default, tak ada "jawab semua".
- Tak ada polling dialog berkala; tak ada channel realtime baru (ADR-0039 ditegakkan).
- Tak ada perubahan skema DB, tak ada perubahan `lead/gate.ts` atau `lead/deciding.ts`.
- Tak ada perubahan pada `sendToPane` maupun pada satu pun primitif `tui-dialog.ts` yang sudah ada.

## 9. Docs yang tersentuh

- `internal/docs/adr/0142-inbox-keputusan-dialog-sesi.md` (baru) + baris index.
- `internal/docs/architecture/api-contract.md` — dua endpoint.
- `docs/agent-integration.md` — baris domain `sessions`, dan catatan bahwa jalur ini di luar MCP.
- `internal/docs/frontend/frontend-implementation.md` — seksi Pet.
- `internal/docs/README.md` — tautan ADR baru & penyegaran baris frontend/pet.
