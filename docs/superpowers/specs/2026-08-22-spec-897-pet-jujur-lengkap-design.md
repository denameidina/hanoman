# Pet jujur & lengkap — kondisi terputus, lencana hitungan, panel multi-kondisi, pose deciding & tidur (spec B)

Tanggal: 2026-08-22 · Sumber: brief · Prioritas: sedang · Backlog **SPEC-897** (project `hanoman`)
· **Tanpa ADR** (lihat §12).

Spec kedua program **"Pet hidup"** (A→B→C→D, roadmap di spec A §13:
`docs/superpowers/specs/2026-08-22-pet-hidup-atlas-sprite-design.md`). Spec A memberi pet **tubuh**
— atlas sprite PET-001, pipeline `internal/scripts/pet/`, renderer frame, mesin berkeliaran. Spec
B memberi pet **kejujuran**: ia berhenti memamerkan data basi saat koneksi putus, berhenti
menyembunyikan kondisi kedua & ketiga di balik "+2 lainnya", dan menumbuhkan dua keadaan yang
selama ini tak punya wajah (lead sedang memutuskan; dashboard sepi lama).

## 1. Masalah

Tiga hal yang hari ini **salah atau tersembunyi**:

1. **Pet berbohong saat koneksi putus.** `src/src/api/events.ts` tidak mengekspos status koneksi
   sama sekali. Saat WS `events` putus, klien reconnect ber-backoff sampai 10 dtk, dan saat tab
   hidden socketnya ditutup sengaja. Selama itu `sessions`/`backlog` di `App` **membeku**, dan pet
   dengan tenang memamerkan "sedang bekerja" atas data yang bisa berumur menit. Ini kembaran persis
   SPEC-878 di sisi dashboard: di sana `ws.readyState === OPEN` (fakta transport) dibaca sebagai
   fakta pengiriman; di sini ketiadaan sinyal apa pun dibaca sebagai "semuanya baik".
2. **Pet hanya menunjukkan puncak prioritas.** `derivePetState` mengembalikan **satu** kondisi.
   Kondisi kedua/ketiga terkubur di sufiks `+N lainnya` pada `detail`, dan panel hanya punya satu
   headline dan satu tombol. Operator dengan satu sesi gagal + dua sesi menunggu jawaban melihat
   satu kalimat dan satu `Buka Terminal` — ke sesi yang gagal, bukan ke sesi yang menunggunya.
3. **Dua keadaan tak punya wajah.** Sesi yang sedang disusunkan keputusannya oleh hanoman-lead
   (`TerminalSession.deciding`, SPEC-409/ADR-0091) jatuh ke pose `working`, sehingga operator tak
   bisa membedakan "agen sedang mengetik" dari "lead sedang memutuskan untuknya". Dan dashboard
   yang sepi berjam-jam menampilkan pet yang tetap bernapas seolah menunggu sesuatu.

## 2. Hasil yang dituju

Pet mencerminkan kebenaran: ia **memudar dan mengaku** saat tak terhubung, **menghitung** kondisi
sejenis di lencana kecil, **mendaftar semua** kondisi aktif berikut aksinya di panel, punya pose
**deciding** saat lead bekerja, dan **tidur** saat memang tak ada apa-apa. Tanpa endpoint, skema,
poll, atau channel WS baru; tanpa menyentuh satu pun jaminan spec A (reduced-motion, a11y, gerbang
tap SPEC-763, mesin berkeliaran).

## 3. Keputusan yang mengikat

1. **Status koneksi diturunkan dari socket `events` yang sudah ada** — bukan channel, endpoint,
   atau poll baru (ADR-0039 utuh). `events.ts` menumbuhkan `subscribeStatus`/`eventsStatus`
   di samping `subscribe` yang ada, memakai socket yang sama.
2. **`connected` menyala pada FRAME PERTAMA, bukan pada `onopen`.** Socket terbuka adalah fakta
   transport; frame yang tiba adalah fakta pengiriman. Ini pelajaran terukur SPEC-878/ADR-0134
   (socket `OPEN` tanpa byte mengalir menghapus 9 glyph dan mematikan prediksi 30,5 dtk tanpa satu
   pun banner) diterapkan ke permukaan kedua. Objective menyebutnya "pulih otomatis saat frame
   pertama masuk lagi" — itu klausa yang sama.
3. **Tab hidden BUKAN "terputus".** `onVisibility` menutup socket dengan sengaja; menyebutnya
   gangguan berarti setiap kembali dari tab lain memudarkan pet. Status membawa `paused` terpisah
   dari `connected`, dan jam "tak terhubung sejak" **dinolkan saat tab aktif lagi** — kalau tidak,
   `since` bernilai jam-jam lalu dan pet langsung mengaku putus di detik pertama tab kembali.
4. **`derivePetState` menjadi turunan dari daftar.** Sumber tunggalnya kini
   `derivePetConditions(input): PetCondition[]` (urut prioritas); `derivePetState` mengembalikan
   `conditions[0]` beserta seluruh daftarnya. Tabel prioritas tetap **satu** tempat — panel dan
   pose tak bisa saling bertentangan secara konstruksi.
5. **`kind` ≠ `pose`.** Dua kondisi berbeda memakai pose `blocked` yang sama (sesi gagal; backlog
   tertahan dependency). Lencana dan daftar menghitung per **kind**, animasi memilih per **pose**.
6. **Gerbang "tertahan dependency hanya saat tak ada sesi hidup" DIPERTAHANKAN** untuk urutan, dan
   kondisinya **tetap didaftar** di panel. `blockedBy` adalah keadaan normal & berumur panjang di
   project ber-`dependsOn` (ADR-0093); menaikkannya jadi puncak permanen adalah persis "gerbang
   yang tak pernah padam" yang sudah tercatat sebagai jebakan SPEC-585. Panel boleh menyebutnya,
   pose tidak.
7. **Dua baris atlas baru lewat pipeline A yang sama** (`gen.py` → `key.py` → `register.py` →
   `qa.py` → `atlas.py`), latar hijau, model sheet `ref/anoman-pet-model.png` dilampirkan, tanpa
   mirror, dengan artefak `qa/` sebagai bukti review. Bukan cara lain, bukan tangan.
8. **Tanpa ADR.** Tak ada keputusan arsitektur yang berubah: tanpa endpoint/skema/channel, tanpa
   dependency baru, tanpa keluarga aset baru (dua baris menumpang keluarga & pipeline ADR-0140).
   Yang bertambah adalah isi tabel prioritas dan bentuk panel — konvensi, bukan arsitektur.
   ADR-0039 (tanpa realtime baru), ADR-0134 (fakta pengiriman ≠ fakta transport), ADR-0093, dan
   ADR-0140 semuanya **ditegakkan**, tak ada yang diamandemen.

## 4. Status koneksi (`src/src/api/events.ts`)

```ts
export type EventsStatus = {
  connected: boolean;   // frame terakhir benar-benar tiba
  since: number;        // ms epoch — kapan keadaan ini mulai
  paused: boolean;      // tab hidden: socket ditutup SENGAJA, bukan gangguan
};
export function eventsStatus(): EventsStatus;
export function subscribeStatus(handler: (s: EventsStatus) => void): () => void;
```

| peristiwa | status sesudahnya |
|---|---|
| modul dimuat | `{ connected: false, since: <load>, paused: document.hidden }` |
| frame pertama tiba (`ws.onmessage`) | `connected: true`, `since` dicap ulang |
| `ws.onclose` (bukan intentional) | `connected: false`, `since` dicap ulang |
| tiket WS gagal (`open()` catch) | tak berubah (sudah `false`) — hanya `scheduleReconnect` |
| tab hidden | `paused: true` **sebelum** `close()`, `since` tidak dicap ulang |
| tab aktif lagi | `paused: false`; `since` dicap ulang **bila sedang tak terhubung** |

`subscribeStatus` **tidak** membuka socket: ia pengamat. Yang membuka tetap `subscribe`, dan App
sudah memanggilnya untuk `specs`/`sessions` (plus `NotificationsContext`), jadi selama pet hidup
socketnya selalu ada. Notifikasi hanya dikirim saat nilainya **benar-benar berubah** — status yang
identik tak boleh memicu render.

## 5. Kontrak pet yang diperluas (`src/src/screens/pet-state.ts`)

### 5.1 Tipe

```ts
export type PetPose = "ready" | "sleeping" | "working" | "deciding" | "waiting"
  | "blocked" | "review" | "shipped" | "docs-updated" | "offline";

export type PetConditionKind = "offline" | "failed" | "waiting" | "deciding" | "shipped"
  | "docs-updated" | "working" | "review" | "blocked" | "ready";

export type PetCondition = {
  kind: PetConditionKind;
  pose: PetPose;
  headline: string;
  detail: string;
  count: number;                 // berapa hal sejenis (≥ 1)
  target: PetTarget | null;      // null = tak ada yang bisa dibuka (kondisi `offline`)
  recheckAt: number | null;      // kapan kondisi INI berhenti benar tanpa data baru
};

export type PetView = PetCondition & { conditions: PetCondition[] };

export type PetConnection = { connected: boolean; since: number; paused: boolean };

export function derivePetConditions(input: PetInput): PetCondition[];
export function derivePetState(input: PetInput): PetView;   // conditions[0] + daftarnya
```

`PetInput` bertambah dua field **opsional** supaya pemanggil & test yang tak peduli tetap
berjalan apa adanya:

```ts
connection?: PetConnection;   // default: terhubung
quietSince?: number;          // default: undefined → tak pernah tidur
```

Tiga perubahan kontrak yang perlu disebut namanya:

- **`transientUntil` → `recheckAt`.** Maknanya melebar dari "kapan pose transient ini luruh"
  menjadi "kapan pandangan ini berhenti benar **tanpa data baru**". Tiga hal kini memakainya —
  peluruhan transient, habisnya grace `offline`, dan onset `sleeping` — dan ketiganya dilayani
  **satu** `setTimeout` yang sudah ada di komponen. Satu field, satu timer, tak ada denyut.
- **`target` boleh `null`.** Kondisi `offline` tak menunjuk sesi atau backlog mana pun; memberinya
  target palsu berarti tombol yang membuka layar yang salah.
- **Sufiks `+N lainnya` dicabut dari `detail`.** Jumlah kini dibawa `count`, ditampilkan lencana
  dan daftar panel. Menyisakannya berarti angka yang sama diucapkan tiga kali di ruang 268 px.

### 5.2 Tabel prioritas

Urutan array **adalah** urutan prioritas; kandidat pertama yang menyala jadi pose. Seluruh
kandidat yang menyala masuk `conditions`.

| # | kind | pose | baris atlas | menyala saat | count |
|---|---|---|---|---|---|
| 1 | `offline` | `offline` | `idle` (pudar) | `!connected && !paused` dan sudah lewat `PET_OFFLINE_MS` sejak `since` | 1 |
| 2 | `failed` | `blocked` | `blocked` | ada sesi `exited && exitCode` bukan nol | jumlah sesi gagal |
| 3 | `blocked` | `blocked` | `blocked` | **hanya bila tak ada sesi hidup** dan ada backlog belum-`done` ber-`blockedBy` | jumlah backlog tertahan |
| 4 | `waiting` | `waiting` | `waiting` | sesi hidup ber-`decision` yang **tidak** sedang dilayani lead | jumlah sesi |
| 5 | `deciding` | `deciding` | `deciding` | sesi hidup ber-`deciding` (lead sedang menyusun keputusan) | jumlah sesi |
| 6 | `shipped` | `shipped` | `shipped` | notifikasi `done`/`automerge` non-audit, masih di dalam window transient | jumlah notifikasi segar |
| 7 | `docs-updated` | `docs-updated` | `docs-updated` | notifikasi `done` untuk backlog ber-`source: "audit"`, masih transient | jumlah notifikasi segar |
| 8 | `working` | `working` | `working` | sesi hidup, backlog belum `done`, **bukan** `deciding` | jumlah sesi |
| 9 | `review` | `review` | `review` | sesi terdaftar yang backlog-nya `stage: "done"` | jumlah sesi |
| 10 | `blocked` | `blocked` | `blocked` | backlog tertahan dependency **saat ada sesi hidup** — ekor daftar, tak pernah jadi pose | jumlah backlog tertahan |
| — | `ready` | `ready` / `sleeping` | `idle` / `sleep` | lantai: daftar kosong | jumlah backlog siap |

Baris 3 dan 10 adalah **kondisi yang sama** di dua tempat: gerbang "tak ada sesi hidup" memutuskan
apakah ia boleh menjadi **pose** (naik ke #3) atau hanya boleh **didaftar** (turun ke #10). Itu
mempertahankan perilaku SPEC-585 apa adanya sambil memenuhi "panel mendaftar semua kondisi".

Tiga hal yang tak terbaca dari kodenya:

- **`offline` tak menyala seketika.** `PET_OFFLINE_MS = 6_000`. Backoff reconnect mulai 500 ms dan
  berlipat (0,5 → 1 → 2 → 4 → 8 → 10 dtk); tanpa grace, satu blip jaringan memudarkan pet dan
  membuat lencana berkedip. 6 dtk menelan tiga percobaan gagal dan tetap jauh lebih pendek dari
  umur data basi yang jadi keluhannya. Selama grace berjalan, pose tetap yang lama dan
  `recheckAt = since + PET_OFFLINE_MS` — pet berpindah tepat pada waktunya, tanpa interval.
- **`deciding` duduk di bawah `waiting`, bukan di atasnya.** Sesi yang dilayani lead **tidak**
  meminta apa-apa dari manusia; sesi ber-`decision` meminta. Ini konsisten dengan pengecualian
  `deciding` di dalam `waiting` yang sudah ada sejak SPEC-585 — yang berubah hanya: keadaan itu
  kini punya wajah sendiri alih-alih menyamar jadi `working`.
- **`sleeping` adalah sub-keadaan lantai, bukan kondisi.** Ia tak pernah masuk `conditions`; ia
  mengganti pose & baris dari kondisi lantai `ready`. Karena itu tidur tak pernah bisa menutupi
  sesuatu yang sedang terjadi — kalau ada satu saja kondisi, lantai tak dipakai. Konsekuensinya
  disengaja dan perlu disebut: sesi gagal yang tak ditengok dan backlog yang tertahan dependency
  **menahan pet tetap terjaga**, walau keduanya bisa berumur berjam-jam. Tidur berarti "tak ada
  yang meminta apa pun darimu"; selama sebuah kondisi masih terdaftar, ada yang meminta.

### 5.3 Tidur

```ts
export const PET_SLEEP_MS = 30 * 60_000;
export function petPulse(sessions: TerminalSession[], notifications: Notification[]): string;
```

`petPulse` = tanda tangan "ada kehidupan": id sesi hidup (diurut) + `createdAt` notifikasi
terbaru. Komponen menyimpan `quietSince` dan **mencapnya ulang setiap kali pulse berubah** memakai
pola "menyesuaikan state saat prop berubah" (bandingkan nilai saat render, bukan `useEffect` — tak
ada render perantara yang salah). `derivePetState` menjadikan lantai `sleeping` saat
`quietSince !== undefined && now − quietSince ≥ PET_SLEEP_MS`; sebelum itu ia menaruh
`recheckAt = quietSince + PET_SLEEP_MS` sehingga pet tertidur lewat **satu timeout**, bukan
interval. Bangunnya bukan timer sama sekali: pulse berubah → `quietSince` dicap ulang → lantai
kembali `ready` pada render yang sama.

`quietSince` disemai `Date.now()` saat mount. Konsekuensinya disengaja: membuka dashboard berarti
pet terjaga 30 menit lagi, sekalipun sudah sepi berjam-jam sebelum tab dibuka. Menyemainya dari
notifikasi terlama akan membuat pet menyambut operator dengan tidur — jawaban yang benar secara
data tetapi salah secara produk.

### 5.4 Kata benda per kind

`KIND_NOUN: Record<PetConditionKind, string>` (mis. `waiting → "sesi menunggu jawabanmu"`,
`blocked → "backlog tertahan dependency"`). Dipakai dua tempat dan hanya dua: `title` lencana dan
kalimat sr-only saat `count > 1`. Ia ada supaya "2" punya satuan — lencana telanjang di pojok
sprite adalah angka tanpa makna bagi pembaca layar.

## 6. Renderer (`HanomanPet.tsx`)

Struktur DOM spec A **tidak berubah**; tiga hal ditambahkan di tempatnya masing-masing.

```
pet-actor
└─ pet-stage   role=status aria-live=polite
   ├─ pet-reactor
   │  └─ pet-viewport   ← + opacity 0,45 saat pose `offline` (data-offline)
   │     └─ pet-rowshift → img.hn-pet-atlas
   ├─ span.hn-sr-only   kalimat status (+ "· N <noun>" saat count > 1)
   ├─ span.pet-badge    ← BARU: lencana hitungan, aria-hidden, pointer-events:none
   └─ button.hit        44×44 di kaki
```

- **Pudar saat terputus** duduk di `pet-viewport`, **bukan** di `pet-stage`: `pet-stage` memakai
  `hn-pet-reveal … both`, dan `animation-fill-mode: forwards` menang atas `opacity` inline, jadi
  fade di sana akan diam-diam tak berpengaruh. `pet-viewport` tak punya animasi. Transisinya
  `opacity var(--dur-slow) var(--ease-out)`, dan `none` persis saat reduced-motion.
- **Lencana** tampil saat `view.count ≥ 2`. Hanya token DS: `var(--accent)` / `var(--accent-on)` /
  `var(--border-hair)` / `var(--shadow-sm)` / `var(--radius-pill)` / `var(--font-ui)` — tanpa satu
  pun warna literal. `aria-hidden` + `pointerEvents: "none"`: angkanya sudah ada di kalimat
  sr-only (satu sumber), dan jalur pet tak boleh menumbuhkan hit area kedua (SPEC-763).
- **Panel multi-kondisi** merender `view.conditions` sebagai daftar; **baris pertama** memakai
  tipografi headline (font display, `--text-strong`) dan sisanya tipografi daftar. Tak ada blok
  headline terpisah di atas daftar — kalau ada, kondisi puncak akan tertulis dua kali di panel
  268 px. Tiap baris: judul + detail + lencana hitungan kecil (saat `count > 1`) + tombol
  `Buka Terminal`/`Buka Backlog` sesuai `target`-nya sendiri; baris ber-`target: null` (yaitu
  `offline`) tak punya tombol. Saat `offline`, satu kalimat di bawah daftar menyebut bahwa isinya
  **data terakhir**, karena mendaftar kondisi basi tanpa mengatakannya adalah kebohongan yang sama
  dalam bentuk lebih panjang.
- Tombol `Diam di pojok`/`Berkeliaran` dan `Sembunyikan` tetap di baris tombol paling bawah.
- `wave` **tidak** dipasang saat pose `offline` atau `sleeping`: melambai atas data basi, atau
  melambai sambil tidur, keduanya berbohong.

## 7. Mesin berkeliaran (`pet-walk.ts`)

Satu cabang baru, di antara cabang jeda dan cabang pose perhatian:

| kondisi | perilaku |
|---|---|
| `offline` ∨ `sleeping` | **diam di tempat** — transisi dipotong di posisi saat ini, baris pose diputar; tak pulang ke pojok |

`deciding` masuk himpunan **pose tenang** bersama `ready`/`working`/`review`/`docs-updated`: lead
yang bekerja bukan permintaan tolong, jadi pet tak perlu pulang ke pojok. Sisa tabel spec A §7 tak
berubah. `POSE_ROW` dilengkapi tiga pose baru (`deciding → deciding`, `sleeping → sleep`,
`offline → idle`) sehingga `stepWalk` tetap total.

`offline` memakai baris `idle`, bukan baris sendiri: yang dikatakan pet saat terputus adalah "aku
tak tahu", dan itu diucapkan oleh **pudar + kalimat**, bukan oleh gerak baru. Menambah baris ke-13
untuk itu berarti membayar ±80 KB atlas demi informasi yang sudah tersampaikan.

## 8. Atlas: dua baris baru (`deciding`, `sleep`)

`PET_ROW_KEYS`, `parsePetManifest` (jumlah baris = panjang `PET_ROW_KEYS`), `petlib.ROWS`, dan
`pet.json` bergerak bersama — ketiganya adalah satu kontrak di tiga bahasa. Dua baris **ditambahkan
di ekor** array (indeks 10 & 11) supaya indeks baris lama tak bergeser dan diff atlas minimal.

```
{ "key": "deciding", "fps": 6, "loop": true }     mode registrasi: stand
{ "key": "sleep",    "fps": 4, "loop": true }     mode registrasi: stand
```

Atlas menjadi 1536×2496 (12 baris). Isi frame (naskah di `internal/assets/pet/prompts/<key>.md`,
kosakata brand: emosi lewat mata/alis, kepala, gestur, ekor; tanpa wajah emoji, tanpa slapstick):

| baris | isi | dibedakan dari |
|---|---|---|
| `deciding` | berdiri tegak, berat badan ke belakang, satu tangan di dagu, pandangan ke **atas** menerawang, alis naik, ekor melengkung pelan seperti tanda tanya; kedip di frame 6 | `review` yang **condong ke depan** memindai sesuatu di kanan — `deciding` tak sedang melihat apa pun |
| `sleep` | duduk meringkuk, mata terpejam, kepala turun-naik sangat lambat mengikuti napas, ekor melingkari tubuh, satu telinga berkedut sekali | `blocked` yang **berdiri** dengan bahu jatuh dan mata setengah terbuka |

**Anggaran.** Atlas 10 baris saat ini 799 KB pada `quality=82`; ±80 KB/baris berarti 12 baris
≈ 960 KB — di bawah plafon `ATLAS_BUDGET` 1 MB tetapi tanpa ruang. `atlas.py` sudah **gagal keras**
bila terlampaui. Bila hasil nyata menembus plafon, `quality` diturunkan (82 → 78) untuk seluruh
atlas dan angkanya dicatat di `internal/assets/pet/README.md`; menaikkan plafon bukan pilihan —
satu `<img>` yang di-decode di setiap halaman adalah anggaran, bukan preferensi.

**Gerbang.** `qa.py` apa adanya: 8 sprite terdeteksi, tak ada yang menyentuh tepi lembar, tumpahan
sel 0 px, residu pra-pin ≤ 0,15 (mode `stand`), alpha utuh. Artefak `qa/deciding.gif`,
`qa/sleep.gif`, contact sheet, dan onion-skin dikomit sebagai bukti review Gate 2.

## 9. Aksesibilitas & reduced motion

Semua jaminan spec A dipertahankan, dengan tiga tambahan:

- Kalimat sr-only menjadi `Hanoman <label> · <headline>` + ` · <count> <noun>` saat `count > 1`.
  Tetap **satu** sumber kalimat; lencana `aria-hidden` justru yang menjaganya tetap satu.
- Label pose baru: `deciding → "sedang diputuskan lead"`, `sleeping → "tidur"`,
  `offline → "tak terhubung"`. Headline `offline` memuat jam mulai (`tak terhubung sejak HH:MM`,
  `toLocaleTimeString` dua digit) — "sejak" tanpa jam adalah keluhan tanpa ukuran.
- `prefers-reduced-motion`: fade `opacity` memakai `transition: none` (nilai persis, di-assert),
  lencana tetap tampil (ia informasi, bukan gerak), dan pet tetap di rumah.

## 10. Kinerja

Nol permukaan jaringan baru: status koneksi adalah pengamat socket yang sudah ada, tidur adalah
satu `setTimeout`, grace `offline` menumpang timeout `recheckAt` yang sama. Render tambahan hanya
saat status koneksi benar-benar berubah (`subscribeStatus` mendedup) dan saat pulse berubah.
Panel merender daftar yang panjangnya terbatas jumlah kondisi (≤ 9), di dalam kontainer yang
sudah `overflow-y: auto`.

## 11. Pengujian

Semua dijalankan `env -u NODE_ENV pnpm vitest --run <path>` (prod bikin RTL `act` gagal).

- `src/test/events.test.ts` — `subscribeStatus`: awal tak terhubung; **frame pertama** (bukan
  `onopen`) menyalakan `connected`; `onclose` mematikannya dan mencap `since`; tab hidden memberi
  `paused` tanpa mencap `since`; tab aktif lagi mencap ulang `since` saat masih putus; status yang
  tak berubah tak memanggil handler. `vi.resetModules()` per test — modulnya singleton.
- `src/test/pet-state.test.ts` — tabel §5.2 lengkap: `offline` menang atas segalanya **setelah**
  grace dan **tidak** sebelumnya; `paused` tak pernah `offline`; `deciding` di antara `waiting` dan
  transient; `working` mengecualikan `deciding`; `sleeping` setelah `PET_SLEEP_MS` dan hanya di
  lantai; `conditions` memuat semua yang menyala dengan `count` benar; `blocked` dependency naik
  ke #3 hanya saat tak ada sesi hidup dan tetap terdaftar di ekor saat ada; `recheckAt` = yang
  paling awal di antara transient/grace/tidur.
- `src/test/pet-sprite.test.ts` — manifest nyata 12 baris; `deciding`/`sleep` punya indeks &
  durasi; `POSE_ROW` total atas sepuluh pose.
- `src/test/hanoman-pet.test.tsx` — lencana muncul di `count ≥ 2` dan tidak di `count = 1`; panel
  merender satu baris per kondisi dengan tombol per baris ke target masing-masing; baris `offline`
  tanpa tombol; `pet-viewport` pudar (`data-offline`) saat terputus; kalimat sr-only memuat jumlah;
  `wave` tak dipasang saat `offline`/`sleeping`; test a11y/roam/reduced/pointer-containment lama
  tetap hijau.
- `src/test/pet-walk.test.ts` — `offline`/`sleeping` diam di tempat (tak pulang, `durationMs` 0);
  `deciding` ikut aturan pose tenang.
- `python3 internal/scripts/pet/test-petlib.py` — tetap hijau dengan 12 baris (assert komposisi
  atlas memakai `len(petlib.ROWS)`, bukan angka).
- `python3 internal/scripts/pet/verify.py` + `atlas.py --check` — atlas & manifest segar.
- Typecheck paket `src` saja.

## 12. Docs (commit yang sama)

- `internal/docs/frontend/frontend-implementation.md` — seksi "Pet Hanoman": tabel prioritas baru,
  status koneksi, `recheckAt`, lencana, panel multi-kondisi, tidur, 12 baris atlas.
- `internal/assets/pet/README.md` — 12 baris, dua baris baru, catatan anggaran/quality.
- `internal/docs/README.md` — tautan keduanya sudah ada sejak spec A; dicek ulang, bukan ditambah.
- **Tanpa ADR** (§3.8). Alasannya dicatat di seksi docs agar tak dibaca sebagai kelalaian.

## 13. Di luar scope

Gelembung teks & rekap "selama kamu pergi" (spec C, SPEC-898), inbox keputusan
(spec D, SPEC-899), urgensi menurut umur (butuh `decisionAt` di payload sesi — `TerminalSession`
tak punya stempel waktu), pose `thanks`, mengubah `derivePetState` menjadi berskop project,
menampilkan status koneksi di luar pet, dan menambahkan baris atlas untuk `offline`.

## 14. Struktur berkas

| berkas | perubahan |
|---|---|
| `src/src/api/events.ts` | `EventsStatus`, `eventsStatus`, `subscribeStatus` di atas socket yang sama |
| `src/src/screens/pet-state.ts` | pose/kind baru, `derivePetConditions`, `recheckAt`, `petPulse`, `KIND_NOUN`, konstanta grace & tidur |
| `src/src/screens/pet-sprite.ts` | `PET_ROW_KEYS` 12 baris, `POSE_ROW` sepuluh pose |
| `src/src/screens/pet-walk.ts` | cabang diam di tempat, `deciding` sebagai pose tenang |
| `src/src/screens/HanomanPet.tsx` | status koneksi, lencana, panel multi-kondisi, pudar, tidur |
| `internal/scripts/pet/petlib.py` | `ROWS` + dua baris |
| `internal/assets/pet/prompts/{deciding,sleep}.md` | naskah baru |
| `internal/assets/pet/rows/{deciding,sleep}.png` + `.report.json`, `qa/{deciding,sleep}.*` | artefak pipeline |
| `internal/assets/pet/hnm-pet-anoman-atlas-v01.webp`, `pet.json` | dirakit ulang 12 baris |
| `src/test/{events,pet-state,pet-sprite,pet-walk}.test.ts`, `src/test/hanoman-pet.test.tsx` | §11 |
| docs | §12 |
