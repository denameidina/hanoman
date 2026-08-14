# Audit SPEC-759 — stored XSS pada seluruh renderer Markdown dashboard

**Sumber:** qa · **Prioritas:** tinggi · **Severity:** critical · **Tanggal:** 2026-08-14
**Metode:** `superpowers:systematic-debugging`

## Temuan

Finding terkonfirmasi. `src/src/ds/markdown.tsx` mengalirkan teks yang dapat berasal dari repository,
artefak sesi, PRD, atau changelog melalui urutan berikut tanpa batas kepercayaan di antaranya:

```text
Markdown tidak tepercaya → marked.parse() → string HTML → dangerouslySetInnerHTML → DOM admin
```

`marked` adalah parser, bukan sanitizer. Reproduksi terhadap versi terkunci `marked@12.0.2`
menunjukkan hasil parser mempertahankan kelima kelas payload yang diminta finding:

| Input | HTML/DOM sebelum perbaikan |
| --- | --- |
| `<script>globalThis.__hanomanXss=1</script>` | satu elemen `script` bertahan |
| `<img src=x onerror="…">` | atribut `onerror` bertahan |
| `[klik](JaVaScRiPt:…)` | `href="JaVaScRiPt:…"` bertahan |
| `<svg><g onload="…"></g></svg>` | SVG dan `onload` bertahan |
| `<IMG SRC=&#x6a;avascript:… ONERROR=…>` | entity di-decode DOM menjadi `javascript:` dan event handler bertahan |

Reproduksi dilakukan dengan `marked.parse()`, lalu hasilnya diparse memakai jsdom dan diperiksa
sebagai DOM. Ini membuktikan masalah berada sebelum React memasang hasilnya; produksi tidak perlu
disentuh untuk mengonfirmasi akar masalah.

## Jangkauan

`MarkdownView` adalah titik cekik yang benar, tetapi hari ini titik itu hanya memusatkan parsing,
bukan kebijakan keamanan. Seluruh preview Markdown hidup melewatinya:

- Docs · SoT, termasuk preview draft;
- dokumen backlog/sesi di `SpecDocsModal`;
- PRD dan changelog;
- preview inline IDE;
- preview lebar `DocPreviewModal`, yang dipakai IDE, Review, dan Dokumentasi AI Agent;
- tab preview berkas Git Graph.

Sweep sumber menemukan hanya satu pemanggilan `marked.parse()` di frontend, yakni
`ds/markdown.tsx`. Dua pemakaian `dangerouslySetInnerHTML` lain perlu dibedakan: sink Markdown di
berkas itu dan hasil `highlight.js` di source viewer IDE. Renderer pesan Git Graph membangun node
React dan secara eksplisit tidak memakai HTML mentah. Jadi finding meluas ke seluruh preview
Markdown, tetapi akar dan tempat perbaikannya tetap satu.

Dampaknya critical karena DOM berjalan pada origin dashboard admin yang sama dengan cookie API dan
WebSocket terminal. Payload repository yang terbuka sebagai admin dapat menjalankan tindakan dengan
otoritas operator tanpa perlu membaca cookie `httpOnly` secara langsung.

## Akar masalah dan hipotesis perbaikan

Akar tunggalnya adalah asumsi bahwa HTML keluaran parser aman dipasang ke DOM. Escape input sebelum
parsing bukan solusi karena akan merusak sintaks Markdown; memfilter hanya `script` juga tidak menutup
event attribute, URL aktif, SVG/MathML, entity encoding, atau markup malformed.

Hipotesis yang akan diuji di Execute: sanitasi **sesudah** `marked.parse()` dan **sebelum** sink,
dengan satu allowlist HTML di `ds/markdown.tsx`, menutup seluruh permukaan sekaligus sambil
mempertahankan elemen yang memang dihasilkan Markdown/GFM. Kebijakan harus:

- hanya mengizinkan tag dan atribut keluaran Markdown yang dikenal;
- membuang script, style, iframe, object, embed, form, SVG, MathML, event handler, `style`, atribut
  `data-*`, dan `aria-*` dari konten repository;
- mengizinkan URL relatif serta `http:`, `https:`, dan `mailto:` yang relevan, lalu membuang skema
  aktif termasuk variasi case, entity, whitespace/control, `data:`, dan `javascript:`;
- mempertahankan task checkbox hanya sebagai checkbox `disabled`;
- gagal aman: bila parse atau sanitasi melempar, tampilkan sumber sebagai teks dalam `<pre>`.

DOMPurify dipilih sebagai primitive, berdasarkan dokumentasi upstream yang menyarankan profil
HTML-only untuk meniadakan SVG/MathML dan mendokumentasikan penanganan event handler, URL
`javascript:`, entity/malformed HTML, serta allowlist tag/atribut. Konfigurasi Hanoman tetap eksplisit
dan lebih sempit daripada allowlist default library.

CSP tidak ditambahkan dalam finding ini. Kebijakan CSP global menyentuh pemuatan aset, gambar
eksternal, koneksi HTTP/WebSocket, dan development Vite; mengubahnya tanpa inventaris runtime adalah
perubahan lintas-permukaan yang berisiko memutus dashboard. Sanitizer di titik cekik menghilangkan
primitive eksploit finding secara langsung. CSP layak diaudit terpisah sebagai defense-in-depth,
bukan dijadikan pengganti atau perluasan diam-diam dari perbaikan ini.

## Keputusan pasca-Audit

Temuan berconfidence tinggi, reproduksinya deterministik, seluruh permukaan bertemu di satu renderer,
dan bentuk perbaikannya kecil tanpa perubahan API, endpoint, skema, atau data model. **Spec dan Plan
dilewati** sesuai ADR-0020/0040; dokumen ini menjadi doc-of-record. Execute memakai TDD dan wajib
mengunci payload script, event attribute, URL aktif, SVG/MathML, entity/malformed HTML, variasi case,
konten Markdown aman, fallback gagal-aman, serta kontrak bahwa parser Markdown tetap hanya hidup di
renderer bersama.

## Perbaikan

`ds/markdown.tsx` sekarang menyisipkan DOMPurify sesudah `marked.parse()` dengan allowlist tag dan
atribut yang hanya mencakup keluaran Markdown/GFM. Lapisan kedua menegakkan scheme URL per atribut,
menyaring kelas ke `contains-task-list`/`task-list-item`/`language-*`, dan membuang input selain
checkbox yang dipaksa `disabled`. Seluruh operasi tetap di dalam `try`; kegagalan parser, sanitizer,
atau DOM jatuh ke `<pre>` dengan HTML ter-escape.

Test `src/test/markdown-security.test.tsx` menjalankan kode nyata dan DOM jsdom. Run merah awal
memberi **13 kegagalan keamanan yang diharapkan** pada tag aktif, event handler, URL aktif, dan sink
React. Sesudah implementasi dan perluasan review, run final memberi **20/20 lulus**. Mutation check
membuktikan test lapis Hanoman tidak hampa: mengganti `safeUrl()` dengan allow-all memerahkan tepat
tiga kasus `data:`/`ftp:`/`mailto:` yang DOMPurify sendiri izinkan; mengganti fallback dengan sumber
mentah memerahkan test escape. Test juga me-reparse payload mutation-XSS dan mempertahankan heading,
strong, tautan relatif/http/mailto, gambar relatif, task checkbox inert, tabel, serta fenced code.
Kontrak permukaan mengikat sembilan entry point preview ke `MarkdownView`/`DocPreviewModal` dan
menuntut `marked.parse()` hanya dimiliki `ds/markdown.tsx`.
