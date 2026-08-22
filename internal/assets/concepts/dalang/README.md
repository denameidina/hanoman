# Konsep "Panggung Dalang" — Anoman mengorkestrasi banyak project

Empat gambar konsep (concept art, BUKAN aset produk) untuk arah visual dashboard: Anoman sebagai
**dalang** yang mengendalikan wayang — tiap project adalah satu wayang kulit; sesi yang running =
wayang yang sedang dimainkan di kelir, project diam = wayang parkir di debog. Gambar-gambar ini
adalah **referensi desain** bagi panel `DalangStage` di Overview (`src/src/screens/DalangStage.tsx`);
mereka tidak masuk katalog 41-ID (`../illustration/inventory.json`), tidak dibundel frontend, dan
tidak melewati Gate review brand — karena itu duduk di `concepts/`, bukan `illustration/`.

| berkas | state yang digambarkan |
|---|---|
| `hnm-concept-dalang-idle-v01.webp` | idle — kelir kosong, semua wayang parkir, blencong redup |
| `hnm-concept-dalang-working-one-v01.webp` | satu sesi running — satu wayang diangkat ke panel gelap menyala |
| `hnm-concept-dalang-orchestrating-v01.webp` | multi-sesi — dalang **enam lengan** memainkan 4 wayang sekaligus |
| `hnm-concept-dashboard-v01.webp` | konsep layar dashboard futuristik utuh (sidebar, hero kelir, kartu statistik, strip terminal) |

## Catatan ikonografi

- **Enam lengan** pada gambar 3–4 adalah pengecualian sadar atas `NEGATIVE_CORE` "no extra limb"
  (`internal/docs/brand/illustration/07-prompt-library.md`) — hiperbola mitis "banyak tangan sang
  orkestrator", preseden bentuknya pengecualian laptop ADR-0140. Berlaku HANYA untuk adegan
  orkestrasi multi-project; di luar itu anatomi Anoman tetap dua lengan.
- Angka/teks pada `hnm-concept-dashboard-v01.webp` adalah placeholder konsep; aset produk nyata tetap
  mengikuti aturan "typography tidak di-bake" (`01-art-direction.md`).

## Rekaman produksi (07-prompt-library.md § Prompt record)

```yaml
model: "codex exec / GPT Image (imagegen)"
version: "codex-cli 0.146.0"
date: 2026-08-22
seed_or_job_id: "tidak diekspos codex — dinyatakan absen"
image_references:
  - "MOD-001 hnm-ill-model-character-sheet-master-v01 (identity authority)"
  - "HRO-001 hnm-ill-hero-workflow-16x9-master-v01 (gaya editorial)"
  - "LKN-001 hnm-ill-lakon-anoman-duta-4x3-master-v01 (gaya adegan)"
prompt_blocks: [IDENTITY_CORE, TIER_NARRATIVE, STYLE_EDITORIAL_WAYANG, COMP_HERO]
negative_block: NEGATIVE_CORE (minus "extra limb" untuk adegan orkestrasi — lihat catatan)
selected_output: "generasi pertama tiap prompt, tanpa retry"
manual_changes: "konversi PNG → WebP q88 (cwebp), tanpa retouch"
reviewer: "belum direview manusia (concept exploration)"
```

Prompt persisnya dikomit di direktori ini: `common.md` + `state-idle.md` + `state-working-one.md` +
`state-orchestrating.md` + `dashboard-concept.md`. Regenerasi: gabungkan `<state>.md` + `common.md`
ke stdin `codex exec --skip-git-repo-check -s workspace-write -C <tmp> --add-dir
~/.codex/generated_images -i <3 referensi di atas> -` (pola `internal/scripts/pet/gen.py`,
ADR-0140); PNG mendarat di `~/.codex/generated_images/<sesi>/exec-*.png`.
