// ADR-0099 · ADR-0155 · bentuk katalog tool MCP. Data murni: dipakai runtime MCP di CLI DAN panel
// Settings di web, jadi daftar capability yang harus dicentang manusia tak bisa drift dari yang
// benar-benar dituntut tool.
//
// `mode` punya TIGA nilai. `danger` bukan "tulis yang lebih berani": ia menandai tool yang menuntut
// capability berakses `danger` (ADR-0155) ATAU yang destruktif tanpa jalan pulang. Tingkat mode CLI
// MENGHILANGKANNYA dari tools/list kecuali dinyalakan sengaja (ADR-0099 §5) — tool yang tak terlihat
// tak bisa dicoba. Itu BUKAN kontrol keamanan; yang menahan sungguhan adalah capability pada token.
import type { JsonSchemaObject } from "../mcp-schema";

export type McpMode = "read" | "write" | "danger";

/** Tingkat mode CLI. Yang lebih sempit selalu menang, apa pun urutan argumen. */
export type McpLevel = "read-only" | "default" | "danger";

/**
 * ADR-0183 · berkas yang DIUNGGAH. `build()` hanya menyatakan NIAT — path lokal apa yang ingin
 * dikirim sebagai part apa. Pembacaan disk, batas ukuran, dan penolakan path berbahaya ada di
 * `cli/src/mcp/transfer.ts`; katalog tetap data murni yang bisa dirender web tanpa `node:fs`.
 */
export type McpUploadFile = {
  /** Nama field multipart (`file`, `attachments`, …). */
  field: string;
  /** Path LOKAL di mesin klien MCP, persis dari argumen model. Belum tentu aman — klien yang menilai. */
  filePath: string;
  /** Nama berkas yang dikirim ke server. Kosong = nama dasar `filePath`. */
  name?: string;
};
export type McpMultipart = {
  /** Field teks, DENGAN URUTAN dijaga: sebagian route (`/projects/:id/upload`) membacanya sebelum berkas. */
  fields?: readonly (readonly [string, string])[];
  files: readonly McpUploadFile[];
};

/**
 * ADR-0183 · balasan yang BERUPA BERKAS. Tool MCP berbicara JSON teks, jadi byte tak pernah
 * dikembalikan ke model: `file` menyimpannya ke disk klien lalu menjawab path+ukuran+mime;
 * `inline` hanya untuk teks kecil dan GAGAL (bukan memotong) bila kebesaran.
 */
export type McpDownload =
  | { mode: "inline"; fallbackName: string }
  | { mode: "file"; fallbackName: string; savePath?: string; overwrite?: boolean };

export type McpRequest = {
  // PUT & DELETE belum dipakai tool mana pun sampai katalog domain lahir, tapi tipenya dipasang
  // sekarang supaya `cli/src/mcp/client.ts` tak perlu disentuh lagi kemudian.
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  /** ADR-0183 · saling eksklusif dengan `body`. Klien merakit `multipart/form-data` dari disk lokal. */
  multipart?: McpMultipart;
  /** ADR-0183 · balasan berkas: disimpan ke disk klien (atau inline bila teks kecil), bukan JSON. */
  download?: McpDownload;
  /** Header tambahan dari PROSES MCP. Tak pernah dari argumen model. */
  headers?: Record<string, string>;
};

export type Args = Record<string, unknown>;

export type McpToolDef = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchemaObject;
  mode: McpMode;
  /**
   * Capability REST yang dituntut. `null` = tool ini tak menuntut apa pun — entah karena ia tak
   * memanggil `/api` sama sekali (`hanoman_about`), entah karena route-nya `GLOBAL_READ`
   * (ADR-0157). Assert di `server/test/mcp-coverage.test.ts` menjaga agar `null` tak pernah bisa
   * menyelundupkan route yang sebenarnya bergerbang capability.
   */
  capability: string | null;
  /** Path CONTOH (tanpa `/api`) untuk uji kontrak terhadap `capabilityForRoute`. */
  samplePath: string;
  /** Method contoh, dipakai uji kontrak yang sama. */
  sampleMethod: McpRequest["method"];
  /**
   * ADR-0193..0195 · nama argumen yang berisi RAHASIA yang dikirim pemanggil (password akun klien,
   * bot token). Nilainya disensor dari SEMUA teks keluar tool ini (hasil & galat) oleh runtime MCP.
   * Rahasia yang dibangkitkan SERVER (secret webhook sekali-tampil) sengaja tidak termasuk — itu
   * hasil yang memang harus sampai ke pemanggil.
   */
  secretArgs?: readonly string[];
  /**
   * ADR-0196 · HASIL SUKSES tool ini memuat kredensial sekali-tampil (plaintext agent/device token)
   * yang memang HARUS sampai ke pemanggil. Runtime CLI karenanya tak menerapkan topeng pola
   * `hnm_agt_…` pada hasil sukses tool ini — token konfigurasi MCP sendiri tetap disembunyikan, dan
   * galat/stderr tetap dimasker penuh. Tak ada tool lain yang boleh menyalakan ini.
   */
  revealsSecret?: boolean;
  build(args: Args): McpRequest | null;
  shape(raw: unknown, args: Args): unknown;
};
