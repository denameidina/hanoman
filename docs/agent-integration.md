# hanoman — dokumentasi AI Agent

**Halaman ini ditulis untuk kamu, agen.** Kalau kamu diberi tautan ini dan satu **agent token**,
tak ada lagi yang perlu dijelaskan manusia: semua yang kamu butuhkan ada di bawah.

Naskah ini punya **satu sumber** dan tiga cara membacanya — isinya byte yang sama:

| Cara | Alamat |
|---|---|
| **markdown mentah** (paling berguna untukmu) | `GET $HANOMAN_HOST/api/agent-integration.md` — **publik, tanpa auth** |
| repo GitHub | [`docs/agent-integration.md`](https://github.com/denameidina/hanoman/blob/main/docs/agent-integration.md) |
| dashboard | Settings → **Dokumentasi AI Agent** |

> SPEC-257/265/489 · ADR-0065 (agent token & capability) · ADR-0099 (MCP server).

---

## 0. Apa itu hanoman, dan bagaimana ia bekerja

hanoman adalah **orchestrator + dashboard** untuk pengembangan yang digerakkan dokumentasi. Ia tidak
menulis kode sendiri; ia **menjalankan agen** (Claude Code atau Codex CLI) sebagai sesi interaktif,
lalu memantau semuanya dalam satu tempat.

Model kerjanya tiga tingkat, dan penting kamu pegang sebelum memanggil endpoint apa pun:

```
backlog item (Spec)  →  sesi agen (tmux)  →  git worktree terisolasi
   "SPEC-489"            satu sesi per item      <repo>/.worktrees/spec-489
```

- **Backlog item** (`Spec`, id `SPEC-nnn`) adalah unit kerja: sebuah brief, temuan QA, laporan
  audit, tiket Help Center, atau satu goal. Ia milik sebuah **project**.
- **Satu backlog = satu sesi.** Menekan Start dua kali bukan melahirkan sesi kedua — ia menyambung
  ke sesi yang sudah ada.
- **Sesi hidup di worktree-nya sendiri**, bercabang dari branch basis, dan mendorong hasilnya ke
  `hanoman/<id>`. Isolasi worktree itulah satu-satunya batas keamanan eksekusi di hanoman —
  tak ada guardrail perintah.
- **Fase bukan proses, melainkan giliran** di dalam satu sesi: `Brainstorm → Objective → Spec →
  Plan → Execute` (bervariasi per jenis kerja). Kemajuannya dibaca dari berkas fase, bukan dari
  status proses.
- **Dokumentasi project (`internal/docs/**`) adalah Source of Truth.** Sebelum mengusulkan apa pun,
  baca dokumen project-nya — itu sikap yang diharapkan dari agen di sini.

Dashboard React hanyalah **satu klien** dari REST API di bawah `/api`. Kamu memakai API yang persis
sama; yang berbeda hanya jalur auth-nya: **`Authorization: Bearer`**, bukan cookie sesi.

## 1. Nyalakan akses & buat token (manusia, sekali)

Langkah ini **bukan** milikmu — mintalah ke manusia bila belum dilakukan. Di dashboard hanoman:
**Settings → Akses AI Agent**.

1. **Aktifkan "Akses AI Agent"** (master switch). Selagi mati, *semua* agent token dibalas **401**
   apa pun capability-nya.
2. **Buat token:** beri nama (mis. `agent-ci`), centang **capability** yang dibutuhkan (baca/tulis
   per domain), klik **Buat token**.
3. **Salin token plaintext sekarang** — bentuknya `hnm_agt_<hex>` dan **hanya ditampilkan sekali**
   (di server hanya `sha256` yang tersimpan). Simpan di rahasia agen (mis. env
   `HANOMAN_AGENT_TOKEN`).

Cabut/nonaktifkan token atau matikan master switch kapan saja → efek **instan**.

## 2. Base URL & autentikasi

```bash
export HANOMAN_HOST="https://hanoman.example"   # TANPA "/" di ekor
export HANOMAN_AGENT_TOKEN="hnm_agt_…"          # dari langkah §1
```

- **Seluruh path berawalan `/api`.** `$HANOMAN_HOST/api/specs`, bukan `$HANOMAN_HOST/specs`.
- **`HANOMAN_HOST` tanpa garis miring di ekor** — path di dokumen ini selalu dimulai dengan `/`,
  jadi ekor ganda menghasilkan `//api/...` yang tak dikenal router.
- Sertakan token di **tiap** request:

  ```
  Authorization: Bearer hnm_agt_xxxxxxxxxxxx
  ```

- Untuk **WebSocket** (terminal PTY, event stream) yang tak bisa memasang header dari browser,
  kirim sebagai query: `?agent_token=hnm_agt_...`.
- **Token diterbitkan per-instance.** Token dari instance lain selalu 401 di sini.

```bash
curl -s "$HANOMAN_HOST/api/specs" -H "Authorization: Bearer $HANOMAN_AGENT_TOKEN"
```

**Probe host lebih dulu.** `GET /api/health` bersifat **publik** (tanpa auth), begitu pula halaman
ini (`GET /api/agent-integration.md`). Keduanya memisahkan tiga sebab yang tampak identik sebagai
"401 telanjang": host salah · master switch mati · token dicabut. Kalau `/api/health` menjawab 200,
host-mu benar dan masalahnya ada pada token atau master switch.

## 3. Capability

Capability berformat `"<domain>:<access>"`, `access ∈ {read, write}`, dan **write meng-implikasikan
read** pada domain yang sama. Ada **13 domain**; empat di antaranya punya akses KETIGA `danger`
(ADR-0155) yang **tak diimplikasikan `:write`**, sehingga totalnya **30 capability**. Katalog resmi (dengan label &
deskripsi) tampil di panel **Settings → Akses AI Agent** saat manusia membuat token; endpoint
katalognya (`GET /api/agent-tokens/capabilities`) bersifat **cookie-only** (lihat §5) — kamu tak
perlu mengambilnya, cukup rujuk tabel di bawah:

| Domain | Cakupan endpoint | Catatan |
|---|---|---|
| `projects` | `/api/projects*` | project, branch, binding, Help Center |
| `backlog` | `/api/specs*` | spec/backlog, dokumen, review diff, integrate |
| `sessions` | `/api/terminal*` (+ WS terminal) | jalankan sesi agen/shell, kirim input, baca & jawab dialog sesi (SPEC-899) — **high-risk (RCE)** |
| `docs` | `/api/prds*`, `/api/projects/:id/{docs,prds}*` | dokumen SoT project & PRD |
| `ide` | `/api/projects/:id/{tree,file,file-diff,working-status,graph,commit,git,status,stashes,remotes,compare,archive,pr-url}*` | tree/file working tree, operasi git |
| `vps` | `/api/vps*` | kelola VPS, audit, harden, konsol — **high-risk (remote exec)** |
| `settings` | `/api/settings*`, `/api/config*`, `/api/scheduler*` | setelan instance & config runtime |
| `support` | `/api/tickets*`, `/api/github-issues*`, `/api/projects/:id/github*` | tiket Help Center & issue GitHub (triase) |
| `notifications` | `/api/notifications*` | notifikasi |
| `lead` | `/api/lead*` | minta putusan ke hanoman-lead & baca jejaknya — **`lead:write` bisa menggerakkan sesi** (ADR-0091) |
| `agents` | `/api/custom-agents*` | katalog custom agent global & per project — **`agents:write` mengubah apa yang dilihat SETIAP sesi baru** (ADR-0094) |
| `telegram` | `/api/telegram*` kecuali sub-path kredensial | context/memory/reply/audit kanal operator Telegram (ADR-0096) |
| `team` | `/api/tasks*`, `/api/members*` | papan **Tim**: kartu kerja MANUSIA & direktori anggota (ADR-0157). `status` kartu milik manusia — ia **bukan** `stage` backlog. `POST /api/tasks/:id/escalate` melahirkan backlog item dan tetap `team:write` (cermin `POST /api/tickets/:id/accept`) |

Aturan pemetaan **deterministik** (`server/src/services/agent-capabilities.ts`): `GET`/`HEAD` →
`:read`, metode lain → `:write`. Itu berlaku untuk domain `lead` juga — **`POST /api/lead/decisions`
menuntut `lead:write`**, dan `lead:read` tak pernah cukup: meminta putusan melahirkan baris jejak
permanen dan keputusannya bisa menggerakkan sesi. Sub-path `/api/projects/:id/{docs,prds}` dihitung
domain **`docs`**; sub-path IDE/git di atas dihitung domain **`ide`**; WebSocket terminal butuh
**`sessions:write`**.

Empat endpoint STATUS tak menuntut capability sama sekali — token sah mana pun boleh membacanya
(`GLOBAL_READ`, ADR-0157): `GET /api/limits`, `GET /api/limits/codex`, `GET /api/update`, dan
`GET /api/fs/browse` (menelusuri folder mesin untuk mengisi `repoDir`). Hanya method BACA:
`POST /api/update/apply` me-restart instance dan tetap **403** untuk agent token, apa pun
capability-nya (SPEC-405/ADR-0088) — prefix yang sama tak menurunkan gerbangnya.

## 4. Aturan gate & kode status

Gate `onRequest` yang sama menegakkan semuanya:

| Situasi | Balasan |
|---|---|
| Master switch mati, atau token invalid/nonaktif/dicabut | **401** `{ error: "unauthorized" }` |
| Token valid tapi capability kurang | **403** `{ error: "capability required", need: "<domain>:<access>" }` |
| Route cookie-only (§5) diakses agen | **403** `{ error: "cookie session required" }` |
| Capability cukup | request diproses seperti biasa |

Field **`need`** pada 403 memberi tahu capability persis yang harus ditambahkan ke token. Baca 403
seperti itu bukan sebagai "gagal" melainkan sebagai **instruksi**: sampaikan `need` ke manusia dan
minta capability itu ditambahkan di Settings.

## 5. Yang tak bisa didelegasikan (cookie-only)

Untuk mencegah privilege-escalation, endpoint berikut **hanya** untuk sesi cookie manusia — agent
token selalu **403**, apa pun capability-nya, dan tak ada capability yang bisa membukanya:

- `/api/auth/*` — kelola user & password
- `/api/agent-tokens*` — agen tak boleh mencetak/menaikkan token sendiri
- `/api/device-tokens*`, `/api/sync*` — identitas mesin & sync hub
- `/api/webhooks*` — memegang secret penandatanganan **dan** menentukan ke mana data workspace
  mengalir keluar (ADR-0100)
- `/api/telegram/settings`, `/api/telegram/test`, `/api/telegram/credentials` — permukaan
  **kredensial** (bot token & agent token), beda dari sisa `/api/telegram*` (ADR-0097)
- `/api/portal*` — portal klien: isinya ditentukan **akun yang login** (`ClientProjectAccess`), jadi
  tak ada capability yang bisa berarti apa pun di sana. Backlog & tiket yang sama tersedia lewat
  `/api/specs` dan `/api/tickets` dengan capability `backlog`/`support` (ADR-0110)
- `/api/client-accounts*` — membuat & mencabut akun klien beserta password awalnya (ADR-0110)
- `/api/session-events` — event pertanyaan sesi untuk hanoman-lead (SPEC-909/ADR-0146). Pemanggilnya
  **hook sesi**, bukan manusia dan bukan agen: kredensialnya token turunan per sesi, dan agen yang
  bisa memalsukan "sesi X bertanya Y" bisa menggerakkan lead atas nama sesi mana pun — itu peniruan
  identitas, bukan capability. Agent token di sini menerima **401** (token sesi tak cocok), bukan
  403: gate cookie mem-bypass path-nya dan route menegakkan tokennya sendiri
- `/api/presence` — peta pekerjaan yang sedang berjalan di **seluruh mesin** operator: sesi apa
  hidup di device mana (SPEC-919/ADR-0147). Tak ada capability yang bisa berarti sesuatu untuk
  agregat lintas-mesin, jadi ia cookie-only apa pun method-nya. Frame siar `presence` di
  `/api/events/ws` mengikuti gerbang yang sama — grup itu **tidak** dikirim ke principal non-cookie,
  walau kanalnya sendiri `GLOBAL_READ` bagi agent token
- `POST /api/update/apply` dan tulis lain di bawah prefix status (`/api/limits`, `/api/update`,
  `/api/events`, `/api/fs`, `/api/health`) — **baca**-nya terbuka untuk token mana pun, **tulis**-nya
  cookie-only

Route yang tak dikenal peta juga **default cookie-only** (aman): endpoint baru tak pernah terbuka
karena kelalaian. Endpoint `/api/help*` (Help Center publik) punya otorisasi sendiri (kunci tiket)
dan tak memakai agent token.

## 6. Endpoint yang paling sering dipakai

| Method & path | Capability | Catatan |
|---|---|---|
| `GET /api/health` | — (publik) | probe host. Tanpa auth. |
| `GET /api/agent-integration.md` | — (publik) | halaman ini, markdown mentah. |
| `GET /api/projects` | `projects:read` | daftar project. `id` di sini yang dipakai `POST /api/specs`. |
| `GET /api/projects/:id` | `projects:read` | detail satu project. |
| `GET /api/specs` | `backlog:read` | backlog. Filter: `project`, `source`, `q`, `stage`, `priority`, `startable=true`, `dateField=created\|started` + `from`/`to` (`YYYY-MM-DD`, inklusif), `page`, `limit`. |
| `POST /api/specs` | `backlog:write` | buat backlog item — bentuk payload di §7. |
| `PATCH /api/specs/:id` | `backlog:write` | ubah item; konten hanya selagi belum dimulai. |
| `POST /api/specs/:id/done` | `backlog:write` | tandai item **selesai** tanpa menjalankan sesi — untuk pekerjaan yang beres di luar hanoman. Body `{ reason?: string (≤280), confirm?: boolean }`, keduanya opsional; balasannya `Spec` yang sudah `stage:"done"`. Tak menjalankan maupun menghentikan sesi apa pun. |
| `GET /api/specs/:id/attachments` | `backlog:read` | lampiran backlog item — gambar & dokumen yang dilampirkan manusia sebagai konteks kerja. |
| `POST /api/specs/:id/attachments` | `backlog:write` | unggah lampiran (`multipart/form-data`, beberapa berkas per request). Berkas yang ditolak **tak** menggagalkan yang lain — periksa `rejected[]`. |
| `GET /api/specs/:id/attachments/:attId` | `backlog:read` | byte satu lampiran. |
| `DELETE /api/specs/:id/attachments/:attId` | `backlog:write` | hapus satu lampiran. |
| `GET /api/specs/:id/docs` | `backlog:read` | dokumen yang ditulis sesi item itu. |
| `GET /api/specs/:id/review` | `backlog:read` | diff hasil kerja sesi. |
| `GET /api/projects/:id/docs` | `docs:read` | index Source of Truth project. |
| `GET /api/projects/:id/docs/<path>` | `docs:read` | isi satu dokumen. |
| `GET /api/projects/:id/changelog` | `docs:read` | changelog yang sudah dibangkitkan (paginated). |
| `POST /api/projects/:id/changelog` | `docs:write` | bangkitkan changelog baru — bentuknya di **§6a**. |
| `GET /api/terminal/sessions` | `sessions:read` | sesi yang sedang hidup. |
| `GET /api/notifications` | `notifications:read` | notifikasi. **Tanpa `limit` → 50 teratas**, bukan seluruhnya (lihat jebakan di §10). |
| `GET /api/tickets` | `support:read` | tiket Help Center. |
| `GET /api/lead/decisions` | `lead:read` | jejak keputusan hanoman-lead. Menerima `page`/`limit`; `take`/`skip` lama tetap jalan. |
| `GET /api/scheduler/queue` | `settings:read` | antrean scheduler (`?status=queued\|launched\|done\|failed`). `GET /api/scheduler/state` **tak lagi** memuat `queue` — ia memuat `queueCounts`. |
| `POST /api/lead/decisions` | `lead:write` | minta putusan — baca **§8** dan **§11** dulu. |

## 6a. Changelog per project

Ringkasan perubahan **berorientasi pemakai** — bukan daftar commit. Tiga mode, satu endpoint;
`mode` menentukan field lainnya:

```bash
# 1) backlog yang selesai di rentang tanggal (dua field opsional → 30 hari terakhir)
curl -sS -X POST "$HANOMAN_HOST/api/projects/<id>/changelog" \
  -H "Authorization: Bearer $HANOMAN_AGENT_TOKEN" -H 'Content-Type: application/json' \
  -d '{"mode":"backlog","from":"2026-07-01","to":"2026-07-31"}'

# 2) rentang commit di repo project
  -d '{"mode":"commit","fromSha":"4f2a1c9","toSha":"HEAD"}'

# 3) versi/tag rilis (fromTag opsional → sejak versi sebelumnya)
  -d '{"mode":"version","toTag":"v1.2.0"}'
```

Jawaban **201** berisi `body` (markdown siap pakai), `title`, `itemCount`, `generator`, dan
`warning`. Ambil ulang atau unduh kapan saja:

```bash
curl -sS "$HANOMAN_HOST/api/projects/<id>/changelog/<cid>?download=md" \
  -H "Authorization: Bearer $HANOMAN_AGENT_TOKEN"
```

Tiga hal yang perlu kamu tahu sebelum memanggilnya:

- **Panggil `GET /api/projects/:id/changelog/sources` dulu.** Ia memberi tag yang tersedia, HEAD
  singkat, rentang default, dan — bila repo belum ditautkan di mesin itu atau belum punya tag — satu
  `reason` yang menjelaskan sebabnya. Ia menjawab **200**, bukan galat, jadi jangan perlakukan
  `reason` sebagai kegagalan.
- **422 berarti permintaanmu sah tapi tak ada isinya** (rentang kosong, repo tanpa tag, revisi tak
  dikenal) — pesannya bisa langsung diteruskan ke manusia. **400** berarti bentuknya salah
  (mis. `from` lebih baru dari `to`).
- **`generator:"fallback"` bukan kegagalan.** Artinya narasi otomatis tak tersedia dan yang kamu
  terima adalah draf ringkas deterministik; alasannya ada di `warning`.

## 7. `POST /api/specs` — bentuk payload per `source`

`source` dan bentuk `payload` **saling mengikat**. Salah pasang → **400**
`"bentuk payload tak cocok dengan source"`. Union saja tak menjaganya (objek non-strict), jadi
server menegakkannya di boundary.

| `source` | Bentuk `payload` | Field |
|---|---|---|
| `brief` | brief | `context`, `outcome`, `constraints`, `priority` |
| `audit` | brief | idem — audit-only: hasilnya dokumen temuan, tanpa Execute |
| `help` | brief | idem — item yang lahir dari tiket Help Center |
| `qa` | qa | `severity` (`critical`\|`major`\|`minor`), `steps`, `expected`, `actual`, `env`, `constraints` (opsional, default `""`) |
| `goal` | goal | `goal` (wajib), `done`, `constraints`, `priority` — sesi dua fase (Goal → Verifikasi) |
| `no_effort` | goal | idem — task remeh, sesi SATU fase (`Kerjakan`): langsung dikerjakan lalu berhenti |

Body lengkap: `project` (slug project), `source`, `title`, `priority`
(`tinggi`\|`sedang`\|`rendah`), `payload`; opsional `branchFrom` (branch basis — harus benar-benar
ada di repo project) dan `dependsOn` (array id backlog yang harus selesai & ter-merge lebih dulu).

Yang **tak** kamu kirim karena diturunkan server: `objective` (dari `outcome`/`context` untuk brief,
`actual`/`steps` untuk qa, `goal` untuk goal & no_effort) dan — khusus `qa` — `priority`, yang
diturunkan dari `severity`.

```json
{
  "project": "hanoman",
  "source": "qa",
  "title": "Tombol Lanjutkan diam saat pane mati",
  "priority": "tinggi",
  "payload": {
    "severity": "major",
    "steps": "Buka Terminal → tunggu sesi keluar → klik Lanjutkan",
    "expected": "Sesi dilanjutkan dari fase terakhir",
    "actual": "Tak terjadi apa-apa",
    "env": "hanoman 0.1.13, macOS"
  }
}
```

Balasannya **201** dengan seluruh baris `Spec`, termasuk `id` (`SPEC-nnn`) yang diterbitkan server.

## 8. Tindakan berbahaya — wajib konfirmasi manusia

Tiga permukaan ini **wajib** kamu konfirmasikan ke manusia lebih dulu, walaupun token-mu sudah punya
capability-nya. Capability menjawab "boleh?", bukan "sebaiknya?".

| Tindakan | Kenapa |
|---|---|
| `POST /api/terminal/sessions` | melahirkan proses agen `--dangerously-skip-permissions` di sebuah worktree — **RCE efektif**. Batas satu-satunya adalah isolasi git worktree (ADR-0037). |
| `POST`/`PUT`/`DELETE` di bawah `/api/vps` | **remote exec** di server produksi. |
| `POST /api/lead/decisions` | putusannya bisa **menggerakkan sesi** (integrate ke main, menghentikan sesi) dan selalu melahirkan baris jejak permanen (ADR-0091/0098). |

Perlakukan `POST /api/specs/:id/integrate`, `DELETE /api/specs/:id`, dan perubahan `stage` dengan
disiplin yang sama: ketiganya mengubah sejarah git atau membuang pekerjaan. `POST /api/specs/:id/done`
tak menyentuh git, tetapi ia **menyatakan pekerjaan orang lain selesai** — pakai hanya bila kamu punya
buktinya, dan tulis buktinya di `reason`.

**Preseden yang mengikat:** MCP server resmi (`hanoman mcp`, §13) sengaja **tak punya tool** untuk
satu pun dari yang di atas — batasnya ada di katalog tool, bukan di token. Token yang punya
`sessions:write` sekalipun tak akan menemukan tool untuk memakainya. Lewat REST kamu *bisa*
memanggilnya; jangan lakukan tanpa manusia.

## 9. Jebakan yang sudah diketahui

| Jebakan | Yang benar |
|---|---|
| `startable` hanya bereaksi pada string **`"true"`**; nilai lain (`false`, `1`, `yes`) diabaikan **senyap** dan kamu menerima daftar penuh yang terlihat sah | kirim `?startable=true`, atau jangan kirim sama sekali |
| `q` mencari di `id`, `title`, dan `objective` saja — ia **tak menyentuh `payload`** | untuk mencari isi brief/QA, ambil itemnya lalu baca `payload` sendiri |
| `id` dan `stage` yang kamu sertakan di `POST /api/specs` **dibuang diam-diam** — tak ada galat | `id` diterbitkan server (`SPEC-nnn` berikutnya), `stage` selalu mulai `brainstorming`. Untuk mengubah stage pakai `PATCH /api/specs/:id`, dan ia hanya boleh **mundur** (ADR-0027) |
| **`GET /api/specs/:id` tidak ada** | `GET /api/specs?q=SPEC-489` lalu cocokkan `id` **persis** — `q` itu substring, jadi ia bisa mengembalikan lebih dari satu |
| `POST /api/specs/:id/done` menjawab **409 `{"error":"confirm-required","session":{...}}`** — itu bukan penolakan, melainkan pemberitahuan bahwa masih ada **sesi hidup** untuk item itu | putuskan dulu apakah sesi itu memang sudah tak relevan; bila ya, kirim ulang dengan `{"confirm": true}`. Sesinya **tidak** ikut dihentikan — tutup sesinya sendiri bila perlu. 409 `{"error":"backlog item sudah selesai"}` berarti item itu memang sudah `done` |
| daftar mengembalikan amplop `{ items, total, page, pageSize }` | jangan perlakukan responsnya sebagai array |
| tanpa `limit`, daftar mengembalikan **seluruh** item dalam satu halaman | kirim `limit` untuk backlog besar |
| **`GET /api/notifications` adalah pengecualiannya**: tanpa `limit` ia mengembalikan **50 teratas**, bukan seluruhnya — angka penuhnya ada di `total` | kirim `page`/`limit` bila kamu butuh riwayat lama; jangan simpulkan `items.length` = seluruh notifikasi |
| `GET /api/scheduler/state` **tidak lagi** memuat `queue` (SPEC-523/ADR-0107) | baca `queueCounts` untuk hitungan, `GET /api/scheduler/queue?status=…&page&limit` untuk barisnya |
| `PATCH /api/specs/:id` menolak edit konten begitu item pernah dimulai | ubah `title`/`payload` hanya selagi item belum punya sesi |
| `branchFrom` yang tak ada di repo project → **400**, bukan diterima lalu gagal di tengah sesi | ambil kandidatnya dari `GET /api/projects/:id/branches` |
| **401 telanjang** tak memisahkan "host salah" dari "token salah" dari "master switch mati" | probe `GET /api/health` sekali: 200 = host benar → masalahnya token atau master switch |
| **403** bukan kegagalan permanen | bacalah field `need`, sampaikan ke manusia, minta capability itu ditambahkan |
| **Lampiran backlog tak menyeberang sync** (`SpecAttachment` LOCAL-only, ADR-0124) | item yang sama di instance lain tampil **tanpa** lampiran. Kalau lampiran yang disebut manusia tak kamu temukan, kemungkinan besar kamu bicara ke instance yang bukan tempat lampiran itu diunggah — tanyakan, jangan simpulkan lampirannya tak ada |

## 10. Contoh alur end-to-end

Bisa disalin apa adanya.

```bash
export HANOMAN_HOST="https://hanoman.example"        # tanpa "/" di ekor
export HANOMAN_AGENT_TOKEN="hnm_agt_…"               # dari Settings → Akses AI Agent
auth=(-H "Authorization: Bearer $HANOMAN_AGENT_TOKEN")

# 0. Host benar? (publik, tanpa auth — memisahkan "host salah" dari "token salah")
curl -fsS "$HANOMAN_HOST/api/health"

# 0b. Baca halaman ini sendiri (publik, markdown mentah)
curl -fsS "$HANOMAN_HOST/api/agent-integration.md"

# 1. Project apa saja yang ada? (projects:read) — `id` di sini yang dipakai langkah berikutnya
curl -fsS "${auth[@]}" "$HANOMAN_HOST/api/projects"

# 2. Backlog yang belum selesai di satu project (backlog:read)
curl -fsS "${auth[@]}" "$HANOMAN_HOST/api/specs?project=hanoman&startable=true&limit=20"

# 3. Sudah ada item tentang "webhook"? (q = substring atas id+title+objective, BUKAN payload)
curl -fsS "${auth[@]}" "$HANOMAN_HOST/api/specs?project=hanoman&q=webhook"

# 4. Filekan temuan sebagai backlog item (backlog:write)
curl -fsS -X POST "$HANOMAN_HOST/api/specs" "${auth[@]}" \
  -H "Content-Type: application/json" \
  -d '{
        "project": "hanoman",
        "source": "qa",
        "title": "Preview docs menggulir ke samping",
        "priority": "sedang",
        "payload": { "severity": "minor", "steps": "Buka Docs → pilih .md panjang",
                     "expected": "Teks membungkus", "actual": "Muncul scrollbar horizontal",
                     "env": "hanoman 0.1.13, Chrome" }
      }'
# → 201 { "id": "SPEC-490", ... }   ← id datang dari server; jangan pernah dikirim

# 5. Ambil satu item (tak ada GET /api/specs/:id — pakai q lalu cocokkan persis)
curl -fsS "${auth[@]}" "$HANOMAN_HOST/api/specs?q=SPEC-490" \
  | python3 -c 'import json,sys; print([s for s in json.load(sys.stdin)["items"] if s["id"]=="SPEC-490"])'

# 6. Baca Source of Truth project sebelum mengusulkan apa pun (docs:read)
curl -fsS "${auth[@]}" "$HANOMAN_HOST/api/projects/hanoman/docs"

# 7. 403? Bacanya bukan "gagal" — bacanya "tambahkan capability ini ke token":
#    { "error": "capability required", "need": "backlog:write" }
```

**Yang TIDAK kamu lakukan tanpa manusia:** menjalankan backlog itu
(`POST /api/terminal/sessions`) — lihat §8.

## 11. Minta putusan ke hanoman-lead

Agen yang menemui persimpangan tak selalu harus berhenti menunggu manusia — bila project-nya
meng-opt-in **hanoman-lead**, ia boleh **meminta putusan**:

```bash
curl -s -X POST "$HANOMAN_HOST/api/lead/decisions" \
  -H "Authorization: Bearer $HANOMAN_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "projectId": "hanoman",
        "specId": "SPEC-409",
        "question": "Tambah kolom baru di Spec, atau turunkan dari updatedAt?",
        "options": ["kolom baru", "turunkan dari updatedAt"],
        "context": "Filter rentang tanggal butuh waktu item dibuat."
      }'
# 201 { id, decision, reason, refs: ["ADR-0090", "internal/docs/..."], confidence: "tinggi", action: "none" }
```

Jawabannya **terbaca mesin**, bukan prosa bebas, dan `refs` hanya memuat rujukan yang benar-benar
ada di repo — jadi kamu bisa memverifikasi sendiri dasar keputusannya. `confidence: "ragu"` berarti
lead tetap memutuskan tapi memilih opsi yang paling mudah dibatalkan, dan operator sudah
dinotifikasi.

Kode balasan yang perlu ditangani:

| Kode | Artinya |
|---|---|
| **409** | lead tak aktif / project belum opt-in → **kembali ke perilaku lama**: berhenti & tunggu manusia |
| **503** + `Retry-After` | lead sedang penuh (batas konkurensi) → **boleh diulang** sesudah jeda; ini bukan kegagalan lead |
| **504** | lead tak berhasil memutuskan dalam batas waktu; kegagalannya sudah tercatat & dinotifikasi |
| **403** `{ need: "lead:write" }` | token cuma punya `lead:read` |

Ingat §8: permintaan putusan **bisa menggerakkan sesi**. Konfirmasikan ke manusia dulu.

## 12. Keamanan

- Token = rahasia. Simpan di env/secret manager, **jangan commit**, dan **jangan pernah** berikan
  lewat argumen baris perintah — ARGV terbaca proses lain di mesin yang sama. Bocor → **Cabut** di
  Settings (efek instan).
- Beri capability **seminimal** mungkin. `sessions:write` (spawn agen
  `--dangerously-skip-permissions`) dan `vps:write` (remote exec) adalah RCE efektif — batas
  eksekusi sesungguhnya tetap **isolasi git worktree** (ADR-0037), tapi tetap tandai high-risk.
- `lastUsedAt` per token = jejak audit ringan. Matikan master switch untuk kill-switch seluruh
  workspace.
- Halaman ini sendiri **tak pernah memuat token nyata** — hanya format/placeholder. Kalau kamu
  melihat sesuatu yang menyerupai token asli di sini, itu bug; laporkan.

## 13. MCP server (ADR-0099)

Agen yang berbicara **MCP** tak perlu menulis pembungkus sendiri. `hanoman mcp` adalah MCP server
**stdio** yang membungkus permukaan REST di atas sebagai **17 tool**. Ia memakai **agent token dan
capability yang sama** — bukan jalur otorisasi baru — jadi seluruh aturan §3–§5 berlaku apa adanya.

Prasyarat: `npm i -g hanoman` di mesin tempat klien AI-nya jalan.

**Claude Code / Claude Desktop / Cursor / Copilot** (`~/.claude.json`,
`claude_desktop_config.json`, `~/.cursor/mcp.json`, `.vscode/mcp.json` — Cursor & Copilot memakai
kunci `"servers"` alih-alih `"mcpServers"`):

```json
{
  "mcpServers": {
    "hanoman": {
      "command": "hanoman",
      "args": ["mcp"],
      "env": {
        "HANOMAN_HOST": "https://hanoman.example",
        "HANOMAN_AGENT_TOKEN": "hnm_agt_…"
      }
    }
  }
}
```

**Codex** (`~/.codex/config.toml`):

```toml
[mcp_servers.hanoman]
command = "hanoman"
args = ["mcp"]
env = { HANOMAN_HOST = "https://hanoman.example", HANOMAN_AGENT_TOKEN = "hnm_agt_…" }
```

Panduan siap salin untuk keempat klien, berikut tabel tool → capability, ada di dashboard:
**Settings → Akses AI Agent → MCP server**.

### Tool

| Tool | Mode | Capability |
|---|---|---|
| `hanoman_about` | baca | — (tak memanggil `/api` selain `/health`) |
| `hanoman_projects_list`, `hanoman_project_get` | baca | `projects:read` |
| `hanoman_backlog_search`, `hanoman_backlog_get`, `hanoman_backlog_docs_list`, `hanoman_backlog_doc_read` | baca | `backlog:read` |
| `hanoman_sessions_list` | baca | `sessions:read` |
| `hanoman_notifications_list` | baca | `notifications:read` |
| `hanoman_tickets_list`, `hanoman_ticket_get`, `hanoman_github_issues_list` | baca | `support:read` |
| `hanoman_lead_decisions_list` | baca | `lead:read` |
| `hanoman_backlog_create`, `hanoman_backlog_update` | tulis | `backlog:write` |
| `hanoman_notifications_mark_read` | tulis | `notifications:write` |
| `hanoman_lead_ask` | tulis | `lead:write` |

### Yang sengaja TIDAK tersedia lewat MCP

Membuat sesi terminal (`POST /api/terminal/sessions` — menjalankan agen di worktree, RCE efektif)
dan seluruh `/api/vps*` (remote exec) **tidak ikut**, begitu pula merge/rebase (`integrate`),
penghapusan backlog, dan perubahan `stage`. Batasan ini ada di katalog toolnya, bukan di token:
token yang punya `sessions:write` sekalipun tak akan menemukan tool untuk memakainya. Lihat §8.

**Menjawab dialog sesi** (`GET /api/terminal/sessions/:id/dialog`,
`POST /api/terminal/sessions/:id/dialog/answer`, dan sejak SPEC-909 · ADR-0146 juga
`POST /api/terminal/sessions/:id/dialog/takeover` — merebut sesi dari hanoman-lead) sengaja **tak
punya tool** — dan alasannya lebih tajam dari sekadar "mengeksekusi": endpoint itu menjawab pertanyaan
yang **secara desain ditujukan kepada manusia** (`AskUserQuestion`). Agen yang bisa memanggilnya
bisa menjawab pertanyaannya sendiri, dan gerbang "manusia terakhir yang memutuskan" runtuh lewat
pintu belakang. Capability-nya tetap ada (`sessions:read`/`sessions:write`) karena peta itu berlaku
untuk seluruh permukaan HTTP, bukan hanya untuk yang muncul di MCP.

**Lampiran backlog** (`/api/specs/:id/attachments*`, SPEC-843 · ADR-0124) juga sengaja **tak punya
tool**: berkasnya lahir dari disk manusia, bukan dari model, dan tool MCP berbentuk JSON sehingga
byte biner tak punya representasi di sana. REST-nya tetap terjangkau agent token
ber-`backlog:read`/`backlog:write` — yang tak dipajang adalah **tool**-nya.

### Opsi

| Variabel / flag | Arti |
|---|---|
| `HANOMAN_HOST` / `--host <url>` | **Wajib.** Instance yang dituju. Agent token diterbitkan per-instance — token dari instance lain selalu 401 di sini, dan MCP server menjelaskannya, bukan meneruskan 401 telanjang. |
| `HANOMAN_AGENT_TOKEN` | **Wajib.** Hanya dari env atau `~/.hanoman/agent-token` — **tak pernah** dari argumen baris perintah (ARGV terbaca proses lain di mesin yang sama). |
| `HANOMAN_MCP_READ_ONLY=1` / `--read-only` | Menyembunyikan seluruh tool tulis dari `tools/list`. |
| `HANOMAN_MCP_MAX_BYTES` / `--max-bytes <n>` | Plafon ukuran balasan tool. Default 24576. Balasan yang dipotong ditandai `truncated: true` + `shown`/`total`. |

Skema tool berversi (`MCP_TOOL_SCHEMA_VERSION`, saat ini **1**) dan aditif dalam satu versi:
menambah tool tak mematahkan klien lama.

---

*Doc-of-record fitur: [ADR-0065](../internal/docs/adr/0065-ai-agent-capability-agent-token.md) dan,
untuk permukaan MCP, [ADR-0099](../internal/docs/adr/0099-mcp-server-hanoman.md). Kontrak API penuh:
[`internal/docs/architecture/api-contract.md`](../internal/docs/architecture/api-contract.md) —
permukaan REST-nya identik dengan yang dipakai dashboard.*
