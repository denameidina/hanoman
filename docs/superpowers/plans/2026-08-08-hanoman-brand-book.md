# Hanoman Brand Book Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuat brand book bilingual lengkap di `internal/brand/` yang menerjemahkan empat lakon Anoman menjadi filosofi, voice, messaging, identitas visual, dan contoh penggunaan yang terbukti oleh perilaku produk Hanoman.

**Architecture:** Brand book dibagi menjadi delapan dokumen kecil dengan `internal/brand/README.md` sebagai router. Foundation dan empat lakon menjadi sumber konsep; voice, messaging, visual identity, dan practice mengonsumsi konsep tersebut tanpa mendefinisikan ulang. `sources.md` memisahkan fakta tradisi dari interpretasi brand, sedangkan `internal/docs/README.md` menautkan paket brand ke Source of Truth project.

**Tech Stack:** Markdown, link relatif GitHub, CLI docs Hanoman (`node cli/dist/hanoman.js docs index|scan`), Git.

## Global Constraints

- Pasar: produk open-source untuk tim engineering kecil yang mengoperasikan coding agent lintas project.
- Brand idea harus persis: **“Kekuatan yang mengemban amanat.” / “Power in service of intent.”**
- Brand promise harus persis: **“Setiap amanat membawa konteks. Setiap kerja dapat diawasi. Setiap hasil meninggalkan pengetahuan.” / “Every mandate carries context. Every task stays observable. Every outcome leaves knowledge behind.”**
- Pendekatan: **story-led, product-grounded**; setiap metafora pewayangan harus menunjuk perilaku produk yang nyata.
- Jangkar budaya: tradisi pewayangan Jawa/Indonesia dengan pengakuan atas banyak tradisi Ramayana di Asia.
- Gunakan **Hanoman** untuk produk, **Anoman** untuk nama lakon Jawa, dan **Hanuman** hanya ketika mengikuti istilah sebuah sumber/tradisi.
- Bahasa Indonesia dan Inggris harus hidup berdampingan dalam bagian yang sama; Inggris adalah adaptasi makna, bukan terjemahan harfiah.
- Istilah `project`, `backlog`, `session`, `worktree`, `agent`, `terminal`, dan `Source of Truth` tetap stabil lintas bahasa.
- Design system yang ada tetap menjadi Source of Truth implementasi UI; brand book tidak menyalin nilai token.
- Contoh copy harus ditandai **Approved**, **Adaptable**, atau **Avoid**.
- Tidak ada perubahan kode, skema, endpoint, dependency, atau perilaku runtime.
- Verifikasi hanya scope docs: index check, coverage scan, link check, placeholder scan, dan diff check.

---

### Task 1: Brand Foundation, Four Lakons, and Research Provenance

**Files:**
- Create: `internal/brand/README.md`
- Create: `internal/brand/01-foundation.md`
- Create: `internal/brand/02-four-lakons.md`
- Create: `internal/brand/sources.md`

**Interfaces:**
- Consumes: `docs/superpowers/specs/2026-08-08-hanoman-brand-book-design.md`; `internal/docs/entrypoints/blueprint.md`; `internal/docs/product/blueprint.md`; `internal/docs/product/scope-principles.md`; `internal/docs/business/brd.md`; four external sources listed in the design.
- Produces: canonical definitions for brand idea, promise, positioning, audience, four lakons, terminology, cultural boundaries, and research citations. Tasks 2–3 must link to these definitions instead of redefining them.

- [ ] **Step 1: Create the brand router**

Write `internal/brand/README.md` with this exact navigation order:

1. Foundation
2. Four lakons
3. Personality & voice
4. Messaging
5. Visual identity
6. Brand in practice
7. Sources & cultural notes

Open with the exact brand idea and a two-sentence bilingual summary. Add “How to use this book” that routes product decisions to foundation/lakons, copy decisions to voice/messaging/practice, visual decisions to visual identity/design system, and cultural claims to sources.

- [ ] **Step 2: Write the foundation in paired languages**

Write `internal/brand/01-foundation.md` with these sections in order:

1. `Brand idea / Gagasan brand`
2. `Why Hanoman exists / Mengapa Hanoman ada`
3. `Audience / Audiens`
4. `Positioning`
5. `Brand promise / Janji brand`
6. `The enemy / Yang dilawan`
7. `Principles / Prinsip`
8. `What Hanoman is not / Bukan Hanoman`
9. `Proof in the product / Bukti dalam produk`

Use the exact copy approved in the design. The proof table must map `docs-driven`, interactive sessions, worktree isolation, human steering/interruption, and durable docs to a specific brand principle. Explicitly state that Hanoman augments a small team’s operational capacity and does not promise to replace engineering judgment.

- [ ] **Step 3: Write the four-lakon system**

Write `internal/brand/02-four-lakons.md`. Each lakon must use the same five-part template:

1. `The story / Kisah`
2. `Brand interpretation / Tafsir brand`
3. `Product behavior / Perilaku produk`
4. `Creative motif / Motif kreatif`
5. `Guardrail / Batas tafsir`

Use these canonical mappings:

| Lakon | Mandate | Product proof | Guardrail |
|---|---|---|---|
| Anoman Duta | pahami dan bawa amanat dengan utuh | docs, objective, spec, traceable decisions | bukan kepatuhan membuta |
| Anoman Obong | bertindak tegas sampai ada hasil | interactive session, visible progress, report-back | bukan eksekusi sembrono atau glorifikasi perusakan |
| Gunung Dronagiri | utamakan kelengkapan daripada kepastian palsu | Source of Truth, history, artifacts, explicit uncertainty | bukan menumpuk seluruh informasi tanpa seleksi |
| Chiranjivi | buat pengetahuan hidup lebih lama daripada pelakunya | durable docs, decision trail, resumable work | bukan klaim bahwa dokumen statis atau sempurna |

End with the exact cycle: `Terima amanat → pahami konteks → kerahkan daya → laporkan hasil → abadikan pengetahuan.` and its natural English adaptation.

- [ ] **Step 4: Document sources and cultural boundaries**

Write `internal/brand/sources.md` with:

- a terminology table for Hanoman/Anoman/Hanuman;
- a statement that Ramayana has multiple tellings and the brand centers a Javanese/Indonesian lens;
- separate `Product sources` and `Cultural sources` sections;
- the four cited sources and what each one supports;
- a `Source versus interpretation` table marking cultural episode, source-backed fact, and Hanoman’s brand interpretation;
- rules against claiming one definitive version, treating devotional belief as universal fact, or using sacred symbols as unexplained decoration.

Use direct links, paraphrase the sources, and do not reproduce long quotations.

- [ ] **Step 5: Verify Task 1 documents**

Run:

```bash
rg -n "T[B]D|T[O]DO|F[I]XME|lorem ipsum|versi asli" internal/brand
rg -n "Kekuatan yang mengemban amanat|Power in service of intent" internal/brand/{README,01-foundation}.md
rg -n "Anoman Duta|Anoman Obong|Gunung Dronagiri|Chiranjivi" internal/brand/02-four-lakons.md
git diff --check
```

Expected: the first command has no output; the second and third show every required phrase; `git diff --check` exits 0.

- [ ] **Step 6: Commit the foundation**

```bash
git add internal/brand/README.md internal/brand/01-foundation.md internal/brand/02-four-lakons.md internal/brand/sources.md
git commit -m "docs(brand): define hanoman philosophy and four lakons"
```

### Task 2: Personality, Bilingual Voice, and Messaging System

**Files:**
- Create: `internal/brand/03-personality-voice.md`
- Create: `internal/brand/04-messaging.md`
- Modify: `internal/brand/README.md`

**Interfaces:**
- Consumes: canonical brand idea, promise, positioning, lakon meanings, and terminology from Task 1.
- Produces: writing rules, tone spectrum, message hierarchy, proof points, approved product description, boilerplates, and CTA vocabulary used by Task 3 examples.

- [ ] **Step 1: Write personality and voice rules**

Write `internal/brand/03-personality-voice.md` with:

- the archetype phrase `duta teknis yang tangguh / a resilient technical envoy`;
- six approved traits: faithful to intent without blind obedience, powerful without showing off, calm in observation and decisive in action, context-aware and candid about uncertainty, accountable for bringing results home, rooted in Indonesia and open to the world;
- a tone matrix for website, docs, product UI, terminal/status, errors, release notes, and community;
- sentence-level rules: state → action, active verbs, evidence/impact/control, specific uncertainty, technical term before metaphor;
- bilingual conventions for pronouns, capitalization, punctuation, English adaptation, and stable product vocabulary;
- at least eight paired `Approved` versus `Avoid` examples, including the two examples already approved in the design;
- an accessibility section prohibiting meaning conveyed only by metaphor, idiom, color, or cultural familiarity.

- [ ] **Step 2: Write the messaging hierarchy**

Write `internal/brand/04-messaging.md` with the exact brand line, category descriptor, one-liner, and three pillars approved in the design. For each pillar—`Grounded in context`, `Visible in motion`, `Durable by default`—include:

- a one-sentence Indonesian claim;
- a one-sentence English claim;
- three product proof points;
- one claim the brand must not make.

Add bilingual blocks for:

- 25-word description;
- 50-word description;
- 100-word boilerplate;
- elevator pitch;
- GitHub repository description;
- homepage hero with eyebrow, headline, subhead, primary CTA, and secondary CTA;
- the three adaptable campaign taglines from the design;
- practical CTA vocabulary and prohibited theatrical replacements.

Mark the brand line, category descriptor, product one-liner, and boilerplate as `Approved`; campaign lines as `Adaptable`; exaggerated AI claims as `Avoid`.

- [ ] **Step 3: Complete router summaries**

Update `internal/brand/README.md` so the personality/voice and messaging links each have a one-sentence purpose in both languages. Confirm every link is relative and points to an existing filename.

- [ ] **Step 4: Verify bilingual and messaging coverage**

Run:

```bash
rg -n "Approved|Adaptable|Avoid" internal/brand/{03-personality-voice,04-messaging}.md
rg -n "Grounded in context|Visible in motion|Durable by default" internal/brand/04-messaging.md
rg -n "revolutionary|magical|limitless|fully autonomous" internal/brand
git diff --check
```

Expected: status labels and all three pillars are present; any matches for exaggerated words occur only inside explicit `Avoid` examples; `git diff --check` exits 0.

- [ ] **Step 5: Commit voice and messaging**

```bash
git add internal/brand/README.md internal/brand/03-personality-voice.md internal/brand/04-messaging.md
git commit -m "docs(brand): define voice and messaging system"
```

### Task 3: Visual Identity and Applied Brand Examples

**Files:**
- Create: `internal/brand/05-visual-identity.md`
- Create: `internal/brand/06-brand-in-practice.md`
- Modify: `internal/brand/README.md`

**Interfaces:**
- Consumes: design tokens and implementation authority from `internal/docs/design-system/design-system.md`; Buntut implementation note from `src/public/favicon.svg`; voice and approved messages from Tasks 1–2.
- Produces: rationale and usage guidance for brand visuals plus ready-to-adapt examples for public and product surfaces. It must not introduce new CSS values or override component rules.

- [ ] **Step 1: Write visual identity guidance**

Write `internal/brand/05-visual-identity.md` with these sections:

1. `Visual idea / Gagasan visual`
2. `Buntut mark`
3. `Color roles / Peran warna`
4. `Typography roles / Peran tipografi`
5. `Composition / Komposisi`
6. `Illustration / Ilustrasi`
7. `Four-lakon motifs / Motif empat lakon`
8. `Photography / Fotografi`
9. `Motion`
10. `Product versus campaign intensity`
11. `Accessibility and cultural care`
12. `Do / Don’t`

Describe bone paper, ink, brass, earthy semantics, IBM Plex Serif/Sans/Mono, hairlines, restrained radii, and the single dark terminal surface by role only. Link to the design system for exact tokens. Explain Buntut as an outward spiral representing energy, session continuity, and connected context; identify `src/public/favicon.svg` and `src/src/ds/marks.tsx` as implementation references without asking readers to hand-edit the baked path.

Define the approved motif mapping from the design. For illustration, require Javanese wayang cues such as silhouette, side profile, gesture, kelir, gunungan, and deliberate negative space; reject generic monkey mascots, aggressive caricatures, decorative sacred symbols, faux-ethnic pattern mixing, and visual clutter.

- [ ] **Step 2: Write ready-to-use examples**

Write `internal/brand/06-brand-in-practice.md` with bilingual, labeled examples for:

- homepage hero;
- README opening;
- About/manifesto passage;
- first-run onboarding;
- empty backlog state;
- session-running status;
- recoverable error;
- destructive confirmation;
- release announcement;
- community contribution invitation;
- social post announcing a feature;
- illustration brief for each of the four lakons.

Each example must include `Context`, `Approved copy`, `Why it works`, and one `Avoid` variant. Product UI examples must remain literal and short; editorial examples may use stronger lakon imagery.

- [ ] **Step 3: Complete the router and cross-links**

Update `internal/brand/README.md` with bilingual summaries for visual identity and brand in practice. Add reciprocal links from visual identity to the design system, from practice to voice/messaging, and from all culture-heavy sections to `sources.md`.

- [ ] **Step 4: Verify visual authority and example completeness**

Run:

```bash
rg -n "#[0-9a-fA-F]{3,8}|rgb\(|hsl\(" internal/brand/05-visual-identity.md
rg -n "Homepage|README|onboarding|backlog|session|error|confirmation|release|community|social|Anoman Duta|Anoman Obong|Dronagiri|Chiranjivi" internal/brand/06-brand-in-practice.md
rg -n "design-system.md|sources.md|03-personality-voice.md|04-messaging.md" internal/brand
git diff --check
```

Expected: the color-literal command has no output; the completeness and cross-link commands find all required topics; `git diff --check` exits 0.

- [ ] **Step 5: Commit visual and applied guidance**

```bash
git add internal/brand/README.md internal/brand/05-visual-identity.md internal/brand/06-brand-in-practice.md
git commit -m "docs(brand): add visual and application guidance"
```

### Task 4: Source-of-Truth Index, Consistency Audit, and Final Verification

**Files:**
- Modify: `internal/docs/README.md`
- Modify if audit finds an inconsistency: `internal/brand/*.md`

**Interfaces:**
- Consumes: all eight completed brand documents.
- Produces: one discoverable brand entry in the Source of Truth index and evidence that terminology, links, coverage, and scope are correct.

- [ ] **Step 1: Link the brand book from the Source of Truth index**

Add this section between `business` and `design-system` in `internal/docs/README.md`:

```markdown
## brand
- [Hanoman brand book](../brand/README.md) — filosofi story-led/product-grounded, empat lakon, voice bilingual, messaging, identitas visual, dan contoh penerapan untuk produk open-source
```

- [ ] **Step 2: Run the terminology and placeholder audit**

Run:

```bash
rg -n "T[B]D|T[O]DO|F[I]XME|lorem ipsum|versi asli|one true|the original Ramayana" internal/brand
rg -n "Hanuman Duta|Hanuman Obong" internal/brand
rg -n "Hanoman Duta|Hanoman Obong" internal/brand
rg -n "Anoman Duta|Anoman Obong|Gunung Dronagiri|Chiranjivi" internal/brand
```

Expected: the first three commands have no output; the fourth finds the canonical lakon names where expected. If a prohibited match appears inside a deliberate `Avoid` example, rewrite the example so the prohibited phrase does not need to appear verbatim.

- [ ] **Step 3: Check every local Markdown link**

Run this read-only Node script from the repository root:

```bash
node --input-type=module <<'NODE'
import fs from "node:fs";
import path from "node:path";

const files = fs.readdirSync("internal/brand")
  .filter((name) => name.endsWith(".md"))
  .map((name) => path.join("internal/brand", name));
const missing = [];
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].split("#", 1)[0];
    if (!target || /^(https?:|mailto:)/.test(target)) continue;
    const resolved = path.resolve(path.dirname(file), decodeURIComponent(target));
    if (!fs.existsSync(resolved)) missing.push(`${file}: ${target}`);
  }
}
if (missing.length) {
  console.error(missing.join("\n"));
  process.exit(1);
}
console.log(`brand links ok (${files.length} files)`);
NODE
```

Expected: `brand links ok (8 files)`.

- [ ] **Step 4: Run Hanoman docs verification**

Build the CLI only if `cli/dist/hanoman.js` is absent or stale, then run:

```bash
pnpm --filter ./cli build
node cli/dist/hanoman.js docs index --check
node cli/dist/hanoman.js docs scan --json
git diff --check
```

Expected: CLI build succeeds; index reports `index ok`; JSON coverage remains `100`; diff check exits 0.

- [ ] **Step 5: Review the final diff against the approved design**

Run:

```bash
git diff --stat HEAD~3
git diff HEAD~3 -- internal/brand internal/docs/README.md
git status --short
```

Confirm all eight acceptance criteria from the design are satisfied, there are no unrelated files, and the only uncommitted change is the index/audit correction for this task.

- [ ] **Step 6: Commit the index and audit corrections**

```bash
git add internal/docs/README.md internal/brand
git commit -m "docs(brand): link and verify hanoman brand book"
```

- [ ] **Step 7: Confirm a clean worktree**

```bash
git status --short --branch
git log -5 --oneline
```

Expected: branch `docs/brand-book`, no uncommitted files, and the design, plan, and four implementation commits visible in history.
