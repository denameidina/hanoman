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

export type McpRequest = {
  // PUT & DELETE belum dipakai tool mana pun sampai katalog domain lahir, tapi tipenya dipasang
  // sekarang supaya `cli/src/mcp/client.ts` tak perlu disentuh lagi kemudian.
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  query?: Record<string, string>;
  body?: unknown;
};

export type Args = Record<string, unknown>;

export type McpToolDef = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchemaObject;
  mode: McpMode;
  /** Capability REST yang dituntut. `null` = tool ini tak memanggil `/api` sama sekali. */
  capability: string | null;
  /** Path CONTOH (tanpa `/api`) untuk uji kontrak terhadap `capabilityForRoute`. */
  samplePath: string;
  /** Method contoh, dipakai uji kontrak yang sama. */
  sampleMethod: McpRequest["method"];
  build(args: Args): McpRequest | null;
  shape(raw: unknown, args: Args): unknown;
};
