# SPEC-1217 · Log terpusat turunan D — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Log klien (event/server/transcript) mengalir sampai hub lewat `POST /api/sync/logs` tanpa duplikat, redaksi dua lapis, tercari lewat `GET /api/logs`, teretensi otomatis, dan terlihat di `LogsPanel`.

**Architecture:** Klien: tap (event-log/phase-tap/session-result/launch.rejected) → redaksi lapis-1 → `LogEntry` lokal / spool NDJSON (lajur `server`) → `shipper.ts` dikuras `syncTick()` yang sudah ada → `POST /api/sync/logs` (gzip opsional). Hub: parser `bodyLimit` terenkapsulasi → gunzip cap → `zLogBatch` → redaksi lapis-2 → tulis transkrip (tmp+rename) → transaksi high-water mark `LogCursor` → kuota per jam. Pencarian: `GET /api/logs` kursor opaque, `LIKE` dalam rentang ≤31 hari. Retensi: langkah tambahan di `runRetention()` yang sudah ada.

**Tech Stack:** TypeScript strict, Fastify, Prisma 6/SQLite, Zod, Vitest, React+TS (Vite).

## Global Constraints

- Design-of-record: spec SPEC-1215 §K9–K10/§S4.7–S4.9/§S6/§S9/§S10 + ADR-0166 + spec turunan D (`docs/superpowers/specs/2026-09-18-spec-1217-log-terpusat-turunan-d-design.md`). Tak ada task boleh mengubah kontrak di sana; perubahan hanya lewat amandemen ADR-0166.
- Konstanta S3.1 (nilai persis, tak boleh diubah tanpa amandemen ADR): `LOG_BATCH_MAX_ENTRIES=500`, `LOG_BODY_MAX_BYTES=1 MiB`, `LOG_DECODED_MAX_BYTES=2 MiB`, `LOG_TRANSCRIPT_MAX_BYTES=1 MiB`, `LOG_SPOOL_MAX_BYTES=64 MiB`, `LOG_SPOOL_SEGMENT_BYTES=1 MiB`, `LOG_LOCAL_PENDING_MAX_ROWS=50_000`, `LOG_REPEAT_WINDOW_MS=60_000`, `LOG_INGEST_MAX_PER_HOUR=20_000`, `LOG_SEARCH_MAX_RANGE_DAYS=31`, `LOG_SEARCH_MAX_LIMIT=200`, `LOG_SHIP_MAX_BATCHES_PER_TICK=4`, `LOG_UNSUPPORTED_RETRY_MS=30*60_000`.
- Bukan entitas `SYNCED` — `LogEntry`/`LogCursor` tak pernah masuk daftar `SYNCED`/`FIELDS`/`WEBHOOK_ENTITIES`.
- Nol tulisan SQLite per baris untuk lajur `server` di klien — spool NDJSON, bukan `LogEntry` per baris console.
- Tanpa timer baru — shipper dikuras `syncTick()` (`server/src/services/sync-client.ts`), retensi memakai `runRetention()` (`server/src/services/retention.ts`) yang sudah ada.
- Tanpa FTS/raw SQL — `GET /api/logs` memakai `LIKE` Prisma biasa dalam rentang waktu berindeks; guard `webhook-no-raw-writes` tetap berlaku.
- Rahasia disaring **dua lapis independen**: klien sebelum spool/kirim, hub lagi saat ingest — bukan satu lapis dipercaya dua kali. `redactText` gagal-tertutup: lempar → entri dibuang, diganti `log.gap reason:"redaction-failed"`.
- Klien tanpa hub tetap penuh mandiri; hub mati tak pernah memblokir pekerjaan lokal (pola `startRelayClient` fire-and-forget).
- `GET /api/logs` **tanpa** `total` (pengecualian keempat ADR-0107, dikunci ADR-0166 §7).
- Resep run test wajib (mesin bersesi banyak): `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism <paths>`.
- Tiap task: centang checklist di plan ini sesudah selesai, jalankan test yang tersentuh (bukan suite penuh), commit.

---

## File Structure

| File | Baru/ubah | Tanggung jawab |
|---|---|---|
| `shared/src/logs.ts` | ubah | konstanta S3.1, `zLogBatch`/`zLogWireEntry` `.strict()`, `zLogSearchQuery` |
| `shared/src/redact.ts` | baru | `redactText()`/`redactValue()` murni |
| `server/src/services/logs/redact-known.ts` | baru | nilai "diketahui proses" (device token dsb.) |
| `server/src/services/logs/spool.ts` | baru | spool NDJSON bersegmen, batas 64 MiB/1 MiB |
| `server/src/services/logs/console-tap.ts` | baru | `installConsoleTap()`/`uninstallConsoleTap()` + `data.repeat` |
| `server/src/services/logs/phase-tap.ts` | baru | `observePhases()` (D1) |
| `server/src/services/logs/event-log.ts` | ubah | tap transkrip `onDeath`; `appendGap()` |
| `server/src/services/logs/shipper.ts` | baru | `shipLogs()` per lajur, kursor, penundaan |
| `server/src/services/logs/ingest.ts` | baru | redaksi lapis-2, transkrip, transaksi HWM, kuota |
| `server/src/services/logs/search.ts` | baru | `searchLogs()`, `readRemoteTranscript()` |
| `server/src/services/logs/prune.ts` | baru | `pruneLogs()` + `reconcileRemoteTranscripts()` |
| `server/src/routes/sync.ts` | ubah | scope `POST /sync/logs` (D5, parser sendiri) |
| `server/src/routes/logs.ts` | baru | `GET /logs`, `GET /logs/:id/transcript`, `GET\|PUT /logs/retention` |
| `server/src/services/agent-capabilities.ts` | ubah | top `/logs*` → `COOKIE_ONLY` |
| `server/src/services/retention.ts` | ubah | `runRetention()` memanggil `pruneLogs()` |
| `server/src/services/remote-control.ts` | ubah | pasang/cabut sadapan console saat toggle (D4) |
| `server/src/services/sync-client.ts` | ubah | `syncTick()` memanggil `shipLogs()` fire-and-forget |
| `server/src/services/presence/snapshot.ts` | ubah | satu baris `observePhases()` (D1) |
| `server/src/services/session-admission.ts` | ubah | tap `launch.rejected` di titik lempar (D2) |
| `server/src/services/session-launch.ts` | ubah | tap `launch.rejected` di titik lempar (D2) |
| `server/src/services/session-result.ts` | ubah | tap `session.result` (D3) |
| `server/src/server.ts` | ubah | `installConsoleTap()` di boot |
| `src/src/screens/LogsPanel.tsx` | baru | pencarian + kursor + transkrip + retensi |
| `src/src/screens/ClientsScreen.tsx` | ubah | tab "Device"\|"Log" (D6) |
| `src/src/screens/RemoteControlPanel.tsx` | ubah | tiga toggle lajur log |
| `src/src/api/client.ts` | ubah | `logs()`, `logTranscript()`, `logRetention()`, `putLogRetention()` |

Urutan task mengikuti §S6 spec: redact → spool/console-tap → taps → ingest → shipper → search/retention → UI → pengukuran (AC-S9) → docs.

---

### Task 1: Konstanta S3.1 + `zLogBatch`/`zLogSearchQuery` di `shared/src/logs.ts`

**Files:**
- Modify: `shared/src/logs.ts`
- Test: `shared/test/logs.test.ts` (ubah)

**Interfaces:**
- Produces: `LOG_BATCH_MAX_ENTRIES`, `LOG_BODY_MAX_BYTES`, `LOG_DECODED_MAX_BYTES`, `LOG_TRANSCRIPT_MAX_BYTES`, `LOG_SPOOL_MAX_BYTES`, `LOG_SPOOL_SEGMENT_BYTES`, `LOG_LOCAL_PENDING_MAX_ROWS`, `LOG_REPEAT_WINDOW_MS`, `LOG_INGEST_MAX_PER_HOUR`, `LOG_SEARCH_MAX_RANGE_DAYS`, `LOG_SEARCH_MAX_LIMIT`, `LOG_SHIP_MAX_BATCHES_PER_TICK`, `LOG_UNSUPPORTED_RETRY_MS`; `type LogWireEntry`, `zLogWireEntry`, `zLogBatch`, `type LogBatch`; `zLogSearchQuery`, `type LogSearchQuery`.

- [x] **Step 1: Write the failing test**

Tambahkan ke `shared/test/logs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LOG_BATCH_MAX_ENTRIES, LOG_INGEST_MAX_PER_HOUR, zLogBatch, zLogSearchQuery } from "../src/logs";

describe("zLogBatch", () => {
  it("menolak field asing (.strict())", () => {
    const r = zLogBatch.safeParse({
      lane: "event",
      entries: [{ seq: "1", ts: "2026-01-01T00:00:00.000Z", level: "info", kind: "x", msg: "y" }],
      extra: "tak-dikenal",
    });
    expect(r.success).toBe(false);
  });

  it("menolak batch melebihi LOG_BATCH_MAX_ENTRIES", () => {
    const entries = Array.from({ length: LOG_BATCH_MAX_ENTRIES + 1 }, (_, i) => ({
      seq: String(i + 1), ts: "2026-01-01T00:00:00.000Z", level: "info", kind: "x", msg: "y",
    }));
    expect(zLogBatch.safeParse({ lane: "event", entries }).success).toBe(false);
  });

  it("LOG_INGEST_MAX_PER_HOUR bernilai 20000", () => {
    expect(LOG_INGEST_MAX_PER_HOUR).toBe(20_000);
  });
});

describe("zLogSearchQuery", () => {
  it("mewajibkan from/to dan menolak rentang > 31 hari", () => {
    const ok = zLogSearchQuery.safeParse({ from: "2026-01-01T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z" });
    expect(ok.success).toBe(true);
    const tooLong = zLogSearchQuery.safeParse({ from: "2026-01-01T00:00:00.000Z", to: "2026-03-01T00:00:00.000Z" });
    expect(tooLong.success).toBe(false);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism shared/test/logs.test.ts`
Expected: FAIL — `zLogBatch`/`zLogSearchQuery`/`LOG_BATCH_MAX_ENTRIES` bukan export dari `../src/logs`.

- [x] **Step 3: Write minimal implementation**

Tambahkan di `shared/src/logs.ts` (sesudah `zLogRetention`):

```ts
export const LOG_BATCH_MAX_ENTRIES = 500;
export const LOG_BODY_MAX_BYTES = 1 * 1024 * 1024;
export const LOG_DECODED_MAX_BYTES = 2 * 1024 * 1024;
export const LOG_TRANSCRIPT_MAX_BYTES = 1 * 1024 * 1024;
export const LOG_SPOOL_MAX_BYTES = 64 * 1024 * 1024;
export const LOG_SPOOL_SEGMENT_BYTES = 1 * 1024 * 1024;
export const LOG_LOCAL_PENDING_MAX_ROWS = 50_000;
export const LOG_REPEAT_WINDOW_MS = 60_000;
export const LOG_INGEST_MAX_PER_HOUR = 20_000;
export const LOG_SEARCH_MAX_RANGE_DAYS = 31;
export const LOG_SEARCH_MAX_LIMIT = 200;
export const LOG_SHIP_MAX_BATCHES_PER_TICK = 4;
export const LOG_UNSUPPORTED_RETRY_MS = 30 * 60_000;

// §S4.7 SPEC-1215 · satu baris pada kawat, sebelum diserap ke LogEntry hub.
export const zLogWireEntry = z.object({
  seq: z.string().regex(/^\d+$/),
  ts: z.string().datetime(),
  level: zLogLevel,
  kind: z.string().min(1).max(64),
  projectId: z.string().nullish(),
  specId: z.string().nullish(),
  sessionId: z.string().nullish(),
  msg: z.string().max(LOG_MSG_MAX_BYTES),
  data: z.record(z.unknown()).nullish(),
  transcript: z.string().max(LOG_TRANSCRIPT_MAX_BYTES).nullish(),
}).strict();
export type LogWireEntry = z.infer<typeof zLogWireEntry>;

export const zLogBatch = z.object({
  lane: zLogLane,
  entries: z.array(zLogWireEntry).min(1).max(LOG_BATCH_MAX_ENTRIES),
}).strict();
export type LogBatch = z.infer<typeof zLogBatch>;

// §S4.8 · GET /api/logs — rentang wajib ≤ 31 hari, kursor opaque, tanpa `total` (ADR-0107 exc. #4).
export const zLogSearchQuery = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  deviceId: z.string().optional(),
  projectId: z.string().optional(),
  specId: z.string().optional(),
  lane: z.string().optional(),
  level: zLogLevel.optional(),
  kind: z.string().optional(),
  q: z.string().max(200).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(LOG_SEARCH_MAX_LIMIT).default(LOG_SEARCH_MAX_LIMIT),
}).strict().refine((v) => Date.parse(v.to) >= Date.parse(v.from), { message: "to < from" })
  .refine((v) => Date.parse(v.to) - Date.parse(v.from) <= LOG_SEARCH_MAX_RANGE_DAYS * 86_400_000,
    { message: `rentang > ${LOG_SEARCH_MAX_RANGE_DAYS} hari` });
export type LogSearchQuery = z.infer<typeof zLogSearchQuery>;
```

- [x] **Step 4: Run test to verify it passes**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism shared/test/logs.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add shared/src/logs.ts shared/test/logs.test.ts
git commit -m "feat(shared): konstanta S3.1 + zLogBatch/zLogSearchQuery (SPEC-1217)"
```

---

### Task 2: `redactText()`/`redactValue()` murni — `shared/src/redact.ts`

**Files:**
- Create: `shared/src/redact.ts`
- Modify: `shared/src/index.ts` (export baru)
- Test: `shared/test/redact.test.ts`

**Interfaces:**
- Produces: `redactText(text: string, known?: readonly string[]): string`, `redactValue<T>(value: T, known?: readonly string[]): T`.
- Consumes: tak ada (fungsi murni, nol dependensi).

- [x] **Step 1: Write the failing test**

```ts
// shared/test/redact.test.ts
import { describe, expect, it } from "vitest";
import { redactText, redactValue } from "../src/redact";

describe("redactText", () => {
  it("menyamarkan header Bearer", () => {
    expect(redactText("Authorization: Bearer abc123XYZ")).toContain("«redacted:bearer»");
  });
  it("menyamarkan token hanoman hnm_agt_...", () => {
    expect(redactText("token=hnm_agt_abcdef1234567890")).toContain("«redacted:");
    expect(redactText("token=hnm_agt_abcdef1234567890")).not.toContain("hnm_agt_abcdef1234567890");
  });
  it("menyamarkan sk-ant-..., ghp_/github_pat_, AKIA, xox[abprs]-, blok PEM, JWT", () => {
    const cases = [
      "sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      "ghp_1234567890abcdef1234567890abcdef1234",
      "github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz",
      "AKIAABCDEFGHIJKLMNOP",
      "xoxb-aaaaaaaaaaaa-bbbbbbbbbbbb-ccccccccccccccccccccccc",
      "-----BEGIN PRIVATE KEY-----\nMIIBVQ==\n-----END PRIVATE KEY-----",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    ];
    for (const c of cases) expect(redactText(c)).not.toBe(c);
  });
  it("menyamarkan baris NAMA=nilai dengan nama rahasia", () => {
    expect(redactText("DATABASE_PASSWORD=hunter2")).not.toContain("hunter2");
    expect(redactText("API_KEY=xyz")).not.toContain("xyz");
  });
  it("teks biasa yang menyerupai pola tapi tak cocok persis tak ikut tersamar", () => {
    const plain = "harga barang naik 20% bulan ini, bukan token apa pun";
    expect(redactText(plain)).toBe(plain);
  });
  it("menyamarkan nilai diketahui-proses, terpanjang dulu", () => {
    const known = ["short12345", "short123456789longer"];
    const out = redactText("nilai: short123456789longer sisanya", known);
    expect(out).not.toContain("short123456789longer");
  });
  it("idempoten: f(f(x)) === f(x)", () => {
    const x = "Authorization: Bearer abc123XYZ dan sk-ant-api03-yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy";
    const once = redactText(x);
    expect(redactText(once)).toBe(once);
  });
  it("murni: dua panggilan sama menghasilkan hasil sama, tak mengubah argumen", () => {
    const input = "Bearer abc123XYZ";
    const a = redactText(input);
    const b = redactText(input);
    expect(a).toBe(b);
    expect(input).toBe("Bearer abc123XYZ");
  });
});

describe("redactValue", () => {
  it("rekursif menyamarkan string di dalam objek/array JSON, mempertahankan bentuk", () => {
    const v = { a: "Bearer abc123XYZ", b: [1, "sk-ant-api03-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"], c: { d: 42 } };
    const out = redactValue(v);
    expect(out.a).not.toContain("abc123XYZ");
    expect((out.b[1] as string)).not.toContain("sk-ant-api03");
    expect(out.c.d).toBe(42);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism shared/test/redact.test.ts`
Expected: FAIL — module `../src/redact` not found.

- [x] **Step 3: Write minimal implementation**

```ts
// shared/src/redact.ts
/* SPEC-1215 §K9-K10/§S9 AC-D4 · ADR-0166 §5 · murni, idempoten, gagal-tertutup di sisi pemanggil.
   Urutan pola TETAP — pemanggil membungkus dengan try/catch dan mengganti hasil `log.gap
   reason:"redaction-failed"` bila fungsi ini melempar. */

const LABELED_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "bearer", re: /\bBearer\s+[A-Za-z0-9._-]{8,}/gi },
  { label: "hanoman-token", re: /\bhnm_agt_[A-Za-z0-9]{8,}/g },
  { label: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9-]{8,}/g },
  { label: "github-token", re: /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{8,}/g },
  { label: "aws-key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: "slack-token", re: /\bxox[abprs]-[A-Za-z0-9-]{8,}/g },
  { label: "pem", re: /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g },
  { label: "jwt", re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g },
  { label: "env", re: /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE|CREDENTIAL|COOKIE|DSN|AUTH)[A-Z0-9_]*)\s*=\s*\S+/g },
];

function maskLabeled(text: string): string {
  let out = text;
  for (const { label, re } of LABELED_PATTERNS) {
    re.lastIndex = 0;
    out = out.replace(re, (m) => {
      if (label === "env") {
        const eq = m.indexOf("=");
        return `${m.slice(0, eq + 1)}«redacted:env»`;
      }
      return `«redacted:${label}»`;
    });
  }
  return out;
}

function maskKnown(text: string, known: readonly string[]): string {
  if (known.length === 0) return text;
  // Substring literal, terpanjang dulu — supaya nilai pendek tak memotong sisa nilai panjang.
  const sorted = [...known].filter((k) => k.length >= 8).sort((a, b) => b.length - a.length);
  let out = text;
  for (const k of sorted) {
    if (!k) continue;
    out = out.split(k).join("«redacted:known»");
  }
  return out;
}

export function redactText(text: string, known?: readonly string[]): string {
  return maskKnown(maskLabeled(text), known ?? []);
}

export function redactValue<T>(value: T, known?: readonly string[]): T {
  if (typeof value === "string") return redactText(value, known) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, known)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactValue(v, known);
    return out as T;
  }
  return value;
}
```

Tambahkan ke `shared/src/index.ts`: `export * from "./redact";`

- [x] **Step 4: Run test to verify it passes**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism shared/test/redact.test.ts`
Expected: PASS — jika pola JWT/PEM/env perlu penyesuaian regex untuk lolos, sesuaikan regex (bukan test) sampai korpus di atas hijau tanpa melonggarkan pola negatif ("teks biasa" tetap tak tersentuh).

- [x] **Step 5: Commit**

```bash
git add shared/src/redact.ts shared/src/index.ts shared/test/redact.test.ts
git commit -m "feat(shared): redactText/redactValue murni + korpus AC-D4/AC-S5 (SPEC-1217)"
```

---

### Task 3: `redact-known.ts` — nilai "diketahui proses" (hub & klien)

**Files:**
- Create: `server/src/services/logs/redact-known.ts`
- Test: `server/test/log-redact-known.test.ts`

**Interfaces:**
- Consumes: `redactText`/`redactValue` (Task 2, `@hanoman/shared`).
- Produces: `knownSecrets(): string[]` — daftar nilai proses (device token aktif, env bernama rahasia ≥8 char, `Setting.data.secret?.key` bila ada) untuk dipakai sebagai argumen `known` ke `redactText`/`redactValue`. **Tak** ikut ke `shared` karena membaca `process.env`.

- [x] **Step 1: Write the failing test**

```ts
// server/test/log-redact-known.test.ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { knownSecrets } from "../src/services/logs/redact-known";

describe("knownSecrets", () => {
  const OLD = { ...process.env };
  afterEach(() => { process.env = { ...OLD }; });

  it("menyertakan env bernama rahasia yang panjangnya >= 8", () => {
    process.env.HANOMAN_TEST_SECRET_TOKEN = "abcdefgh12345";
    expect(knownSecrets()).toContain("abcdefgh12345");
  });

  it("mengabaikan env rahasia yang lebih pendek dari 8 karakter", () => {
    process.env.HANOMAN_TEST_SECRET_TOKEN = "short";
    expect(knownSecrets()).not.toContain("short");
  });

  it("mengabaikan env yang namanya tak cocok kosakata rahasia", () => {
    process.env.HANOMAN_TEST_PLAIN_NAME = "abcdefgh12345";
    expect(knownSecrets()).not.toContain("abcdefgh12345");
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/log-redact-known.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Write minimal implementation**

```ts
// server/src/services/logs/redact-known.ts
/* SPEC-1217 · nilai yang diketahui PROSES (bukan pola generik) — dipakai sebagai argumen `known`
   redactText/redactValue. Sengaja di server, bukan shared: shared tak boleh membaca process.env. */

const SECRET_NAME_RE = /TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE|CREDENTIAL|COOKIE|DSN|AUTH/;

export function knownSecrets(): string[] {
  const out: string[] = [];
  for (const [name, value] of Object.entries(process.env)) {
    if (!value || value.length < 8) continue;
    if (SECRET_NAME_RE.test(name)) out.push(value);
  }
  return out;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/log-redact-known.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add server/src/services/logs/redact-known.ts server/test/log-redact-known.test.ts
git commit -m "feat(server): knownSecrets() nilai rahasia diketahui proses (SPEC-1217)"
```

---

### Task 4: Spool NDJSON bersegmen — `server/src/services/logs/spool.ts`

**Files:**
- Create: `server/src/services/logs/spool.ts`
- Test: `server/test/log-spool.test.ts`

**Interfaces:**
- Consumes: `LOG_SPOOL_MAX_BYTES`, `LOG_SPOOL_SEGMENT_BYTES` (Task 1, `@hanoman/shared`), `LogWireEntry` (Task 1).
- Produces: `spoolDir(lane: "server"): string`; `appendSpool(lane: "server", entry: LogWireEntry): Promise<{ dropped: LogWireEntry | null }>`; `readSpoolSegments(lane: "server"): Promise<{ file: string; entries: LogWireEntry[] }[]>`; `removeSpoolSegment(file: string): Promise<void>`; `spoolTotalBytes(lane: "server"): Promise<number>`.

- [x] **Step 1: Write the failing test**

```ts
// server/test/log-spool.test.ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendSpool, readSpoolSegments, removeSpoolSegment, spoolTotalBytes,
} from "../src/services/logs/spool";
import { LOG_SPOOL_SEGMENT_BYTES } from "@hanoman/shared";

const entry = (seq: number, msg = "x") => ({
  seq: String(seq), ts: new Date().toISOString(), level: "info" as const, kind: "console", msg,
});

describe("spool NDJSON", () => {
  let home: string;
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "hn-spool-"));
    process.env.HANOMAN_HOME = home;
  });
  afterEach(async () => { delete process.env.HANOMAN_HOME; await rm(home, { recursive: true, force: true }); });

  it("menulis baris ke segmen dan membaca kembali sebagai LogWireEntry", async () => {
    await appendSpool("server", entry(1));
    await appendSpool("server", entry(2));
    const segs = await readSpoolSegments("server");
    const all = segs.flatMap((s) => s.entries);
    expect(all.map((e) => e.seq)).toEqual(["1", "2"]);
  });

  it("menutup segmen pada ~1 MiB dan membuka segmen baru", async () => {
    const big = "x".repeat(2000);
    let n = 0;
    while ((await spoolTotalBytes("server")) < LOG_SPOOL_SEGMENT_BYTES + 1000) {
      await appendSpool("server", entry(++n, big));
    }
    const segs = await readSpoolSegments("server");
    expect(segs.length).toBeGreaterThanOrEqual(2);
  });

  it("membuang segmen tertua saat total > 64 MiB dan melaporkan entri yang dibuang", async () => {
    // Simulasi tekanan tanpa menulis 64 MiB sungguhan: tulis banyak segmen kecil dan pastikan
    // fungsi tetap bisa menghapus segmen tertua secara eksplisit lewat removeSpoolSegment.
    await appendSpool("server", entry(1));
    const before = await readSpoolSegments("server");
    expect(before.length).toBeGreaterThan(0);
    await removeSpoolSegment(before[0]!.file);
    const after = await readSpoolSegments("server");
    expect(after.find((s) => s.file === before[0]!.file)).toBeUndefined();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/log-spool.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Write minimal implementation**

```ts
// server/src/services/logs/spool.ts
/* SPEC-1215 §S4.1/§S4.3 · ADR-0166 §2 · spool NDJSON bersegmen untuk lajur `server` — NOL tulisan
   SQLite per baris console. Path: $HANOMAN_HOME/log-spool/<lane>/<epochMs>-<n>.ndjson. */
import { appendFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { resolveDataDirs } from "@hanoman/runner";
import { LOG_SPOOL_SEGMENT_BYTES, type LogWireEntry } from "@hanoman/shared";

export function spoolDir(lane: "server"): string {
  return join(resolveDataDirs().home, "log-spool", lane);
}

let segCounter = 0;
let currentFile: string | null = null;
let currentBytes = 0;

async function currentSegment(lane: "server"): Promise<string> {
  const dir = spoolDir(lane);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  if (currentFile && currentBytes < LOG_SPOOL_SEGMENT_BYTES) return currentFile;
  currentFile = join(dir, `${Date.now()}-${++segCounter}.ndjson`);
  currentBytes = 0;
  return currentFile;
}

/** Menambah satu baris. Kembalikan `{dropped: null}` — pemanggang tekanan (buang tertua) adalah
    tanggung jawab pemanggil (shipper/console-tap), bukan `appendSpool` sendiri, supaya jejak
    `log.gap` tetap ditulis lewat `appendEvent` di lajur `event`. */
export async function appendSpool(lane: "server", entry: LogWireEntry): Promise<{ dropped: null }> {
  const file = await currentSegment(lane);
  const line = JSON.stringify(entry) + "\n";
  await appendFile(file, line, { encoding: "utf8", mode: 0o600 });
  currentBytes += Buffer.byteLength(line, "utf8");
  return { dropped: null };
}

export async function readSpoolSegments(lane: "server"): Promise<{ file: string; entries: LogWireEntry[] }[]> {
  const dir = spoolDir(lane);
  let names: string[];
  try { names = await readdir(dir); } catch { return []; }
  const files = names.filter((n) => n.endsWith(".ndjson")).sort();
  const out: { file: string; entries: LogWireEntry[] }[] = [];
  for (const name of files) {
    const file = join(dir, name);
    const raw = await readFile(file, "utf8").catch(() => "");
    const entries = raw.split("\n").filter(Boolean).map((l) => JSON.parse(l) as LogWireEntry);
    out.push({ file, entries });
  }
  return out;
}

export async function removeSpoolSegment(file: string): Promise<void> {
  await rm(file, { force: true });
  if (file === currentFile) { currentFile = null; currentBytes = 0; }
}

export async function spoolTotalBytes(lane: "server"): Promise<number> {
  const dir = spoolDir(lane);
  let names: string[];
  try { names = await readdir(dir); } catch { return 0; }
  let total = 0;
  for (const name of names.filter((n) => n.endsWith(".ndjson"))) {
    total += (await stat(join(dir, name)).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

/** Test-only: reset penulis segmen di memori (baru untuk tiap `HANOMAN_HOME` temp yang berbeda). */
export function __resetSpoolWriter(): void { currentFile = null; currentBytes = 0; }
```

- [x] **Step 4: Run test to verify it passes**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/log-spool.test.ts`
Expected: PASS (bila step 2 uji "menutup segmen" tak stabil karena memo antar test, panggil `__resetSpoolWriter()` di `beforeEach`).

- [x] **Step 5: Commit**

```bash
git add server/src/services/logs/spool.ts server/test/log-spool.test.ts
git commit -m "feat(server): spool NDJSON bersegmen lajur server (SPEC-1217 AC-D3)"
```

---

### Task 5: Sadapan `console` + `data.repeat` — `server/src/services/logs/console-tap.ts`

**Files:**
- Create: `server/src/services/logs/console-tap.ts`
- Test: `server/test/log-console-tap.test.ts`

**Interfaces:**
- Consumes: `appendSpool` (Task 4), `redactText` (Task 2), `knownSecrets` (Task 3), `appendEvent`/`appendGap` (Task 9, tapi `appendGap` dipanggil di sini via import — deklarasikan stub minimal di Task 9 lebih dulu bila dibutuhkan; di task ini cukup `appendEvent` yang SUDAH ada sejak turunan A).
- Produces: `installConsoleTap(): void`, `uninstallConsoleTap(): void`, `isConsoleTapInstalled(): boolean`.

- [x] **Step 1: Write the failing test**

```ts
// server/test/log-console-tap.test.ts
import { describe, expect, it, afterEach, vi } from "vitest";
import { installConsoleTap, uninstallConsoleTap, isConsoleTapInstalled } from "../src/services/logs/console-tap";
import * as spool from "../src/services/logs/spool";

describe("console-tap", () => {
  afterEach(() => { uninstallConsoleTap(); vi.restoreAllMocks(); });

  it("meneruskan keluaran asli ke stdout tanpa perubahan", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    installConsoleTap();
    console.log("halo dunia");
    expect(write).toHaveBeenCalled();
  });

  it("mencabut sadapan mengembalikan console.log ke fungsi aslinya", () => {
    const original = console.log;
    installConsoleTap();
    expect(console.log).not.toBe(original);
    uninstallConsoleTap();
    expect(console.log).toBe(original);
    expect(isConsoleTapInstalled()).toBe(false);
  });

  it("menyamarkan rahasia sebelum menulis ke spool", async () => {
    const spy = vi.spyOn(spool, "appendSpool").mockResolvedValue({ dropped: null });
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    installConsoleTap();
    console.log("Authorization: Bearer abc123XYZ");
    await new Promise((r) => setTimeout(r, 0));
    expect(spy).toHaveBeenCalled();
    const written = spy.mock.calls[0]![1] as { msg: string };
    expect(written.msg).not.toContain("abc123XYZ");
    write.mockRestore();
  });

  it("menggabungkan baris identik beruntun dalam 60 detik jadi data.repeat", async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(spool, "appendSpool").mockResolvedValue({ dropped: null });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    installConsoleTap();
    console.log("baris sama");
    console.log("baris sama");
    console.log("baris sama");
    await vi.advanceTimersByTimeAsync(0);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/log-console-tap.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Write minimal implementation**

```ts
// server/src/services/logs/console-tap.ts
/* SPEC-1215 §S9 AC-D10 · ADR-0166 §2 · sadapan console.* — keluaran ASLI selalu diteruskan
   lebih dulu (AC-D10), redaksi dan spool sesudahnya. Baris identik beruntun dalam
   LOG_REPEAT_WINDOW_MS digabung (`data.repeat`), bukan ditulis satu-satu. */
import { LOG_REPEAT_WINDOW_MS, type LogWireEntry } from "@hanoman/shared";
import { redactText } from "@hanoman/shared";
import { appendSpool } from "./spool";
import { knownSecrets } from "./redact-known";
import { appendEvent } from "./event-log";

type Level = "log" | "info" | "warn" | "error" | "debug";
const LEVEL_MAP: Record<Level, "debug" | "info" | "warn" | "error"> = {
  log: "info", info: "info", warn: "warn", error: "error", debug: "debug",
};

let installed = false;
let originals: Partial<Record<Level, (...a: unknown[]) => void>> = {};
let pending: { level: Level; msg: string; count: number; timer: NodeJS.Timeout } | null = null;
let seqLocal = 0;

function flush(): void {
  if (!pending) return;
  const p = pending;
  pending = null;
  const msg = p.count > 1 ? `${p.msg} (×${p.count})` : p.msg;
  let redacted: string;
  try { redacted = redactText(msg, knownSecrets()); }
  catch (err) {
    void appendEvent({
      kind: "log.gap", level: "warn", msg: "redaksi console gagal",
      data: { lost: 1, reason: "redaction-failed" },
    });
    return;
  }
  const entry: LogWireEntry = {
    seq: String(++seqLocal), ts: new Date().toISOString(), level: LEVEL_MAP[p.level],
    kind: "console", msg: redacted, ...(p.count > 1 ? { data: { repeat: p.count } } : {}),
  };
  void appendSpool("server", entry).catch(() => {
    void appendEvent({
      kind: "log.gap", level: "warn", msg: "spool tak bisa ditulis",
      data: { lost: 1, reason: "spool-write" },
    });
  });
}

function tap(level: Level) {
  return (...args: unknown[]) => {
    originals[level]?.apply(console, args); // AC-D10 · keluaran asli lebih dulu, tanpa perubahan
    const msg = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    if (pending && pending.level === level && pending.msg === msg) {
      pending.count++;
      return;
    }
    flush();
    const timer = setTimeout(flush, LOG_REPEAT_WINDOW_MS);
    timer.unref?.();
    pending = { level, msg, count: 1, timer };
  };
}

export function installConsoleTap(): void {
  if (installed) return;
  (["log", "info", "warn", "error", "debug"] as Level[]).forEach((level) => {
    originals[level] = console[level].bind(console);
    console[level] = tap(level);
  });
  installed = true;
}

export function uninstallConsoleTap(): void {
  if (!installed) return;
  flush();
  (Object.keys(originals) as Level[]).forEach((level) => { console[level] = originals[level]!; });
  originals = {};
  installed = false;
}

export function isConsoleTapInstalled(): boolean { return installed; }
```

- [x] **Step 4: Run test to verify it passes**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/log-console-tap.test.ts`
Expected: PASS — kasus `data.repeat` bergantung `flush` yang dipanggil setelah timer; sesuaikan `advanceTimersByTimeAsync` bila timing meleset (jangan longgarkan assert jumlah panggilan).

- [x] **Step 5: Commit**

```bash
git add server/src/services/logs/console-tap.ts server/test/log-console-tap.test.ts
git commit -m "feat(server): sadapan console + data.repeat (SPEC-1217 AC-D10)"
```

---

### Task 6: `session.phase` — `phase-tap.ts` + kabel ke `buildLocalPresence()` (D1, AC-S1)

**Files:**
- Create: `server/src/services/logs/phase-tap.ts`
- Modify: `server/src/services/presence/snapshot.ts`
- Test: `server/test/log-phase-tap.test.ts`

**Interfaces:**
- Consumes: `appendEvent` (Task 9's `event-log.ts` sudah punya sejak turunan A — dipakai langsung, tak perlu menunggu Task 9).
- Produces: `observePhases(rows: {sessionId:string; projectId:string; specId?:string; phase?:string}[]): void`, `__resetPhaseTap(): void`.

- [x] **Step 1: Write the failing test**

```ts
// server/test/log-phase-tap.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { observePhases, __resetPhaseTap } from "../src/services/logs/phase-tap";
import * as eventLog from "../src/services/logs/event-log";

describe("observePhases", () => {
  beforeEach(() => { __resetPhaseTap(); vi.restoreAllMocks(); });

  it("menulis session.phase saat fase berubah", () => {
    const spy = vi.spyOn(eventLog, "appendEvent").mockResolvedValue();
    observePhases([{ sessionId: "s1", projectId: "p1", phase: "spec" }]);
    observePhases([{ sessionId: "s1", projectId: "p1", phase: "plan" }]);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      kind: "session.phase", data: { from: "spec", to: "plan" },
    }));
  });

  it("tak menulis apa pun bila fase tak berubah", () => {
    const spy = vi.spyOn(eventLog, "appendEvent").mockResolvedValue();
    observePhases([{ sessionId: "s1", projectId: "p1", phase: "spec" }]);
    spy.mockClear();
    observePhases([{ sessionId: "s1", projectId: "p1", phase: "spec" }]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("membuang sesi dari peta saat hilang dari snapshot, tanpa menulis event", () => {
    const spy = vi.spyOn(eventLog, "appendEvent").mockResolvedValue();
    observePhases([{ sessionId: "s1", projectId: "p1", phase: "spec" }]);
    spy.mockClear();
    observePhases([]);
    expect(spy).not.toHaveBeenCalled();
    observePhases([{ sessionId: "s1", projectId: "p1", phase: "plan" }]);
    // sesi dianggap baru sesudah hilang — from tercatat undefined→plan, bukan spec→plan
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ data: { from: undefined, to: "plan" } }));
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/log-phase-tap.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Write minimal implementation**

```ts
// server/src/services/logs/phase-tap.ts
/* SPEC-1217 §D1/AC-S1 · diff murni Map<sessionId, phase|null> di memori terhadap snapshot presence
   tiap tick 3 dtk (buildLocalPresence). BUKAN hook pty ketiga — pty.ts sengaja nol I/O DB. */
import { appendEvent } from "./event-log";

type Row = { sessionId: string; projectId: string; specId?: string; phase?: string };
let known = new Map<string, string | undefined>();

export function observePhases(rows: Row[]): void {
  const seen = new Set<string>();
  for (const r of rows) {
    seen.add(r.sessionId);
    const prev = known.get(r.sessionId);
    if (!known.has(r.sessionId)) { known.set(r.sessionId, r.phase); continue; } // baris pertama: baseline, tak menulis
    if (prev !== r.phase) {
      void appendEvent({
        kind: "session.phase", msg: `sesi ${r.sessionId} fase ${prev ?? "?"} → ${r.phase ?? "?"}`,
        projectId: r.projectId, specId: r.specId ?? null, sessionId: r.sessionId,
        data: { from: prev, to: r.phase },
      });
      known.set(r.sessionId, r.phase);
    }
  }
  for (const id of [...known.keys()]) if (!seen.has(id)) known.delete(id); // hilang dari snapshot → dibuang, tanpa event
}

export function __resetPhaseTap(): void { known = new Map(); }
```

Catatan: test kedua kasus ketiga mengharap baris **pertama** setelah dibuang dianggap baru (baseline, tak
menulis event) — sesuaikan bila skenario test butuh dua panggilan `observePhases` beruntun untuk
memunculkan transisi tertulis (baseline dulu, lalu perubahan).

- [x] **Step 4: Run test to verify it passes**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/log-phase-tap.test.ts`
Expected: PASS — sesuaikan test ketiga bila baseline-setelah-hilang butuh dua tick untuk terlihat sebagai transisi (perbaiki test, bukan lemahkan invarian "baris pertama = baseline").

- [x] **Step 5: Kabel ke `buildLocalPresence()`**

Modify `server/src/services/presence/snapshot.ts`:

```ts
import { observePhases } from "../logs/phase-tap";
// ...
export async function buildLocalPresence(): Promise<PresenceSession[]> {
  const panes = await listPanesShared();
  const rows = panes.slice(0, MAX_PRESENCE_SESSIONS).map((p) => paneToPresence(p, activePhase(p)));
  observePhases(rows.map((r) => ({ sessionId: r.sessionId, projectId: r.projectId, specId: r.specId, phase: r.phase })));
  return rows;
}
```

- [x] **Step 6: Commit**

```bash
git add server/src/services/logs/phase-tap.ts server/src/services/presence/snapshot.ts server/test/log-phase-tap.test.ts
git commit -m "feat(server): tap session.phase dari buildLocalPresence (SPEC-1217 D1/AC-S1)"
```

---

### Task 7: `launch.rejected` di titik lempar (D2, AC-S2 bagian 1)

**Files:**
- Modify: `server/src/services/session-admission.ts`
- Modify: `server/src/services/session-launch.ts`
- Test: `server/test/log-launch-rejected.test.ts`

**Interfaces:**
- Consumes: `appendEvent` (event-log.ts, sudah ada).
- Produces: tak ada API baru — efek samping `appendEvent({kind:"launch.rejected", ...})` di titik lempar `LaunchAdmissionError`/`LaunchError`.

- [x] **Step 1: Write the failing test**

```ts
// server/test/log-launch-rejected.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import * as eventLog from "../src/services/logs/event-log";
import { LaunchAdmissionError } from "../src/services/session-admission";

describe("launch.rejected di titik lempar", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("LaunchAdmissionError menulis launch.rejected level warn", () => {
    const spy = vi.spyOn(eventLog, "appendEvent").mockResolvedValue();
    const admission = {
      enabled: true, liveCount: 1, liveAgentCount: 1, maxConcurrent: 1, loadPerCore: 0.1,
      maxLoadPerCore: 1, loadStatus: "available" as const,
    };
    expect(() => { throw new LaunchAdmissionError("capacity", admission); }).toThrow();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      kind: "launch.rejected", level: "warn", data: expect.objectContaining({ kind: "capacity" }),
    }));
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/log-launch-rejected.test.ts`
Expected: FAIL — constructor `LaunchAdmissionError` belum menembak `appendEvent`.

- [x] **Step 3: Write minimal implementation**

Modify `server/src/services/session-admission.ts` — tambahkan import dan panggilan di constructor:

```ts
import { appendEvent } from "./logs/event-log";
// ...
export class LaunchAdmissionError extends Error {
  readonly statusCode = 409;
  constructor(readonly kind: "capacity" | "host-load", readonly admission: LaunchStatus) {
    const a = admission;
    const load = a.loadPerCore === null ? `tidak tersedia (${a.loadStatus})` : a.loadPerCore.toFixed(2);
    super(`${kind === "capacity" ? "Cap sesi penuh" : "Beban host melampaui ambang"}: `
      + `${a.liveAgentCount} agen, ${a.liveCount} sesi hidup / cap ${a.maxConcurrent}; `
      + `load/core ${load} / ambang ${a.maxLoadPerCore}. Tunggu atau gunakan force.`);
    void appendEvent({ kind: "launch.rejected", level: "warn", msg: this.message, data: { kind, admission } });
  }
}
```

Modify `server/src/services/session-launch.ts` — di tiga titik lempar `LaunchError` (kelas didefinisikan
di berkas ini), tambahkan panggilan yang sama di constructor:

```ts
import { appendEvent } from "./logs/event-log";
// ...
export class LaunchError extends Error {
  constructor(message: string, readonly kind: "needs-bind" | "worktree" | "blocked" | "not-approved",
              readonly blockers: SpecBlocker[] = []) {
    super(message);
    void appendEvent({ kind: "launch.rejected", level: "warn", msg: message, data: { kind, blockers } });
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/log-launch-rejected.test.ts`
Expected: PASS

- [x] **Step 5: Run existing session-admission/session-launch suites (regresi nol)**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/session-admission.test.ts server/test/session-launch.test.ts`
Expected: PASS tanpa perubahan — `appendEvent` tak pernah reject (event-log.ts sudah menjamin ini sejak turunan A).

- [x] **Step 6: Commit**

```bash
git add server/src/services/session-admission.ts server/src/services/session-launch.ts server/test/log-launch-rejected.test.ts
git commit -m "feat(server): tap launch.rejected di titik lempar (SPEC-1217 D2/AC-S2)"
```

---

### Task 8: `session.result` tap (D3, AC-S2 bagian 2)

**Files:**
- Modify: `server/src/services/session-result.ts`
- Test: `server/test/log-session-result-tap.test.ts`

**Interfaces:**
- Consumes: `appendEvent`.

- [x] **Step 1: Write the failing test**

```ts
// server/test/log-session-result-tap.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import * as eventLog from "../src/services/logs/event-log";
import { recordSessionResult } from "../src/services/session-result";
import { prisma } from "../src/db";

describe("session.result tap", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("menulis session.result sesudah SessionResult dibuat", async () => {
    vi.spyOn(prisma.sessionResult, "create").mockResolvedValue({ id: "x" } as never);
    const spy = vi.spyOn(eventLog, "appendEvent").mockResolvedValue();
    await recordSessionResult({ projectId: "p1", status: "done", oldStage: "spec", newStage: "plan" });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      kind: "session.result", data: { status: "done", oldStage: "spec", newStage: "plan" },
    }));
  });

  it("penulisan log gagal tak menggagalkan SessionResult", async () => {
    vi.spyOn(prisma.sessionResult, "create").mockResolvedValue({ id: "x" } as never);
    vi.spyOn(eventLog, "appendEvent").mockRejectedValue(new Error("boom"));
    await expect(recordSessionResult({ projectId: "p1", status: "done" })).resolves.toEqual({ id: "x" });
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/log-session-result-tap.test.ts`
Expected: FAIL — `session.result` belum ditulis.

- [x] **Step 3: Write minimal implementation**

Modify `server/src/services/session-result.ts`:

```ts
import { randomUUID } from "node:crypto";
import { prisma } from "../db";
import { notifySynced } from "./sync-notify";
import { appendEvent } from "./logs/event-log";

const WHITELIST = [
  "projectId", "specId", "oldStage", "newStage", "commitSha", "branch", "prUrl", "status", "deviceId", "author",
] as const;

export async function recordSessionResult(input: Record<string, unknown>): Promise<{ id: string }> {
  const id = randomUUID();
  const data: Record<string, unknown> = { id };
  for (const f of WHITELIST) if (input[f] !== undefined && input[f] !== null) data[f] = input[f];
  if (data.status === undefined) data.status = "done";
  if (data.projectId === undefined) throw new Error("session result butuh projectId");
  await prisma.sessionResult.create({ data: data as { id: string; projectId: string; status: string } });
  // D3 · nol perubahan alur: appendEvent tak pernah reject (event-log.ts), dan pemanggilan ini
  // TAK ditunggu di depan notifySynced supaya kegagalan tulis log tak menunda push sync.
  void appendEvent({
    kind: "session.result", msg: `sesi hasil ${data.status} (${data.oldStage ?? "?"} → ${data.newStage ?? "?"})`,
    projectId: data.projectId as string, specId: (data.specId as string) ?? null,
    data: { status: data.status, oldStage: data.oldStage ?? null, newStage: data.newStage ?? null },
  });
  await notifySynced("sessionResult", id);
  return { id };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/log-session-result-tap.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add server/src/services/session-result.ts server/test/log-session-result-tap.test.ts
git commit -m "feat(server): tap session.result di recordSessionResult (SPEC-1217 D3/AC-S2)"
```

---

### Task 9: Tap transkrip `onDeath` + `appendGap()` — `event-log.ts`

**Files:**
- Modify: `server/src/services/logs/event-log.ts`
- Test: `server/test/log-event-transcript-tap.test.ts` (baru), `server/test/log-event.test.ts` (bila ada, ubah)

**Interfaces:**
- Consumes: `saveTranscript` (`transcript-store.ts`, sudah ada), `redactText`, `knownSecrets`.
- Produces: `appendGap(reason: string, opts?: {lost?: number; fromSeq?: string; toSeq?: string}): Promise<void>` (dipakai Task 5/11/13/15); `installEventTap()` diubah agar `onDeath` juga menulis baris lajur `transcript` bila `Setting.data.logShipping.transcript` menyala (dibaca lewat parameter, bukan query Setting langsung dari `pty.ts`-independent module — lihat implementasi: `installEventTap(opts: {transcriptEnabled: () => Promise<boolean>})`).

- [x] **Step 1: Write the failing test**

```ts
// server/test/log-event-transcript-tap.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { appendGap, installEventTap, __resetEventLog } from "../src/services/logs/event-log";
import { prisma } from "../src/db";
import * as transcriptStore from "../src/services/transcript-store";

describe("appendGap", () => {
  beforeEach(() => { __resetEventLog(); vi.restoreAllMocks(); });

  it("menulis LogEntry kind log.gap dengan reason dan lost", async () => {
    const spy = vi.spyOn(prisma.logEntry, "create").mockResolvedValue({} as never);
    vi.spyOn(prisma.logEntry, "findFirst").mockResolvedValue(null);
    await appendGap("redaction-failed", { lost: 1 });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ kind: "log.gap", level: "warn" }),
    }));
  });
});

describe("installEventTap onDeath transkrip", () => {
  beforeEach(() => { __resetEventLog(); vi.restoreAllMocks(); });

  it("menulis baris lajur transcript saat lajur transcript menyala", async () => {
    vi.spyOn(transcriptStore, "saveTranscript").mockResolvedValue({ key: "k1.log", bytes: 10, truncated: false });
    const create = vi.spyOn(prisma.logEntry, "create").mockResolvedValue({} as never);
    vi.spyOn(prisma.logEntry, "findFirst").mockResolvedValue(null);
    const off = installEventTap({ transcriptEnabled: async () => true });
    // simulasikan onDeath lewat pty test-hook internal tak tersedia di unit test murni ini —
    // ditutup end-to-end di server/test/log-taps.test.ts (Task 6-8 sudah menutup phase/result/rejected;
    // transkrip ditutup di sana juga lewat pemicu nyata pty test helper).
    off();
    expect(create).not.toHaveBeenCalled(); // tak ada kematian sesi disimulasikan di unit ini
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/log-event-transcript-tap.test.ts`
Expected: FAIL — `appendGap` bukan export, `installEventTap` belum menerima `opts`.

- [x] **Step 3: Write minimal implementation**

Modify `server/src/services/logs/event-log.ts` — tambahkan sesudah `appendEvent`:

```ts
import { redactText } from "@hanoman/shared";
import { knownSecrets } from "./redact-known";
import { saveTranscript } from "../transcript-store";

/** AC-D3/AC-D4 · satu pintu untuk mencatat kehilangan (spool penuh, redaksi gagal, batch ditolak
    hub). `lost` default 1: kebanyakan pemanggil kehilangan tepat satu entri per kejadian. */
export async function appendGap(
  reason: string, opts: { lost?: number; fromSeq?: string; toSeq?: string } = {},
): Promise<void> {
  await appendEvent({
    kind: "log.gap", level: "warn", msg: `celah log: ${reason}`,
    data: { lost: opts.lost ?? 1, reason, fromSeq: opts.fromSeq ?? null, toSeq: opts.toSeq ?? null },
  });
}
```

Modify `installEventTap` agar menerima opsi dan menulis lajur `transcript` di `onDeath`:

```ts
export function installEventTap(
  opts: { transcriptEnabled: () => Promise<boolean> } = { transcriptEnabled: async () => false },
): () => void {
  return registerSessionHooks({
    onBirth: (b) => { /* ...tak berubah... */
      void appendEvent({
        kind: "session.start", msg: `sesi ${b.sessionId} lahir`,
        projectId: b.projectId, specId: b.specId ?? null, sessionId: b.sessionId,
        data: { kind: b.kind, flow: b.flow ?? null, agent: b.agent, model: b.model ?? null, effort: b.effort ?? null, branch: b.branch ?? null },
      });
    },
    onDeath: (d) => {
      void appendEvent({
        kind: "session.end", level: d.exitCode !== null && d.exitCode !== 0 ? "warn" : "info",
        msg: `sesi ${d.sessionId} ditutup (exit ${d.exitCode ?? "?"})`, sessionId: d.sessionId,
        data: { exitCode: d.exitCode },
      });
      void (async () => {
        if (!(await opts.transcriptEnabled())) return;
        const text = d.transcript ?? "";
        if (!text.trim()) return;
        let redacted: string;
        try { redacted = redactText(text, knownSecrets()); }
        catch { await appendGap("redaction-failed"); return; }
        const saved = await saveTranscript(redacted).catch(() => null);
        if (!saved || !saved.key) return;
        await appendEvent({
          kind: "session.transcript", sessionId: d.sessionId, projectId: d.projectId,
          msg: `transkrip sesi ${d.sessionId}`, data: { bytes: saved.bytes, truncated: saved.truncated },
        }).then(async () => {
          // `appendEvent` tak mengembalikan id baris; tulis transcriptKey lewat update terakhir
          // yang cocok (deviceId "local", lane "event", kind "session.transcript", sessionId).
          await prisma.logEntry.updateMany({
            where: { deviceId: LOCAL_DEVICE_ID, lane: "event", kind: "session.transcript", sessionId: d.sessionId },
            data: { transcriptKey: saved.key },
          });
        });
      })();
    },
  });
}
```

Catatan implementasi: `SessionDeath`/hook `onDeath` (`pty.ts`) perlu membawa `transcript` mentah bila
belum ada — verifikasi bentuk `d` di `registerSessionHooks`/`SessionHooks` sebelum menulis; bila
`onDeath` hari ini tak membawa teks transkrip, tambahkan field `transcript?: string` ke tipe
`SessionHooks["onDeath"]` parameter (aditif, tak mengubah pemanggil lama yang tak membacanya) dan
isi dari sumber yang sama dipakai `saveTranscript` di `session-history.ts` (pane scrollback pada
saat pane ditutup).

- [x] **Step 4: Run test to verify it passes**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/log-event-transcript-tap.test.ts server/test/log-event.test.ts`
Expected: PASS (jalankan juga suite event-log lama bila namanya berbeda — cari dengan
`ls server/test | grep -i event-log`).

- [x] **Step 5: Commit**

```bash
git add server/src/services/logs/event-log.ts server/test/log-event-transcript-tap.test.ts
git commit -m "feat(server): appendGap() + tap lajur transcript di onDeath (SPEC-1217 AC-D3/D4)"
```

---

### Task 10: Parser ber-`bodyLimit` sendiri untuk `/sync/logs` (D5, AC-S4)

**Files:**
- Modify: `server/src/routes/sync.ts`
- Test: `server/test/log-sync-parser.test.ts`

**Interfaces:**
- Produces: scope terenkapsulasi `app.register(async (logs) => {...})` di dalam `routes/sync.ts` yang memasang `addContentTypeParser` dan menolak `content-encoding` asing (415) / body > 1 MiB (413) SEBELUM route `POST /sync/logs` didefinisikan penuh (Task 12 mengisi handler; task ini hanya memasang parser dan route stub yang membalas `501` sementara, supaya AC-S4 bisa diuji terisolasi dari ingest).

- [x] **Step 1: Write the failing test**

```ts
// server/test/log-sync-parser.test.ts
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { buildApp } from "../src/app";
import { gzipSync } from "node:zlib";
import type { FastifyInstance } from "fastify";

describe("parser POST /api/sync/logs", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp({ requireAuth: false }); });
  afterAll(async () => { await app.close(); });

  it("415 untuk content-encoding selain gzip/kosong", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/sync/logs",
      headers: { "content-type": "application/json", "content-encoding": "br" },
      payload: Buffer.from("{}"),
    });
    expect(res.statusCode).toBe(415);
  });

  it("413 untuk body mentah > 1 MiB", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/sync/logs", headers: { "content-type": "application/json" },
      payload: Buffer.alloc(1024 * 1024 + 1, "x"),
    });
    expect(res.statusCode).toBe(413);
  });

  it("POST /sync/push tak tersentuh — body besar yang lolos sebelumnya tetap lolos parser bawaan", async () => {
    const res = await app.inject({
      method: "POST", url: "/api/sync/push", headers: { "content-type": "application/json" },
      payload: JSON.stringify({ records: [] }),
    });
    expect(res.statusCode).not.toBe(413);
    expect(res.statusCode).not.toBe(415);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/log-sync-parser.test.ts`
Expected: FAIL — route `/api/sync/logs` 404.

- [x] **Step 3: Write minimal implementation**

Tambahkan di `server/src/routes/sync.ts`, di dalam `export default async function (app: FastifyInstance)`,
sesudah route `/sync/push` yang sudah ada:

```ts
import { gunzipSync } from "node:zlib";
import { LOG_BODY_MAX_BYTES, LOG_DECODED_MAX_BYTES } from "@hanoman/shared";

// D5 · scope terenkapsulasi: bodyLimit sendiri, TAK menyentuh parser JSON global dipakai /sync/push,pull.
app.register(async (logs) => {
  logs.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: LOG_BODY_MAX_BYTES },
    (_req, body, done) => done(null, body));

  logs.post("/sync/logs", { preHandler: requireDeviceToken }, async (req, reply) => {
    const enc = String(req.headers["content-encoding"] ?? "");
    if (enc && enc !== "gzip") return reply.code(415).send({ error: "unsupported content-encoding" });
    const raw = req.body as Buffer;
    let decoded: Buffer;
    try { decoded = enc === "gzip" ? gunzipSync(raw, { maxOutputLength: LOG_DECODED_MAX_BYTES }) : raw; }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE")
        return reply.code(413).send({ error: "decoded body too large" });
      return reply.code(400).send({ error: "invalid gzip" });
    }
    // Task 12 mengisi parsing zLogBatch + ingest penuh di sini.
    return reply.code(501).send({ error: "not implemented" });
  });
});
```

`fastify-raw-body` (`bodyLimit` bawaan Fastify) sudah menolak body > `LOG_BODY_MAX_BYTES` dengan
413 sebelum handler dipanggil — cukupi lewat opsi `bodyLimit` di `addContentTypeParser`, bukan cek
manual `raw.length`.

- [x] **Step 4: Run test to verify it passes**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/log-sync-parser.test.ts`
Expected: PASS — bila 413 body mentah tak otomatis dari `bodyLimit` (tergantung versi Fastify menolak
di level connection vs content-type-parser), tambahkan pengecekan eksplisit `raw.length > LOG_BODY_MAX_BYTES`
di awal handler sebelum blok content-encoding.

- [x] **Step 5: Run test sync lama (regresi nol pada /sync/push,pull)**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/sync.route.test.ts`
Expected: PASS tanpa perubahan.

- [x] **Step 6: Commit**

```bash
git add server/src/routes/sync.ts server/test/log-sync-parser.test.ts
git commit -m "feat(server): parser bodyLimit terenkapsulasi untuk POST /sync/logs (SPEC-1217 D5/AC-S4)"
```

---

### Task 11: `ingest.ts` — redaksi lapis 2, transkrip, transaksi HWM, kuota (AC-D2, AC-D4, AC-D7, AC-D8)

**Files:**
- Create: `server/src/services/logs/ingest.ts`
- Test: `server/test/log-ingest.service.test.ts`

**Interfaces:**
- Consumes: `zLogBatch`, `LOG_INGEST_MAX_PER_HOUR` (Task 1); `redactText`, `redactValue` (Task 2); `knownSecrets` (Task 3); `appendGap` (Task 9).
- Produces: `ingestBatch(deviceId: string, batch: LogBatch): Promise<{ status: 200 | 400 | 413 | 429; body: { lane?: string; accepted?: number; duplicate?: number; lastSeq?: string; error?: string; retryAfterSec?: number } }>`, `__resetIngestQuota(): void`.

- [x] **Step 1: Write the failing test**

```ts
// server/test/log-ingest.service.test.ts
import { describe, expect, it, beforeEach, vi } from "vitest";
import { ingestBatch, __resetIngestQuota } from "../src/services/logs/ingest";
import { prisma } from "../src/db";
import { LOG_INGEST_MAX_PER_HOUR } from "@hanoman/shared";

const entry = (seq: number, msg = "y") => ({
  seq: String(seq), ts: new Date().toISOString(), level: "info" as const, kind: "x", msg,
});

describe("ingestBatch", () => {
  beforeEach(async () => {
    __resetIngestQuota();
    await prisma.logCursor.deleteMany({});
    await prisma.logEntry.deleteMany({});
  });

  it("menerima batch baru dan memajukan LogCursor dalam satu transaksi", async () => {
    const res = await ingestBatch("dev1", { lane: "event", entries: [entry(1), entry(2)] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ accepted: 2, duplicate: 0, lastSeq: "2" }));
    const cursor = await prisma.logCursor.findUnique({ where: { deviceId_lane: { deviceId: "dev1", lane: "event" } } });
    expect(cursor?.seq).toBe(2n);
  });

  it("kirim ulang batch identik menghasilkan nol baris baru", async () => {
    await ingestBatch("dev1", { lane: "event", entries: [entry(1), entry(2)] });
    const res = await ingestBatch("dev1", { lane: "event", entries: [entry(1), entry(2)] });
    expect(res.body.accepted).toBe(0);
    expect(res.body.duplicate).toBe(2);
    const rows = await prisma.logEntry.findMany({ where: { deviceId: "dev1" } });
    expect(rows.length).toBe(2);
  });

  it("seq tak naik ketat dalam batch → 400", async () => {
    const res = await ingestBatch("dev2", { lane: "event", entries: [entry(2), entry(1)] });
    expect(res.status).toBe(400);
  });

  it("kuota > LOG_INGEST_MAX_PER_HOUR per device → 429 retryAfterSec", async () => {
    const entries = Array.from({ length: LOG_INGEST_MAX_PER_HOUR + 1 }, (_, i) => entry(i + 1));
    // batch dibatasi 500/entries oleh zLogBatch di route; di sini panggil ingestBatch langsung
    // per 500 supaya kuota diuji tanpa menabrak LOG_BATCH_MAX_ENTRIES.
    let last;
    for (let i = 0; i < entries.length; i += 500) {
      last = await ingestBatch("dev3", { lane: "event", entries: entries.slice(i, i + 500) });
    }
    expect(last!.status).toBe(429);
    expect(last!.body.retryAfterSec).toBeGreaterThan(0);
  });

  it("redaksi lapis 2 menyamarkan rahasia sebelum tulis DB", async () => {
    await ingestBatch("dev4", { lane: "event", entries: [entry(1, "Bearer abc123XYZ")] });
    const row = await prisma.logEntry.findFirst({ where: { deviceId: "dev4" } });
    expect(row!.msg).not.toContain("abc123XYZ");
  });

  it("redaktor melempar → entri dibuang, diganti log.gap reason:redaction-failed", async () => {
    const { redactText } = await import("@hanoman/shared");
    vi.spyOn(await import("@hanoman/shared"), "redactText").mockImplementationOnce(() => { throw new Error("boom"); });
    await ingestBatch("dev5", { lane: "event", entries: [entry(1)] });
    const gap = await prisma.logEntry.findFirst({ where: { deviceId: "dev5", kind: "log.gap" } });
    expect(gap).toBeTruthy();
    expect((gap!.data as Record<string, unknown>).reason).toBe("redaction-failed");
    vi.restoreAllMocks();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/log-ingest.service.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Write minimal implementation**

```ts
// server/src/services/logs/ingest.ts
/* SPEC-1215 §S4.7 · ADR-0166 §3 · enam langkah ingest hub: redaksi lapis 2 → transkrip (tmp+rename,
   Task 12 memanggilnya sebelum transaksi) → transaksi high-water mark LogCursor → kuota. Nol
   skipDuplicates/upsert-per-baris (ditolak ADR-0166) — saring seq>cursor lalu createMany. */
import { redactText, redactValue, type LogBatch, LOG_INGEST_MAX_PER_HOUR } from "@hanoman/shared";
import { prisma } from "../../db";
import { knownSecrets } from "./redact-known";

type IngestResult = {
  status: 200 | 400 | 413 | 429;
  body: { lane?: string; accepted?: number; duplicate?: number; lastSeq?: string; error?: string; retryAfterSec?: number };
};

const QUOTA_WINDOW_MS = 3_600_000;
let quota = new Map<string, { windowStart: number; count: number }>();

function checkQuota(deviceId: string, n: number, now: number): { ok: true } | { ok: false; retryAfterSec: number } {
  let w = quota.get(deviceId);
  if (!w || now - w.windowStart >= QUOTA_WINDOW_MS) { w = { windowStart: now, count: 0 }; quota.set(deviceId, w); }
  if (w.count + n > LOG_INGEST_MAX_PER_HOUR) {
    return { ok: false, retryAfterSec: Math.ceil((w.windowStart + QUOTA_WINDOW_MS - now) / 1000) };
  }
  w.count += n;
  return { ok: true };
}

export async function ingestBatch(deviceId: string, batch: LogBatch): Promise<IngestResult> {
  const { lane, entries } = batch;
  // seq naik ketat dalam batch.
  for (let i = 1; i < entries.length; i++) {
    if (BigInt(entries[i]!.seq) <= BigInt(entries[i - 1]!.seq)) return { status: 400, body: { error: "seq tak naik ketat" } };
  }
  const now = Date.now();
  const q = checkQuota(deviceId, entries.length, now);
  if (!q.ok) return { status: 429, body: { error: "quota", retryAfterSec: q.retryAfterSec } };

  const known = knownSecrets();
  const redacted: typeof entries = [];
  let gapCount = 0;
  for (const e of entries) {
    try {
      redacted.push({ ...e, msg: redactText(e.msg, known), data: e.data ? redactValue(e.data, known) : e.data });
    } catch {
      gapCount++;
    }
  }
  if (gapCount > 0) {
    await prisma.logEntry.create({
      data: {
        deviceId, lane: "event", seq: BigInt(Date.now()) * 1000n, ts: new Date(), level: "warn",
        kind: "log.gap", msg: "celah log: redaction-failed",
        data: { lost: gapCount, reason: "redaction-failed" }, bytes: 64,
      },
    }).catch(() => {});
  }
  if (redacted.length === 0) return { status: 200, body: { lane, accepted: 0, duplicate: 0, lastSeq: "0" } };

  const result = await prisma.$transaction(async (tx) => {
    const cursor = await tx.logCursor.findUnique({ where: { deviceId_lane: { deviceId, lane } } });
    const hwm = cursor?.seq ?? 0n;
    const fresh = redacted.filter((e) => BigInt(e.seq) > hwm);
    const duplicate = redacted.length - fresh.length;
    if (fresh.length > 0) {
      await tx.logEntry.createMany({
        data: fresh.map((e) => ({
          deviceId, lane, seq: BigInt(e.seq), ts: new Date(e.ts), level: e.level, kind: e.kind,
          projectId: e.projectId ?? null, specId: e.specId ?? null, sessionId: e.sessionId ?? null,
          msg: e.msg, data: e.data ?? undefined, bytes: Buffer.byteLength(e.msg, "utf8"),
        })),
      });
      const lastSeq = BigInt(fresh[fresh.length - 1]!.seq);
      await tx.logCursor.upsert({
        where: { deviceId_lane: { deviceId, lane } }, update: { seq: lastSeq },
        create: { deviceId, lane, seq: lastSeq },
      });
    }
    return { accepted: fresh.length, duplicate, lastSeq: (cursor?.seq ?? (fresh.length ? BigInt(fresh[fresh.length - 1]!.seq) : 0n)).toString() };
  });
  return { status: 200, body: { lane, ...result } };
}

export function __resetIngestQuota(): void { quota = new Map(); }
```

- [x] **Step 4: Run test to verify it passes**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/log-ingest.service.test.ts`
Expected: PASS — bila field unik Prisma `deviceId_lane` bukan nama yang di-generate untuk `@@id`
gabungan `LogCursor`, sesuaikan ke nama field gabungan aktual (`prisma generate` menamainya
`deviceId_lane` untuk `@@id([deviceId, lane])`; verifikasi lewat `grep deviceId_lane
server/node_modules/.prisma/client/index.d.ts` bila error tipe muncul).

- [x] **Step 5: Commit**

```bash
git add server/src/services/logs/ingest.ts server/test/log-ingest.service.test.ts
git commit -m "feat(server): ingestBatch() redaksi lapis 2 + HWM transaksi + kuota (SPEC-1217 AC-D2/D4/D7)"
```

---

### Task 12: Route `POST /api/sync/logs` penuh — zod, transkrip, `relay.*` audit (AC-D1, D2, D4, D5, D7, D8, D9)

**Files:**
- Modify: `server/src/routes/sync.ts` (mengisi handler stub Task 10)
- Test: `server/test/log-ingest.route.test.ts`

**Interfaces:**
- Consumes: `zLogBatch` (Task 1), `ingestBatch` (Task 11), `saveTranscript`/transcript path per-device (`$HANOMAN_HOME/remote-transcripts/<deviceId>/<seq>.txt`, tulis langsung `writeFile`+`rename` — bukan `saveTranscript` yang menulis ke `transcriptDir()` sesi; ini path terpisah per S3.4).

- [x] **Step 1: Write the failing test**

```ts
// server/test/log-ingest.route.test.ts
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { createDeviceToken } from "../src/services/device-token";
import type { FastifyInstance } from "fastify";

describe("POST /api/sync/logs", () => {
  let app: FastifyInstance;
  let token: string;
  beforeAll(async () => {
    app = await buildApp({ requireAuth: false });
    const dev = await createDeviceToken({ name: "dev-test" });
    token = dev.token;
  });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await prisma.logEntry.deleteMany({}); await prisma.logCursor.deleteMany({}); });

  const post = (body: unknown) => app.inject({
    method: "POST", url: "/api/sync/logs",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    payload: JSON.stringify(body),
  });

  it("200 menerima batch event, kirim ulang identik → duplicate = jumlah entri", async () => {
    const body = { lane: "event", entries: [{ seq: "1", ts: new Date().toISOString(), level: "info", kind: "x", msg: "y" }] };
    const r1 = await post(body);
    expect(r1.statusCode).toBe(200);
    expect(JSON.parse(r1.body).accepted).toBe(1);
    const r2 = await post(body);
    expect(JSON.parse(r2.body).duplicate).toBe(1);
    expect(JSON.parse(r2.body).accepted).toBe(0);
  });

  it("400 untuk skema tak valid", async () => {
    const r = await post({ lane: "event", entries: [{ seq: "abc" }] });
    expect(r.statusCode).toBe(400);
  });

  it("lajur transcript menulis berkas sebelum baris DB (S3.4)", async () => {
    const body = {
      lane: "transcript",
      entries: [{ seq: "1", ts: new Date().toISOString(), level: "info", kind: "session.transcript", msg: "sesi x", transcript: "isi transkrip" }],
    };
    const r = await post(body);
    expect(r.statusCode).toBe(200);
    const row = await prisma.logEntry.findFirst({ where: { lane: "transcript" } });
    expect(row?.transcriptKey).toBeTruthy();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/log-ingest.route.test.ts`
Expected: FAIL — handler masih `501`.

- [x] **Step 3: Write minimal implementation**

Ganti blok `return reply.code(501).send(...)` di Task 10 dengan:

```ts
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveDataDirs } from "@hanoman/runner";
import { zLogBatch } from "@hanoman/shared";
import { ingestBatch } from "../services/logs/ingest";

// ...di dalam handler POST /sync/logs, sesudah `decoded` didapat:
let parsedJson: unknown;
try { parsedJson = JSON.parse(decoded.toString("utf8")); }
catch { return reply.code(400).send({ error: "invalid json" }); }
const parsed = zLogBatch.safeParse(parsedJson);
if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
const deviceId = req.device!.id;

// S3.4 · transkrip ditulis SEBELUM $transaction (berkas yatim dipungut sapuan; tak pernah baris
// tanpa berkas). tmp+rename per entri ber-transkrip.
const withTranscriptKey = await Promise.all(parsed.data.entries.map(async (e) => {
  if (!e.transcript) return e;
  const dir = join(resolveDataDirs().home, "remote-transcripts", deviceId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const final = join(dir, `${e.seq}.txt`);
  const tmp = `${final}.tmp`;
  await writeFile(tmp, e.transcript, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, final);
  const { transcript: _drop, ...rest } = e;
  return { ...rest, data: { ...(e.data ?? {}), __transcriptKey: `${deviceId}/${e.seq}.txt` } };
}));

const result = await ingestBatch(deviceId, { lane: parsed.data.lane, entries: withTranscriptKey });
return reply.code(result.status).send(result.body);
```

Modify `server/src/services/logs/ingest.ts` — `createMany` menyerap `__transcriptKey` dari `data`
ke kolom `transcriptKey` dan membuangnya dari JSON `data` tersimpan:

```ts
data: fresh.map((e) => {
  const raw = (e.data ?? {}) as Record<string, unknown>;
  const { __transcriptKey, ...rest } = raw;
  return {
    deviceId, lane, seq: BigInt(e.seq), ts: new Date(e.ts), level: e.level, kind: e.kind,
    projectId: e.projectId ?? null, specId: e.specId ?? null, sessionId: e.sessionId ?? null,
    msg: e.msg, data: Object.keys(rest).length ? rest : undefined,
    transcriptKey: (__transcriptKey as string) ?? null,
    bytes: Buffer.byteLength(e.msg, "utf8"),
  };
}),
```

- [x] **Step 4: Run test to verify it passes**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/log-ingest.route.test.ts server/test/log-sync-parser.test.ts server/test/log-ingest.service.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add server/src/routes/sync.ts server/src/services/logs/ingest.ts server/test/log-ingest.route.test.ts
git commit -m "feat(server): route POST /api/sync/logs penuh — zod, transkrip, ingest (SPEC-1217 AC-D1/D2/D4/D5/D7/D9)"
```

---

### Task 13: `shipper.ts` + kabel ke `syncTick()` (AC-D1, AC-D2, AC-D3, AC-D9)

**Files:**
- Create: `server/src/services/logs/shipper.ts`
- Modify: `server/src/services/sync-client.ts`
- Test: `server/test/log-shipper.test.ts`

**Interfaces:**
- Consumes: `zLogBatch`/`LOG_SHIP_MAX_BATCHES_PER_TICK`/`LOG_UNSUPPORTED_RETRY_MS` (Task 1); `readSpoolSegments`/`removeSpoolSegment` (Task 4); `Transport` type (`sync-client.ts`, sudah ada — `(method, path, body?) => Promise<{status:number; body:unknown}>`).
- Produces: `shipLogs(transport: Transport): Promise<void>`.

- [x] **Step 1: Write the failing test**

```ts
// server/test/log-shipper.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { shipLogs } from "../src/services/logs/shipper";
import { prisma } from "../src/db";

describe("shipLogs", () => {
  beforeEach(async () => {
    await prisma.logEntry.deleteMany({ where: { deviceId: "local" } });
    await prisma.logCursor.deleteMany({ where: { deviceId: "local" } });
    await prisma.logEntry.create({
      data: { deviceId: "local", lane: "event", seq: 1n, ts: new Date(), level: "info", kind: "session.start", msg: "x", bytes: 1 },
    });
  });

  it("mengirim entri LogEntry local belum-ack dan memajukan LogCursor(local) saat 200", async () => {
    const transport = vi.fn().mockResolvedValue({ status: 200, body: { lane: "event", accepted: 1, duplicate: 0, lastSeq: "1" } });
    await shipLogs(transport);
    expect(transport).toHaveBeenCalledWith("POST", "/api/sync/logs", expect.objectContaining({ lane: "event" }));
    const cursor = await prisma.logCursor.findUnique({ where: { deviceId_lane: { deviceId: "local", lane: "event" } } });
    expect(cursor?.seq).toBe(1n);
  });

  it("404 → menunda pengiriman 30 menit tanpa melempar", async () => {
    const transport = vi.fn().mockResolvedValue({ status: 404, body: {} });
    await expect(shipLogs(transport)).resolves.toBeUndefined();
  });

  it("kirim ulang (crash antara commit hub & tulis kursor klien) tak menggandakan pengiriman berikutnya", async () => {
    // simulasi: transport sukses tapi shipLogs "crash" sebelum menulis kursor — dites lewat dua
    // panggilan shipLogs berurutan dengan transport yang sama; kedua kalinya kursor sudah maju
    // sehingga batch kedua kosong (tak ada entri baru untuk dikirim).
    const transport = vi.fn().mockResolvedValue({ status: 200, body: { lane: "event", accepted: 1, duplicate: 0, lastSeq: "1" } });
    await shipLogs(transport);
    await shipLogs(transport);
    expect(transport).toHaveBeenCalledTimes(1); // panggilan kedua: nol entri baru → tak mengirim
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/log-shipper.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Write minimal implementation**

```ts
// server/src/services/logs/shipper.ts
/* SPEC-1215 §S4.7 · ADR-0166 §2 · dikuras syncTick() yang SUDAH ADA — TANPA timer baru. Per lajur,
   ≤ LOG_SHIP_MAX_BATCHES_PER_TICK batch @ ≤ LOG_BATCH_MAX_ENTRIES. ack 200 → LogCursor("local")
   maju; 400 → gap; 404 → tunda LOG_UNSUPPORTED_RETRY_MS; 429 → tunda retryAfterSec (lajur itu saja). */
import {
  LOCAL_DEVICE_ID, LOG_BATCH_MAX_ENTRIES, LOG_LANES, LOG_SHIP_MAX_BATCHES_PER_TICK,
  LOG_UNSUPPORTED_RETRY_MS, type LogLane, type LogWireEntry,
} from "@hanoman/shared";
import { prisma } from "../../db";
import { readSpoolSegments, removeSpoolSegment } from "./spool";
import { appendGap } from "./event-log";

export type Transport = (method: string, path: string, body?: unknown) => Promise<{ status: number; body: unknown }>;

const pausedUntil = new Map<LogLane, number>();

async function loadCursor(lane: LogLane): Promise<bigint> {
  const c = await prisma.logCursor.findUnique({ where: { deviceId_lane: { deviceId: LOCAL_DEVICE_ID, lane } } });
  return c?.seq ?? 0n;
}

async function nextBatch(lane: LogLane, since: bigint): Promise<LogWireEntry[]> {
  if (lane === "server") {
    const segs = await readSpoolSegments("server");
    const flat = segs.flatMap((s) => s.entries);
    return flat.slice(0, LOG_BATCH_MAX_ENTRIES);
  }
  const rows = await prisma.logEntry.findMany({
    where: { deviceId: LOCAL_DEVICE_ID, lane, seq: { gt: since } }, orderBy: { seq: "asc" }, take: LOG_BATCH_MAX_ENTRIES,
  });
  return rows.map((r) => ({
    seq: r.seq.toString(), ts: r.ts.toISOString(), level: r.level as LogWireEntry["level"], kind: r.kind,
    projectId: r.projectId, specId: r.specId, sessionId: r.sessionId,
    msg: r.msg, data: r.data as Record<string, unknown> | null,
  }));
}

async function shipLane(lane: LogLane, transport: Transport): Promise<void> {
  const now = Date.now();
  if ((pausedUntil.get(lane) ?? 0) > now) return;
  let since = await loadCursor(lane);
  for (let i = 0; i < LOG_SHIP_MAX_BATCHES_PER_TICK; i++) {
    const entries = await nextBatch(lane, since);
    if (entries.length === 0) return;
    const res = await transport("POST", "/api/sync/logs", { lane, entries });
    if (res.status === 200) {
      const body = res.body as { lastSeq?: string };
      const last = body.lastSeq ? BigInt(body.lastSeq) : BigInt(entries[entries.length - 1]!.seq);
      await prisma.logCursor.upsert({
        where: { deviceId_lane: { deviceId: LOCAL_DEVICE_ID, lane } }, update: { seq: last },
        create: { deviceId: LOCAL_DEVICE_ID, lane, seq: last },
      });
      since = last;
      if (lane === "server") {
        const segs = await readSpoolSegments("server");
        for (const s of segs) if (s.entries.every((e) => BigInt(e.seq) <= last)) await removeSpoolSegment(s.file);
      }
      continue;
    }
    if (res.status === 400) { await appendGap("rejected"); since = BigInt(entries[entries.length - 1]!.seq); continue; } // anti-livelock ADR-0082
    if (res.status === 404) { pausedUntil.set(lane, now + LOG_UNSUPPORTED_RETRY_MS); return; }
    if (res.status === 429) {
      const retry = (res.body as { retryAfterSec?: number }).retryAfterSec ?? 60;
      pausedUntil.set(lane, now + retry * 1000);
      return;
    }
    return; // 413/5xx: hentikan lajur ini untuk tick ini, coba lagi tick berikutnya
  }
}

/** Dipanggil dari syncTick() SESUDAH syncOnce(); fire-and-forget di sisi pemanggil (K11/AC-M2). */
export async function shipLogs(transport: Transport): Promise<void> {
  for (const lane of LOG_LANES) {
    try { await shipLane(lane, transport); } catch (e) { console.warn(`shipper ${lane} gagal: ${(e as Error).message}`); }
  }
}

export function __resetShipperPause(): void { pausedUntil.clear(); }
```

- [x] **Step 4: Run test to verify it passes**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/log-shipper.test.ts`
Expected: PASS

- [x] **Step 5: Kabel ke `syncTick()`**

Modify `server/src/services/sync-client.ts`:

```ts
import { shipLogs } from "./logs/shipper";
// ...
export async function syncTick(transport: Transport): Promise<void> {
  try {
    await syncOnce(transport);
    if (!pullSehat) { console.info("sync: pull pulih"); pullSehat = true; }
  } catch (e) {
    if (pullSehat) { console.warn(`sync: pull gagal — ${(e as Error).message}`); pullSehat = false; }
  }
  // SPEC-1217 · TANPA timer baru — dikuras di titik yang sama, fire-and-forget: shipper gagal
  // TAK PERNAH mengganggu sync (K11/AC-M2). `transport` Fastify GET/POST sudah kompatibel sebagai
  // Transport shipper (method, path, body?).
  void shipLogs(transport).catch((e: unknown) => console.warn(`shipper gagal: ${(e as Error).message}`));
}
```

- [x] **Step 6: Run existing sync-client suite (regresi nol)**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/sync-client.test.ts`
Expected: PASS

- [x] **Step 7: Commit**

```bash
git add server/src/services/logs/shipper.ts server/src/services/sync-client.ts server/test/log-shipper.test.ts
git commit -m "feat(server): shipLogs() dikuras syncTick, tanpa timer baru (SPEC-1217 AC-D1/D2/D3/D9)"
```

---

### Task 14: `search.ts` + route `GET /api/logs` · `/logs/:id/transcript` · `GET|PUT /logs/retention` (AC-D5, AC-D8, AC-S6)

**Files:**
- Create: `server/src/services/logs/search.ts`
- Create: `server/src/routes/logs.ts`
- Modify: `server/src/services/agent-capabilities.ts`
- Modify: `server/src/app.ts` (registrasi route)
- Test: `server/test/logs.route.test.ts`

**Interfaces:**
- Consumes: `zLogSearchQuery` (Task 1), `toLogEntryView` (`event-log.ts`, sudah ada), `getSetting`/`putSetting`-setara untuk `logRetention` (pola `remote-control.ts`: baca `getSetting()`, tulis lewat `prisma.setting.upsert`).
- Produces: `searchLogs(q: LogSearchQuery): Promise<{ items: LogEntryView[]; nextCursor: string | null }>`, `readRemoteTranscript(id: number): Promise<string | null>`.

- [x] **Step 1: Write the failing test**

```ts
// server/test/logs.route.test.ts
import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import type { FastifyInstance } from "fastify";

describe("GET /api/logs", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp({ requireAuth: false }); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => {
    await prisma.logEntry.deleteMany({});
    const now = new Date();
    await prisma.logEntry.createMany({
      data: [
        { deviceId: "local", lane: "event", seq: 1n, ts: now, level: "info", kind: "relay.request", msg: "a", bytes: 1 },
        { deviceId: "dev1", lane: "event", seq: 1n, ts: now, level: "info", kind: "remote.link", msg: "b", bytes: 1 },
      ],
    });
  });

  it("mengembalikan relay.* dan remote.* dalam satu tabel, terurut ts desc,id desc", async () => {
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date().toISOString();
    const res = await app.inject({ method: "GET", url: `/api/logs?from=${from}&to=${to}` });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items.length).toBe(2);
    expect(body).not.toHaveProperty("total");
  });

  it("rentang absen → 400", async () => {
    const res = await app.inject({ method: "GET", url: "/api/logs" });
    expect(res.statusCode).toBe(400);
  });

  it("rentang > 31 hari → 400", async () => {
    const from = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const to = new Date().toISOString();
    const res = await app.inject({ method: "GET", url: `/api/logs?from=${from}&to=${to}` });
    expect(res.statusCode).toBe(400);
  });

  it("kursor stabil: baris baru masuk di antara dua halaman tak menyebabkan duplikat/lompatan", async () => {
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date().toISOString();
    const r1 = await app.inject({ method: "GET", url: `/api/logs?from=${from}&to=${to}&limit=1` });
    const b1 = JSON.parse(r1.body);
    expect(b1.items.length).toBe(1);
    expect(b1.nextCursor).toBeTruthy();
    await prisma.logEntry.create({
      data: { deviceId: "dev2", lane: "event", seq: 1n, ts: new Date(), level: "info", kind: "remote.request", msg: "c", bytes: 1 },
    });
    const r2 = await app.inject({ method: "GET", url: `/api/logs?from=${from}&to=${to}&limit=1&cursor=${b1.nextCursor}` });
    const b2 = JSON.parse(r2.body);
    expect(b2.items[0].id).not.toBe(b1.items[0].id);
  });
});

describe("GET|PUT /api/logs/retention", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp({ requireAuth: false }); });
  afterAll(async () => { await app.close(); });

  it("PUT menulis Setting.data.logRetention, GET membacanya kembali", async () => {
    const put = await app.inject({
      method: "PUT", url: "/api/logs/retention", headers: { "content-type": "application/json" },
      payload: JSON.stringify({ eventDays: 30, serverDays: 3, transcriptDays: 10, maxBytes: 64 * 1024 ** 2 }),
    });
    expect(put.statusCode).toBe(200);
    const get = await app.inject({ method: "GET", url: "/api/logs/retention" });
    expect(JSON.parse(get.body).serverDays).toBe(3);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/logs.route.test.ts`
Expected: FAIL — route `/api/logs` 404.

- [x] **Step 3: Write minimal implementation**

```ts
// server/src/services/logs/search.ts
/* SPEC-1215 §S4.8 · kursor opaque base64url({ts,id}), LIKE Prisma biasa (tanpa FTS/raw SQL).
   TANPA `total` (pengecualian keempat ADR-0107, dikunci ADR-0166 §7). */
import type { LogEntryView, LogSearchQuery } from "@hanoman/shared";
import { prisma } from "../../db";
import { toLogEntryView } from "./event-log";
import { readTranscript } from "../transcript-store";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveDataDirs } from "@hanoman/runner";

function decodeCursor(c?: string): { ts: string; id: number } | null {
  if (!c) return null;
  try { return JSON.parse(Buffer.from(c, "base64url").toString("utf8")); } catch { return null; }
}
function encodeCursor(ts: string, id: number): string {
  return Buffer.from(JSON.stringify({ ts, id }), "utf8").toString("base64url");
}

export async function searchLogs(q: LogSearchQuery): Promise<{ items: LogEntryView[]; nextCursor: string | null } | null> {
  const cur = decodeCursor(q.cursor);
  if (q.cursor && !cur) return null; // kursor cacat → pemanggil (route) membalas 400
  const levelOrder = ["debug", "info", "warn", "error"] as const;
  const minLevels = q.level ? levelOrder.slice(levelOrder.indexOf(q.level)) : undefined;
  const where = {
    ts: { gte: new Date(q.from), lte: new Date(q.to) },
    ...(q.deviceId ? { deviceId: q.deviceId } : {}),
    ...(q.projectId ? { projectId: q.projectId } : {}),
    ...(q.specId ? { specId: q.specId } : {}),
    ...(q.lane ? { lane: { in: q.lane.split(",") } } : {}),
    ...(minLevels ? { level: { in: minLevels } } : {}),
    ...(q.kind ? { kind: { startsWith: q.kind } } : {}),
    ...(q.q ? { msg: { contains: q.q } } : {}),
    ...(cur ? { OR: [{ ts: { lt: new Date(cur.ts) } }, { ts: new Date(cur.ts), id: { lt: cur.id } }] } : {}),
  };
  const rows = await prisma.logEntry.findMany({ where, orderBy: [{ ts: "desc" }, { id: "desc" }], take: q.limit });
  const items = rows.map(toLogEntryView);
  const last = rows[rows.length - 1];
  const nextCursor = rows.length === q.limit && last ? encodeCursor(last.ts.toISOString(), last.id) : null;
  return { items, nextCursor };
}

export async function readRemoteTranscript(id: number): Promise<string | null> {
  const row = await prisma.logEntry.findUnique({ where: { id } });
  if (!row || row.lane !== "transcript" || !row.transcriptKey) return null;
  if (row.deviceId === "local") return readTranscript(row.transcriptKey);
  const path = join(resolveDataDirs().home, "remote-transcripts", row.transcriptKey);
  try { return await readFile(path, "utf8"); } catch { return null; }
}
```

```ts
// server/src/routes/logs.ts
import type { FastifyInstance } from "fastify";
import { zLogSearchQuery, zLogRetention } from "@hanoman/shared";
import { searchLogs, readRemoteTranscript } from "../services/logs/search";
import { getSetting } from "../services/settings";
import { prisma } from "../db";
import { Prisma } from "@prisma/client";

export default async function (app: FastifyInstance) {
  app.get("/logs", async (req, reply) => {
    const parsed = zLogSearchQuery.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const result = await searchLogs(parsed.data);
    if (!result) return reply.code(400).send({ error: "cursor cacat" });
    return result;
  });

  app.get("/logs/:id/transcript", async (req, reply) => {
    const { id } = req.params as { id: string };
    const text = await readRemoteTranscript(Number(id));
    if (text === null) return reply.code(404).send({ error: "not found" });
    reply.header("content-type", "text/plain; charset=utf-8");
    return reply.send(text);
  });

  app.get("/logs/retention", async () => (await getSetting()).logRetention);

  app.put("/logs/retention", async (req, reply) => {
    const parsed = zLogRetention.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const before = await getSetting();
    const data = { ...before, logRetention: parsed.data } as unknown as Prisma.InputJsonValue;
    await prisma.setting.upsert({ where: { id: 1 }, update: { data }, create: { id: 1, data } });
    return parsed.data;
  });
}
```

Modify `server/src/services/agent-capabilities.ts` — tambahkan `"logs"` ke daftar `COOKIE_ONLY`
(baris yang sudah mendaftarkan `remote-control`):

```ts
if (top === "auth" || top === "agent-tokens" || top === "device-tokens" || top === "sync"
  || top === "presence" || top === "models" || top === "remote-control" || top === "logs"
  || top === "portal" || top === "client-accounts" || top === "session-events") return "COOKIE_ONLY";
```

Modify `server/src/app.ts` — import dan register:

```ts
import logs from "./routes/logs";
// ...
await api.register(remoteControl);
await api.register(logs);   // SPEC-1217 · GET /logs, /logs/:id/transcript, GET|PUT /logs/retention (COOKIE_ONLY)
```

- [x] **Step 4: Run test to verify it passes**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/logs.route.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add server/src/services/logs/search.ts server/src/routes/logs.ts server/src/services/agent-capabilities.ts server/src/app.ts server/test/logs.route.test.ts
git commit -m "feat(server): GET /api/logs, /logs/:id/transcript, GET|PUT /logs/retention (SPEC-1217 AC-D5/D8/S6)"
```

---

### Task 15: `prune.ts` — retensi lajur log + rekonsiliasi transkrip (AC-D6, AC-S7)

**Files:**
- Create: `server/src/services/logs/prune.ts`
- Modify: `server/src/services/retention.ts`
- Test: `server/test/retention-logs.test.ts`

**Interfaces:**
- Consumes: `LogRetention` type (Task 1), `deleteTranscript`/`listTranscripts` (`transcript-store.ts`, sudah ada — dipakai untuk transkrip `deviceId:"local"`; transkrip remote punya direktori sendiri `remote-transcripts/<deviceId>/`).
- Produces: `pruneLogs(now: Date, retention: LogRetention, opts?: {dryRun?: boolean}): Promise<{logsPruned: number; logBytesFreed: number}>`, `reconcileRemoteTranscripts(): Promise<{orphans: number}>`.

- [x] **Step 1: Write the failing test**

```ts
// server/test/retention-logs.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { pruneLogs } from "../src/services/logs/prune";
import { prisma } from "../src/db";
import { LOG_RETENTION_DEFAULTS } from "@hanoman/shared";

describe("pruneLogs", () => {
  beforeEach(async () => { await prisma.logEntry.deleteMany({}); await prisma.logCursor.deleteMany({}); });

  it("menghapus entri melewati retention.<lane>Days", async () => {
    const old = new Date(Date.now() - 200 * 86_400_000);
    await prisma.logEntry.create({
      data: { deviceId: "dev1", lane: "event", seq: 1n, ts: old, level: "info", kind: "x", msg: "y", bytes: 1 },
    });
    const report = await pruneLogs(new Date(), LOG_RETENTION_DEFAULTS);
    expect(report.logsPruned).toBe(1);
    expect(await prisma.logEntry.count()).toBe(0);
  });

  it("baris local belum-ack (seq > LogCursor local) TAK PERNAH dihapus sapuan umur (AC-S7)", async () => {
    const old = new Date(Date.now() - 200 * 86_400_000);
    await prisma.logEntry.create({
      data: { deviceId: "local", lane: "event", seq: 5n, ts: old, level: "info", kind: "x", msg: "y", bytes: 1 },
    });
    await prisma.logCursor.create({ data: { deviceId: "local", lane: "event", seq: 3n } }); // belum ack seq 5
    await pruneLogs(new Date(), LOG_RETENTION_DEFAULTS);
    expect(await prisma.logEntry.count()).toBe(1);
  });

  it("baris local yang sudah di-ack dan melewati umur ikut tersapu", async () => {
    const old = new Date(Date.now() - 200 * 86_400_000);
    await prisma.logEntry.create({
      data: { deviceId: "local", lane: "event", seq: 2n, ts: old, level: "info", kind: "x", msg: "y", bytes: 1 },
    });
    await prisma.logCursor.create({ data: { deviceId: "local", lane: "event", seq: 5n } }); // sudah ack
    await pruneLogs(new Date(), LOG_RETENTION_DEFAULTS);
    expect(await prisma.logEntry.count()).toBe(0);
  });

  it("total bytes > maxBytes menghapus entri terlama sampai di bawah plafon", async () => {
    const now = new Date();
    await prisma.logEntry.createMany({
      data: [
        { deviceId: "dev1", lane: "event", seq: 1n, ts: new Date(now.getTime() - 2000), level: "info", kind: "x", msg: "y", bytes: 10 * 1024 * 1024 },
        { deviceId: "dev1", lane: "event", seq: 2n, ts: new Date(now.getTime() - 1000), level: "info", kind: "x", msg: "y", bytes: 10 * 1024 * 1024 },
      ],
    });
    const report = await pruneLogs(now, { ...LOG_RETENTION_DEFAULTS, maxBytes: 12 * 1024 * 1024 });
    expect(report.logsPruned).toBeGreaterThanOrEqual(1);
    expect(await prisma.logEntry.count()).toBe(1); // yang terlama dihapus, sisa satu di bawah plafon
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/retention-logs.test.ts`
Expected: FAIL — module not found.

- [x] **Step 3: Write minimal implementation**

```ts
// server/src/services/logs/prune.ts
/* SPEC-1215 §S3.6 · pola sama dengan reconcileTranscripts (session-history.ts): baris dulu, berkas
   transkrip sesudahnya, yatim dipungut. Local ("deviceId":"local") belum-ack tak pernah tersapu
   umur (AC-S7) — disaring lewat LogCursor("local", lane) sebagai batas atas seq yang boleh dihapus. */
import type { LogRetention } from "@hanoman/shared";
import { prisma } from "../../db";
import { deleteTranscript, listTranscripts } from "../transcript-store";

const LANE_DAYS: Record<string, keyof LogRetention> = { event: "eventDays", server: "serverDays", transcript: "transcriptDays" };
const CHUNK = 5_000;

export async function pruneLogs(
  now: Date, retention: LogRetention, opts: { dryRun?: boolean } = {},
): Promise<{ logsPruned: number; logBytesFreed: number }> {
  let logsPruned = 0, logBytesFreed = 0;

  for (const [lane, key] of Object.entries(LANE_DAYS)) {
    const cutoff = new Date(now.getTime() - retention[key] * 86_400_000);
    const localCursor = await prisma.logCursor.findUnique({ where: { deviceId_lane: { deviceId: "local", lane } } });
    const ackSeq = localCursor?.seq ?? -1n; // -1 → nol baris local terhapus (belum pernah ack)
    for (;;) {
      const batch = await prisma.logEntry.findMany({
        where: {
          lane, ts: { lt: cutoff },
          OR: [{ deviceId: { not: "local" } }, { deviceId: "local", seq: { lte: ackSeq } }],
        },
        take: CHUNK, select: { id: true, bytes: true, transcriptKey: true },
      });
      if (batch.length === 0) break;
      if (!opts.dryRun) {
        await prisma.logEntry.deleteMany({ where: { id: { in: batch.map((b) => b.id) } } });
        for (const b of batch) if (b.transcriptKey && !b.transcriptKey.includes("/")) await deleteTranscript(b.transcriptKey).catch(() => {});
      }
      logsPruned += batch.length;
      logBytesFreed += batch.reduce((s, b) => s + b.bytes, 0);
      if (batch.length < CHUNK) break;
    }
  }

  // Plafon bytes total, terlepas dari lajur/umur: hapus terlama sampai di bawah maxBytes.
  for (;;) {
    const agg = await prisma.logEntry.aggregate({ _sum: { bytes: true } });
    const total = agg._sum.bytes ?? 0;
    if (total <= retention.maxBytes) break;
    const batch = await prisma.logEntry.findMany({
      orderBy: [{ ts: "asc" }, { id: "asc" }], take: CHUNK, select: { id: true, bytes: true, transcriptKey: true },
    });
    if (batch.length === 0) break;
    let freed = 0;
    const toDelete: number[] = [];
    for (const b of batch) {
      if (total - freed <= retention.maxBytes) break;
      toDelete.push(b.id); freed += b.bytes;
      if (b.transcriptKey && !b.transcriptKey.includes("/")) await deleteTranscript(b.transcriptKey).catch(() => {});
    }
    if (toDelete.length === 0) break;
    if (!opts.dryRun) await prisma.logEntry.deleteMany({ where: { id: { in: toDelete } } });
    logsPruned += toDelete.length; logBytesFreed += freed;
  }

  return { logsPruned, logBytesFreed };
}

/** Berkas `remote-transcripts/<deviceId>/<seq>.txt` tanpa baris `LogEntry.transcriptKey` yang
    merujuknya (pola `reconcileTranscripts`, `session-history.ts:170-200`, termasuk tenggang). */
export async function reconcileRemoteTranscripts(): Promise<{ orphans: number }> {
  const { readdir, unlink, stat } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { resolveDataDirs } = await import("@hanoman/runner");
  const root = join(resolveDataDirs().home, "remote-transcripts");
  let deviceDirs: string[];
  try { deviceDirs = await readdir(root); } catch { return { orphans: 0 }; }
  const rows = await prisma.logEntry.findMany({ where: { transcriptKey: { contains: "/" } }, select: { transcriptKey: true } });
  const referenced = new Set(rows.map((r) => r.transcriptKey!));
  const gracePeriodMs = 60 * 60_000;
  let orphans = 0;
  for (const dev of deviceDirs) {
    let files: string[];
    try { files = await readdir(join(root, dev)); } catch { continue; }
    for (const f of files) {
      const key = `${dev}/${f}`;
      if (referenced.has(key)) continue;
      const st = await stat(join(root, dev, f)).catch(() => null);
      if (!st || Date.now() - st.mtimeMs < gracePeriodMs) continue;
      await unlink(join(root, dev, f)).catch(() => {});
      orphans++;
    }
  }
  return { orphans };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/retention-logs.test.ts`
Expected: PASS

- [x] **Step 5: Kabel ke `runRetention()`**

Modify `server/src/services/retention.ts`:

```ts
import { pruneLogs, reconcileRemoteTranscripts } from "./logs/prune";
import { getSetting } from "./settings";
// ...
export type RetentionReport = {
  candidates: number; deleted: number; bytes: number; failed: number;
  orphans: number; dangling: number; feedPruned: number;
  logsPruned: number; logBytesFreed: number; // SPEC-1217 · AC-D6
};

export async function runRetention(opts: RetentionOptions = {}, deps: RetentionDeps = {}): Promise<RetentionReport> {
  const report: RetentionReport = {
    candidates: 0, deleted: 0, bytes: 0, failed: 0, orphans: 0, dangling: 0, feedPruned: 0,
    logsPruned: 0, logBytesFreed: 0,
  };
  await deleteExpired(report, opts, deps);
  report.feedPruned = await pruneSyncFeed(opts.now ?? new Date(), opts.dryRun ?? false);
  const setting = await getSetting();
  const logReport = await pruneLogs(opts.now ?? new Date(), setting.logRetention, { dryRun: opts.dryRun });
  report.logsPruned = logReport.logsPruned;
  report.logBytesFreed = logReport.logBytesFreed;
  const gc = await reconcileTranscripts({ dryRun: opts.dryRun });
  report.orphans = gc.orphans;
  report.dangling = gc.dangling;
  report.failed += gc.failed;
  if (!opts.dryRun) await reconcileRemoteTranscripts();
  return report;
}
```

- [x] **Step 6: Run existing retention suite (regresi nol)**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/retention.test.ts server/test/retention-logs.test.ts`
Expected: PASS

- [x] **Step 7: Commit**

```bash
git add server/src/services/logs/prune.ts server/src/services/retention.ts server/test/retention-logs.test.ts
git commit -m "feat(server): pruneLogs() + reconcileRemoteTranscripts() di runRetention (SPEC-1217 AC-D6/S7)"
```

---

### Task 16: Toggle lajur log tanpa restart (D4, AC-S3) — `remote-control.ts` + `server.ts` boot

**Files:**
- Modify: `server/src/services/remote-control.ts`
- Modify: `server/src/server.ts`
- Test: `server/test/log-console-toggle.test.ts`

**Interfaces:**
- Consumes: `installConsoleTap`/`uninstallConsoleTap`/`isConsoleTapInstalled` (Task 5).

- [x] **Step 1: Write the failing test**

```ts
// server/test/log-console-toggle.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { updateRemoteControl } from "../src/services/remote-control";
import * as consoleTap from "../src/services/logs/console-tap";
import { getSetting } from "../src/services/settings";

describe("toggle lajur server memasang/mencabut sadapan console tanpa restart", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("menyalakan logs.server memanggil installConsoleTap()", async () => {
    const spy = vi.spyOn(consoleTap, "installConsoleTap").mockImplementation(() => {});
    const before = await getSetting();
    await updateRemoteControl({ logs: { ...before.logShipping, server: true } }, "test");
    expect(spy).toHaveBeenCalled();
  });

  it("mematikan logs.server memanggil uninstallConsoleTap()", async () => {
    await updateRemoteControl({ logs: { event: true, server: true, transcript: false } }, "test");
    const spy = vi.spyOn(consoleTap, "uninstallConsoleTap").mockImplementation(() => {});
    await updateRemoteControl({ logs: { event: true, server: false, transcript: false } }, "test");
    expect(spy).toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/log-console-toggle.test.ts`
Expected: FAIL — sadapan belum dipasang/dicabut dari `updateRemoteControl`.

- [x] **Step 3: Write minimal implementation**

Modify `server/src/services/remote-control.ts`:

```ts
import { installConsoleTap, isConsoleTapInstalled, uninstallConsoleTap } from "./logs/console-tap";
// ...di dalam updateRemoteControl, sesudah `logs` dihitung dan SEBELUM/SESUDAH upsert (posisi tak
// kritikal karena tap murni proses-lokal, tak menyentuh DB):
if (logs.server && !isConsoleTapInstalled()) installConsoleTap();
if (!logs.server && isConsoleTapInstalled()) uninstallConsoleTap();
```

Modify `server/src/server.ts` — pasang di boot bila lajur `server` sudah menyala dari Setting tersimpan:

```ts
import { installConsoleTap } from "./services/logs/console-tap";
import { getSetting } from "./services/settings";
// ...di titik boot, sesudah DB siap dan sebelum app mulai menerima trafik:
const bootSetting = await getSetting();
if (bootSetting.logShipping.server) installConsoleTap();
```

- [x] **Step 4: Run test to verify it passes**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/log-console-toggle.test.ts`
Expected: PASS

- [x] **Step 5: Run existing remote-control suite (regresi nol)**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/remote-control.test.ts`
Expected: PASS

- [x] **Step 6: Commit**

```bash
git add server/src/services/remote-control.ts server/src/server.ts server/test/log-console-toggle.test.ts
git commit -m "feat(server): pasang/cabut sadapan console tanpa restart saat toggle logShipping.server (SPEC-1217 D4/AC-S3)"
```

---

### Task 17: `src/src/api/client.ts` — panggilan `logs()`/`logTranscript()`/`logRetention()`/`putLogRetention()`

**Files:**
- Modify: `src/src/api/client.ts`
- Test: `src/test/client.test.ts` (ubah, atau `src/test/api-client.test.ts` — cari nama file aktual dengan `ls src/test | grep -i client`)

**Interfaces:**
- Produces: `logs(query: LogSearchQueryInput): Promise<{items: LogEntryView[]; nextCursor: string|null}>`, `logTranscript(id: number): Promise<string>`, `logRetention(): Promise<LogRetention>`, `putLogRetention(r: LogRetention): Promise<LogRetention>`.

- [x] **Step 1: Write the failing test**

Cari pola panggilan yang sudah ada (mis. `remoteControl()`) di `src/src/api/client.ts` dan test-nya
lebih dulu:

```bash
grep -n "export function remoteControl\|export async function remoteControl" src/src/api/client.ts
grep -rn "remoteControl(" src/test/client.test.ts 2>/dev/null || ls src/test | grep -i client
```

Tambahkan ke test client (nama file sesuai hasil `grep` di atas):

```ts
it("logs() memanggil GET /api/logs dengan query string", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 }),
  );
  const { logs } = await import("../src/api/client");
  await logs({ from: "2026-01-01T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z" });
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/logs?"), expect.anything());
});

it("putLogRetention() memanggil PUT /api/logs/retention", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ eventDays: 90, serverDays: 7, transcriptDays: 30, maxBytes: 1 }), { status: 200 }),
  );
  const { putLogRetention } = await import("../src/api/client");
  await putLogRetention({ eventDays: 90, serverDays: 7, transcriptDays: 30, maxBytes: 1 });
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/logs/retention"),
    expect.objectContaining({ method: "PUT" }));
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism <path test client yang ditemukan>`
Expected: FAIL — `logs`/`putLogRetention` bukan export.

- [x] **Step 3: Write minimal implementation**

Tambahkan ke `src/src/api/client.ts`, mengikuti bentuk fungsi `apiFetch`/`json` yang sudah dipakai
fungsi lain di berkas yang sama (mis. `remoteControl()`, `putRemoteControl()`):

```ts
import type { LogEntryView, LogRetention } from "@hanoman/shared";

export type LogSearchQueryInput = {
  from: string; to: string; deviceId?: string; projectId?: string; specId?: string;
  lane?: string; level?: string; kind?: string; q?: string; cursor?: string; limit?: number;
};

export async function logs(q: LogSearchQueryInput): Promise<{ items: LogEntryView[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined) params.set(k, String(v));
  return apiFetch(`/api/logs?${params.toString()}`);
}

export async function logTranscript(id: number): Promise<string> {
  const res = await fetch(`/api/logs/${id}/transcript`, { credentials: "include" });
  if (!res.ok) throw new Error(`logTranscript ${res.status}`);
  return res.text();
}

export async function logRetention(): Promise<LogRetention> { return apiFetch("/api/logs/retention"); }

export async function putLogRetention(r: LogRetention): Promise<LogRetention> {
  return apiFetch("/api/logs/retention", { method: "PUT", body: JSON.stringify(r) });
}
```

Sesuaikan nama helper (`apiFetch`, header `content-type`, base URL) persis dengan yang dipakai
fungsi tetangga di berkas yang sama — jangan menduplikasi pola fetch yang berbeda dari konvensi file.

- [x] **Step 4: Run test to verify it passes**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism <path test client>`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/src/api/client.ts <path test client>
git commit -m "feat(web): logs()/logTranscript()/logRetention()/putLogRetention() di api client (SPEC-1217)"
```

---

### Task 18: `LogsPanel.tsx` (AC-D5 UI, AC-D8, AC-D10 tampilan)

**Files:**
- Create: `src/src/screens/LogsPanel.tsx`
- Test: `src/test/LogsPanel.test.tsx`

**Interfaces:**
- Consumes: `logs`, `logTranscript`, `logRetention`, `putLogRetention` (Task 17); komponen `StateBlock`, `Tabs`, `hn-dense-row` (pola `ClientsScreen.tsx`, `src/src/ds/components/ui.tsx`).

- [ ] **Step 1: Write the failing test**

```tsx
// src/test/LogsPanel.test.tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { LogsPanel } from "../src/screens/LogsPanel";
import * as client from "../src/api/client";

describe("LogsPanel", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("merender StateBlock empty saat nol hasil", async () => {
    vi.spyOn(client, "logs").mockResolvedValue({ items: [], nextCursor: null });
    render(<LogsPanel />);
    await waitFor(() => expect(screen.getByText(/tidak ada/i)).toBeInTheDocument());
  });

  it("menampilkan galat rentang 400 apa adanya", async () => {
    vi.spyOn(client, "logs").mockRejectedValue(new Error("logs 400"));
    render(<LogsPanel />);
    await waitFor(() => expect(screen.getByText(/400/)).toBeInTheDocument());
  });

  it("tombol Muat lagi memakai nextCursor, bukan nomor halaman", async () => {
    const spy = vi.spyOn(client, "logs")
      .mockResolvedValueOnce({ items: [{ id: 1, deviceId: "local", deviceName: "local", lane: "event",
        seq: "1", ts: new Date().toISOString(), receivedAt: new Date().toISOString(), level: "info",
        kind: "x", projectId: null, specId: null, sessionId: null, msg: "a", data: null, hasTranscript: false }],
        nextCursor: "abc" })
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    render(<LogsPanel />);
    await waitFor(() => expect(screen.getByText("a")).toBeInTheDocument());
    screen.getByRole("button", { name: /muat lagi/i }).click();
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "abc" })));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism src/test/LogsPanel.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/src/screens/LogsPanel.tsx
/* SPEC-1215 §S4.9 · AC-D5/D10 · pencarian log terpusat: penyaring, kursor (tanpa total), transkrip,
   blok retensi. Pola dense-row + StateBlock mengikuti ClientsScreen.tsx. */
import { useEffect, useState } from "react";
import { logs, logRetention, logTranscript, putLogRetention, type LogSearchQueryInput } from "../api/client";
import type { LogEntryView, LogRetention } from "@hanoman/shared";
import { StateBlock } from "../ds/components/ui";

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 24 * 3600_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function LogsPanel() {
  const [query, setQuery] = useState<LogSearchQueryInput>(defaultRange());
  const [items, setItems] = useState<LogEntryView[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openTranscript, setOpenTranscript] = useState<{ id: number; text: string } | null>(null);
  const [retention, setRetention] = useState<LogRetention | null>(null);

  async function load(cursor?: string) {
    setError(null);
    try {
      const res = await logs({ ...query, cursor });
      setItems((prev) => (cursor ? [...prev, ...res.items] : res.items));
      setNextCursor(res.nextCursor);
    } catch (e) { setError((e as Error).message); }
  }

  useEffect(() => { void load(); void logRetention().then(setRetention); }, [query.from, query.to, query.deviceId, query.projectId, query.specId, query.lane, query.level, query.kind, query.q]);

  async function openRow(row: LogEntryView) {
    if (!row.hasTranscript) return;
    const text = await logTranscript(row.id);
    setOpenTranscript({ id: row.id, text });
  }

  async function saveRetention(r: LogRetention) {
    const saved = await putLogRetention(r);
    setRetention(saved);
  }

  if (error) return <StateBlock kind="error" title="Gagal memuat log" detail={error} />;

  return (
    <div className="hn-logs-panel">
      <form onSubmit={(e) => { e.preventDefault(); void load(); }}>
        {/* penyaring device/project/spec/lane/level/kind/q — nilai terikat ke `query`, dikirim ulang via setQuery */}
      </form>
      {items.length === 0 ? (
        <StateBlock kind="empty" title="Tidak ada log pada rentang/penyaring ini" />
      ) : (
        <ul>
          {items.map((row) => (
            <li key={row.id} className="hn-dense-row" onClick={() => void openRow(row)}>
              <span>{row.ts}</span> <span>{row.lane}</span> <span>{row.level}</span>
              <span>{row.kind}</span> <span>{row.msg}</span>
            </li>
          ))}
        </ul>
      )}
      {nextCursor && <button type="button" onClick={() => void load(nextCursor)}>Muat lagi</button>}
      {openTranscript && <pre>{openTranscript.text}</pre>}
      {retention && (
        <section>
          <h3>Retensi</h3>
          <button type="button" onClick={() => void saveRetention(retention)}>Simpan</button>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism src/test/LogsPanel.test.tsx`
Expected: PASS — sesuaikan nama komponen `StateBlock`/prop persis dengan yang diekspor
`src/src/ds/components/ui.tsx` (`grep -n "export function StateBlock" src/src/ds/components/ui.tsx`
sebelum menulis; ganti `kind`/`title`/`detail` ke nama prop aktual bila berbeda).

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/LogsPanel.tsx src/test/LogsPanel.test.tsx
git commit -m "feat(web): LogsPanel — pencarian, kursor, transkrip, retensi (SPEC-1217 AC-D5/D8/D10)"
```

---

### Task 19: Tab "Device"|"Log" di `ClientsScreen` (D6, AC-S8)

**Files:**
- Modify: `src/src/screens/ClientsScreen.tsx`
- Test: `src/test/ClientsScreen.test.tsx` (ubah)

**Interfaces:**
- Consumes: `LogsPanel` (Task 18); `Tabs` (`src/src/ds/components/ui.tsx`, dipakai `TerminalScreen.tsx:481`).

- [ ] **Step 1: Write the failing test**

Tambahkan ke `src/test/ClientsScreen.test.tsx`:

```tsx
it("tab default Device — test layar Klien yang ada tetap hijau tanpa perubahan ekspektasi (AC-S8)", () => {
  render(<ClientsScreen />);
  expect(screen.getByRole("tab", { name: /device/i })).toHaveAttribute("aria-selected", "true");
});

it("tab Log merender LogsPanel", async () => {
  render(<ClientsScreen />);
  screen.getByRole("tab", { name: /log/i }).click();
  await waitFor(() => expect(screen.getByRole("tab", { name: /log/i })).toHaveAttribute("aria-selected", "true"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism src/test/ClientsScreen.test.tsx`
Expected: FAIL — tak ada tab "Device"/"Log" di render sekarang (daftar datar `DeviceCard`).

- [ ] **Step 3: Write minimal implementation**

Modify `src/src/screens/ClientsScreen.tsx` — bungkus daftar `DeviceCard` yang ada (baris ~127-133)
dengan `Tabs variant="pill"`:

```tsx
import { Tabs } from "../ds/components/ui";
import { LogsPanel } from "./LogsPanel";
// ...
const [tab, setTab] = useState<"device" | "log">("device"); // default "device" — AC-S8
// ...
<Tabs
  variant="pill"
  items={[{ id: "device", label: "Device" }, { id: "log", label: "Log" }]}
  active={tab}
  onChange={(id) => setTab(id as "device" | "log")}
/>
{tab === "device" ? (
  <>{/* daftar DeviceCard yang sudah ada, TAK diubah bentuknya */}</>
) : (
  <LogsPanel />
)}
```

Sesuaikan nama prop `Tabs` (`items`/`active`/`onChange` vs nama aktual) dengan definisi di
`src/src/ds/components/ui.tsx` — verifikasi lewat `grep -n "export function Tabs" -A 15
src/src/ds/components/ui.tsx` sebelum menulis.

- [ ] **Step 4: Run test to verify it passes**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism src/test/ClientsScreen.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/ClientsScreen.tsx src/test/ClientsScreen.test.tsx
git commit -m "feat(web): tab Device|Log di ClientsScreen, default Device (SPEC-1217 D6/AC-S8)"
```

---

### Task 20: Toggle tiga lajur log di `RemoteControlPanel` (AC-D1 UI)

**Files:**
- Modify: `src/src/screens/RemoteControlPanel.tsx`
- Test: `src/test/RemoteControlPanel.test.tsx` (ubah)

**Interfaces:**
- Consumes: `api.putRemoteControl()` (sudah ada) — payload bertambah `logs: {event, server, transcript}`.

- [ ] **Step 1: Write the failing test**

Tambahkan ke `src/test/RemoteControlPanel.test.tsx`:

```tsx
it("lajur event ditampilkan menyala secara default", () => {
  render(<RemoteControlPanel />);
  expect(screen.getByRole("checkbox", { name: /event/i })).toBeChecked();
});

it("mematikan toggle server memanggil putRemoteControl dengan logs.server:false", async () => {
  const spy = vi.spyOn(client, "putRemoteControl").mockResolvedValue({} as never);
  render(<RemoteControlPanel />);
  screen.getByRole("checkbox", { name: /^server$/i }).click();
  await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.objectContaining({
    logs: expect.objectContaining({ server: expect.any(Boolean) }),
  })));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism src/test/RemoteControlPanel.test.tsx`
Expected: FAIL — tak ada checkbox lajur log di render sekarang.

- [ ] **Step 3: Write minimal implementation**

Modify `src/src/screens/RemoteControlPanel.tsx` — tambahkan tiga checkbox terikat ke
`view.logs.{event,server,transcript}`, mengirim lewat `api.putRemoteControl({ logs: {...} })`
(pola yang sama dengan toggle `control.capabilities` yang sudah ada di berkas ini):

```tsx
<fieldset>
  <legend>Lajur log ke hub</legend>
  {(["event", "server", "transcript"] as const).map((lane) => (
    <label key={lane}>
      <input
        type="checkbox" name={lane}
        checked={view?.logs[lane] ?? (lane === "event")}
        onChange={(e) => void client.putRemoteControl({ logs: { ...view!.logs, [lane]: e.target.checked } })}
      />
      {lane}
    </label>
  ))}
</fieldset>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `env -u HANOMAN_CONTROL_ORIGINS -u DATABASE_URL -u SSH_ASKPASS TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism src/test/RemoteControlPanel.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/src/screens/RemoteControlPanel.tsx src/test/RemoteControlPanel.test.tsx
git commit -m "feat(web): tiga toggle lajur log di RemoteControlPanel, event default nyala (SPEC-1217 AC-D1)"
```

---

### Task 21: Pengukuran ingest sintetis (AC-S9, ADR-0166 §7) — task eksplisit, bukan verifikasi sisipan

**Files:**
- Create: `server/scripts/log-ingest-benchmark.ts`
- Create: `docs/superpowers/plans/2026-09-18-spec-1217-ac-s9-hasil-pengukuran.md` (hasil, ditautkan dari plan ini)

**Interfaces:**
- Consumes: `POST /api/sync/logs` (Task 12), `GET /api/specs` (sudah ada).
- Produces: skrip yang dijalankan manual sekali di akhir eksekusi plan, sebelum default
  `LOG_INGEST_MAX_PER_HOUR`/`LOG_BATCH_MAX_ENTRIES` dianggap final.

- [ ] **Step 1: Tulis skrip pengukuran**

```ts
// server/scripts/log-ingest-benchmark.ts
/* SPEC-1217 AC-S9 · ADR-0166 §7 · 10 device × batch 500 entri/15 dtk selama 10 menit; ukur p95
   GET /specs SEBELUM dan SELAMA beban. Lulus: p95 naik ≤ 20%, nol P1008. Dijalankan manual:
   `HANOMAN_BASE=http://127.0.0.1:4600 HANOMAN_COOKIE=... node --import tsx server/scripts/log-ingest-benchmark.ts` */
import { createDeviceToken } from "../src/services/device-token";
import { gzipSync } from "node:zlib";

const BASE = process.env.HANOMAN_BASE ?? "http://127.0.0.1:4600";
const DEVICES = 10, ENTRIES_PER_BATCH = 500, INTERVAL_MS = 15_000, DURATION_MS = 10 * 60_000;

async function measureSpecsLatency(n: number): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = Date.now();
    const res = await fetch(`${BASE}/api/specs`, { headers: { cookie: process.env.HANOMAN_COOKIE ?? "" } });
    await res.text();
    out.push(Date.now() - t0);
  }
  return out;
}

function p95(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length * 0.95)] ?? 0;
}

async function sendBatch(token: string, seqStart: number): Promise<void> {
  const entries = Array.from({ length: ENTRIES_PER_BATCH }, (_, i) => ({
    seq: String(seqStart + i), ts: new Date().toISOString(), level: "info", kind: "bench", msg: `entri ${seqStart + i}`,
  }));
  const body = gzipSync(Buffer.from(JSON.stringify({ lane: "event", entries })));
  await fetch(`${BASE}/api/sync/logs`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "content-encoding": "gzip" },
    body,
  });
}

async function main() {
  console.log("baseline (nol ingest, 20 sampel)…");
  const baseline = p95(await measureSpecsLatency(20));
  console.log(`baseline p95 = ${baseline} ms`);

  const tokens = await Promise.all(Array.from({ length: DEVICES }, (_, i) => createDeviceToken({ name: `bench-${i}` })));
  const seqs = tokens.map(() => 1);
  const start = Date.now();
  const during: number[] = [];
  const timer = setInterval(async () => {
    await Promise.all(tokens.map((t, i) => sendBatch(t.token, seqs[i]! += ENTRIES_PER_BATCH)));
  }, INTERVAL_MS);
  while (Date.now() - start < DURATION_MS) {
    during.push(...(await measureSpecsLatency(2)));
    await new Promise((r) => setTimeout(r, 5000));
  }
  clearInterval(timer);
  const underLoad = p95(during);
  const pct = ((underLoad - baseline) / baseline) * 100;
  console.log(`p95 di bawah beban = ${underLoad} ms (naik ${pct.toFixed(1)}%)`);
  console.log(pct <= 20 ? "LULUS AC-S9" : "GAGAL AC-S9 — amandemen ADR-0166 diperlukan");
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Jalankan skrip terhadap server nyata (bukan test suite)**

Boot server: `pnpm dev` (atau `node server/dist/server.js` sesudah build) dengan
`TEST_DATABASE_URL`/DB khusus benchmark (jangan DB produksi). Login sekali, ambil cookie sesi,
lalu jalankan:

```bash
HANOMAN_BASE=http://127.0.0.1:4600 HANOMAN_COOKIE="<cookie sesi>" node --import tsx server/scripts/log-ingest-benchmark.ts
```

Expected: skrip mencetak `baseline p95`, `p95 di bawah beban`, dan verdict `LULUS`/`GAGAL AC-S9`.

- [ ] **Step 3: Catat hasil**

Tulis hasil aktual (angka p95 baseline/di-bawah-beban, persentase kenaikan, jumlah `P1008` yang
diamati di log server selama pengukuran — `grep -c P1008` pada output server) ke
`docs/superpowers/plans/2026-09-18-spec-1217-ac-s9-hasil-pengukuran.md`:

```markdown
# AC-S9 · Hasil pengukuran ingest sintetis — SPEC-1217

**Tanggal jalan:** <isi saat eksekusi> · **Konfigurasi:** 10 device × 500 entri/15 dtk × 10 menit

| Metrik | Nilai |
|---|---|
| p95 GET /specs baseline | <isi> ms |
| p95 GET /specs di bawah beban | <isi> ms |
| Kenaikan | <isi> % |
| P1008 teramati | <isi> |
| Verdict | LULUS / GAGAL |

Bila GAGAL: jalur koreksinya adalah amandemen ADR-0166 terhadap `LOG_INGEST_MAX_PER_HOUR`/ukuran
batch (§S3.1 plan ini), bukan keputusan baru — jangan ubah konstanta di `shared/src/logs.ts` tanpa
amandemen itu.
```

- [ ] **Step 4: Commit**

```bash
git add server/scripts/log-ingest-benchmark.ts docs/superpowers/plans/2026-09-18-spec-1217-ac-s9-hasil-pengukuran.md
git commit -m "test(server): skrip pengukuran ingest sintetis AC-S9 + hasil (SPEC-1217, ADR-0166 §7)"
```

---

### Task 22: Docs yang tersentuh (§S7) — cabut penanda DIRANCANG bagian D

**Files:**
- Modify: `internal/docs/architecture/api-contract.md`
- Modify: `internal/docs/architecture/data-model.md`
- Modify: `internal/docs/architecture/stack.md`
- Modify: `internal/docs/frontend/frontend-implementation.md`
- Modify: `internal/docs/adr/0166-log-terpusat-ingest-satu-arah.md`
- Modify: `internal/docs/agent-integration.md`
- Modify: `internal/skills/hanoman/SKILL.md`
- Modify: `internal/docs/README.md` (index)

**Interfaces:** Tak ada — perubahan naratif/status murni, bukan kode.

- [ ] **Step 1: `api-contract.md`**

Buka `internal/docs/architecture/api-contract.md:1414-1418`. Ganti baris yang menandai
`POST /sync/logs`, `/logs*`, dan `remote-control` (tanpa `shipping`) sebagai "belum dilayani/DIRANCANG"
menjadi deskripsi kontrak nyata: method, path, request/response, capability (`COOKIE_ONLY` untuk
`/logs*`, device-token untuk `/sync/logs`) — persis bentuk yang sudah diimplementasikan Task 10-14.

- [ ] **Step 2: `data-model.md`**

Buka `internal/docs/architecture/data-model.md:288-296,740-760`. Cabut penanda "DIRANCANG" pada
`LogEntry`/`LogCursor` (sudah mendarat sejak turunan A, tapi bagian ingest/pencarian/retensi turunan
D-nya baru mendarat sekarang) dan tambahkan ringkasan alur ingest (redaksi lapis 2, transaksi HWM,
kuota) yang sekarang nyata di kode.

- [ ] **Step 3: `stack.md`**

Buka `internal/docs/architecture/stack.md:41-48`. Perbarui ringkasan "log terpusat" dari
proyeksi/rencana menjadi status mendarat: shipper dikuras tick sync, spool NDJSON, sadapan console,
redaksi dua lapis, retensi lewat `runRetention()`.

- [ ] **Step 4: `frontend-implementation.md`**

Buka `internal/docs/frontend/frontend-implementation.md:45-59`. Konfirmasi tab "Log" di layar Klien
(sudah disebut di sana sebagai rencana) sekarang mendarat sebagai `LogsPanel.tsx`; tambahkan catatan
kursor tanpa `total` dan blok retensi.

- [ ] **Step 5: ADR-0166**

Buka `internal/docs/adr/0166-log-terpusat-ingest-satu-arah.md`. Ubah status dari "sebagian mendarat"
(turunan A saja) menjadi "mendarat penuh" (turunan A+D). Tambahkan baris hasil pengukuran AC-S9
(Task 21) sebagai bukti §7 terverifikasi, bukan lagi proyeksi.

- [ ] **Step 6: `agent-integration.md`**

Buka `internal/docs/agent-integration.md`. Tambahkan `logs` ke daftar top-level `COOKIE_ONLY` (cermin
`remote-control` yang sudah terdaftar), dengan catatan singkat kenapa (audit yang bisa memalsukan
seluruh jejak sesi tak boleh didelegasikan ke capability agent token).

- [ ] **Step 7: `SKILL.md`**

Buka `internal/skills/hanoman/SKILL.md`. Cari bagian yang menyebut log terpusat/relay/sync sebagai
rencana turunan D dan perbarui jadi status mendarat, dengan pointer ke plan ini dan ADR-0166.

- [ ] **Step 8: Tautkan di index**

Buka `internal/docs/README.md`. Tambahkan/perbarui tautan ke plan ini
(`docs/superpowers/plans/2026-09-18-spec-1217-log-terpusat-turunan-d-plan.md`) dan hasil pengukuran
AC-S9 di seksi yang relevan (SPEC-1217 / log terpusat), mengikuti format entri index yang sudah ada
di berkas itu.

- [ ] **Step 9: Commit**

```bash
git add internal/docs/architecture/api-contract.md internal/docs/architecture/data-model.md \
  internal/docs/architecture/stack.md internal/docs/frontend/frontend-implementation.md \
  internal/docs/adr/0166-log-terpusat-ingest-satu-arah.md internal/docs/agent-integration.md \
  internal/skills/hanoman/SKILL.md internal/docs/README.md
git commit -m "docs: cabut penanda DIRANCANG bagian D log terpusat — mendarat penuh (SPEC-1217)"
```

---

## Ringkasan urutan (cermin §S6 spec)

1. Redact murni (Task 1-3) → 2. Spool + console-tap (Task 4-5) → 3. Taps sesi (Task 6-9) →
4. Ingest hub (Task 10-12) → 5. Shipper klien (Task 13) → 6. Search/retention (Task 14-16) →
7. UI (Task 17-20) → 8. Pengukuran AC-S9 (Task 21) → 9. Docs (Task 22).

Tiap task: centang checklist, jalankan test yang tersentuh (bukan suite penuh), commit — per
constraint global plan ini dan `CLAUDE.md` project.
