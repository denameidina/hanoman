# ADR-0229 — Scope verifikasi `none`: sesi tak menjalankan test sama sekali

**Status:** aktif (2026-10-25). **Memperluas ADR-0080** — kosakata `verifyScope` bertambah satu
nilai; mekanismenya (klausa prompt + env, bukan hook deny) tak berubah. ADR-0037 tetap utuh.

## Konteks

Scope `changed` (ADR-0080) mempersempit verifikasi ke berkas yang berubah, tapi tetap menjalankan
test. Operator melaporkan bahwa beberapa kali run test oleh agen — bahkan set yang sempit, dikalikan
sesi yang berjalan bersamaan — membuat perangkatnya tak kuat. Klausa `changed` juga sengaja memberi
jalan keluar "perluas scope bila berdampak luas", jadi ia tak bisa menjamin test tidak dijalankan.

## Keputusan

1. **`VerifyScope` = `"changed" | "full" | "none"`** (`zVerifyScope`/`VERIFY_SCOPES` di
   `@hanoman/shared`, cermin di `runner/src/types.ts`). `Setting.data` kolom `Json` → **tanpa
   migration**. Default tetap `"changed"`.
2. **Klausa `none`** (`runner/src/verify-scope.ts`): jangan jalankan test apa pun (termasuk
   `--changed`/`related`, e2e); **menimpa** instruksi skill/metode (TDD), fase Verifikasi/review,
   dan DoD repo target; jangan build/lint repo/boot server; typecheck paling banyak sekali di akhir
   per paket tersentuh; verifikasi dengan membaca diff; laporan wajib menyatakan test tak dijalankan
   dan menyebut berkas test yang perlu dijalankan manusia. **Tanpa** jalan keluar "perluas bila
   perlu" — biaya test adalah alasan operator memilih mode ini, jadi bukan keputusan sesi.
3. Permukaan: picker Settings (default global), `StartSessionModal` (per sesi), body
   `POST /terminal/sessions`, tool MCP `hanoman_session_start` (enum diperluas), dan sesi QA
   (`qa-session.ts`, ikut setelan global). Gerbang `writesCode` sama dengan ADR-0080.

## Konsekuensi

- **Mengarahkan, bukan memaksa** — sama seperti ADR-0080, tak ada hook deny.
- **Menulis test tetap boleh**; yang dihilangkan hanya menjalankannya. Bukti hijau berpindah penuh
  ke manusia sebelum merge, dan laporan sesi tak boleh mengklaim hijau.
- Tak ada endpoint baru; kontrak `verifyScope` yang berubah sudah ter-wrap MCP (ADR-0202).
