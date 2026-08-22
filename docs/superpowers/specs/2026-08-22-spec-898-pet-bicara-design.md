# Pet bicara — gelembung ber-template, rekap "selama kamu pergi", urgensi menurut umur, pose thanks (spec C)

Tanggal: 2026-08-22 · Sumber: brief · Prioritas: sedang · Backlog **SPEC-898** (project `hanoman`)
· **ADR-0141** (lihat §4).

Spec ketiga program **"Pet hidup"** (A→B→C→D, roadmap di spec A §13:
`docs/superpowers/specs/2026-08-22-pet-hidup-atlas-sprite-design.md`). A memberi pet **tubuh**
(atlas sprite, pipeline, mesin berkeliaran); B memberi pet **kejujuran** (status koneksi, lencana
hitungan, panel multi-kondisi, pose `deciding` & tidur). C memberi pet **suara**: ia mengatakan
kabarnya satu baris di atas kepalanya, merangkum apa yang terlewat saat operator pergi, terlihat
makin mendesak ketika sebuah pertanyaan sudah lama tak dijawab, dan berterima kasih saat dielus.

## 1. Masalah

1. **Pet berganti pose dalam diam.** Seluruh kabar pet hari ini hidup di dua tempat yang sama-sama
   harus dicari: sprite 112 px yang berganti baris, dan panel yang hanya terbuka kalau diklik.
   Sesi yang selesai, dokumen yang terbit, dan sesi yang mulai menunggu jawaban semuanya lewat
   tanpa satu kata. `Toast` design system sudah duduk di tengah-bawah, tetapi ia hanya melaporkan
   **aksi pengguna** — kabar yang lahir dari sesi yang berjalan sendiri tak punya suara.
2. **Kembali ke tab berarti kehilangan konteks.** `api/events.ts` menutup socket saat tab hidden
   dan menerima snapshot penuh saat menyambung lagi. Apa pun yang terjadi selama itu tak
   meninggalkan jejak di pet: operator kembali dan melihat pose "sekarang", bukan "yang terjadi".
   Bell notifikasi menyimpan riwayatnya, tetapi ia daftar 50 baris, bukan satu kalimat.
3. **"Menunggu" tak punya umur.** `TerminalSession` tak punya satu pun stempel waktu, jadi sesi
   yang baru saja bertanya dan sesi yang sudah 40 menit tak dijawab terlihat **persis sama** —
   baris atlas yang sama, kalimat yang sama, urutan yang sama. Yang paling butuh perhatian justru
   yang paling tak menonjol.
4. **Pet tak bisa disapa.** `wave` menyala saat hover/klik, tetapi tak ada satu pun reaksi yang
   berkata "aku menyadarimu". STK-007 `thanks` sengaja tak dipakai SPEC-585 karena ia bukan
   keadaan mesin; sebagai **reaksi**, ia tepat.

## 2. Hasil yang dituju

Pet mengucapkan kabarnya sendiri: satu baris ber-template di atas kepala saat pose berganti ke
kabar yang tak lewat Toast, satu rekap saat operator kembali dari tab lain, urgensi yang naik
sendiri saat sebuah pertanyaan menua, dan pose terima kasih saat dielus. Tanpa LLM, tanpa suara,
tanpa notifikasi browser, tanpa channel realtime baru, tanpa skema DB — dan tanpa merusak satu pun
jaminan A/B (reduced-motion, a11y, gerbang tap SPEC-763, mesin berkeliaran).

## 3. Keputusan yang mengikat

1. **Gelembung hanya untuk kabar yang TIDAK lewat Toast.** Himpunannya tertutup:
   `shipped`, `docs-updated`, `waiting`, `offline`. `working`/`review`/`blocked`/`deciding`/`ready`
   **tak pernah** bergelembung — mereka keadaan mapan, dan kalimat yang muncul-hilang tiap kali
   sebuah sesi lahir adalah kebisingan, bukan kabar.
2. **Templat hidup di modul murni `pet-speech.ts`,** tanpa React/DOM, diuji tabel. Alasannya sama
   dengan `pet-state.ts`: kalimat yang lahir di dalam komponen hanya bisa diuji lewat render.
3. **Gelembung pose `aria-hidden`.** Region `role="status"` di `pet-stage` sudah membacakan
   pergantian pose; gelembung yang ikut diumumkan berarti pembaca layar mendengar kabar yang sama
   dua kali dengan dua rumusan berbeda. Ini keputusan yang sama dengan lencana SPEC-897.
4. **Gelembung rekap TIDAK `aria-hidden` dan punya tombol.** Ia membawa informasi yang **tak** ada
   di region status (apa yang terjadi selama kamu pergi) dan satu aksi. Ia karena itu satu
   `<button>` ber-`pointer-events: auto` — kelas yang sama dengan panel: permukaan sengaja di atas
   pet, bukan pelebaran badan pet. SPEC-763 ditegakkan: badan pet tetap 44×44 px di kaki.
5. **Satu gelembung pada satu waktu, satu `setTimeout` per peristiwa.** Gelembung baru
   menggantikan yang lama (timer lama dibatalkan). Tanpa interval, tanpa rAF.
6. **`decisionAt` lahir dari marker keputusan, dan marker itu kini menyimpan ONSET-nya.**
   Lihat §4 — ini satu-satunya perubahan kontrak di luar frontend, dan satu-satunya alasan ADR.
7. **Urgensi adalah turunan, bukan keadaan kedua.** `PetCondition` menumbuhkan `since: number|null`;
   "mendesak" = `now − since ≥ PET_URGENT_MS`, dihitung di tempat pemakaian. Menyimpan `urgent`
   sebagai boolean di state berarti dua sumber kebenaran yang bisa berselisih.
8. **Onset urgensi dilayani `recheckAt` yang sudah ada.** Kondisi `waiting` yang belum mendesak
   memasang `recheckAt = since + PET_URGENT_MS`; pet berubah **tepat** pada menit ke-10 lewat satu
   timeout yang sudah ada di komponen. Ini pemakaian **keempat** `recheckAt` (SPEC-897 menyebut
   tiga) dan persis alasan field itu dinamai ulang dari `transientUntil`.
9. **Rekap dihitung dari diff snapshot, bukan dari interval.** Snapshot dicap saat tab **hidden**;
   dibandingkan saat tab **visible** lagi. Tak ada timer yang berjalan selama tab tersembunyi —
   tab hidden memang tempat browser membekukan timer.
10. **Satu baris atlas baru lewat pipeline A yang sama** (`gen.py` → `key.py` → `register.py` →
    `qa.py` → `atlas.py`), latar hijau, model sheet dilampirkan, tanpa mirror, artefak `qa/`
    dikomit sebagai bukti review. `quality` atlas **diturunkan** supaya 13 baris muat di plafon
    `ATLAS_BUDGET` 1 MB — plafonnya tidak dinaikkan (§8).
11. **ADR-0141, kecil.** Yang berubah arsitektural hanya isi marker keputusan + satu kolom payload
    sesi. ADR-0039 (tanpa realtime baru), ADR-0024, ADR-0091, ADR-0134, dan ADR-0140 semuanya
    **ditegakkan**; SPEC-184 **diamandemen** pada satu titik: isi markernya kini bermakna.

## 4. `decisionAt` — onset "menunggu" (ADR-0141)

### 4.1 Kenapa mtime tidak bisa dipakai

Jawaban naifnya adalah `statSync(decisionFile).mtimeMs`. Ia **salah**, dan ini terukur, bukan
dugaan. Hook `Notification` (`runner/src/settings.ts`) menjalankan `echo waiting >> f` **setiap
kali** Claude menandai dirinya idle/butuh input; hanya `UserPromptSubmit` (manusia menjawab) yang
mengosongkannya. Marker nyata di mesin pengembang membuktikan pengulangan itu — misalnya
`.worktrees/.decisions/prd-orchestrator-hanoman` berisi **13 baris** tanpa satu pun truncate di
antaranya. Setiap baris mencap ulang mtime, jadi "umur menunggu" yang diturunkan darinya selalu
terbaca lebih muda dari satu putaran idle: **gerbang 10 menit tak akan pernah menyala.**

Dua alternatif ditimbang dan ditolak: peta onset di memori server (hilang saat restart, dan onset
baru tercatat saat `listSessions()` dipanggil — dashboard yang ditutup dua jam kembali dengan umur
nol), dan `createdAt` notifikasi `decision` di DB (persis benar, tapi `pty.ts` sengaja **nol
dependensi DB** dan grup siar `sessions` di-recompute tiap detik).

### 4.2 Marker menyimpan onset-nya sendiri

Hook diubah dari "tambahkan satu baris" menjadi **"tulis stempel bila masih kosong"**:

| hook | sebelum | sesudah |
|---|---|---|
| `Notification` (claude) | `grep -qiE '…' && echo waiting >> F \|\| true` | `grep -qiE '…' && { [ -s F ] \|\| date +%s > F; } \|\| true` |
| `UserPromptSubmit` (claude) | `: > F` | tidak berubah |
| Stop (codex) | `echo waiting >> F` | `[ -s F ] \|\| date +%s > F` |
| Submit (codex) | `: > F` | tidak berubah |

Yang dijaga utuh: `size > 0` **tetap** berarti "menunggu manusia", jadi `markerFilled()`,
`scanDecisions()` (SPEC-184), dan `GET /lead/status` tak berubah satu baris pun. Yang bertambah:
isi marker kini adalah **detik epoch saat episode menunggu ini dimulai**, dan ia kebal terhadap
notifikasi idle berulang karena `[ -s F ]` menolak menulis dua kali.

### 4.3 Payload

`SessionInfo` (`server/src/services/pty.ts`), `SessionDTO` (`shared/src/dto.ts`), dan
`TerminalSession` (`src/src/api/client.ts`) menumbuhkan satu field **opsional**:

```ts
/** SPEC-898 · ADR-0141 · ISO onset episode "menunggu manusia". Ada HANYA saat `decision` true. */
decisionAt?: string;
```

Diturunkan di `toSessionInfo` dari satu bacaan berkas yang **hanya terjadi untuk marker yang
terisi** — nol biaya untuk sesi yang tak menunggu:

```
decision === false                        → decisionAt absen
isi marker = "1755840000\n"               → decisionAt = new Date(1755840000_000).toISOString()
isi marker = "waiting\n" (sesi pra-0141)  → decisionAt absen
```

Marker sesi yang **sudah berjalan** saat versi ini dipasang berisi `waiting` — tak bisa diparse,
jadi `decisionAt` absen dan pet tak pernah mengeskalasinya. Itu jawaban yang benar: kita memang
tak tahu sejak kapan. Kompatibel dua arah — klien lama mengabaikan kolom baru, server lama tak
mengirimnya.

## 5. `pet-speech.ts` — modul murni

```ts
export const PET_SPEECH_MS = 5_000;    // umur gelembung pose
export const PET_RECAP_MS = 12_000;    // umur gelembung rekap — ia membawa aksi
export const PET_AWAY_MS = 5 * 60_000; // tab hidden selama ini = "kamu pergi"
export const PET_URGENT_MS = 10 * 60_000;

export type PetSpeech = { kind: "pose" | "recap"; text: string; ttl: number };

/** Kalimat untuk pandangan pet. `null` = kondisi ini tak bergelembung (§3.1). */
export function speechFor(view: PetView, now: number): PetSpeech | null;

export type PetSnapshot = {
  at: number;
  sessions: Record<string, PetConditionKind>;  // id sesi → kondisinya saat snapshot
  notifiedAt: string;                          // createdAt notifikasi terbaru saat snapshot
};
export function petSnapshot(input: PetInput): PetSnapshot;

/** Rekap perubahan sejak snapshot; `null` bila tak ada yang berubah. */
export function petRecap(before: PetSnapshot, input: PetInput): PetSpeech | null;

/** "12 menit" / "1 jam 5 menit" — dipakai gelembung waiting. */
export function humanAge(ms: number): string;
```

### 5.1 Tabel templat (`speechFor`)

| kondisi puncak | kalimat | catatan |
|---|---|---|
| `shipped` count 1 | `SPEC-547 selesai` | `headline` sudah memuat id; templat memakai `specId` kondisi |
| `shipped` count ≥ 2 | `SPEC-547 selesai · 2 kabar` | angka yang sama dengan lencana |
| `docs-updated` | `SPEC-612 dokumen terbit` | |
| `waiting` belum mendesak | `SPEC-612 butuh jawabanmu` | |
| `waiting` mendesak | `SPEC-612 butuh jawabanmu — 12 menit` | `since` ada **dan** `now − since ≥ PET_URGENT_MS` |
| `waiting` count ≥ 2 | `… · 3 sesi` | disisipkan sebelum sufiks umur |
| `offline` | `Aku kehilangan sambungan` | tanpa jam: `headline` panel yang membawanya |
| lainnya | `null` | tak bergelembung |

Kalimatnya sengaja **bukan** `headline`: `headline` ditulis untuk daftar panel (lebar 268 px,
berdampingan dengan `detail`), gelembung ditulis untuk dibaca sekilas di atas kepala pet.
Menyamakan keduanya berarti salah satu dari keduanya jadi salah.

### 5.2 Rekap (`petRecap`)

Tiga angka, dihitung dari diff — bukan dari kondisi yang sedang menyala, karena `shipped` meluruh
45 detik dan operator yang pergi 20 menit tak akan pernah melihatnya:

| bagian | rumus |
|---|---|
| `N selesai` | notifikasi bertipe `done`/`automerge` ber-`createdAt > before.notifiedAt` |
| `N menunggu` | sesi yang **kini** `waiting` dan di snapshot bukan `waiting` |
| `N gagal` | sesi yang **kini** `failed` dan di snapshot bukan `failed` |

Bagian bernilai nol dibuang; hasil kosong → `null` (tak ada gelembung — kembali ke tab yang sepi
tak boleh disambut kalimat "0 selesai"). Contoh: `2 selesai · 1 menunggu · 1 gagal`.

`petSnapshot` memakai `sessionKind()` yang **diekstrak** dari closure `kindOf` di dalam
`derivePetConditions` (`pet-state.ts`) dan diekspor. Satu klasifikasi sesi, dua pemakai — menyalin
tabelnya ke `pet-speech.ts` adalah kelas bug yang sama dengan predikat yang disalin ke pemakai
kedua (SPEC-431/448).

## 6. `pet-state.ts` — `since` & urgensi

```ts
export type PetCondition = {
  …
  /** ms epoch kapan kondisi ini MULAI, bila diketahui. null = tak ada stempelnya. */
  since: number | null;
};
export const PET_URGENT_MS = 10 * 60_000;
```

| kondisi | `since` |
|---|---|
| `waiting` | `decisionAt` **tertua** di antara sesi yang menunggu (yang tertua = yang paling mendesak); `null` bila tak satu pun punya stempel |
| `offline` | `conn.since` |
| lainnya | `null` |

`recheckAt` kondisi `waiting` = `since + PET_URGENT_MS` bila masih di depan. `derivePetState`
sudah memilih yang paling awal di antara kandidat (`earliest`), jadi tak ada mekanisme baru.

`PET_URGENT_MS` didefinisikan di `pet-state.ts`, bersama `PET_TRANSIENT_MS`/`PET_OFFLINE_MS`/
`PET_SLEEP_MS` — seluruh ambang waktu pet sudah tinggal di sana, dan `derivePetConditions` butuh
angka itu untuk memasang `recheckAt`. Dependensi karena itu satu arah: `pet-speech.ts` mengimpor
`pet-state.ts`, tak pernah sebaliknya.

Urutan prioritas §5.2 SPEC-897 **tidak berubah**: sesi yang menunggu 40 menit tetap kondisi
`waiting` yang sama, hanya lebih keras. Menaikkannya di atas `failed` berarti tabel prioritas yang
berubah bentuk seiring waktu — hal yang sengaja dihindari sejak SPEC-585.

## 7. Renderer (`HanomanPet.tsx`)

```
pet-root
├─ pet-panel                       (B, tak berubah)
└─ pet-actor                       translateX(pet)
   ├─ pet-bubble                   ← BARU: di ATAS panggung, ikut pet, di-clamp
   └─ pet-stage   role=status
      ├─ pet-reactor → pet-viewport → pet-rowshift → img.hn-pet-atlas
      ├─ span.hn-sr-only
      ├─ span.pet-badge
      ├─ span.pet-hearts           ← BARU: 3 hati, aria-hidden, pointer-events none
      └─ button.hit                44×44
```

### 7.1 Gelembung

- **Di dalam `pet-actor`, di luar `pet-stage`.** Di dalam actor supaya ia ikut `translateX` pet
  tanpa satu baris kode posisi (objective: "ikut posisi pet"); di luar `pet-stage` supaya ia tak
  masuk region `aria-live` — kalimat pose sudah dibacakan di sana, dan gelembung rekap punya
  aturan pengumumannya sendiri (§3.3/§3.4).
- **Clamp viewport.** Lebarnya `max-content` dengan `maxWidth: PET_BUBBLE_W` (200 px). Pergeseran
  dihitung dari `move.x` (posisi tujuan actor) + `anchor.x * cellW`: `shift = clamped − desired`,
  dan `left = anchor.x*cellW − W/2 + shift`. Memakai `PET_BUBBLE_W` sebagai lebar terburuk berarti
  gelembung pendek di dekat tepi sedikit lebih ke dalam dari yang perlu — pilihan yang benar:
  yang tak boleh terjadi adalah terpotong.
- `pointerEvents: "none"` untuk gelembung pose; gelembung rekap adalah `<button>` ber-`auto`.
- `z-index` tidak dinaikkan: ia anak `pet-root` yang sudah `zIndex: 80`.
- Animasi masuk `hn-pet-bubble-in` (opacity + translateY 4 px); `animation: none` persis saat
  reduced-motion — gelembungnya **tetap tampil**, ia informasi, bukan gerak.
- Satu `setTimeout` menyalakan `setSpeech(null)`; gelembung baru membatalkan timer lama lewat
  `useEffect` berkunci `speech.id`.

### 7.2 Kapan gelembung pose lahir

`view.kind` dibandingkan dengan nilai render sebelumnya memakai pola "menyesuaikan state saat prop
berubah" (nilai dibandingkan **saat render**, bukan di `useEffect`) — pola yang sudah dipakai
`quietSince`/`seenPulse` di komponen ini. Berubah **dan** `speechFor` mengembalikan kalimat →
gelembung. Kalimat `waiting` yang berubah dari "biasa" ke "mendesak" **juga** melahirkan gelembung
baru walau `kind`-nya sama; pembandingnya karena itu teks kalimat, bukan `kind`.

Gelembung **tidak** menghentikan pet: `stepWalk` tak menerima masukan baru. Pengecualian yang
diminta objective (`waiting`) sudah berlaku sejak spec A — `waiting` ada di himpunan `ATTENTION`,
jadi pet memang pulang ke pojok dan berdiri.

### 7.3 Rekap

`useDocumentHidden()` sudah ada. Ditambahkan satu ref `awayRef: PetSnapshot | null`:

- transisi **visible → hidden**: `awayRef.current = petSnapshot(input)`.
- transisi **hidden → visible**: bila `now − awayRef.current.at ≥ PET_AWAY_MS`, hitung
  `petRecap(awayRef.current, input)`; ada isinya → gelembung rekap. Lalu `awayRef.current = null`.

Perangkap yang dihindari dengan sengaja: snapshot diambil saat **hidden**, bukan saat visible.
Mengambilnya saat visible berarti ia dicap ulang tiap render dan diff-nya selalu kosong.

Data yang dipakai untuk `petRecap` adalah frame **sesudah** socket menyambung lagi. `api/events.ts`
menutup socket saat hidden dan menerima snapshot penuh saat connect ulang, jadi pada tick
`visibilitychange` datanya masih basi. Karena itu rekap dihitung di `useEffect` yang bergantung
pada `[documentHidden, sessions, items]`: begitu tab terlihat lagi, frame pertama yang tiba
memicunya. Bila tak ada perubahan sama sekali, `petRecap` mengembalikan `null` dan `awayRef`
dibersihkan pada frame itu juga — jadi ia tak menunggu selamanya.

Tombolnya `Lihat` membuka panel (`showPanel()`); gelembung ditutup pada klik yang sama.

### 7.4 Dielus

`PET_PET_WINDOW_MS = 2_000`, `PET_PET_CLICKS = 3`. Ref berisi stempel klik dalam jendela:

```
klik → buang stempel > 2 dtk → push → panjang < 3 ? toggle panel seperti biasa
                                              : mainkan `thanks` + hati, JANGAN toggle
```

Klik ke-3 (dan seterusnya selama jendela masih penuh) **tidak** menyentuh panel sama sekali —
itulah isi "tidak membuka/menutup panel berulang". Klik pertama & kedua tetap membuka lalu menutup
panel; itu perilaku normal dua klik dan tak boleh diubah demi easter egg.

`thanks` diputar lewat `oneShot` yang sudah ada (mekanisme `wave`), jadi ia otomatis: satu putaran,
`key` di-`img` memaksa animasi ulang, `onAnimationEnd` mengembalikan baris mesin. Di bawah
reduced-motion tak ada `oneShot` sama sekali (gerbang `playWave` yang sudah ada) dan **hati
dimatikan** — objective (e).

Hati: tiga `<span>` `aria-hidden` ber-`pointerEvents: none` di dalam `pet-stage`, keyframe
`hn-pet-heart` (opacity + translateY + scale saja), `animation-delay` berbeda per hati, dilepas
pada `animationend` hati terakhir. Karakternya `♥` dari font UI — bukan aset, bukan emoji berwarna.

### 7.5 Urgensi

Kondisi puncak `waiting` yang mendesak mempercepat baris atlasnya:

```ts
const urgent = view.kind === "waiting" && view.since !== null && now - view.since >= PET_URGENT_MS;
const ms = Math.round(durationMs(displayRow) / (urgent && displayRow === "waiting" ? PET_URGENT_RATE : 1));
```

`PET_URGENT_RATE = 1.5` (fps 6 → 9). Digerbangi `displayRow === "waiting"` supaya `wave`/`thanks`
yang menumpang di atasnya tetap berirama normal. Reduced-motion tak terpengaruh: di sana
`animation` sudah `"none"`, dan urgensi tetap terucap lewat gelembung + kalimat sr-only.

## 8. Atlas: baris `thanks` (baris ke-13)

`PET_ROW_KEYS`, `parsePetManifest`, `petlib.ROWS`, dan `pet.json` bergerak bersama. Baris
ditambahkan **di ekor** (indeks 12) supaya indeks lama tak bergeser.

```
{ "key": "thanks", "fps": 10, "loop": false, "then": "idle" }    mode registrasi: stand
```

`thanks` **bukan** pose: `POSE_ROW` tak berubah, dan tak ada `PetPose` baru. Ia baris sekali-putar
seperti `wave`, dipilih oleh `oneShot`.

**Isi frame** (naskah `internal/assets/pet/prompts/thanks.md`, kosakata brand STK-007 =
GST-02 telapak terbuka · EXP-08 bersyukur · TAL-01 lengkung netral): berdiri menghadap depan-samping,
kedua tangan bertemu di depan dada lalu membuka ke bawah dalam gestur terima kasih, kepala
menunduk singkat, mata menyipit senang (bukan wajah emoji), ekor melengkung tenang naik sekali.
Dibedakan dari `wave` yang **mengangkat satu tangan setinggi kepala dan melambai** — `thanks`
tak pernah mengangkat tangan di atas bahu.

**Anggaran.** 12 baris pada `quality=82` = **975 484 B**; sisa 24 516 B tak cukup untuk baris
ke-13 (±80 KB). `quality` diturunkan untuk **seluruh** atlas sampai 13 baris muat di bawah
`ATLAS_BUDGET` 1 000 000 B, dan angkanya (quality final + byte final) dicatat di
`internal/assets/pet/README.md`. Menaikkan plafon bukan pilihan (keputusan yang sudah tercatat di
README itu sendiri): satu `<img>` yang di-decode di setiap halaman adalah anggaran, bukan
preferensi. `atlas.py` sudah gagal keras bila terlampaui, jadi gerbangnya sudah ada.

**Gerbang `qa.py` apa adanya**: 8 sprite terdeteksi, tak ada yang menyentuh tepi lembar, tumpahan
sel 0 px, residu pra-pin ≤ 0,25 (`stand`), alpha utuh. Artefak `qa/thanks.gif`, contact sheet, dan
onion-skin dikomit sebagai bukti review Gate 2.

## 9. Aksesibilitas & reduced motion

- Gelembung pose `aria-hidden="true"` (§3.3). Kalimat sr-only SPEC-897 tak berubah.
- Gelembung rekap: `<button>` ber-`aria-label` lengkap (`"2 selesai · 1 menunggu · 1 gagal — buka
  ringkasan pet"`), sehingga teksnya terbaca **sekali** oleh pembaca layar, sebagai tombol.
- Hati `aria-hidden`, `pointer-events: none`.
- `prefers-reduced-motion`: gelembung **tampil tanpa animasi** (`animation: none`, nilai persis,
  di-assert), hati **tidak dirender sama sekali**, `thanks` tak diputar (gerbang `oneShot` yang
  sudah ada), urgensi tetap tersampaikan lewat kalimat.
- Gerbang tap SPEC-763 utuh: satu-satunya hit area baru adalah tombol rekap — transient, di atas
  jalur pet, kelas yang sama dengan panel.

## 10. Kinerja

Nol permukaan jaringan baru. `decisionAt` menambah **satu** `readFileSync` per pane yang markernya
terisi (nol untuk sesi yang tak menunggu) di atas `statSync` yang sudah dibayar `markerFilled`.
Gelembung, rekap, hati, dan urgensi semuanya satu `setTimeout` per peristiwa; onset urgensi
menumpang `recheckAt` yang sudah ada. Frame siar `sessions` tetap ber-dedup signature — `decisionAt`
konstan selama satu episode, jadi ia tak melahirkan frame tambahan.

## 11. Pengujian

Semua dijalankan `env -u NODE_ENV pnpm vitest --run <path>` (prod bikin RTL `act` gagal).

- `src/test/pet-speech.test.ts` — **baru**. Tabel §5.1 lengkap (termasuk `null` untuk pose yang tak
  bergelembung, sufiks hitungan, sufiks umur hanya saat mendesak); `humanAge` untuk detik/menit/jam;
  `petSnapshot` + `petRecap`: tiga angka, bagian nol dibuang, tak ada perubahan → `null`, kabar
  yang lahir **saat pergi** terhitung walau transient-nya sudah luruh.
- `src/test/pet-state.test.ts` — `since` waiting = `decisionAt` **tertua**; `null` bila tak ada
  stempel; `recheckAt` memuat onset urgensi dan kalah dari transient yang lebih awal.
- `src/test/hanoman-pet.test.tsx` — gelembung muncul pada pergantian pose ke `shipped`/`waiting`,
  **tidak** untuk `working`; hilang sesudah `PET_SPEECH_MS`; `pointer-events: none` + `aria-hidden`;
  di-clamp saat pet di tepi kiri dan kanan; rekap lewat `visibilitychange` (hidden ≥ 5 menit)
  dengan tombol yang membuka panel, dan **tidak** muncul saat hidden < 5 menit; tiga klik dalam
  2 dtk memutar baris `thanks` + hati tanpa mengubah panel; reduced-motion: gelembung tanpa
  animasi, tanpa hati; fps baris `waiting` naik saat mendesak; seluruh test A/B tetap hijau.
- `src/test/pet-sprite.test.ts` — manifest nyata 13 baris; `thanks` punya indeks, `loop:false`,
  `then: "idle"`; `POSE_ROW` **tidak** memuat `thanks`.
- `server/test/pty.test.ts` — `listSessions()` memberi `decisionAt` ISO saat marker berisi epoch;
  absen saat marker berisi teks lama (`waiting`); absen saat marker kosong.
- `server/test/terminal.route.test.ts` — `GET /api/terminal/sessions` meneruskan `decisionAt`.
- `runner/test/settings.test.ts` + `runner/test/codex-settings.test.ts` — hook menulis stempel
  hanya bila marker kosong (`[ -s` ada di perintah), `UserPromptSubmit` tetap mengosongkan.
- `python3 internal/scripts/pet/test-petlib.py` — tetap hijau dengan 13 baris.
- `python3 internal/scripts/pet/qa.py thanks` + `atlas.py --check` + `verify.py`.
- Typecheck paket `src`, `server`, `shared`, `runner` yang tersentuh.

## 12. Docs (commit yang sama)

- `internal/docs/adr/0141-onset-menunggu-di-marker-keputusan.md` — **baru** (§4).
- `internal/docs/adr/README.md` — baris ADR-0141.
- `internal/docs/frontend/frontend-implementation.md` — seksi "Pet Hanoman": gelembung, rekap,
  urgensi, elus, 13 baris atlas, `decisionAt` sebagai sumber baru.
- `internal/docs/architecture/*` yang mendeskripsikan payload sesi bila ada — dicek, diperbarui
  bila menyebut daftar field.
- `internal/assets/pet/README.md` — 13 baris, baris `thanks`, quality & byte final.
- `internal/docs/README.md` — tautan ADR baru.

## 13. Di luar scope

Inbox keputusan (spec D, SPEC-899); teks LLM; suara; notifikasi browser; gelembung untuk pose mapan;
pet per project; menampilkan `decisionAt` di layar Terminal; mengubah urutan prioritas menurut umur;
membersihkan marker saat dialog TUI dijawab tanpa `UserPromptSubmit` (cacat lama SPEC-184, tak
diperkenalkan spec ini); `deciding` di `SessionDTO` (celah lama, tak disentuh).

## 14. Struktur berkas

| berkas | perubahan |
|---|---|
| `runner/src/settings.ts` | hook `Notification` menulis stempel sekali |
| `runner/src/codex-settings.ts` | cermin untuk codex |
| `server/src/services/pty.ts` | `SessionInfo.decisionAt`, dibaca dari marker terisi |
| `shared/src/dto.ts` | `SessionDTO.decisionAt` |
| `src/src/api/client.ts` | `TerminalSession.decisionAt` |
| `src/src/screens/pet-state.ts` | `PetCondition.since`, `PET_URGENT_MS`, `sessionKind` diekspor, `recheckAt` urgensi |
| `src/src/screens/pet-speech.ts` | **baru** — templat, snapshot, rekap, `humanAge` |
| `src/src/screens/pet-sprite.ts` | `PET_ROW_KEYS` 13 baris |
| `src/src/screens/HanomanPet.tsx` | gelembung, rekap, elus, hati, urgensi fps |
| `src/src/app.css` | `hn-pet-bubble-in`, `hn-pet-heart` |
| `internal/scripts/pet/petlib.py` | `ROWS` + `thanks` |
| `internal/scripts/pet/atlas.py` | `quality` diturunkan |
| `internal/assets/pet/prompts/thanks.md` | naskah baru |
| `internal/assets/pet/rows/thanks.png` + `.report.json`, `qa/thanks.*` | artefak pipeline |
| `internal/assets/pet/hnm-pet-anoman-atlas-v01.webp`, `pet.json` | dirakit ulang 13 baris |
| test & docs | §11, §12 |
