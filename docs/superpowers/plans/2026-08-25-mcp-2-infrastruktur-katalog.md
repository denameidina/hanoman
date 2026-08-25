# MCP Rencana 2 — Infrastruktur katalog & gerbang anti-drift

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menyiapkan katalog MCP untuk 152 tool — dipecah per domain, dengan mode ketiga `danger`, tingkat mode ketiga di CLI, dan tiga gerbang test yang membuat tool baru tak bisa salah pasang maupun terlupa.

**Architecture:** `shared/src/mcp-catalog.ts` (satu berkas) menjadi direktori `shared/src/mcp-catalog/` berisi `types.ts`, `helpers.ts`, satu berkas per domain, dan `index.ts` yang merakit `MCP_TOOLS`. Bentuk `McpToolDef` bertambah satu nilai mode. `mcpToolsFor` berganti dari `(readOnly: boolean)` menjadi `(level: McpLevel)`. **Nol tool baru** di rencana ini: 17 tool yang ada dipindahkan apa adanya dan tetap lulus test lama.

**Tech Stack:** TypeScript strict, vitest, `@modelcontextprotocol/server` v2, esbuild (bundling CLI).

## Global Constraints

- Rencana 1 **wajib selesai** lebih dulu: `access: "danger"` di `zCapabilityInfo` dan keempat capability harus sudah ada.
- `MCP_TOOL_SCHEMA_VERSION` (`shared/src/mcp.ts:16`) **tetap 1** sepanjang rencana ini: memindahkan berkas dan menambah nilai mode bersifat aditif bagi klien. Ia baru naik bila ada nama tool yang berubah/hilang.
- Bentuk `McpToolDef` tak boleh berubah selain menambah nilai `mode` — `cli/src/mcp/server.ts` hanya boleh disentuh untuk menyalurkan tingkat mode.
- `--danger` **bukan** kontrol keamanan. Kalimat itu wajib ada di ADR, di `MCP_INSTRUCTIONS`, dan di keluaran `hanoman_about`.
- Test shared dijalankan biasa; test server butuh `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"` dan `--no-file-parallelism`.

---

## File Structure

- Delete: `shared/src/mcp-catalog.ts`
- Create: `shared/src/mcp-catalog/types.ts` — `McpMode`, `McpRequest`, `McpToolDef`, `McpLevel`
- Create: `shared/src/mcp-catalog/helpers.ts` — `s`, `n`, `enc`, `query`, `reshapePage`, `localPage`, `ID_HINT`
- Create: `shared/src/mcp-catalog/about.ts`, `backlog.ts`, `projects.ts`, `sessions.ts`, `notifications.ts`, `support.ts`, `lead.ts` — tujuh domain yang sudah punya tool hari ini
- Create: `shared/src/mcp-catalog/index.ts` — merakit `MCP_TOOLS`
- Modify: `shared/src/mcp.ts` — `mcpToolsFor(level)`, `MCP_INSTRUCTIONS`
- Modify: `cli/src/mcp/config.ts` — `level` menggantikan `readOnly`
- Modify: `cli/src/mcp/server.ts` — salurkan level, laporkan di `hanoman_about`
- Test: `shared/src/mcp-catalog.test.ts` (tetap di tempatnya), `server/test/mcp-coverage.test.ts` (baru)

---

### Task 1: Pecah katalog jadi direktori per domain, tanpa mengubah perilaku

**Files:**
- Delete: `shared/src/mcp-catalog.ts`
- Create: `shared/src/mcp-catalog/{types,helpers,index}.ts` + tujuh berkas domain
- Test: `shared/src/mcp-catalog.test.ts` (tak diubah sama sekali di task ini)

**Interfaces:**
- Consumes: `shared/src/mcp-schema.ts`, `shared/src/mcp-shape.ts` — keduanya tak disentuh.
- Produces:
  ```ts
  // shared/src/mcp-catalog/types.ts
  export type McpMode = "read" | "write" | "danger";
  export type McpLevel = "read-only" | "default" | "danger";
  export type McpRequest = {
    method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    path: string;
    query?: Record<string, string>;
    body?: unknown;
  };
  export type McpToolDef = {
    name: string;
    title: string;
    description: string;
    inputSchema: JsonSchemaObject;
    mode: McpMode;
    capability: string | null;
    samplePath: string;
    sampleMethod: McpRequest["method"];
    build(args: Record<string, unknown>): McpRequest | null;
    shape(raw: unknown, args: Record<string, unknown>): unknown;
  };
  ```
  Setiap berkas domain mengekspor satu konstanta bernama `<DOMAIN>_TOOLS: readonly McpToolDef[]` — mis. `BACKLOG_TOOLS`, `IDE_TOOLS`. Rencana 3–6 menambah berkas domain baru dan **hanya** menyentuh `index.ts` untuk merangkainya.

**Catatan penting:** `McpRequest.method` melebar dari `"GET" | "POST" | "PATCH"` menjadi lima method. `PUT` dan `DELETE` belum dipakai satu tool pun sampai Rencana 3 — tapi tipenya dipasang sekarang supaya `client.ts` tak perlu disentuh lagi kemudian.

- [x] **Step 1: Jalankan test katalog SEBELUM menyentuh apa pun, catat hasilnya**

Run: `pnpm vitest --run shared/src/mcp-catalog.test.ts`
Expected: PASS. Ini garis dasar — task ini murni pemindahan, jadi test yang sama harus tetap hijau di akhir tanpa satu baris pun diubah.

- [x] **Step 2: Buat `types.ts` dan `helpers.ts`**

`shared/src/mcp-catalog/types.ts` memuat blok tipe di **Interfaces** di atas, ditambah `import type { JsonSchemaObject } from "../mcp-schema";` dan komentar kepala:

```ts
// ADR-0099 · ADR-0155 · bentuk katalog tool MCP. Data murni: dipakai runtime MCP di CLI DAN panel
// Settings di web, jadi daftar capability yang harus dicentang manusia tak bisa drift dari yang
// benar-benar dituntut tool.
//
// `mode` punya TIGA nilai. `danger` bukan sekadar "tulis yang lebih berani": ia menandai tool yang
// menuntut capability berakses `danger` (ADR-0155), dan tingkat mode CLI menghilangkannya dari
// tools/list kecuali dinyalakan sengaja.
```

`shared/src/mcp-catalog/helpers.ts` memuat, **dipindahkan apa adanya** dari `shared/src/mcp-catalog.ts` baris 38–72: `s`, `n`, `enc`, `query`, `reshapePage`, `localPage`, `ID_HINT`. Semuanya di-`export` (sebelumnya modul-lokal).

- [x] **Step 3: Pindahkan 17 tool ke tujuh berkas domain**

Salin entri dari `shared/src/mcp-catalog.ts` **tanpa mengubah satu properti pun** — nama, deskripsi, skema, `build`, `shape` semuanya identik:

| Berkas | Konstanta | Tool |
|---|---|---|
| `about.ts` | `ABOUT_TOOLS` | `hanoman_about` |
| `projects.ts` | `PROJECTS_TOOLS` | `hanoman_projects_list`, `hanoman_project_get` |
| `backlog.ts` | `BACKLOG_TOOLS` | `hanoman_backlog_search`, `_get`, `_docs_list`, `_doc_read`, `_create`, `_update` |
| `sessions.ts` | `SESSIONS_TOOLS` | `hanoman_sessions_list` |
| `notifications.ts` | `NOTIFICATIONS_TOOLS` | `hanoman_notifications_list`, `_mark_read` |
| `support.ts` | `SUPPORT_TOOLS` | `hanoman_tickets_list`, `hanoman_ticket_get`, `hanoman_github_issues_list` |
| `lead.ts` | `LEAD_TOOLS` | `hanoman_lead_decisions_list`, `hanoman_lead_ask` |

Tiap berkas berbentuk:

```ts
import { obj, str, /* … yang dipakai */ } from "../mcp-schema";
import { shapeSpec, /* … */ } from "../mcp-shape";
import { enc, localPage, query, reshapePage, s, n, ID_HINT } from "./helpers";
import type { McpToolDef } from "./types";

export const BACKLOG_TOOLS: readonly McpToolDef[] = [
  /* entri dipindahkan apa adanya */
];
```

- [x] **Step 4: Buat `index.ts`**

```ts
// ADR-0099 · ADR-0155 · perakitan katalog. Urutan domain di sini = urutan tool di `tools/list`,
// dan itu urutan yang dibaca model di seberang: yang paling sering dipakai lebih dulu.
export * from "./types";
export * from "./helpers";

import { ABOUT_TOOLS } from "./about";
import { BACKLOG_TOOLS } from "./backlog";
import { PROJECTS_TOOLS } from "./projects";
import { SESSIONS_TOOLS } from "./sessions";
import { NOTIFICATIONS_TOOLS } from "./notifications";
import { SUPPORT_TOOLS } from "./support";
import { LEAD_TOOLS } from "./lead";
import type { McpToolDef } from "./types";

export const MCP_TOOLS: readonly McpToolDef[] = [
  ...ABOUT_TOOLS,
  ...PROJECTS_TOOLS,
  ...BACKLOG_TOOLS,
  ...SESSIONS_TOOLS,
  ...NOTIFICATIONS_TOOLS,
  ...SUPPORT_TOOLS,
  ...LEAD_TOOLS,
];
```

- [x] **Step 5: Hapus berkas lama**

```bash
git rm shared/src/mcp-catalog.ts
```

`shared/src/mcp.ts:4` sudah menulis `export * from "./mcp-catalog";` — resolusi direktori menemukan `index.ts`, jadi baris itu **tak perlu diubah**.

- [x] **Step 6: Jalankan test yang SAMA, pastikan tetap LULUS**

Run: `pnpm vitest --run shared/src/mcp-catalog.test.ts`
Expected: PASS, identik dengan Step 1. Satu pun assert tak boleh diubah — kalau ada yang merah, itu berarti pemindahan mengubah perilaku, dan itu bug.

Run: `pnpm -F @hanoman/shared typecheck` (atau `npx tsc --noEmit -p shared`)
Expected: nol error.

- [x] **Step 7: Commit**

```bash
git add shared/src/mcp-catalog shared/src/mcp-catalog.ts
git commit -m "refactor(mcp): pecah katalog jadi direktori per domain"
```

---

### Task 2: Tingkat mode ketiga — `mcpToolsFor(level)`

**Files:**
- Modify: `shared/src/mcp.ts:18-20` (mcpToolsFor), `:22-31` (MCP_INSTRUCTIONS)
- Test: `shared/src/mcp-catalog.test.ts`

**Interfaces:**
- Consumes: `McpLevel`, `McpMode` dari Task 1.
- Produces: `mcpToolsFor(level: McpLevel): readonly McpToolDef[]`. **Tanda tangan lama `(readOnly: boolean)` hilang** — pemanggilnya hanya `cli/src/mcp/server.ts:12` dan test.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan ke `shared/src/mcp-catalog.test.ts`:

```ts
describe("tingkat mode", () => {
  it("read-only hanya tool baca", () => {
    const t = mcpToolsFor("read-only");
    expect(t.every((x) => x.mode === "read")).toBe(true);
  });

  it("default menyembunyikan danger — menghilangkan, bukan menolak saat dipanggil", () => {
    const t = mcpToolsFor("default");
    expect(t.some((x) => x.mode === "danger")).toBe(false);
    expect(t.some((x) => x.mode === "write")).toBe(true);
  });

  it("danger memuat semuanya", () => {
    expect(mcpToolsFor("danger")).toHaveLength(MCP_TOOLS.length);
  });

  it("instruksi menyatakan --danger BUKAN kontrol keamanan", () => {
    expect(MCP_INSTRUCTIONS).toMatch(/bukan kontrol keamanan/i);
  });
});
```

Perbarui juga test lama yang memanggil `mcpToolsFor(true)` / `mcpToolsFor(false)` menjadi `"read-only"` / `"default"`.

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm vitest --run shared/src/mcp-catalog.test.ts`
Expected: FAIL — `mcpToolsFor("read-only")` tak dikenal tipenya, dan instruksi belum memuat kalimat itu.

- [x] **Step 3: Implementasi minimal**

Di `shared/src/mcp.ts`, ganti `mcpToolsFor`:

```ts
/**
 * ADR-0155 · tiga tingkat. Tingkat yang lebih rendah MENGHILANGKAN tool dari tools/list, bukan
 * menolaknya saat dipanggil (ADR-0099 §5): tool yang tak terlihat tak bisa dicoba, dan menolak saat
 * dipanggil hanya menghasilkan percakapan yang membingungkan.
 *
 * Ini BUKAN kontrol keamanan. Token yang sama tetap bisa memanggil REST langsung; yang menahannya
 * adalah capability pada token (ADR-0155). Tingkat ini melindungi dari agen yang SALAH PILIH tool,
 * bukan dari agen yang BERNIAT.
 */
export function mcpToolsFor(level: McpLevel): readonly McpToolDef[] {
  if (level === "read-only") return MCP_TOOLS.filter((t) => t.mode === "read");
  if (level === "default") return MCP_TOOLS.filter((t) => t.mode !== "danger");
  return MCP_TOOLS;
}
```

Tambahkan import `McpLevel` dari `./mcp-catalog`, dan ganti paragraf ketiga `MCP_INSTRUCTIONS`:

```ts
  "Sebagian tool berbahaya (membuka sesi agen di worktree, perintah VPS, merge/rebase, penghapusan backlog, perubahan stage) hanya muncul bila manusia menyalakan tingkat `--danger` di konfigurasi klien MCP ini. Tingkat itu BUKAN kontrol keamanan — ia mencegah salah pilih tool; yang menahan sungguhan adalah capability pada agent token.",
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm vitest --run shared/src/mcp-catalog.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add shared/src/mcp.ts shared/src/mcp-catalog.test.ts
git commit -m "feat(mcp): tingkat mode ketiga danger di mcpToolsFor"
```

---

### Task 3: CLI menerima `--danger`

**Files:**
- Modify: `cli/src/mcp/config.ts:5-12` (McpConfig), `:49-51` (resolusi readOnly)
- Modify: `cli/src/mcp/server.ts:12`, `:36-45` (hanoman_about)
- Test: `cli/test/mcp-config.test.ts`, `cli/test/mcp-server.test.ts`

**Interfaces:**
- Consumes: `McpLevel` dari Task 1, `mcpToolsFor(level)` dari Task 2.
- Produces: `McpConfig.level: McpLevel` menggantikan `McpConfig.readOnly: boolean`.

- [x] **Step 1: Tulis test yang gagal**

Di `cli/test/mcp-config.test.ts`:

```ts
const base = { HANOMAN_HOST: "http://x", HANOMAN_AGENT_TOKEN: "hnm_agt_1" };
const r = (argv: string[], env: Record<string, string | undefined> = {}) =>
  resolveMcpConfig(argv, { ...base, ...env }, () => null);

describe("tingkat mode", () => {
  it("default", () => expect(r([]).level).toBe("default"));
  it("--read-only", () => expect(r(["--read-only"]).level).toBe("read-only"));
  it("--danger", () => expect(r(["--danger"]).level).toBe("danger"));
  it("HANOMAN_MCP_DANGER=1", () => expect(r([], { HANOMAN_MCP_DANGER: "1" }).level).toBe("danger"));

  it("read-only MENANG atas danger — yang lebih sempit selalu menang, tak peduli urutan", () => {
    expect(r(["--danger", "--read-only"]).level).toBe("read-only");
    expect(r(["--read-only"], { HANOMAN_MCP_DANGER: "1" }).level).toBe("read-only");
  });

  it("mengeluh saat --danger dan --read-only diberikan bersamaan, bukan diam", () => {
    expect(r(["--danger", "--read-only"]).problems.join(" ")).toMatch(/--danger diabaikan/i);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm vitest --run cli/test/mcp-config.test.ts`
Expected: FAIL — `level` tak ada di `McpConfig`.

- [x] **Step 3: Implementasi minimal**

Di `cli/src/mcp/config.ts`, ganti field `readOnly` di `McpConfig`:

```ts
  /** ADR-0155 · tingkat mode. Yang lebih sempit selalu menang, apa pun urutan argumen. */
  level: McpLevel;
```

dan ganti blok resolusinya:

```ts
  const roEnv = env.HANOMAN_MCP_READ_ONLY;
  const readOnly = argv.includes("--read-only") || roEnv === "1" || roEnv === "true";
  const dgEnv = env.HANOMAN_MCP_DANGER;
  const danger = argv.includes("--danger") || dgEnv === "1" || dgEnv === "true";
  // Yang lebih sempit menang. Diam-diam memilih yang lebih luas adalah cara paling mudah membuat
  // seseorang menyalakan permukaan berbahaya tanpa sadar.
  if (readOnly && danger) {
    problems.push("--danger diabaikan karena --read-only juga aktif. Tingkat yang lebih sempit selalu menang.");
  }
  const level: McpLevel = readOnly ? "read-only" : danger ? "danger" : "default";
```

Kembalikan `{ host, token, level, maxBytes, problems }`.

Di `cli/src/mcp/server.ts`, ganti `const tools = mcpToolsFor(cfg.readOnly);` menjadi `const tools = mcpToolsFor(cfg.level);`, dan di blok `hanoman_about` ganti baris `mode`:

```ts
            mode: cfg.level,
            modeNote: "Tingkat mode menyembunyikan tool; ia BUKAN kontrol keamanan. Yang menahan sungguhan adalah capability pada agent token.",
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm vitest --run cli/test/`
Expected: PASS. Perbarui test lama yang menyebut `cfg.readOnly`.

- [x] **Step 5: Perbarui snippet pemasangan di panel Settings**

Kartu "MCP server" di `src/src/screens/SettingsScreen.tsx:521` memuat snippet konfigurasi per klien. Tambahkan baris komentar yang menyebut `"HANOMAN_MCP_DANGER": "1"` sebagai opsi, dengan kalimat bahwa ia menampilkan tool berbahaya dan **bukan** pengganti mencentang capability.

- [x] **Step 6: Commit**

```bash
git add cli/src/mcp/ cli/test/ src/src/screens/SettingsScreen.tsx
git commit -m "feat(mcp): tingkat --danger di CLI + laporkan di hanoman_about"
```

---

### Task 4: Gerbang anti-drift #1 & #3 — mode ⇔ capability, dan tingkat

**Files:**
- Modify: `shared/src/mcp-catalog.test.ts`

**Interfaces:**
- Consumes: `MCP_TOOLS`, `mcpToolsFor` dari Task 1–2.
- Produces: `DESTRUCTIVE_BUT_WRITE` — daftar-kecuali eksplisit yang dibaca Rencana 3–6.

- [x] **Step 1: Tulis test yang gagal**

```ts
// ADR-0155 · tool yang DESTRUKTIF tapi capability-nya tetap `:write` — bukan karena ringan,
// melainkan karena tak ada capability `danger` di domainnya. Mode `danger`-nya murni ergonomi.
// Daftar ini sengaja eksplisit: menambahnya menuntut seseorang mengetik namanya di sini.
const DESTRUCTIVE_BUT_WRITE = new Set([
  "hanoman_project_delete", "hanoman_project_rename", "hanoman_docs_delete",
  "hanoman_changelog_delete", "hanoman_ticket_delete", "hanoman_agent_delete",
  "hanoman_session_history_clear", "hanoman_notifications_clear",
  "hanoman_telegram_reply_send", "hanoman_lead_flow_submit",
]);
const DANGER_CAPS = new Set(["sessions:spawn", "ide:git", "backlog:lifecycle", "vps:exec"]);

describe("mode ⇔ capability", () => {
  it("tool bercapability danger WAJIB bermode danger", () => {
    for (const t of MCP_TOOLS)
      if (t.capability && DANGER_CAPS.has(t.capability)) expect(t.mode, t.name).toBe("danger");
  });

  it("tool bermode danger WAJIB bercapability danger, kecuali yang terdaftar", () => {
    for (const t of MCP_TOOLS) {
      if (t.mode !== "danger") continue;
      if (DESTRUCTIVE_BUT_WRITE.has(t.name)) continue;
      expect(DANGER_CAPS.has(t.capability ?? ""), t.name).toBe(true);
    }
  });

  it("daftar-kecuali tak memuat nama yang sudah tak ada — kalau tool dihapus, daftarnya ikut", () => {
    const names = new Set(MCP_TOOLS.map((t) => t.name));
    for (const n of DESTRUCTIVE_BUT_WRITE) expect(names.has(n), n).toBe(true);
  });

  it("nol tool danger yang bocor ke tingkat default", () => {
    expect(mcpToolsFor("default").filter((t) => t.mode === "danger")).toHaveLength(0);
    expect(mcpToolsFor("read-only").filter((t) => t.mode !== "read")).toHaveLength(0);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm vitest --run shared/src/mcp-catalog.test.ts`
Expected: FAIL pada assert "daftar-kecuali tak memuat nama yang sudah tak ada" — sepuluh nama itu belum ada (baru lahir di Rencana 3–6). Ini kegagalan yang BENAR.

- [x] **Step 3: Kosongkan daftar sementara**

Ganti isi `DESTRUCTIVE_BUT_WRITE` menjadi `new Set([])`, dan tulis komentar tepat di atasnya:

```ts
// Diisi bertahap oleh Rencana 3–6 saat tool destruktifnya lahir. Kosong sekarang BUKAN kelalaian:
// assert terakhir menolak nama yang tak punya tool, jadi daftar ini tak bisa mendahului katalognya.
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm vitest --run shared/src/mcp-catalog.test.ts`
Expected: PASS, keempat assert.

- [x] **Step 5: Commit**

```bash
git add shared/src/mcp-catalog.test.ts
git commit -m "test(mcp): gerbang mode ⇔ capability dan kebocoran tingkat"
```

---

### Task 5: Gerbang anti-drift #2 — cakupan route

**Files:**
- Create: `server/test/mcp-coverage.test.ts`

**Interfaces:**
- Consumes: `MCP_TOOLS` dari `@hanoman/shared`, `capabilityForRoute` dari `server/src/services/agent-capabilities`.
- Produces: `UNWRAPPED` — daftar-kecuali eksplisit berisi route yang sengaja tak dibungkus.

**Kenapa di paket server:** test ini butuh **dua** hal yang tak pernah bertemu di paket lain — sumber route Fastify dan katalog MCP. Menaruhnya di `shared` memaksa paket data membaca sumber server.

- [x] **Step 1: Tulis test yang gagal**

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MCP_TOOLS } from "@hanoman/shared";
import { capabilityForRoute } from "../src/services/agent-capabilities";

const ROUTES_DIR = join(__dirname, "../src/routes");

/** Membaca (method, path) dari sumber route. Sengaja regex, bukan boot Fastify: test ini harus
 *  gagal saat SUMBER berubah, bahkan bila route-nya belum terdaftar di app. */
function routeInventory(): { method: string; path: string }[] {
  const out: { method: string; path: string }[] = [];
  for (const f of readdirSync(ROUTES_DIR).filter((f) => f.endsWith(".ts"))) {
    const src = readFileSync(join(ROUTES_DIR, f), "utf8");
    for (const m of src.matchAll(/app\.(get|post|patch|put|delete)\(\s*"([^"]+)"/g))
      out.push({ method: m[1].toUpperCase(), path: m[2] });
  }
  return out;
}

// ADR-0155 · route yang SENGAJA tak punya tool MCP. Alasannya wajib ditulis di sebelahnya.
const UNWRAPPED = new Map<string, string>([
  ["POST /specs/:id/attachments", "multipart — tak ada bentuk masuk akal lewat tool teks"],
  ["POST /projects/:id/upload", "multipart"],
  ["GET /projects/:id/archive", "biner (zip)"],
  ["GET /terminal/sessions/:id/ws", "WebSocket, bukan request-response"],
]);

/** Cocokkan path route Fastify (`/specs/:id`) dengan samplePath katalog (`/specs/SPEC-1`). */
const toPattern = (p: string) => new RegExp("^" + p.replace(/:[^/]+/g, "[^/]+").replace(/\*/g, ".*") + "$");

describe("cakupan katalog MCP", () => {
  it("setiap route yang TERJANGKAU agent token punya tool, atau terdaftar sebagai dikecualikan", () => {
    const missing: string[] = [];
    for (const r of routeInventory()) {
      const cap = capabilityForRoute(r.method, r.path);
      if (cap === null || cap === "COOKIE_ONLY" || cap === "GLOBAL_READ") continue;
      const key = `${r.method} ${r.path}`;
      if (UNWRAPPED.has(key)) continue;
      const re = toPattern(r.path);
      const covered = MCP_TOOLS.some((t) => t.sampleMethod === r.method && re.test(t.samplePath));
      if (!covered) missing.push(key);
    }
    expect(missing, `route terjangkau tanpa tool MCP:\n${missing.join("\n")}`).toEqual([]);
  });

  it("setiap samplePath katalog memang menuntut capability yang diakui tool-nya", () => {
    for (const t of MCP_TOOLS) {
      if (!t.capability) continue;
      expect(capabilityForRoute(t.sampleMethod, t.samplePath), t.name).toBe(t.capability);
    }
  });

  it("daftar dikecualikan tak memuat route yang sudah tak ada", () => {
    const keys = new Set(routeInventory().map((r) => `${r.method} ${r.path}`));
    for (const k of UNWRAPPED.keys()) expect(keys.has(k), k).toBe(true);
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL dengan daftar panjang**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/mcp-coverage.test.ts`
Expected: FAIL, pesan memuat ±135 route tanpa tool. **Ini keluaran yang paling berguna di seluruh rencana** — ia adalah daftar kerja Rencana 3–6, diturunkan dari sumber, bukan dari ingatan.

- [x] **Step 3: Simpan daftar itu sebagai bahan rencana berikutnya**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism \
  server/test/mcp-coverage.test.ts 2>&1 | tee /tmp/mcp-uncovered.txt
```

- [x] **Step 4: Buat test hijau sementara dengan cara yang JUJUR**

Tambahkan `it.todo` alih-alih melonggarkan assert:

```ts
  it.todo("cakupan penuh — dinyalakan di akhir Rencana 6");
```

dan bungkus assert pertama dengan `it.skip` **berikut komentar yang menyebut rencana mana yang menyalakannya**:

```ts
  // Dinyalakan (skip dibuang) di Task terakhir Rencana 6, saat 135 tool sudah lahir. Melonggarkan
  // assert-nya alih-alih men-skip akan membuat gerbang ini bohong selamanya.
  it.skip("setiap route yang TERJANGKAU agent token punya tool, atau terdaftar sebagai dikecualikan", () => {
```

Assert kedua dan ketiga **tetap aktif** — keduanya sudah benar hari ini.

- [x] **Step 5: Jalankan test, pastikan LULUS**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/mcp-coverage.test.ts`
Expected: PASS (1 skipped, 1 todo).

- [x] **Step 6: Commit**

```bash
git add server/test/mcp-coverage.test.ts
git commit -m "test(mcp): gerbang cakupan route, di-skip sampai katalog lengkap"
```

---

### Task 6: Verifikasi menyeluruh rencana 2

- [x] **Step 1: Jalankan test yang tersentuh**

```bash
pnpm vitest --run shared/src/mcp-catalog.test.ts cli/test/
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/mcp-coverage.test.ts
```
Expected: PASS semua.

- [x] **Step 2: Buktikan MCP masih hidup dari ujung ke ujung**

```bash
pnpm -F hanoman build
HANOMAN_HOST=http://localhost:8787 HANOMAN_AGENT_TOKEN=hnm_agt_… \
  node cli/dist/hanoman.js mcp <<< '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
Expected: JSON-RPC sah berisi 17 tool. Ulangi dengan `--danger`: tetap 17 (belum ada tool danger). Ulangi dengan `--read-only`: 13.

- [x] **Step 3: ADR & docs**

Tambahkan bagian "Tingkat mode ketiga" ke ADR-0155 (dibuat di Rencana 1 Task 6): tiga tingkat, aturan "yang lebih sempit menang", dan kalimat bahwa ia bukan kontrol keamanan. Tautkan di `internal/docs/README.md` bila belum.

- [x] **Step 4: Commit**

```bash
git add internal/docs/ docs/superpowers/plans/2026-08-25-mcp-2-infrastruktur-katalog.md
git commit -m "docs(mcp): rencana 2 selesai + tingkat mode di ADR-0155"
```

---

## Catatan pelaksanaan (2026-08-25)

- Pemecahan katalog dilakukan **lewat skrip**, bukan diketik ulang. 17 test lulus tanpa satu assert
  pun diubah — itulah bukti pemindahannya tak mengubah perilaku.
- `helpers.ts` butuh `import type { Args }` yang tak disebut rencana (typecheck menangkapnya).
- `McpPanel` ternyata memuat kalimat **"tidak tersedia lewat MCP"** yang sudah tidak benar. Dibuang
  dan diganti; test-nya diubah untuk menjaga kalimat pengganti, bukan kalimat yang berbohong.
- `modeNote` sempat memakai frasa "capability pada agent token" dan **menggagalkan uji kebocoran**
  `hanoman_about` yang melarang kata "token" muncul di balasannya. Kalimatnya yang diubah, bukan
  guard-nya — guard itu benar.
- `leftIcon="triangle-alert"` **salah**; registry DS memetakan `alert-triangle` (`icon.tsx:20`), dan
  nama yang salah jatuh SENYAP ke `Circle` (SPEC-906). Diperbaiki.
- Test `settings-agent-danger` sempat merah karena `AgentAccessPanel` ikut merender `<McpPanel/>`,
  sehingga kata "berbahaya" muncul dua kali dan query jadi ambigu — bukan kode yang salah.

Gerbang cakupan langsung membayar dirinya: ia menemukan route yang **tak ada di tabel rencana mana
pun** — `/projects/:id/binding` (GET/PUT/DELETE), `POST /projects/:id/clone`, dan `breakdown` yang
ternyata `projects:read`, bukan `docs:read`.

Verifikasi CLI nyata (`node cli/dist/hanoman.js mcp`, `tools/list`):
`default=17 · --danger=17 · --read-only=13` — default sama dengan danger karena belum ada tool
bermode `danger`; itu benar, bukan bug.
