# Hanoman Illustration System — Design

**Tanggal:** 2026-08-08  
**Status:** disetujui secara konseptual; menunggu review dokumen  
**Output tujuan:** sistem brief ilustrasi hybrid di `internal/docs/brand/illustration/`

## Ringkasan

Hanoman membutuhkan sistem brief ilustrasi lengkap untuk menghasilkan aset yang konsisten melalui
illustrator manusia maupun AI image generator. Sistem ini memperluas
[`internal/docs/brand/05-visual-identity.md`](../../../internal/docs/brand/05-visual-identity.md), bukan
menggantikan design system atau membuat artwork final.

Gaya utama adalah **editorial wayang kontemporer**, static-first dan layer-ready. Wayang kulit purwa
gaya Surakarta menjadi jangkar karakter Anoman. Satu karakter kanonik diterjemahkan ke tiga tingkat
ekspresi—Narrative, Editorial, dan Mascot—agar hero, empat lakon, UI, social, diagram, sticker, serta
release artwork tetap terasa sebagai satu brand.

## Keputusan arah

- **Cakupan:** sistem lengkap untuk hero, empat lakon, spot illustration, product state, social,
  release, diagram, motif, character model, mascot, pose, dan sticker.
- **Pelaksana:** hybrid—satu master brief melayani illustrator manusia dan AI image generator.
- **Gaya:** editorial wayang kontemporer; siluet/profil wayang, bidang datar, texture halus, dan
  komposisi modern.
- **Motion:** static-first; setiap aset utama mempunyai layer map agar dapat dianimasikan kelak.
- **Jangkar karakter:** wayang kulit purwa gaya Surakarta.
- **Konsistensi:** character model sheet wajib; output AI tidak boleh menetapkan anatomi kanonik
  sendirian.
- **Mascot:** penyederhanaan terkontrol dari Anoman yang sama, bukan karakter baru atau generic
  monkey mascot.
- **Pendekatan sistem:** unified character system.

## Unified character system

### Narrative Anoman

Figur paling lengkap untuk homepage hero, manifesto, empat lakon, dan release artwork besar. Ia
mempertahankan siluet rewanda, profil, gestur, struktur busana, serta inspirasi tatahan/sungging yang
paling kaya. Detail selalu mendukung action line dan tetap dapat dibaca sebagai satu silhouette.

### Editorial Anoman

Penyederhanaan untuk article art, diagram, social, feature card, dan release note. Contour, profil,
gelung, ulur-ulur, dan Buntut tetap stabil; detail interior dan texture dikurangi agar terbaca pada
ukuran menengah.

### Mascot Anoman

Penyederhanaan paling ringkas untuk onboarding, empty state, status, sticker, avatar komunitas, dan
micro-illustration. Tubuh dapat dipadatkan, tetapi tidak menjadi chibi berkepala besar, hewan
realistis, atau mascot kera generik. Profil, supit urang, ulur-ulur, ekor/Buntut, kecerdasan, serta
wibawa harus tetap terbaca.

### Consistency rule

Ketiga tier memakai identitas yang sama. Perubahan tier hanya mengurangi detail dan memadatkan
proporsi; ia tidak mengganti spesies rupa, wajah, kostum inti, atau bahasa gestur.

## Asset package

Sistem brief harus mendefinisikan 41 deliverable:

| Family | Jumlah | Isi |
|---|---:|---|
| Character model | 1 | Master model sheet Narrative–Editorial–Mascot |
| Mascot model | 1 | Construction, reusable parts, scale, dan consistency test |
| Homepage hero | 1 | Master brand/category illustration |
| Four lakons | 4 | Anoman Duta, Anoman Obong, Gunung Dronagiri, Chiranjivi |
| Spot illustration | 6 | Context, visibility, isolation, human control, parallel work, durable knowledge |
| Product state | 6 | Onboarding, empty backlog, session active, awaiting decision, success, recoverable error |
| Mascot pose/expression | 8 | Neutral, welcome, observe, work, ask, warn, celebrate, carry knowledge |
| Sticker/community | 8 | Ready, working, waiting, blocked, shipped, review, thanks, docs updated |
| Social/release templates | 4 | Safe-area templates untuk 1:1, 4:5, 16:9, dan 9:16 |
| Technical diagram kit | 1 | Human, agent, docs, backlog, session, terminal, branch, worktree |
| Lakon motif kit | 1 | Duta, Obong, Dronagiri, Chiranjivi, dan Buntut primitives |

Brief tidak membuat semua artwork sekaligus. Ia membuat katalog, urutan produksi, acceptance
criteria, prompt blocks, dan template delivery yang membuat 41 aset tersebut dapat diproduksi secara
bertahap.

## Character model sheet

### Canonical anchors

Model sheet mengunci:

- rupa rewanda/kera putih;
- profil samping dengan satu mata terlihat;
- kepala sedikit mendongak;
- bahu belakang relatif datar;
- gelung supit urang sebagai penanda silhouette kepala;
- kalung/ulur-ulur sebagai aksen status dan ritme bentuk;
- ekor panjang sebagai action line dan jembatan visual menuju mark Buntut;
- tubuh tangkas serta terarah, bukan bodybuilder atau kera realistis;
- wajah yang menunjukkan kecerdasan, kewaspadaan, dan tata krama;
- bone/putih hangat untuk tubuh, ink untuk struktur, dan brass untuk amanat/tindakan sesuai semantic
  role design system.

Riset perbandingan Anoman gaya Surakarta dan Yogyakarta mencatat pembeda Surakarta berupa satu mata
yang terlihat, kepala lebih mendongak, bahu belakang lebih datar, supit urang tampak lebih tinggi,
serta kalung/ulur-ulur yang lebih lazim. Rujukan ini menjadi starting point yang harus divalidasi
terhadap reference board dan reviewer budaya sebelum artwork kanonik disetujui.

### Adaptable details

Tier dapat mengubah kerumitan tatahan/sungging, jumlah lapisan busana kecil, panjang tungkai, tingkat
elongasi, detail bulu, texture kulit, dan intensitas gerak. Perubahan itu tidak boleh merusak canonical
anchors.

### Tier guidance

- **Narrative:** proporsi paling panjang, detail kostum penuh, tangan dan gestur terbaca.
- **Editorial:** contour serta kostum inti tetap; detail interior dikurangi kira-kira separuh.
- **Mascot:** tubuh dipadatkan menjadi sekitar 3,5–4 unit kepala; kepala tidak lebih dari kira-kira
  28% tinggi figur; profil, supit urang, ulur-ulur, dan ekor tetap terbaca.

Angka mascot adalah production target, bukan klaim pakem wayang. Reviewer boleh menyesuaikannya jika
silhouette terasa komikal atau tidak lagi konsisten dengan figur utama.

### Required views and tests

Model sheet memuat:

- presentation profile utama;
- back silhouette;
- three-quarter editorial adaptation;
- neutral pose dan action line;
- 12 gestur tangan/tubuh;
- 8 ekspresi yang bekerja dalam profil;
- 4 konfigurasi ekor/Buntut;
- exploded view kostum;
- detail kepala, mata, mulut, supit urang, ulur-ulur, tangan, kaki, dan ekor;
- perbandingan Narrative–Editorial–Mascot;
- minimum-size test;
- one-color silhouette test;
- anatomy/cultural do and don't; dan
- layer map static-first.

## Art direction

### Form language

- Siluet dan gestur wayang menjadi struktur utama.
- Bidang warna datar memakai keyline ink; texture hanya memberi rasa material.
- Tatahan diterjemahkan sebagai negative-space cutouts dan pola terukur.
- Komposisi asimetris memperlakukan bidang seperti kelir.
- Satu action line utama mengikat tiap ilustrasi.
- Buntut/ekor mengarahkan mata ke product proof.
- Docs, terminal, branch, dan worktree tampil sebagai bentuk editorial yang dapat dikenali, bukan UI
  palsu yang menyerupai screenshot.
- Screenshot produk dan typography ditempatkan sebagai layer terpisah.

### Visual feeling

- Tenang pada bidang besar, kuat pada satu gestur.
- Hangat, tactile, dan editorial; bukan aged parchment.
- Epik tanpa menjadi poster film fantasi.
- Modern tanpa neon, hologram, robot, brain network, atau code rain.
- Berakar di Surakarta tanpa menjadikan ornamentasi sebagai pattern acak.

### Composition rules

- Figur utama memakai kira-kira 35–55% bidang sesuai surface.
- Negative space minimal sepertiga bidang disediakan untuk copy atau product proof.
- Satu foreground, satu middle ground utama, dan background sederhana.
- Maksimal satu lakon atau satu pesan produk per artwork.
- Text tidak di-bake ke master artwork.
- Hero dapat di-crop ke desktop, tablet, mobile, dan social tanpa memotong wajah, tangan utama, atau
  ujung Buntut.
- Setiap aset tetap terbaca sebagai silhouette satu warna dan thumbnail.

### Allowed texture

- serat kertas sangat halus;
- grain tinta terkontrol;
- edge wear minimal pada bentuk, bukan seluruh canvas; dan
- irama perforasi/tatahan yang dirancang, bukan texture generator acak.

### Visual exclusions

- generic monkey mascot, chibi berkepala besar, atau hewan realistis;
- campuran ornamentasi Jawa–Bali–India–Thailand tanpa provenance;
- kostum superhero, armor sci-fi, hoodie, laptop, atau keyboard sebagai shorthand teknologi;
- kota terbakar, ledakan, dan kekerasan untuk Anoman Obong;
- background penuh kode, sirkuit, partikel, atau glyph acak; dan
- clip-art wayang yang ditempel di atas dashboard.

## Static-first layer system

Setiap master artwork memisahkan minimum:

1. `bg`
2. `environment`
3. `character-base`
4. `character-gesture`
5. `buntut-fx`
6. `foreground`
7. `text-safe`

Untuk aset yang mungkin dianimasikan, tangan/forearm, kepala, ekor, serta motif utama dipisahkan
tanpa mengorbankan kualitas ilustrasi static. Layer readiness tidak berarti membuat puppet rig atau
motion asset pada scope ini.

## Master production brief

Setiap asset brief wajib mencatat:

- Asset ID, nama, owner, status, dan versi;
- tujuan komunikasi dan surface;
- audiens serta tindakan yang diharapkan;
- lakon/prinsip produk;
- character tier;
- scene, focal action, dan emotional beat;
- locked character anchors;
- motif, props, dan product proof;
- composition, aspect ratio, crop, serta text-safe area;
- color roles dan level detail;
- layer map;
- alt-text intent;
- cultural/visual references;
- do, don't, dan acceptance checklist;
- executor path: human, AI-assisted, atau hybrid;
- creator, tools/model, prompt/version, license, reviewer, serta perubahan manual.

## Human illustration workflow

1. Reference board tervalidasi.
2. Enam thumbnail composition.
3. Dua silhouette directions dipilih.
4. Cultural dan character anatomy review.
5. Layered rough.
6. Color/style proof.
7. Final master.
8. Responsive crops, variants, dan delivery package.

## AI-assisted workflow

1. Gunakan approved model sheet sebagai image reference.
2. Susun prompt dari blok tetap: identity → tier → scene → composition → style → color role →
   exclusions → output.
3. Generate composition explorations, bukan anatomi kanonik baru.
4. Pilih output atas silhouette dan gesture, bukan banyaknya detail dekoratif.
5. Redraw/correct tangan, mata, kostum, ekor, tatahan, dan product props.
6. Pisahkan layer secara manual.
7. Jalankan cultural dan product-truth review.
8. Finalisasi melalui delivery workflow yang sama.

### AI-specific rules

- Core model sheet tidak boleh ditentukan oleh satu output AI.
- Prompt menyebut “Surakarta-style wayang kulit purwa reference” dan canonical anchors.
- Negative block menolak frontal two-eyed face, extra limbs/tails, generic monkey mascot, chibi,
  superhero anatomy, mixed Asian ornament, neon AI imagery, text, watermark, dan fake UI.
- Text, logo, serta screenshot produk tidak dibuat generator.
- Output AI bukan final sebelum provenance, anatomy, cultural, accessibility, dan crop review.
- Prompt dan model/version dicatat agar hasil dapat diaudit dan direproduksi secara wajar.

## Approval gates

| Gate | Fokus | Bukti lolos |
|---|---|---|
| 0 — Product truth | Pesan, fitur, state, dan CTA benar. | Owner produk menyetujui brief. |
| 1 — Cultural reference | Pakem, istilah, costume, gesture, dan sumber jelas. | Reference list + cultural reviewer. |
| 2 — Character consistency | Silhouette, profile, anchors, tier, dan Buntut konsisten. | Model-sheet overlay + size test. |
| 3 — Composition and message | Focal action, negative space, crop, serta product proof bekerja. | Selected rough pada target surface. |
| 4 — Final craft | Anatomi, tatahan, color role, texture, dan responsive crops bersih. | Final QA sheet. |
| 5 — Delivery | File, layer, alt text, license, source, dan manifest lengkap. | Delivery manifest disetujui. |

## Delivery standard

- Source utama sebisa mungkin vector dan editable.
- SVG menjadi interchange format utama untuk flat illustration.
- PNG dan WebP transparan menjadi raster delivery.
- PDF dipakai untuk review/print proof.
- Layered source boleh Figma, Illustrator, Affinity, atau PSD, tetapi wajib disertai SVG/PNG terbuka.
- Digital output memakai sRGB.
- Master artwork tidak membake text, logo, atau screenshot.
- Responsive exports mengikuti family: desktop, tablet, mobile, 1:1, 4:5, 16:9, dan 9:16.
- Export minimum 2× target display size; raster narrative master memiliki sisi panjang minimal 3200
  px.
- Naming: `hnm-ill-{family}-{subject}-{ratio}-{variant}-vNN`.
- Delivery folder memuat `manifest.md` berisi creator, tanggal, tools/model, prompt/version,
  references, license, reviewer, alt text, dan perubahan manual.
- Aset utama mempunyai light-field, dark-field bila perlu, one-color silhouette, thumbnail test, dan
  reduced-detail variant.

## Documentation structure

```text
internal/docs/brand/illustration/
├── README.md
├── 01-art-direction.md
├── 02-character-model-sheet.md
├── 03-mascot-system.md
├── 04-asset-catalog.md
├── 05-production-brief-template.md
├── 06-human-ai-workflow.md
├── 07-prompt-library.md
├── 08-delivery-qa.md
├── references.md
└── briefs/
    ├── 00-homepage-hero.md
    ├── 01-anoman-duta.md
    ├── 02-anoman-obong.md
    ├── 03-gunung-dronagiri.md
    ├── 04-chiranjivi.md
    ├── 05-spot-illustrations.md
    ├── 06-product-states.md
    ├── 07-mascot-pose-pack.md
    ├── 08-sticker-pack.md
    ├── 09-social-release-templates.md
    └── 10-diagram-and-motif-kit.md
```

Semua dokumen inti bilingual Indonesia–Inggris sesuai brand book. Brief individual boleh memakai
field label bilingual dengan isi ringkas yang tidak diduplikasi dua kali jika proper noun, token,
ratio, dan output specification identik.

## Research sources

### Surakarta form and classification

- Khoiron Mahfudzi, [“Studi tentang perbedaan wujud wayang kulit purwa gaya Surakarta dengan wayang
  kulit purwa gaya Yogyakarta pada tokoh Anoman”](https://repository.um.ac.id/12589/), Universitas
  Negeri Malang. Mendukung pembeda rupa Anoman Surakarta yang dipakai sebagai starting point model
  sheet.
- Agus Ahmadi, [laporan penelitian kriya wayang kulit purwa gaya
  Surakarta](https://repository.isi-ska.ac.id/id/eprint/2977/1/Ag.%20Ahmadi.pdf), ISI Surakarta.
  Mendukung klasifikasi kelompok bentuk/busana dan Anoman sebagai figur rewanda.
- Bambang Suwarno dkk., [“Kajian Bentuk dan Fungsi Wanda Wayang Kulit Purwa Gaya Surakarta,
  Kaitannya dengan Pertunjukan”](https://jurnal.isi-ska.ac.id/index.php/gelar/article/view/1487), ISI
  Surakarta. Menjadi rujukan bahwa wanda, rupa, dan fungsi pertunjukan saling terkait; satu gambar
  tidak boleh dianggap seluruh variasi kanonik.
- ISI Yogyakarta, [“Wayang Kulit Purwa Gaya Surakarta: Ikonografi & Teknik
  Pakelirannya”](https://digilib.isi.ac.id/161/). Rujukan lanjutan untuk ikonografi dan teknik visual.

### Existing Hanoman sources

- [`internal/docs/brand/sources.md`](../../../internal/docs/brand/sources.md) untuk batas tradisi versus tafsir
  brand.
- [`internal/docs/brand/02-four-lakons.md`](../../../internal/docs/brand/02-four-lakons.md) untuk makna dan
  guardrail tiap lakon.
- [`internal/docs/brand/05-visual-identity.md`](../../../internal/docs/brand/05-visual-identity.md) untuk visual
  roles, Buntut, intensity, accessibility, dan cultural care.
- [`internal/docs/brand/06-brand-in-practice.md`](../../../internal/docs/brand/06-brand-in-practice.md) untuk
  brief awal hero/lakon dan contoh surface.

## Cultural and licensing boundaries

- Referensi Surakarta adalah jangkar, bukan izin untuk menyatakan satu wanda sebagai satu-satunya
  bentuk Anoman.
- Model sheet mencatat source image, creator/collection, URL, akses, dan license/status izin.
- Gambar museum, scan buku, atau karya dalang/perajin tidak disalin menjadi asset produksi tanpa izin
  yang sesuai.
- AI reference pack hanya memakai gambar yang lisensinya jelas atau disediakan secara sah.
- Prompt tidak meminta “in the style of” seniman hidup; gunakan deskripsi bentuk, material, pakem,
  dan periode/tradisi yang dapat dipertanggungjawabkan.
- Cultural reviewer memeriksa costume, gesture, naming, dan campuran tradisi sebelum Gate 1.
- Alt text menjelaskan fungsi adegan dan tidak menganggap audiens mengenal lakon.

## Verification and acceptance criteria

Illustration documentation selesai ketika:

1. seluruh 21 file dalam struktur dokumentasi tersedia dan saling tertaut;
2. `README.md` menjelaskan route bagi product owner, art director, illustrator, AI operator, cultural
   reviewer, dan delivery reviewer;
3. model sheet membedakan canonical anchors, adaptable details, dan tiga tier karakter;
4. mascot system tetap satu karakter dengan Anoman dan memiliki pose/expression serta no-chibi
   guardrails;
5. asset catalog menghitung tepat 41 deliverable dan memberi ID, priority, tier, surface, ratio,
   executor, serta dependency;
6. master template berisi semua field dan approval gates;
7. human dan AI workflow sama-sama lengkap dan bertemu pada final QA yang sama;
8. prompt library menyediakan master identity block, tier blocks, composition blocks, per-family
   prompt, negative block, dan repair prompt tanpa menjanjikan determinisme;
9. setiap brief family mempunyai tujuan, scene, product proof, composition, locked anchors, layer
   map, responsive outputs, alt-text intent, do/don't, dan acceptance checklist;
10. delivery QA memeriksa file format, naming, layers, responsive crop, contrast, silhouette,
    thumbnail, accessibility, cultural provenance, prompt/model record, dan license;
11. `internal/docs/brand/README.md`, `internal/docs/brand/05-visual-identity.md`,
    `internal/docs/brand/06-brand-in-practice.md`, `internal/docs/brand/sources.md`, serta
    `internal/docs/README.md` menautkan illustration system tanpa menduplikasi isinya;
12. seluruh link lokal valid, tidak ada placeholder, dan istilah Hanoman/Anoman/Hanuman mengikuti
    brand convention; dan
13. `hanoman docs index --check` tetap berhasil serta `hanoman docs scan --json` tetap melaporkan
    coverage penuh.

Tidak ada perubahan kode, token, komponen UI, atau artwork final pada scope ini.
