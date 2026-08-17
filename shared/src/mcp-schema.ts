// SPEC-482 · ADR-0099 · fragmen JSON Schema untuk katalog tool MCP.
//
// Sengaja JSON Schema polos, BUKAN zod: (a) `tools/list` MCP memancarkan JSON Schema apa adanya —
// yang ditulis di sini adalah persis yang dibaca model di seberang; (b) panel Settings merender
// katalog yang sama tanpa perlu konverter; (c) repo memakai zod v3 sementara SDK MCP v2 memakai
// zod v4 — memilih JSON Schema membuat katalog bebas dari perselisihan itu.
//
// Deskripsi di sini BUKAN kosmetik. Batasan SPEC-482: "sebut jebakan yang sudah diketahui langsung
// di deskripsi parameter, jangan mengandalkan agen membaca dokumen terpisah". Dokumen terpisah bisa
// basi tanpa suara — `~/.claude/skills/hanoman/api-reference.md` masih memuat domain `errors` dan
// source `cross-audit` yang dicabut SPEC-384. Skema tool tak bisa basi diam-diam: ia dites.
import { zPriority, zSpecSource, zStage } from "./enums";

export type JsonSchemaNode = {
  type?: string;
  description?: string;
  enum?: readonly string[];
  const?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  items?: JsonSchemaNode;
  oneOf?: readonly JsonSchemaNode[];
  properties?: Record<string, JsonSchemaNode>;
  required?: readonly string[];
  additionalProperties?: boolean;
};

export type IfThen = { if: JsonSchemaNode; then: JsonSchemaNode };

export type JsonSchemaObject = JsonSchemaNode & {
  type: "object";
  properties: Record<string, JsonSchemaNode>;
  required?: readonly string[];
  additionalProperties: boolean;
  allOf?: readonly IfThen[];
};

export const str = (description: string, extra: Partial<JsonSchemaNode> = {}): JsonSchemaNode =>
  ({ type: "string", description, ...extra });
export const enumStr = (values: readonly string[], description: string): JsonSchemaNode =>
  ({ type: "string", enum: values, description });
export const bool = (description: string): JsonSchemaNode => ({ type: "boolean", description });
export const int = (description: string, extra: Partial<JsonSchemaNode> = {}): JsonSchemaNode =>
  ({ type: "integer", description, ...extra });
export const strArray = (description: string): JsonSchemaNode =>
  ({ type: "array", description, items: { type: "string" } });

export function obj(o: {
  properties: Record<string, JsonSchemaNode>;
  required?: readonly string[];
  allOf?: readonly IfThen[];
  description?: string;
}): JsonSchemaObject {
  return {
    type: "object",
    ...(o.description ? { description: o.description } : {}),
    properties: o.properties,
    ...(o.required ? { required: o.required } : {}),
    additionalProperties: false,
    ...(o.allOf ? { allOf: o.allOf } : {}),
  };
}

// Diturunkan dari zod, bukan disalin: enum yang disalin adalah enum yang akan basi.
export const PRIORITY_ENUM = zPriority.options;
export const SOURCE_ENUM = zSpecSource.options;
export const STAGE_ENUM = zStage.options;
export const SEVERITY_ENUM = ["critical", "major", "minor"] as const;

export const PRIORITY = enumStr(
  PRIORITY_ENUM,
  "Prioritas backlog. Nilainya bahasa Indonesia — `tinggi`, `sedang`, `rendah`. Bukan high/medium/low.",
);

export const BRIEF_PAYLOAD = obj({
  description:
    "Bentuk payload untuk source `brief`, `audit`, dan `help`. Keempat field wajib ada (boleh string kosong).",
  properties: {
    context: str("Kenapa ini muncul: keadaan hari ini dan apa yang menghambat."),
    outcome: str("Keadaan yang diinginkan setelah selesai. Dari sinilah `objective` backlog diturunkan server."),
    constraints: str("Batasan yang mengikat: yang tak boleh berubah, yang wajib dipertahankan."),
    priority: PRIORITY,
    fromAudit: str("Opsional. Id backlog audit asal (mis. `SPEC-371`) bila item ini naik dari sebuah audit."),
  },
  required: ["context", "outcome", "constraints", "priority"],
});

export const QA_PAYLOAD = obj({
  description:
    "Bentuk payload untuk source `qa`. Server menurunkan `priority` dari `severity` (minor → sedang, selain itu → tinggi), jadi `priority` di tingkat atas diabaikan untuk source ini.",
  properties: {
    severity: enumStr(SEVERITY_ENUM, "Keparahan temuan: `critical`, `major`, atau `minor`."),
    steps: str("Langkah reproduksi, satu per baris."),
    expected: str("Yang seharusnya terjadi."),
    actual: str("Yang sebenarnya terjadi. Dari sinilah `objective` backlog diturunkan server."),
    env: str("Lingkungan tempat temuan muncul: versi, browser, OS, instance."),
    constraints: str("Batasan yang mengikat pengerjaan: yang tak boleh berubah, yang wajib dipertahankan. Boleh string kosong — SENGAJA tak wajib (SPEC-826)."),
    fromAudit: str("Opsional. Id backlog audit asal (mis. `SPEC-371`)."),
  },
  required: ["severity", "steps", "expected", "actual", "env"],
});

export const GOAL_PAYLOAD = obj({
  description:
    "Bentuk payload untuk source `goal`. Sesi goal mengejar satu tujuan tanpa fase perencanaan (ADR-0089).",
  properties: {
    goal: str("Satu tujuan yang dikejar sesi. Dari sinilah `objective` backlog diturunkan server."),
    done: str("Bukti berhenti yang dituntut. Kosong berarti goal itu sendiri buktinya."),
    constraints: str("Batasan yang mengikat."),
    priority: PRIORITY,
  },
  required: ["goal", "done", "constraints", "priority"],
});

export const SPEC_PAYLOAD_ONEOF: JsonSchemaNode = {
  description:
    "Isi backlog. BENTUKNYA DITENTUKAN `source`: `qa` → {severity, steps, expected, actual, env, constraints}; `goal` → {goal, done, constraints, priority}; `brief`/`audit`/`help` → {context, outcome, constraints, priority}. `constraints` qa opsional (default string kosong); bentuk yang tak cocok ditolak sebelum dikirim.",
  oneOf: [BRIEF_PAYLOAD, QA_PAYLOAD, GOAL_PAYLOAD],
};

// Mengikat `source` ke bentuk `payload` di tingkat skema, sehingga kombinasi yang salah ditolak
// oleh KLIEN — bukan ditemukan lewat 400 `"bentuk payload tak cocok dengan source"` dari server.
export const SOURCE_PAYLOAD_ALLOF: readonly IfThen[] = [
  { if: { properties: { source: { const: "qa" } }, required: ["source"] }, then: { properties: { payload: QA_PAYLOAD } } },
  { if: { properties: { source: { const: "goal" } }, required: ["source"] }, then: { properties: { payload: GOAL_PAYLOAD } } },
  { if: { properties: { source: { enum: ["brief", "audit", "help"] } }, required: ["source"] }, then: { properties: { payload: BRIEF_PAYLOAD } } },
];

export const PAGE_PARAMS: Record<string, JsonSchemaNode> = {
  page: int("Halaman, mulai dari 1. Default 1.", { minimum: 1 }),
  limit: int("Jumlah item per halaman. Default 20, maksimum 100. Balasan tool dibatasi ukurannya — minta halaman berikutnya, jangan menaikkan limit sampai membanjiri konteks.", { minimum: 1, maximum: 100 }),
};

export const DATE_PARAMS: Record<string, JsonSchemaNode> = {
  dateField: enumStr(["created", "started"], "Sumbu tanggal: `created` (kapan item difilekan, default) atau `started` (kapan sesi pertamanya lahir). `started` MEMBUANG item yang belum pernah dikerjakan."),
  from: str("Batas bawah tanggal, format `YYYY-MM-DD`, INKLUSIF. Boleh sendirian tanpa `to`."),
  to: str("Batas atas tanggal, format `YYYY-MM-DD`, INKLUSIF. Boleh sendirian tanpa `from`."),
};
