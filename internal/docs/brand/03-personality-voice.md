# Personality & voice / Kepribadian dan suara

## Archetype / Arketipe

> **Duta teknis yang tangguh.**  
> **A resilient technical envoy.**

Hanoman berbicara seperti operator yang memahami keadaan, rekan engineering yang berani menyebut
risiko, dan duta yang bertanggung jawab membawa hasil pulang. Suaranya jelas sebelum epik, tenang
sebelum tegas, dan selalu lebih tertarik pada bukti daripada pertunjukan.

Hanoman speaks like an operator who understands the state, an engineering partner willing to name
risk, and an envoy accountable for bringing results home. Its voice is clear before epic, calm before
decisive, and always more interested in evidence than spectacle.

## Personality / Kepribadian

| Sifat | Dalam praktik | Bukan |
|---|---|---|
| Setia pada amanat / Faithful to intent | Menjaga objective dan acceptance tetap utuh sambil mengangkat konflik. | Patuh membuta atau hanya mengulang prompt. |
| Perkasa tanpa pamer / Powerful without showing off | Menyatakan kemampuan melalui hasil dan bukti. | Membesar-besarkan kecerdasan atau otonomi. |
| Tenang mengawasi, tegas bertindak / Calm in observation, decisive in action | Memberi status ringkas; memakai kata kerja langsung saat tindakan perlu. | Dingin, pasif, gaduh, atau agresif. |
| Cermat dan jujur tentang keraguan / Context-aware and candid about uncertainty | Menyebut apa yang belum diketahui dan cara memastikannya. | Menebak atau menyamarkan kegagalan. |
| Membawa hasil pulang / Accountable for returning outcomes | Menyebut diff, branch, docs, dampak, dan langkah berikutnya. | Menganggap terminal output sebagai hasil akhir. |
| Berakar, lalu terbuka / Rooted in Indonesia, open to the world | Mengakui akar wayang Jawa/Indonesia dan menulis Inggris yang natural. | Eksotisme, campur-aduk tradisi, atau terjemahan kaku. |

## Voice principles / Prinsip suara

### 1. State, then action / Keadaan, lalu tindakan

Mulai dari apa yang benar saat ini. Lanjutkan dengan apa yang dilakukan atau apa yang dibutuhkan.

Start with what is true now. Follow with what is being done or what is needed.

> **Approved** — “Session berhenti karena branch tujuan berubah. Rebase diperlukan sebelum lanjut.”  
> **Avoid** — “Terjadi gangguan tak terduga. Silakan coba lagi.”

### 2. Active and accountable / Aktif dan bertanggung jawab

Sebut pelaku dan tindakan. Hindari kalimat pasif yang menyembunyikan siapa yang akan melakukan apa.

Name the actor and action. Avoid passive language that hides who will do what.

> **Approved** — “Hanoman akan membuat worktree terisolasi untuk backlog ini.”  
> **Avoid** — “Sebuah worktree akan dibuat.”

### 3. Evidence, impact, control / Bukti, dampak, kendali

Untuk status penting, jawab tiga pertanyaan: bukti apa yang ada, apa dampaknya, dan siapa yang dapat
bertindak.

For consequential states, answer three questions: what evidence exists, what it affects, and who can
act.

> **Approved** — “3 test gagal di `server/test/auth.test.ts`; merge belum dijalankan. Buka terminal
> untuk memperbaiki atau batalkan session.”  
> **Avoid** — “Agent mengalami masalah.”

### 4. Specific uncertainty / Ketidakpastian yang spesifik

Jangan memakai “mungkin” tanpa objek. Nyatakan apa yang belum diketahui, mengapa itu penting, dan
langkah untuk menguranginya.

Do not use “maybe” without an object. State what is unknown, why it matters, and the step that would
reduce uncertainty.

> **Approved** — “Default branch belum dapat dipastikan karena `origin/HEAD` tidak ada. Pilih branch
> tujuan sebelum merge.”  
> **Avoid** — “Sepertinya branch-nya bermasalah.”

### 5. Technical term before metaphor / Istilah teknis sebelum metafora

Gunakan lakon untuk memberi makna, bukan untuk menyembunyikan fungsi.

Use lakon language to add meaning, not to hide function.

> **Approved** — “Docs membawa konteks ke setiap session—semangat Anoman Duta dalam bentuk yang dapat
> diaudit.”  
> **Avoid** — “Utus wanara ke kelir baru” untuk tindakan `Start a session`.

## Tone by surface / Tone per permukaan

| Permukaan | Tujuan tone | Ciri | Intensitas lakon |
|---|---|---|---|
| Website / homepage | Membuat kategori dan nilai cepat dipahami. | Tegas, lapang, percaya diri, berbukti. | Tinggi pada hero/editorial; istilah produk tetap literal. |
| Documentation | Membuat tindakan dapat dilakukan sekali baca. | Lugas, presisi, edukatif, tidak menggurui. | Rendah–sedang; dipakai untuk menjelaskan prinsip. |
| Product UI | Membantu keputusan cepat dan aman. | Pendek, literal, berorientasi keadaan/tindakan. | Rendah; jangan mengganti label teknis. |
| Terminal & status | Menunjukkan apa yang sedang bergerak. | Ringkas, faktual, timestamp/angka bila relevan. | Sangat rendah. |
| Errors | Menjelaskan sebab, dampak, dan pemulihan. | Tenang, jujur, tanpa menyalahkan pengguna. | Nol bila metafora mengaburkan pemulihan. |
| Release notes | Menghubungkan perubahan dengan nilai pengguna. | Spesifik, optimistis secukupnya, memberi kredit. | Sedang; satu motif lakon boleh mengikat cerita. |
| Community | Mengundang kontribusi dengan standar jelas. | Hangat, setara, terbuka pada koreksi budaya/teknis. | Sedang–tinggi untuk storytelling. |

## Sentence patterns / Pola kalimat

### Status

`[Keadaan] + [bukti atau cakupan] + [langkah berikutnya bila perlu].`

`[State] + [evidence or scope] + [next step when needed].`

> “Session aktif · fase Execute · 4 dari 7 checklist selesai.”  
> “Session active · Execute phase · 4 of 7 checklist items complete.”

### Success

`[Hasil] + [di mana hasil berada] + [apa yang dapat dilakukan berikutnya].`

> “Backlog selesai. Hasil tersedia di branch `hanoman/spec-123`; review diff sebelum merge.”  
> “Backlog complete. The result is on `hanoman/spec-123`; review the diff before merging.”

### Error

`[Yang gagal] + karena [sebab yang diketahui] + [dampak] + [pemulihan].`

> “Session gagal dibuka karena tmux tidak tersedia. Tidak ada worktree yang dibuat. Pasang tmux lalu
> coba lagi.”  
> “The session could not start because tmux is unavailable. No worktree was created. Install tmux and
> try again.”

### Uncertainty

`[Yang belum diketahui] + [mengapa menentukan] + [siapa/apa yang dapat memastikan].`

> “Target deploy belum disebutkan; pilihan ini menentukan secret dan host yang dipakai. Konfirmasi
> environment sebelum agent melanjutkan.”  
> “The deploy target is unspecified; it determines the secrets and host in use. Confirm the
> environment before the agent continues.”

## Bilingual conventions / Konvensi bilingual

### Pairing

- Untuk brand book, landing page bilingual, dan materi inti, letakkan Indonesia lebih dulu lalu
  English dalam blok yang berdekatan. / For core bilingual material, place Indonesian first and
  English in an adjacent block.
- Untuk UI, pilih locale; jangan tampilkan dua bahasa dalam satu control. / In product UI, select a
  locale; do not place two languages inside one control.
- Terjemahkan makna dan ritme, bukan urutan kata. / Translate meaning and rhythm, not word order.

### Pronouns / Kata ganti

- Indonesia: gunakan **kamu** untuk instruksi pengguna dan **tim** untuk narasi kolektif. Hindari
  “Anda” kecuali konteks legal atau kebijakan menuntut formalitas.
- English: use **you** for direct guidance and **your team** when responsibility is shared.
- Hanoman disebut **Hanoman**, bukan “kami”, kecuali penulis benar-benar mewakili komunitas atau
  maintainer manusia.

### Capitalization and punctuation / Kapitalisasi dan tanda baca

- Tulis brand selalu **Hanoman**, kecuali identifier teknis `hanoman` (`npm i -g hanoman`, CLI,
  package, URL, branch convention).
- Gunakan sentence case untuk heading dan UI label.
- Hindari tanda seru pada status, error, dan confirmation. Satu tanda seru boleh dipakai pada momen
  komunitas yang benar-benar merayakan.
- Em dash boleh mengikat gagasan editorial; UI mengutamakan titik dan kalimat pendek.

### Stable vocabulary / Kosakata stabil

| Gunakan | Jangan ganti dengan metafora |
|---|---|
| project | kerajaan |
| backlog | amanat atau gulungan |
| session | lakon atau pentas |
| worktree | padepokan atau wilayah |
| agent | wanara |
| terminal | kelir |
| Source of Truth | kitab |

Kata di kolom kanan boleh hadir dalam esai atau kampanye yang jelas bersifat metaforis, tetapi tidak
menjadi label fitur.

## Approved and avoid examples / Contoh approved dan avoid

### 1. Product promise

> **Approved** — “Jalankan banyak coding agent lintas project tanpa kehilangan konteks, visibilitas,
> atau kendali.”  
> “Run coding agents across projects without losing context, visibility, or control.”

> **Avoid** — “AI akan mengerjakan semuanya untukmu.”  
> “AI will do everything for you.”

### 2. Autonomy

> **Approved** — “Nyalakan scheduler setelah workflow project stabil; setiap session tetap dapat
> diinterupsi.”  
> “Enable the scheduler once the project workflow is stable; every session remains interruptible.”

> **Avoid** — “Unleash limitless autonomous development.”

### 3. Parallel work

> **Approved** — “Jalankan backlog secara paralel; setiap session bekerja di worktree terisolasi.”  
> “Run backlogs in parallel; every session works in an isolated worktree.”

> **Avoid** — “Gerakkan pasukan tanpa batas.”  
> “Command an army without limits.”

### 4. Trust

> **Approved** — “Lihat prompt, terminal, diff, dan riwayat sebelum merge.”  
> “Inspect the prompt, terminal, diff, and history before merging.”

> **Avoid** — “Percayakan project-mu pada kecerdasan Hanoman.”  
> “Trust your project to Hanoman's intelligence.”

### 5. Error

> **Approved** — “Merge berhenti karena konflik di 2 file. Branch sumber tidak diubah.”  
> “The merge stopped on conflicts in 2 files. The source branch is unchanged.”

> **Avoid** — “Anoman gagal menembus Alengka.”  
> “Anoman failed to breach Alengka.”

### 6. Empty state

> **Approved** — “Belum ada backlog. Tulis brief atau catat QA finding untuk memulai.”  
> “No backlog yet. Write a brief or capture a QA finding to begin.”

> **Avoid** — “Kelir masih kosong. Panggil sang duta.”  
> “The stage is empty. Summon the envoy.”

### 7. Release

> **Approved** — “Rilis ini membuat session dapat dilanjutkan tanpa mengulang pekerjaan dari awal.”  
> “This release lets sessions resume without restarting the work.”

> **Avoid** — “A magical leap forward for agentic engineering.”

### 8. Documentation

> **Approved** — “Perbarui docs yang tersentuh agar agent berikutnya menerima konteks yang benar.”  
> “Update the affected docs so the next agent receives the right context.”

> **Avoid** — “Dokumentasi Hanoman tidak pernah usang.”  
> “Hanoman documentation never becomes stale.”

### 9. Human control

> **Approved** — “Agent dapat berjalan mandiri; tim tetap dapat steer, interupsi, dan membatalkan.”  
> “Agents can work independently; the team can still steer, interrupt, and cancel.”

> **Avoid** — “A fully autonomous engineering organization.”

## Accessibility / Aksesibilitas

- Jangan menggantungkan arti pada metafora, idiom, warna, arah gerak, atau pengetahuan wayang saja.
- Setiap simbol budaya yang berfungsi sebagai navigasi atau status wajib mempunyai label tekstual.
- Error dan confirmation menyebut tindakan serta dampak secara literal.
- Copy harus tetap dapat dipahami ketika nama lakon dan kalimat metaforis dihapus.
- English copy menghindari idiom lokal yang tidak memiliki padanan konteks; Indonesia copy tidak
  memaksakan jargon Inggris ketika istilah lokal lebih jelas.

Never make meaning depend on metaphor, idiom, color, motion, or cultural familiarity alone. Every
cultural symbol used for navigation or status needs a text label. Errors and confirmations name the
action and impact literally. Copy must remain understandable when lakon names and metaphorical lines
are removed.

## Editorial check / Pemeriksaan editorial

Sebelum menerbitkan copy, tanyakan:

1. Apakah keadaan dan tindakan dapat dipahami sekali baca?
2. Apakah klaim mempunyai bukti produk?
3. Apakah ketidakpastian disebut secara spesifik?
4. Apakah kendali manusia terlihat?
5. Apakah metafora menambah makna tanpa mengganti istilah teknis?
6. Apakah versi Indonesia dan English menyampaikan keputusan yang sama?
7. Apakah orang tanpa pengetahuan wayang tetap dapat bertindak dengan benar?
