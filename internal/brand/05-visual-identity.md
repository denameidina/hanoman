# Visual identity / Identitas visual

## Visual idea / Gagasan visual

> **A quiet instrument panel carrying epic force.**  
> **Instrument panel yang tenang, mengemban daya yang epik.**

Hanoman menggabungkan ketelitian ruang kerja engineering dengan tenaga visual pewayangan
Jawa/Indonesia. Produk sehari-hari terasa tenang, editorial, dan dapat dipindai. Daya epik muncul pada
mark, komposisi, ilustrasi, serta momen tindakan—bukan sebagai kebisingan permanen.

Hanoman combines the precision of an engineering workspace with the visual force of
Javanese/Indonesian wayang. Everyday product surfaces remain calm, editorial, and scannable. Epic
energy appears in the mark, composition, illustration, and moments of action—not as constant noise.

Untuk nilai token, component, spacing, radius, dan state UI, gunakan
[Hanoman design system](../docs/design-system/design-system.md). Dokumen ini menjelaskan peran dan
makna; ia tidak mendefinisikan implementasi kedua.

For token values, components, spacing, radii, and UI states, use the
[Hanoman design system](../docs/design-system/design-system.md). This document governs role and
meaning; it does not create a second implementation authority.

## Buntut mark

### Meaning / Makna

**Buntut** adalah primary brand mark Hanoman: sebuah spiral bertaper yang bergerak keluar. Ia dapat
dibaca sebagai ekor Anoman, lintasan tenaga, session yang terus bergerak, dan konteks yang tetap
terhubung dari pusat ke hasil.

**Buntut** is Hanoman's primary brand mark: a tapered spiral moving outward. It can be read as
Anoman's tail, a path of energy, a session in motion, and context that remains connected from center
to outcome.

Spiral tidak berarti loop tanpa akhir. Ujungnya bergerak keluar: kerja harus kembali ke dunia sebagai
hasil, bukan berputar selamanya di dalam agent.

The spiral does not represent an endless loop. Its end moves outward: work must return to the world
as an outcome rather than spin forever inside an agent.

### Implementation authority / Otoritas implementasi

- [`src/src/ds/marks.tsx`](../../src/src/ds/marks.tsx) adalah sumber komponen dan geometri mark.
- [`src/public/favicon.svg`](../../src/public/favicon.svg) berisi path yang di-bake untuk favicon.
- Jangan mengedit path favicon dengan tangan; regenerate melalui sumber design system.
- Jaga clear space yang membuat spiral dapat dibaca sebagai satu gestur, bukan ornamen padat.
- Pada ukuran kecil, pakai mark saja. Pada konteks baru atau eksternal, pasangkan dengan wordmark
  **Hanoman** sampai pengenalan terbentuk.

### Approved use / Penggunaan approved

- Satu warna kontras pada tile atau bidang bersih.
- Brass sebagai field dengan Buntut terang untuk app icon atau favicon.
- Ink atau brass pada bone paper untuk cover, merchandise, dan editorial.
- Motion yang menelusuri spiral sekali lalu berhenti pada keadaan final.

### Avoid

- Membalik atau memuntir geometri untuk variasi dekoratif.
- Menambahkan wajah, mata, tangan, atau fitur mascot ke mark.
- Menjadikan spiral sebagai spinner tanpa akhir untuk semua loading state.
- Mengisi mark dengan gradient neon, chrome, atau texture yang melemahkan siluet.

## Color roles / Peran warna

Warna mengikuti design system; gunakan semantic aliases, bukan nilai baru.

| Peran | Makna | Gunakan untuk | Hindari |
|---|---|---|---|
| Bone paper | Dokumen sebagai artefak hidup; ruang untuk berpikir. | Page, card, editorial field, negative space. | “Aged parchment” palsu, noda, atau texture yang mengurangi keterbacaan. |
| Ink | Kejelasan, keputusan, dan bukti tertulis. | Text, keyline, diagram, mark satu warna. | Black murni yang terasa digital-harsh bila token ink tersedia. |
| Brass | Prada/gold-leaf wayang; amanat penting dan titik tindakan. | Primary action, focus, selected state, brand accent. | Mewarnai semua hal penting; brass bukan status universal. |
| Wind | Informasi dan hubungan. | Link dan informational state sesuai design system. | Menjadi aksen brand kedua yang bersaing dengan brass. |
| Leaf, amber, clay | Keadaan operasional yang dapat dibedakan. | Success, warning, danger sesuai semantic token. | Menjadikan lakon sebagai empat kategori warna status. |
| Dark terminal | Panggung kerja yang sedang bergerak. | Terminal, code/log surface. | Mengubah seluruh dashboard menjadi dark sci-fi interface. |

Brass menyatakan **perhatian dan tindakan**, bukan kemewahan. Bone menyatakan **ruang kerja dan
ingatan**, bukan nostalgia. Ink menyatakan **ketegasan**, bukan kekerasan.

Brass signals **attention and action**, not luxury. Bone signals **workspace and memory**, not
nostalgia. Ink signals **clarity**, not severity.

## Typography roles / Peran tipografi

Gunakan keluarga IBM Plex yang ditetapkan design system.

| Typeface role | Fungsi | Karakter |
|---|---|---|
| IBM Plex Serif | Display, manifesto, pull quote, judul editorial. | Berwibawa, bernapas, menghubungkan teknologi dengan tradisi tulis. |
| IBM Plex Sans | UI, body, navigation, documentation. | Netral, jelas, modern, dapat dipindai. |
| IBM Plex Mono | Data, code, SHA, path, phase, label teknis. | Operasional, terukur, membedakan bukti dari narasi. |

Jangan memakai Serif untuk body UI panjang atau Mono sebagai personality gimmick. Hierarki harus
lahir dari role, ukuran, weight, dan ruang; bukan dari terlalu banyak type style.

Do not use Serif for long UI body copy or Mono as a personality gimmick. Hierarchy should come from
role, size, weight, and space—not from a proliferation of type styles.

## Composition / Komposisi

### Product

- Gunakan grid yang tenang, hairline, dan panel dengan radius terkendali.
- Pertahankan overview sebagai bidang orientasi; terminal menjadi pusat gravitasi ketika kerja aktif.
- Sisakan negative space agar status dapat dipindai dan brass tetap berarti.
- Satu area mempunyai satu focal action.
- Data rapat boleh padat, tetapi tidak kehilangan hierarki dan alignment.

### Editorial and campaign / Editorial dan kampanye

- Ambil inspirasi dari **kelir** sebagai bidang tempat bayangan, teks, dan gerak bertemu.
- Pakai komposisi asimetris dengan satu gestur utama, seperti figur wayang yang memasuki bidang.
- Gunakan crop profil, garis lintasan, dan elemen yang melampaui bingkai untuk menyampaikan gerak.
- Padukan satu momen teatrikal dengan typography dan product proof yang sangat literal.
- Jangan memenuhi setiap sudut dengan ornamen; wayang hadir melalui siluet dan ritme, bukan kepadatan.

## Illustration / Ilustrasi

### Character direction / Arah figur

Anoman harus tampak tangkas, cerdas, terarah, dan berwibawa. Gunakan rujukan wayang Jawa/Indonesia:
siluet, profil samping, gestur tangan, proporsi dekoratif, kelir, gunungan, serta negative space yang
disengaja. Detail kostum dan gestur harus memiliki referensi, bukan gabungan imajinatif tradisi Asia.

Anoman should feel agile, intelligent, directed, and dignified. Draw from Javanese/Indonesian wayang:
silhouette, side profile, hand gesture, stylized proportion, kelir, gunungan, and deliberate negative
space. Costume and gesture details need references rather than an invented blend of Asian traditions.

### Illustration modes / Mode ilustrasi

| Mode | Gunakan untuk | Aturan |
|---|---|---|
| Symbolic | Diagram, feature card, small editorial spot. | Satu motif, sedikit detail, tetap terbaca tanpa warna. |
| Narrative | Homepage, About, release hero, manifesto. | Satu episode jelas, product proof dekat, source dicatat dalam brief. |
| Technical-editorial | Docs, architecture, case study. | Bentuk wayang mengarahkan alur; label dan hubungan tetap literal. |

Untuk produksi, gunakan [Illustration system](illustration/README.md): model karakter tiga tier,
katalog 41 aset, brief human/AI, prompt blocks, dan delivery QA. Dokumen ini menetapkan arah;
illustration system menjadi handoff produksi. / For production, use the Illustration system for the
three-tier model, 41-asset catalog, human/AI briefs, prompt blocks, and delivery QA. This document
sets direction; the illustration system is the production handoff.

### Avoid

- Generic monkey mascot dengan hoodie, laptop, atau ekspresi komikal.
- Figur liar, bodoh, marah permanen, atau berotot tanpa konteks pengabdian.
- Campuran ornamentasi Jawa, India, Bali, Thailand, atau budaya lain sebagai gaya “exotic tech”.
- Simbol keagamaan sebagai confetti, border, atau background texture tanpa fungsi.
- Visual AI generik: otak neon, jaringan hologram, robot humanoid, dan kode hujan.
- Adegan perusakan yang membuat Anoman Obong terbaca sebagai kekerasan produk.

Untuk karya budaya besar, ikuti [cultural guardrails](sources.md#cultural-guardrails--pagar-budaya)
dan libatkan seniman atau reviewer yang memahami wayang Jawa/Indonesia.

## Four-lakon motifs / Motif empat lakon

Empat lakon memakai motif bentuk, bukan empat sub-brand atau palet baru.

| Lakon | Motif utama | Gerak | Product connection |
|---|---|---|---|
| Anoman Duta | Lintasan, cincin, garis penghubung, gestur menyampaikan. | Menyeberang lalu kembali. | Context masuk ke session dan bukti kembali ke tim. |
| Anoman Obong | Nyala terkendali, ekor sebagai garis energi, diagonal. | Diam → lepas → selesai. | Intent berubah menjadi tindakan dan hasil. |
| Gunung Dronagiri | Massa gunung, lapisan, bidang yang menopang. | Mengangkat beban terpilih. | Sufficient context dibawa ke pihak yang dapat memutuskan. |
| Chiranjivi | Spiral, lingkar berlanjut, jejak keluar bingkai. | Berulang sambil berkembang. | Pengetahuan bergerak melampaui satu session. |

Jangan memberi warna eksklusif pada masing-masing lakon. Status warna tetap mengikuti makna
operasional design system.

Do not assign each lakon an exclusive color. Status color continues to follow the operational
semantics of the design system.

## Photography / Fotografi

Fotografi melengkapi, bukan meniru, wayang.

### Use / Gunakan

- Tim engineering kecil dalam ruang kerja nyata, bukan kantor generik yang dipentaskan.
- Tangan, layar, catatan, terminal, dan momen kolaborasi yang menunjukkan kerja dapat dilihat.
- Pertunjukan atau artefak wayang hanya dengan asal, izin, caption, dan konteks yang jelas.
- Cahaya hangat terarah, shadow yang memiliki bentuk, dan framing editorial.
- Detail material—kertas, logam, kulit, kain—ketika benar-benar berasal dari subjek.

### Avoid

- Stock photo robot berjabat tangan dengan manusia.
- Siluet wayang tanpa atribusi ketika objek atau karya dapat dikenali.
- Foto budaya sebagai background “eksotis” yang tidak berhubungan dengan cerita.
- Filter sepia berat yang menyamakan Indonesia dengan masa lampau.
- Foto tim yang menyiratkan Hanoman menghapus kebutuhan akan engineer.

## Motion

Motion terasa **wind-quick, never bouncy** sesuai design system.

- Transisi status ringkas dan berhenti pada keadaan yang dapat dibaca.
- Buntut dapat digambar dari pusat ke luar satu kali pada brand reveal.
- Motif Duta mengikuti garis lalu kembali membawa marker hasil.
- Motif Obong memakai akselerasi singkat dengan akhir yang tegas; tidak berkedip terus.
- Motif Dronagiri bergerak sebagai satu massa stabil, bukan partikel data acak.
- Motif Chiranjivi mengulang dengan perubahan kecil dan mempunyai titik istirahat.
- Hormati `prefers-reduced-motion`; semua informasi tetap hadir tanpa animasi.
- Jangan memakai parallax, glow, atau particles hanya untuk memberi kesan “AI”.

## Product versus campaign intensity

| Level | Permukaan | Mythic intensity | Aturan |
|---|---|---|---|
| 1 — Operational | UI controls, errors, terminal, confirmation | Minimal | Literal first; mark dan brass cukup. |
| 2 — Guided | Onboarding, empty state, docs overview | Ringan | Satu motif + penjelasan teknis. |
| 3 — Editorial | README, release, case study, community | Sedang | Satu lakon dapat menjadi struktur narasi. |
| 4 — Brand | Homepage hero, About, manifesto, film | Dominan | Adegan penuh boleh; category dan proof tetap terlihat. |

Mythic intensity mengikuti kedalaman komunikasi, bukan tingkat kepentingan operasional. Error kritis
justru harus lebih literal daripada hero.

Mythic intensity follows communication depth, not operational severity. A critical error should be
more literal than a homepage hero.

## Accessibility and cultural care / Aksesibilitas dan kehati-hatian budaya

- Kontras, focus, semantic state, dan typography mengikuti design system serta standar aksesibilitas
  produk.
- Jangan gunakan brass, bentuk api, atau gerak sebagai satu-satunya penanda tindakan.
- Semua ilustrasi informatif mempunyai alt text yang menyebut fungsi, bukan hanya gaya.
- Alt text adegan budaya menyebut siapa, tindakan, dan hubungan dengan konteks halaman secara ringkas.
- Simbol budaya yang belum familier diberi caption; familiaritas wayang tidak diasumsikan.
- Hindari animasi yang tidak dapat dimatikan dan detail yang hilang pada zoom atau mode kontras.
- Catat tradisi, seniman, source image, lisensi, dan reviewer untuk commissioned cultural artwork.

See [Sources & cultural notes](sources.md) before introducing a new story, symbol, costume, or gesture.

## Do / Don't

| Do | Don't |
|---|---|
| Gunakan satu gestur wayang yang kuat dengan ruang bernapas. | Isi seluruh bidang dengan ornamentasi “tradisional”. |
| Dekatkan storytelling dengan screenshot, diagram, atau bukti produk. | Biarkan mitologi menggantikan penjelasan fungsi. |
| Pakai Buntut sebagai tanda energi yang terhubung dan selesai. | Jadikan Buntut loading spinner tanpa akhir. |
| Jaga dashboard tenang dan terminal fokus. | Ubah produk menjadi command center sci-fi yang gaduh. |
| Gunakan brass pada tindakan dan momen penting. | Beri brass pada semua badge, heading, dan border. |
| Riset serta atribusikan karya budaya. | Campur simbol lintas tradisi demi novelty. |
| Pertahankan label UI literal. | Ganti session, backlog, atau worktree dengan istilah lakon. |
| Tampilkan Anoman sebagai duta yang cerdas dan bertanggung jawab. | Reduksi menjadi mascot kera generik. |
