# Messaging / Sistem pesan

Messaging bergerak dari kategori yang langsung dipahami menuju cerita yang lebih dalam. Gunakan
lapisan paling pendek yang cukup untuk konteks; jangan memasukkan keempat lakon ke setiap permukaan.

Messaging moves from an immediately legible category toward deeper storytelling. Use the shortest
layer sufficient for the context; do not force all four lakons onto every surface.

## Message hierarchy / Hierarki pesan

### 1. Brand line — **Approved**

> **Kekuatan yang mengemban amanat.**  
> **Power in service of intent.**

Gunakan pada manifesto, halaman About, brand film, cover brand book, dan penutup komunikasi besar.
Jangan gunakan sebagai pengganti deskripsi produk pada kemunculan pertama.

Use it in the manifesto, About page, brand film, brand-book cover, and major campaign closings. Do
not use it instead of a product description at first contact.

### 2. Category descriptor — **Approved**

> **Open-source control room untuk AI coding agents.**  
> **The open-source control room for AI coding agents.**

Gunakan dekat nama produk pada homepage, metadata, booth, dan intro singkat.

Use it near the product name on the homepage, in metadata, at events, and in short introductions.

### 3. Product one-liner — **Approved**

> **Jalankan banyak coding agent lintas project tanpa kehilangan konteks, visibilitas, atau
> kendali.**  
> **Run coding agents across projects without losing context, visibility, or control.**

### 4. Message pillars / Pilar pesan

#### Grounded in context

**Indonesia:** Setiap session bekerja terhadap objective, docs, spec, dan keputusan yang dapat
ditelusuri—bukan ingatan model yang kebetulan tersedia.

**English:** Every session works against traceable objectives, docs, specs, and decisions—not
whatever the model happens to remember.

**Product proof / Bukti produk:**

- docs sebagai Source of Truth secara konvensi;
- alur brief/QA → objective/spec → plan → execute; dan
- prompt session membawa kontrak repo serta dokumen yang relevan.

**Do not claim / Jangan klaim:** Agent otomatis memahami seluruh codebase tanpa konteks yang dirawat.

#### Visible in motion

**Indonesia:** Tim melihat pekerjaan saat bergerak dan dapat steer, interupsi, mengambil alih, atau
membatalkan ketika keputusan manusia dibutuhkan.

**English:** The team sees work in motion and can steer, interrupt, take over, or cancel when human
judgment is required.

**Product proof / Bukti produk:**

- session interaktif mengalir ke terminal web;
- tmux menjaga session tetap hidup lintas restart API; dan
- overview, status fase, notifikasi, serta terminal menunjukkan keadaan kerja.

**Do not claim / Jangan klaim:** Semua tindakan agent aman hanya karena terlihat di dashboard.

#### Durable by default

**Indonesia:** Setiap hasil kembali sebagai branch, diff, laporan, status, dan docs yang dapat dipakai
oleh manusia atau agent berikutnya.

**English:** Every outcome returns as a branch, diff, report, status, and docs the next human or agent
can use.

**Product proof / Bukti produk:**

- satu backlog mempunyai branch dan worktree terisolasi;
- docs diperbarui bersama perubahan yang menyentuhnya; dan
- session dapat dilanjutkan dari artefak serta riwayat yang tersisa.

**Do not claim / Jangan klaim:** Docs selalu lengkap, benar, atau tidak perlu dirawat.

### 5. Four lakons / Empat lakon

Gunakan [empat lakon](02-four-lakons.md) ketika audiens sudah memahami fungsi produk dan membutuhkan
alasan mengapa Hanoman bekerja seperti itu. Urutan terbaik untuk narasi panjang adalah Duta → Obong →
Dronagiri → Chiranjivi.

Use the [four lakons](02-four-lakons.md) once the audience understands the product and needs the reason
behind its behavior. For long-form storytelling, use Duta → Obong → Dronagiri → Chiranjivi.

## Descriptions / Deskripsi

### 25 words — **Approved**

**Indonesia (25 kata)**  
Hanoman adalah control room open-source yang membantu tim engineering kecil menjalankan coding agent
lintas project dengan konteks, visibilitas, isolasi, dan kendali manusia tetap utuh.

**English (25 words)**  
Hanoman is the open-source control room helping small engineering teams run coding agents across
projects while preserving context, visibility, isolation, and meaningful human control throughout.

### 50 words — **Approved**

**Indonesia**  
Hanoman membantu tim engineering kecil menjalankan banyak coding agent dari satu control room
open-source. Setiap backlog bergerak di session dan worktree terisolasi, berpijak pada docs, terlihat
melalui terminal, dan tetap dapat diarahkan manusia. Hasilnya kembali sebagai branch, diff, laporan,
serta pengetahuan yang dapat dilanjutkan.

**English**  
Hanoman helps small engineering teams run coding agents from one open-source control room. Each
backlog moves through an isolated session and worktree, grounded in docs, visible through the
terminal, and steerable by humans. Outcomes return as branches, diffs, reports, and knowledge the
next contributor or agent can continue.

### 100 words — **Approved boilerplate**

**Indonesia**  
Hanoman adalah control room open-source untuk tim engineering kecil yang menjalankan coding agent di
banyak project. Brief dan QA finding bergerak menjadi objective, spec, plan, lalu session interaktif
di worktree terisolasi. Tim memantau pekerjaan melalui dashboard dan terminal, lalu dapat steer,
interupsi, mengambil alih, atau membatalkan ketika diperlukan. Docs tetap menjadi Source of Truth
secara konvensi, sehingga keputusan dan hasil tidak hilang bersama berakhirnya session. Hanoman tidak
menjanjikan engineering tanpa manusia; ia memberi tim leverage untuk menjalankan lebih banyak kerja
dengan konteks yang benar, paralelisme yang disiplin, serta hasil yang dapat direview dan dilanjutkan.

**English**  
Hanoman is the open-source control room for small engineering teams running coding agents across
projects. Briefs and QA findings become objectives, specs, plans, and interactive sessions inside
isolated worktrees. Teams watch work through the dashboard and terminal, then steer, interrupt, take
over, or cancel when needed. Docs remain the conventional Source of Truth, so decisions and outcomes
do not disappear with the session. Hanoman does not promise engineering without humans; it gives
teams the leverage to run more work with correct context, disciplined parallelism, and outcomes that
remain reviewable and ready to continue.

## Elevator pitch / Pitch singkat — **Approved**

**Indonesia**  
Coding agent membuat tim kecil mampu bergerak seperti tim yang jauh lebih besar—tetapi hanya jika
setiap agent menerima konteks yang benar dan kerjanya tetap terlihat. Hanoman memberi satu control
room untuk mengubah brief atau QA finding menjadi session yang berjalan di worktree terisolasi,
memantaunya secara realtime, dan membawa hasil kembali ke docs serta branch yang dapat direview.

**English**  
Coding agents can make a small team move like a much larger one—but only when every agent receives
the right context and its work remains visible. Hanoman provides one control room that turns briefs
or QA findings into sessions running in isolated worktrees, monitors them in real time, and returns
their outcomes to docs and reviewable branches.

## GitHub repository description / Deskripsi repository — **Approved**

**Indonesia**  
Control room open-source untuk menjalankan coding agent lintas project dengan docs, worktree
terisolasi, terminal realtime, dan kendali manusia.

**English**  
Open-source control room for running coding agents across projects with docs, isolated worktrees,
real-time terminals, and human control.

## Homepage hero — **Approved**

| Elemen | Indonesia | English |
|---|---|---|
| Eyebrow | Open-source control room untuk AI coding agents | The open-source control room for AI coding agents |
| Headline | Banyak agent. Satu kendali. | Many agents. One control room. |
| Subhead | Jalankan coding agent lintas project dengan konteks yang benar, session yang terlihat, worktree terisolasi, dan kendali yang tetap berada di tangan tim. | Run coding agents across projects with the right context, visible sessions, isolated worktrees, and control that stays with your team. |
| Primary CTA | Pasang Hanoman | Install Hanoman |
| Secondary CTA | Lihat cara kerjanya | See how it works |

## Campaign taglines / Tagline kampanye — **Adaptable**

| Indonesia | English | Gunakan untuk |
|---|---|---|
| Banyak agent. Satu kendali. | Many agents. One control room. | Homepage, demo, kategori produk. |
| Amanat menjadi kerja. Kerja menjadi pengetahuan. | Intent becomes work. Work becomes knowledge. | Manifesto, docs-driven workflow, changelog. |
| Bergerak cepat. Tetap berpijak. | Move fast. Stay grounded. | Parallelism, launch, campaign engineering. |

Tagline campaign boleh diadaptasi pada ritme, bukan pada prinsip. Jangan membuat tagline yang
menjanjikan otonomi tanpa batas, kebenaran otomatis, atau penggantian tim.

Campaign taglines may adapt in rhythm, not principle. Do not promise unbounded autonomy, automatic
correctness, or replacement of the team.

## CTA vocabulary / Kosakata CTA

### **Approved**

| Tujuan | Indonesia | English |
|---|---|---|
| Installation | Pasang Hanoman | Install Hanoman |
| Education | Lihat cara kerjanya | See how it works |
| Session | Buka session | Start a session |
| Backlog | Buat backlog | Create backlog |
| Review | Review diff | Review diff |
| Continuation | Lanjutkan session | Resume session |
| Human intervention | Ambil alih | Take over |
| Cancellation | Batalkan session | Cancel session |
| Integration | Merge branch | Merge branch |

### **Avoid**

- “Mulai lakon” sebagai label `Start a session`.
- “Utus Anoman” sebagai label `Create backlog` atau `Run`.
- “Bakar penghalang” sebagai label retry, force, delete, atau merge.
- “Abadikan” sebagai satu-satunya label save, commit, atau update docs.

Istilah teatrikal dapat menjadi eyebrow atau supporting copy selama CTA literal tetap ada.

Theatrical language may appear as an eyebrow or supporting line as long as the literal CTA remains.

## Proof language / Bahasa bukti

Klaim publik harus memakai bukti yang dapat dilihat atau diuji:

| Klaim | Bukti yang menyertainya |
|---|---|
| “Grounded in docs” | Tunjukkan index docs, objective/spec/plan, atau prompt session. |
| “Visible” | Tunjukkan overview, fase, terminal, atau history. |
| “Isolated” | Sebut satu backlog/satu session/satu worktree dan branch hasil. |
| “Human control” | Sebut steer, interrupt, take over, cancel, dan review. |
| “Durable” | Tunjukkan docs, diff, result, changelog, atau resume. |

Public claims should point to visible or testable evidence. Avoid unsupported superlatives such as
“the smartest”, “effortless”, “zero oversight”, “magical”, or “revolutionary”.

## Message selection / Memilih lapisan pesan

| Konteks | Mulai dengan | Tambahkan bila ruang tersedia |
|---|---|---|
| npm/GitHub metadata | Category descriptor | GitHub description |
| Homepage | Category + one-liner | Three pillars + four-lakon story |
| README | One-liner + workflow | Product proof + installation |
| Demo | User problem + one-liner | Visible session and isolated worktree proof |
| About/manifesto | Brand idea | Four lakons + cultural sources |
| Product UI | Literal state/action | One short principle only when helpful |
| Release | User outcome | One lakon motif that explains the change |
| Community | Shared purpose | Indonesian roots + open-source invitation |

## Final messaging check / Pemeriksaan akhir

Sebelum pesan dipakai, pastikan category dapat dipahami tanpa mitologi, klaim mempunyai bukti,
manusia tetap terlihat dalam sistem, versi Indonesia dan English setara makna, dan lakon memperdalam
cerita alih-alih membebani tindakan.

Before use, confirm the category is legible without mythology, claims have proof, humans remain
visible in the system, Indonesian and English carry equivalent meaning, and the lakons deepen the
story rather than burden the action.
