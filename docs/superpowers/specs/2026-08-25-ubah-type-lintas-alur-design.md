# Ubah type backlog lintas-alur — reset ke brainstorming

**Tanggal:** 2026-08-25
**Status:** disetujui, belum diimplementasikan
**Mengamandemen:** SPEC-546 · ADR-0109 (konversi type in-place)
**ADR baru:** ADR-0149 (nomor dikonfirmasi saat commit — nomor ADR pernah bertabrakan antar-worktree)
**Nomor SPEC:** belum diterbitkan; nomor resmi lahir dari server saat backlog item dibuat.

## Keluhan

> "ketika di klik ubah type nya tidak muncul modal nya"

## Akar masalah

Tombol **Ubah type** dirender tanpa syarat apa pun selain adanya handler
(`src/src/screens/BacklogScreen.tsx:265`). Dialognya menolak dengan diam:

```ts
// src/src/screens/ChangeSourceDialog.tsx:37
if (!options.length) return null;   // tak ada tujuan yang sah
```

`options` disaring gerbang ADR-0109: item yang **sudah pernah dimulai**
(`stage !== "brainstorming" || baseSha !== null`) hanya boleh pindah ke type dengan **flow
yang sama**. Peta flow (`shared/src/dto.ts:302`):

| type | flow | teman se-flow |
|---|---|---|
| brief | feature | help |
| help | feature | brief |
| qa | qa | — |
| audit | audit | — |
| goal | goal | — |
| no_effort | no_effort | — |

Empat type sendirian di flow-nya ⇒ nol opsi ⇒ `return null` ⇒ klik tanpa efek, tanpa pesan.

**Terukur di DB produksi operator** (`~/.hanoman/hanoman.db`, 2026-08-25): 251 item `qa`,
44 `audit`, 10 `goal`, 2 `no_effort` — seluruhnya `done`/sudah dimulai. Untuk semua item itu
tombol Ubah type mati total. Hanya 11 item `brainstorming` dan pasangan `brief`/`help` yang
dialognya hidup.

Jadi ini dua cacat bertumpuk: **kebijakan** yang terlalu ketat, dan **penyampaian** yang bisu.
Keduanya diperbaiki di spec ini.

## Keputusan

Perpindahan type lintas-alur **diperbolehkan**, dengan konsekuensi eksplisit: item dikembalikan
ke tahap `brainstorming` dan jejak sesi lamanya dibuang.

Alasan gerbang lama tetap sah — sesi menulis nama fase `PIPELINES[flow]` ke berkas fase, jadi item
ber-flow `feature` (lima fase) yang pindah ke `goal` (dua fase) meninggalkan berkas yang tak akan
pernah memuaskan `phasesComplete` flow barunya. Yang salah bukan diagnosisnya, melainkan obatnya:
melarang perpindahan, padahal berkas yang mengganggu itu bisa dihapus.

### Yang TIDAK berubah

Perpindahan **se-alur** untuk item yang sudah dimulai (`brief ↔ help`) tetap in-place seperti
sekarang: tanpa reset, tanpa konfirmasi, tanpa penghapusan apa pun. Ini kasus yang paling sering
terjadi dan hari ini sudah benar. Begitu pula item yang belum pernah dimulai.

## Kontrak

`zChangeSpecSource` (`shared/src/dto.ts:120`) mendapat satu field: `confirmReset?: boolean`.
Endpoint tetap `POST /api/specs/:id/source`.

`checkSourceChange` (`server/src/services/spec-source.ts:26`) berhenti menjawab boleh/tidak dan
mulai menjawab **rencana**:

```ts
export type SourceGate =
  | { ok: true; payload: Record<string, unknown>; dropped: string[]; reset: boolean }
  | { ok: false; code: number; error: string };
```

`reset: true` hanya untuk **sudah dimulai + flow berbeda** — keadaan yang hari ini dijawab 409.
`confirmReset` **diabaikan** saat `reset: false`: mengirimnya pada perpindahan se-alur bukan error,
dan tak membuat apa pun terhapus.
Modul ini tetap **murni** (tanpa DB, git, atau jam sistem), sesuai premis berkas itu.

## Urutan di route

Saat `reset` menyala:

1. **Sesi hidup → 409.** `getSession(sessionIdForSpec(id))`; kalau ada dan belum `exited`,
   tolak: *"tutup dulu sesi yang sedang berjalan"*. Berdiri paling depan, sebelum apa pun
   tersentuh — agen yang sedang mengetik tak boleh kehilangan worktree di bawah kakinya.
2. **Dry-run.** `artifactsToRemove(projectId, id, "brainstorming", spec.stage)` plus keberadaan
   worktree `.worktrees/<sid>` dan branch `hanoman/<sid>`. Tanpa `confirmReset: true` →
   `{ pending: true, wouldDelete, worktree, branch }` dan **berhenti**. Nol mutasi.
   Konfirmasi tetap diminta **walau ketiga daftar itu kosong** (item `done` yang worktree-nya
   sudah lepas): yang dikonfirmasi bukan cuma penghapusan, melainkan mundurnya stage.
3. **Eksekusi**, urutannya mengikat:
   1. hapus dokumen fase — `deleteDoc`, gagal-diam (pola SPEC-167),
   2. lepas worktree — `releaseWorktree` → `.trash` (SPEC-742/ADR-0116),
   3. hapus branch lokal — `runGitOp` `delete-branch` force,
   4. `prisma.spec.update`: `source`, `payload`, `priority`, `objective`, `sourceHistory`,
      `stage: "brainstorming"`, `baseSha: null`, `headSha: null`, `startedAt: null`,
   5. `recordSourceChange` + `notifySynced("spec", id)` seperti sekarang.

**Kenapa branch sebelum DB:** `deleteBranches` punya kunci `spec-open` ("backlog-nya belum
selesai"); begitu stage jadi `brainstorming`, kunci itu menyala dan branch tak bisa dihapus lagi.

**Kenapa `runGitOp`, bukan `deleteBranches`:** gerbang di `branch-cleanup.ts` dirancang untuk
pembersihan massal tak-terarah, tempat operator tak melihat satu per satu apa yang dibuang. Di
sini operator menunjuk satu branch dan menyetujui daftarnya. Branch **remote tidak disentuh**.

**Kenapa `baseSha` ikut dikosongkan:** `session-launch.ts:122` memakainya sebagai penanda
*resume* — kalau dibiarkan, sesi berikutnya melanjutkan worktree lama berisi kerja alur lama.
`baseSha != null` juga tetap mengunci edit konten SPEC-186 (`specs.ts:197`), sehingga item yang
"sudah kembali ke brainstorming" tetap tak bisa diedit isinya.

## Dialog

Satu predikat mengatur tampilan:

```ts
const resetNeeded = started && flowForSource(target) !== flowForSource(spec.source);
```

| keadaan | tampilan | payload dikirim |
|---|---|---|
| belum dimulai | seperti sekarang: semua type, form konversi | ya |
| sudah dimulai, se-alur | seperti sekarang: "yang berpindah hanya labelnya" | tidak |
| sudah dimulai, lintas-alur | form konversi + panel peringatan reset | ya |

Submit pada keadaan ketiga tak langsung mengubah apa pun: server menjawab `pending`, dialog
berganti jadi daftar konkret (berkas, worktree, branch) dengan tombol merah
**"Reset & ubah type"** — bentuk dan kata-katanya meminjam konfirmasi revert stage di
`BacklogScreen.tsx:511`.

`onChangeSource` (`src/src/App.tsx:1148`) mengembalikan hasil, seperti `onRevertStage` sudah
lakukan, supaya `pending` sampai kembali ke dialog.

**`if (!options.length) return null` dihapus.** Penyaringan flow dicabut, jadi opsi tak akan
pernah kosong. Kalau suatu hari benar-benar kosong, dialog tetap terbuka dan mengatakan
alasannya. Modal tak boleh lagi menolak dengan diam — itu cacat aslinya.

## Test

**Murni** (`server/test/` atau kolokasi `spec-source`):
- lintas-alur + sudah dimulai → `reset: true`
- se-alur + sudah dimulai → `reset: false`, payload lama dipakai apa adanya
- belum dimulai → `reset: false`, `convertPayload` berlaku

**Route** (`server/test/spec-source.route.test.ts`):
- tanpa `confirmReset` → `pending`, **dan baris DB tak berubah sedikit pun**
- dengan `confirmReset` → stage `brainstorming`, `baseSha`/`headSha`/`startedAt` null,
  `sourceHistory` bertambah satu entri berisi payload lama utuh
- sesi hidup → 409, nol mutasi
- se-alur + sudah dimulai → tetap in-place, tak ada yang dihapus
- no-op (`to === source`) tetap 400

**Dialog** (`src/test/change-source.test.tsx`):
- item `qa` yang sudah `done` **membuka modal** — regresi test untuk keluhan aslinya
- panel peringatan reset muncul hanya saat lintas-alur
- alur konfirmasi dua langkah sampai `confirmReset` terkirim

## Dokumentasi

- **ADR-0149** — amandemen ADR-0109: kunci flow diganti reset eksplisit. Mencatat bahwa gerbang
  lama menolak lewat jalur yang tak punya suara, dan bahwa alasan aslinya dijawab dengan
  menghapus berkas yang mengganggu, bukan melarang perpindahannya.
- `internal/docs` yang tersentuh diperbarui **dalam commit yang sama**, dan ditautkan di
  `internal/docs/README.md`.

## Risiko yang diterima

- **Penghapusan worktree & branch tak bisa dibatalkan.** Commit yang belum ter-merge di branch
  sesi hilang. Operator memilih ini secara sadar; mitigasinya adalah daftar konkret di layar
  konfirmasi + worktree yang lewat `.trash`, bukan `rm` langsung.
- **Item `done` bisa mundur ke `brainstorming`.** Ini menembus premis "stage hanya maju"
  (ADR-0008), sama seperti revert stage SPEC-167 sudah menembusnya. Dibatasi jalur yang sama:
  hanya lewat operasi eksplisit berkonfirmasi, tak pernah dari sesi.

## Di luar lingkup (dicatat, tidak dikerjakan di sini)

- `src/src/App.tsx:364-372` mendaftar tab type buat-backlog secara literal
  (`brief, qa, audit, goal, no_effort`) — **`help` hilang**, padahal `SOURCE_OPTS` diturunkan dari
  `zSpecSource.options`. Item `help` bisa dituju lewat konversi tapi tak bisa dibuat langsung.
- `zPatchSpec` tanpa `.strict()`: `PATCH /specs/:id { source: "qa" }` menjawab 200 sambil membuang
  field itu diam-diam. Bukan penyebab keluhan ini, tapi kelas gagal-senyap yang sama.
