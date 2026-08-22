# Mascot system

## Thesis and construction

Mascot adalah compact Anoman, bukan personality atau species baru. Target 3.5–4 head units; head
approximately ≤28% height. Ini adjustable production guidance: ubah bila hasil terasa chibi.

Lock one-eye profile, lifted head, supit urang, ulur-ulur, white-rewanda contour, long tail/Buntut,
dignified posture. Simplify interior detail, fingers, minor jewelry, and fur marks. Emotion comes from
eye/brow, muzzle, head tilt, gesture, and tail—not frontal emoji face.

## Scale bands

Avatar 32–64 px; pet (dashboard) 80–128 px; sticker 96–256 px; product state 160–480 px; social
spot 480 px+. Add detail only after silhouette remains clear.

Pet (dashboard) 80–128 px — ±2,5 head unit, proporsi ringkas; pengecualian atas "don't use chibi
inflation" (ADR-0140), ekspresi lewat mata/kepala/ekor, tanpa emoji face. Band ini membawa satu
pengecualian kedua yang diputuskan pemilik produk saat Gate 2 Pet hidup A: baris `working` memegang
**laptop** — properti yang di daftar don't di bawah — karena tanpa benda kerja yang dikenali, pose
"sedang bekerja" tak terbaca sekilas di 112 px. Pengecualian ini berhenti di sana: laptop hanya
boleh muncul di baris `working` atlas pet, digambar polos (tanpa logo, tanpa gambar layar) dalam
gaya garis yang sama, dan tak berlaku untuk pose pack, sticker, product state, maupun social spot.

## Pose pack

| ID | Pose | Mapping |
|---|---|---|
| MPS-01 | Neutral | GST-01 · EXP-01 · TAL-01 |
| MPS-02 | Welcome | GST-02 · EXP-02 · TAL-02 |
| MPS-03 | Observe | GST-05 · EXP-03 · TAL-01 |
| MPS-04 | Work | GST-06 · EXP-03 · TAL-02 |
| MPS-05 | Ask | GST-07 · EXP-04 · TAL-02 |
| MPS-06 | Warn | GST-08 · EXP-06 · TAL-03 |
| MPS-07 | Celebrate | GST-11 · EXP-07 · TAL-04 |
| MPS-08 | Carry knowledge | GST-12 · EXP-08 · TAL-04 |

## Sticker pack

STK-01 Ready; STK-02 Working; STK-03 Waiting; STK-04 Blocked; STK-05 Shipped; STK-06 Review;
STK-07 Thanks; STK-08 Docs updated. Master is text-free; localized text stays separate.

## Parts, do/don't, Gate 2

Share head/costume base and palette roles; redraw joints per pose to avoid rigid puppet look. Never
mirror asymmetrical profile. Do preserve intelligence and tail action. Don't use chibi inflation,
generic monkey mascot, realistic fur, hoodie/laptop, emoji face, superhero pose, or slapstick.

Gate 2: silhouette matches model; ratio reviewed; 32 px and one-color pass; IDs correct; transparent
margin; no mirror; sources/reviewer recorded. Atlas pet direview lewat `internal/assets/pet/qa/`
(GIF + contact sheet per baris); `walk-left` digambar, bukan mirror.
