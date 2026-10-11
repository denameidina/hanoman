# ADR-0202 — Setiap API baru wajib punya keputusan MCP (tool, atau pengecualian beralasan)

Tanggal: 2026-10-11
Status: diterima (permintaan pemilik repo)
SPEC: —
Terkait: ADR-0099 (MCP server) · ADR-0155 (cakupan penuh, gerbang anti-drift) · ADR-0183..0201 (pembukaan cakupan MCP)

## Konteks

Audit cakupan MCP menemukan ±150 endpoint tanpa tool; sebagian besar pengecualian lama tidak punya
keputusan yang tercatat atau alasannya sudah usang. Gerbang `server/test/mcp-coverage.test.ts` hanya
memaksa keputusan untuk route yang **terjangkau agent token** (capability nyata atau `GLOBAL_READ`);
route `COOKIE_ONLY`/tak terpetakan lolos tanpa jejak, jadi keputusannya bisa tak pernah diambil.

## Keputusan

Setiap route/endpoint/kanal baru atau yang diubah kontraknya **wajib diberi keputusan MCP eksplisit
dalam commit yang sama**, satu dari dua:

1. **Buat tool** — entri `McpToolDef` di `shared/src/mcp-catalog/*`, dengan capability yang tepat
   di `capabilityForRoute` (`server/src/services/agent-capabilities.ts`), mode `read|write|danger`
   menurut dampak, test katalog + test gerbang, dan baris di `docs/agent-integration.md`.
   Capability baru bersifat opt-in (tak diwarisi capability lama); aksi yang mengeksekusi,
   mengubah kredensial/capability, atau menghapus tanpa jalan pulang memakai capability `danger`
   tersendiri dan — bila mencetak/mengubah kredensial — pagar tak-eskalasi-diri di handler server.
2. **Tidak dibuat** — daftarkan di `UNWRAPPED` (`server/test/mcp-coverage.test.ts`) atau tandai
   `COOKIE_ONLY` di `capabilityForRoute` **dengan alasan teknis/keamanan yang spesifik** (bukan
   "dashboard saja"). Alasan yang sah: biner/multipart tanpa bentuk teks, WebSocket, auth bukan
   agent token (cookie sesi, device-token, HMAC per sesi), meniru identitas pihak lain, atau
   merusak gerbang keputusan manusia. Alasan harus bisa dibantah oleh kode, bukan selera.

Pertimbangan keputusan: apakah agen operator punya kebutuhan sah atas kemampuan ini; apa dampak
terburuk bila token bocor; apakah capability yang ada terlalu longgar atau perlu yang baru.
Default saat ragu: **buat tool** di balik capability opt-in + mode `danger`, bukan diam.

Perubahan pada keputusan lama (mis. membuka yang tadinya dikecualikan) ditulis sebagai ADR baru
yang menyebut ADR yang diamandemen.

## Konsekuensi

- Aturan dicatat di `AGENTS.md` (Aturan #7) dan `CLAUDE.md` (Kebiasaan) serta Definition of done.
- Gerbang yang ada tetap berlaku. Celahnya (route `COOKIE_ONLY`/null yang tak muncul di
  `UNWRAPPED`) saat ini dijaga oleh aturan ini dan review, belum oleh test.
