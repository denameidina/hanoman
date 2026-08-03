# SPEC-518 — Setelan runtime/model/effort agen changelog · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operator bisa menyetel runtime (claude/codex), model, dan effort **khusus agen pembuat changelog** di halaman Settings, dan nilai itu benar-benar dipakai saat changelog dibangkitkan.

**Architecture:** Blok baru `Setting.changelog` bertipe `zAgentEngine` — bentuk "override agen" yang sudah dipakai bersama `Setting.lead.engine` (SPEC-409/488) dan `Setting.telegram.engine` (SPEC-492). Flat (bukan `changelog.engine`) karena bloknya **hanya** override agen, persis kasus `Setting.conflict`. Resolver `changelogAgentDefaults()` menggantikan `sessionAgentDefaults()` pada satu-satunya call site changelog (`services/changelog/generate.ts`). Opt-in: selama `enabled` mati, resolver mendelegasikan **penuh** ke `sessionAgentDefaults()` sehingga instalasi yang ada tak berubah satu argv pun.

**Tech Stack:** TypeScript strict · zod (`@hanoman/shared`) · Prisma 6 / SQLite (kolom `Setting.data` bertipe `Json`) · Fastify · React + Vite · vitest + Testing Library.

**Spec:** [`docs/superpowers/specs/2026-08-04-spec-518-changelog-engine-design.md`](../specs/2026-08-04-spec-518-changelog-engine-design.md)

## Global Constraints

- **Tanpa perubahan skema Prisma, tanpa migration.** `Setting.data` bertipe `Json`; blok baru dipasang lewat `.default()` pada `zSetting` sehingga baris `Setting` lama yang tak punya kunci `changelog` **tetap parse**.
- **Tanpa endpoint baru.** `GET/PUT /settings` yang sudah ada.
- **Tanpa ADR baru.** ADR-0105 (changelog), ADR-0091 (`think()`), dan ADR-0081 (override agen opt-in yang mewarisi saat mati) **ditegakkan**, bukan diamandemen mekanismenya.
- **`zAgentEngine` dipakai apa adanya — jangan bikin bentuk kelima.** `shared/src/agent-engine.test.ts` mengunci `zLeadEngine === zAgentEngine` sebagai identitas objek; blok changelog harus memakai skema yang sama, bukan salinan.
- **Default = override MATI** (`enabled: false`, `agent: "claude"`, `model: "claude-opus-5"`, `effort: "xhigh"`).
- **Effort adalah properti MODEL** (SPEC-339). Setiap tempat yang menyimpan pasangan model+effort codex WAJIB lewat `coerceCodexEffort(model, effort)`, dan setiap picker effort codex WAJIB memakai `codexEfforts(model)` — **bukan** `CODEX_EFFORTS`.
- **Menukar runtime menukar model+effort sekalian** ke default runtime itu (cermin `pickAgent` di `StartSessionModal`). Tanpa itu changelog lahir `codex -m claude-opus-5`.
- **Bahasa komentar & teks UI: Indonesia.** Kode, identifier, dan `aria-label` mengikuti gaya berkas sekitarnya.
- **Test wajib `--no-file-parallelism` + `TEST_DATABASE_URL` sendiri** bila menyentuh test server (mesin ini menjalankan beberapa sesi sekaligus; `<db>.test.db` diturunkan dari `HANOMAN_HOME`, bukan dari checkout, dan dihapus di awal tiap run).

## Struktur berkas

| Berkas | Tanggung jawab | Aksi |
|---|---|---|
| `shared/src/entities.ts` | `CHANGELOG_ENGINE_DEFAULTS` + kunci `changelog` di `zSetting` | Modify |
| `shared/src/agent-engine.test.ts` | kontrak skema blok engine bersama | Modify |
| `server/src/services/settings.ts` | `DEFAULT_SETTING` (DB masih segar / bentuk rusak) | Modify |
| `server/src/services/changelog/config.ts` | `changelogAgentDefaults()` — satu definisi "apa yang berlaku" | **Create** |
| `server/src/services/changelog/generate.ts` | memakai resolver, bukan `sessionAgentDefaults()` | Modify |
| `server/test/changelog-engine.test.ts` | rantai `Setting.changelog → opts think()` | **Create** |
| `src/src/screens/SettingsScreen.tsx` | kartu "Agen changelog" di tab Model sesi | Modify |
| `src/test/settings-changelog-engine.test.tsx` | kontrak kartu | **Create** |
| `internal/docs/architecture/data-model.md` | butir `changelog` pada daftar field `Setting` | Modify |
| `internal/docs/architecture/api-contract.md` | blok `GET/PUT /settings` | Modify |
| `internal/docs/adr/0105-changelog-per-project.md` | catatan: agen penarasi bersetelan sendiri | Modify |
| `internal/skills/hanoman/SKILL.md` | butir changelog | Modify |

Tak ada berkas doc baru → `internal/docs/README.md` tak bertambah entri.

---

### Task 1: Blok `Setting.changelog` di skema bersama

**Files:**
- Modify: `shared/src/entities.ts` (sesudah `zConflict`/`CONFLICT_DEFAULTS`, dan kunci baru di `zSetting`)
- Modify: `server/src/services/settings.ts:12-26` (`DEFAULT_SETTING`)
- Modify: `src/src/screens/SettingsScreen.tsx:33-47` (`S_DEFAULTS`)
- Test: `shared/src/agent-engine.test.ts`

**Interfaces:**
- Consumes: `zAgentEngine`, `type AgentEngine` dari `./agent-engine` (sudah di-import `entities.ts:4`).
- Produces:
  - `export const CHANGELOG_ENGINE_DEFAULTS: AgentEngine` — `{ enabled: false, agent: "claude", model: "claude-opus-5", effort: "xhigh" }`
  - `Setting["changelog"]` bertipe `AgentEngine` (wajib ada di objek `Setting`, diisi `.default()` saat parse).

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan di akhir `shared/src/agent-engine.test.ts`, di dalam berkas yang sama (blok `describe` baru), dan tambahkan `CHANGELOG_ENGINE_DEFAULTS` + `zSetting` ke daftar import di baris 2:

```ts
import { zAgentEngine, zLeadEngine, zTelegramSettings, zSetting, TELEGRAM_DEFAULTS, LEAD_DEFAULTS, CHANGELOG_ENGINE_DEFAULTS } from "./index";
```

```ts
// SPEC-518 · agen PEMBUAT CHANGELOG (SPEC-516/ADR-0105) boleh punya runtime/model/effort sendiri.
// Sampai spec ini `generateChangelog` selalu memakai `sessionAgentDefaults()` dan operator tak
// punya satu pun kontrol untuk memisahkannya dari sesi kerja.
describe("Setting.changelog (SPEC-518)", () => {
  // Bentuk KELIMA adalah yang dicegah SPEC-492. Blok changelog wajib memakai skema yang sama
  // dengan lead & telegram, bukan salinan yang bisa bercabang diam-diam.
  it("memakai zAgentEngine, bukan bentuk kelima", () => {
    expect(CHANGELOG_ENGINE_DEFAULTS).toEqual(zAgentEngine.parse({}));
  });

  it("default = override MATI → instalasi lama tak berubah perilakunya", () => {
    expect(CHANGELOG_ENGINE_DEFAULTS).toEqual({
      enabled: false, agent: "claude", model: "claude-opus-5", effort: "xhigh",
    });
  });

  // Kolom `Setting.data` bertipe Json dan baris yang ditulis sebelum spec ini tak punya kunci
  // `changelog` sama sekali. Tanpa `.default()` seluruh layar Settings mati di baris lama.
  it("baris Setting lama TANPA kunci changelog tetap parse", () => {
    const old = {
      model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true,
      notifyFail: true,
    };
    const parsed = zSetting.safeParse(old);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.changelog).toEqual(CHANGELOG_ENGINE_DEFAULTS);
  });

  it("agent di luar claude|codex ditolak; model & effort tetap longgar", () => {
    expect(zSetting.safeParse({
      model: "m", effort: "e", autoDefault: true, autoScaffold: true, notifyFail: true,
      changelog: { agent: "gemini" },
    }).success).toBe(false);
    const ok = zSetting.parse({
      model: "m", effort: "e", autoDefault: true, autoScaffold: true, notifyFail: true,
      changelog: { enabled: true, agent: "codex", model: "gpt-9-belum-ada", effort: "ultra" },
    });
    expect(ok.changelog.model).toBe("gpt-9-belum-ada");
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

```bash
pnpm vitest --run shared/src/agent-engine.test.ts
```

Expected: FAIL — `CHANGELOG_ENGINE_DEFAULTS` tidak diekspor dari `./index` (`SyntaxError`/`undefined`).

- [ ] **Step 3: Implementasi minimal**

Di `shared/src/entities.ts`, **sesudah** blok `CONFLICT_DEFAULTS` (baris ~230) dan **sebelum** blok `zLead`, tambahkan:

```ts
// SPEC-518 · runtime/model/effort KHUSUS agen pembuat changelog (SPEC-516/[ADR-0105]). Bentuknya
// `zAgentEngine` yang sudah dipakai `lead.engine` & `telegram.engine` — bukan definisi kelima
// (justru itu alasan bentuk bersama itu lahir di SPEC-492).
//
// FLAT, bukan `changelog.engine`: `lead`/`telegram` menyarangkan `engine` karena bloknya sudah
// memuat knob lain (rem darurat, denyut, allowlist). Blok ini HANYA override agen — persis kasus
// `Setting.conflict`, yang juga flat. Menyarangkan berarti satu tingkat kosong tanpa tetangga.
//
// Opt-in: `enabled` mati → `changelogAgentDefaults()` mendelegasikan penuh ke
// `sessionAgentDefaults()`. Dipasang ke `zSetting` lewat `.default()` seperti conflict/goal/codex →
// baris Setting lama tetap parse, TANPA migration.
export const CHANGELOG_ENGINE_DEFAULTS: AgentEngine = zAgentEngine.parse({});
```

Lalu tambahkan kunci di `zSetting` (sesudah baris `telegram:`):

```ts
  changelog: zAgentEngine.default(CHANGELOG_ENGINE_DEFAULTS),                 // SPEC-518 · agen pembuat changelog (opt-in, mati)
```

- [ ] **Step 4: Jalankan test, pastikan HIJAU**

```bash
pnpm vitest --run shared/src/agent-engine.test.ts
```

Expected: PASS, seluruh test di berkas itu (lama + 4 baru) hijau.

- [ ] **Step 5: Isi `DEFAULT_SETTING` & `S_DEFAULTS` yang kini kurang satu kunci**

`Setting` adalah tipe hasil `z.infer`, jadi kunci ber-`.default()` **wajib ada** di objek bertipe `Setting`. Dua objek literal seperti itu ada di repo dan `tsc` akan menolak keduanya.

Di `server/src/services/settings.ts`, tambahkan ke `DEFAULT_SETTING` (sesudah baris `telegram:`) — dan `CHANGELOG_ENGINE_DEFAULTS` ke daftar import dari `@hanoman/shared`:

```ts
  changelog: CHANGELOG_ENGINE_DEFAULTS, // SPEC-518 · agen pembuat changelog (opt-in, mati)
```

Di `src/src/screens/SettingsScreen.tsx`, tambahkan ke `S_DEFAULTS` (sesudah baris `telegram:`) — dan `CHANGELOG_ENGINE_DEFAULTS` ke daftar import `@hanoman/shared` di baris 6:

```ts
  changelog: CHANGELOG_ENGINE_DEFAULTS, // SPEC-518 · agen pembuat changelog (opt-in, mati)
```

- [ ] **Step 6: Typecheck paket yang tersentuh**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck
```

Expected: keduanya keluar tanpa galat.

- [ ] **Step 7: Commit**

```bash
git add shared/src/entities.ts shared/src/agent-engine.test.ts \
        server/src/services/settings.ts src/src/screens/SettingsScreen.tsx
git commit -m "feat(spec-518): blok Setting.changelog memakai zAgentEngine bersama"
```

---

### Task 2: `changelogAgentDefaults()` dan pemakaiannya saat generate

**Files:**
- Create: `server/src/services/changelog/config.ts`
- Modify: `server/src/services/changelog/generate.ts:5` (import) dan `:46` (call site)
- Test: `server/test/changelog-engine.test.ts` (create)

**Interfaces:**
- Consumes: `CHANGELOG_ENGINE_DEFAULTS` (Task 1) · `getSetting()`, `sessionAgentDefaults()` dari `../settings` · `coerceCodexEffort`, `type Agent` dari `@hanoman/shared`.
- Produces: `changelogAgentDefaults(): Promise<{ agent: Agent; model: string; effort: string }>`.

- [ ] **Step 1: Tulis test yang gagal**

Buat `server/test/changelog-engine.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { changelogAgentDefaults } from "../src/services/changelog/config";
import { generateChangelog } from "../src/services/changelog/generate";
import type { ThinkOpts } from "../src/services/lead/brain";
import { resetDb, makeProject, makeSpec, makeSetting } from "./factory";

// SPEC-518 · runtime/model/effort agen changelog disetel operator — dan setelan itu harus
// benar-benar SAMPAI ke panggilan agen, bukan sekadar tersimpan. Tanpa test terakhir di berkas
// ini, "tersimpan tapi tak pernah dipakai" terlihat PERSIS SAMA dengan berhasil: seluruh test
// SPEC-516 menyuntik `think` sebagai stub dan tak satu pun memeriksa opts-nya.
//
// Rantainya: Setting.data.changelog → changelogAgentDefaults() → generateChangelog() → think(opts).
// Ruas terakhir (`think` → argv) sudah dikunci `leadArgv` + `lead-engine-argv.test.ts`; yang belum
// pernah ada adalah ruas-ruas di atasnya.

const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0);
const RANGE = { mode: "backlog", from: "2026-07-01", to: "2026-07-31" } as const;

beforeEach(async () => {
  await resetDb();
  await makeProject({ id: "p1" });
  await makeSpec({ id: "SPEC-1", projectId: "p1", stage: "done",
    title: "Laporan bisa diunduh", objective: "Pemakai mengunduh sendiri.", doneAt: at(2026, 7, 10) });
});

/** Menangkap opts yang benar-benar diterima agen. */
function spyThink() {
  const seen: ThinkOpts[] = [];
  const think = async (_p: string, o: ThinkOpts) => { seen.push(o); return "# Changelog\n\n- apa saja\n"; };
  return { seen, think };
}

describe("changelogAgentDefaults (SPEC-518)", () => {
  it("override MATI → mewarisi default sesi global (akar claude)", async () => {
    await makeSetting({ agent: "claude", model: "claude-fable-5", effort: "medium" });
    expect(await changelogAgentDefaults()).toEqual(
      { agent: "claude", model: "claude-fable-5", effort: "medium" });
  });

  // Warisan wajib mengikuti BLOK yang benar. Membaca `model`/`effort` akar saat agennya codex
  // adalah bug SPEC-377 dalam bentuk baru (`codex -m claude-opus-5`).
  it("override MATI → mewarisi blok codex saat agen global codex", async () => {
    await makeSetting({ agent: "codex", codex: { model: "gpt-5.6-terra", effort: "high" } });
    expect(await changelogAgentDefaults()).toEqual(
      { agent: "codex", model: "gpt-5.6-terra", effort: "high" });
  });

  it("override HIDUP → memakai triple sendiri, bukan default global", async () => {
    await makeSetting({
      agent: "claude", model: "claude-opus-5", effort: "xhigh",
      changelog: { enabled: true, agent: "claude", model: "claude-fable-5", effort: "low" },
    });
    expect(await changelogAgentDefaults()).toEqual(
      { agent: "claude", model: "claude-fable-5", effort: "low" });
  });

  // SPEC-339 · effort adalah properti MODEL. `gpt-5.6-luna` tak mendukung `ultra`; menyimpannya
  // apa adanya berarti panggilan agen ditolak codex. Koersi hidup di RESOLVER, bukan hanya di
  // picker — nilai bisa masuk lewat PUT /settings ber-AgentToken yang tak lewat UI mana pun.
  it("override HIDUP + codex → effort dikoersi ke yang didukung model", async () => {
    await makeSetting({
      changelog: { enabled: true, agent: "codex", model: "gpt-5.6-luna", effort: "ultra" },
    });
    expect(await changelogAgentDefaults()).toEqual(
      { agent: "codex", model: "gpt-5.6-luna", effort: "xhigh" });
  });
});

describe("generateChangelog memakai setelan changelog (SPEC-518)", () => {
  it("meneruskan triple hasil resolver ke think()", async () => {
    await makeSetting({
      agent: "claude", model: "claude-opus-5", effort: "xhigh",
      changelog: { enabled: true, agent: "codex", model: "gpt-5.6-terra", effort: "low" },
    });
    const { seen, think } = spyThink();
    const r = await generateChangelog("p1", RANGE, { think });
    expect(r.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ agent: "codex", model: "gpt-5.6-terra", effort: "low" });
  });

  it("override mati → think() menerima default sesi global", async () => {
    await makeSetting({ agent: "claude", model: "claude-fable-5", effort: "medium" });
    const { seen, think } = spyThink();
    await generateChangelog("p1", RANGE, { think });
    expect(seen[0]).toMatchObject({ agent: "claude", model: "claude-fable-5", effort: "medium" });
  });

  // Dibaca TIAP panggilan, tanpa cache → ganti setelan berlaku pada pembangkitan berikutnya tanpa
  // restart. Pola yang sama dikunci `lead-engine-argv.test.ts` untuk lead.
  it("setelan dibaca tiap panggilan — ganti setelan berlaku tanpa restart", async () => {
    const { seen, think } = spyThink();
    await makeSetting({ changelog: { enabled: true, agent: "claude", model: "claude-opus-5", effort: "xhigh" } });
    await generateChangelog("p1", RANGE, { think });
    await makeSetting({ changelog: { enabled: true, agent: "claude", model: "claude-fable-5", effort: "low" } });
    await generateChangelog("p1", RANGE, { think });
    expect(seen.map((o) => o.model)).toEqual(["claude-opus-5", "claude-fable-5"]);
  });

  // Anggaran waktu TIDAK ikut jadi setelan (di luar scope brief) — ia disebut di dalam prompt
  // (SPEC-432), jadi angka yang bisa digeser diam-diam akan berbohong kepada agennya.
  it("anggaran waktu tetap konstan, bukan turunan setelan", async () => {
    await makeSetting({ changelog: { enabled: true, agent: "claude", model: "claude-fable-5", effort: "low" } });
    const { seen, think } = spyThink();
    await generateChangelog("p1", RANGE, { think });
    expect(seen[0]!.timeoutMs).toBe(180_000);
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run server/test/changelog-engine.test.ts --no-file-parallelism
```

Expected: FAIL — `Failed to resolve import "../src/services/changelog/config"`.

- [ ] **Step 3: Tulis resolver**

Buat `server/src/services/changelog/config.ts`:

```ts
import { coerceCodexEffort, type Agent } from "@hanoman/shared";
import { getSetting, sessionAgentDefaults } from "../settings";

/**
 * SPEC-518 · agen yang MENULIS narasi changelog (SPEC-516/ADR-0105). Cermin
 * `leadAgentDefaults()` (SPEC-409) & `telegramAgentDefaults()` (SPEC-492), dan berperilaku sama
 * dengan `conflictSessionDefaults()` (ADR-0081) saat mati.
 *
 * **Opt-in.** Selama `changelog.enabled` mati ia mendelegasikan PENUH ke `sessionAgentDefaults()`
 * — satu setelan agen yang berlaku, bukan dua yang bisa berselisih diam-diam. Menyalin nilai
 * default ke sini alih-alih mendelegasikan akan membuat instalasi yang mengubah default globalnya
 * tetap memanggil changelog dengan model lama, tanpa satu pun permukaan yang mengatakannya.
 *
 * **Koersi effort di sini, bukan hanya di picker.** Effort adalah properti MODEL (SPEC-339) dan
 * blok ini bisa ditulis lewat `PUT /settings` ber-`AgentToken` yang tak melewati UI mana pun.
 *
 * Dibaca dari `getSetting()` tiap panggilan (tanpa cache) → ganti setelan berlaku pada
 * pembangkitan berikutnya tanpa restart.
 */
export async function changelogAgentDefaults(): Promise<{ agent: Agent; model: string; effort: string }> {
  const e = (await getSetting()).changelog;
  if (!e.enabled) return sessionAgentDefaults();
  return e.agent === "codex"
    ? { agent: "codex", model: e.model, effort: coerceCodexEffort(e.model, e.effort) }
    : { agent: "claude", model: e.model, effort: e.effort };
}
```

- [ ] **Step 4: Pakai resolver di satu-satunya call site**

Di `server/src/services/changelog/generate.ts`, ganti baris import `sessionAgentDefaults`:

```ts
import { changelogAgentDefaults } from "./config";
```

(hapus `import { sessionAgentDefaults } from "../settings";` — sesudah perubahan ini berkas itu tak lagi memakainya)

dan ganti call site di `generateChangelog`:

```ts
  const { agent, model, effort } = await changelogAgentDefaults();
```

Tambahkan komentar di atasnya:

```ts
  // SPEC-518 · runtime/model/effort punya setelan SENDIRI (opt-in). Sebelumnya baris ini
  // `sessionAgentDefaults()`, yang berarti menulis prosa rilis selalu memakai model sesi kerja.
  // Ini SATU-SATUNYA tempat changelog men-spawn agen — tak ada call site kedua untuk didivergensikan.
```

- [ ] **Step 5: Jalankan test, pastikan HIJAU**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" \
  pnpm vitest --run server/test/changelog-engine.test.ts server/test/changelog-generate.test.ts --no-file-parallelism
```

Expected: PASS — 8 test baru **dan** 9 test SPEC-516 yang sudah ada (tak boleh ada yang berubah verdict-nya).

- [ ] **Step 6: Typecheck server**

```bash
pnpm --filter ./server typecheck
```

Expected: keluar tanpa galat.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/changelog/config.ts server/src/services/changelog/generate.ts \
        server/test/changelog-engine.test.ts
git commit -m "feat(spec-518): changelogAgentDefaults dipakai saat generate changelog"
```

---

### Task 3: Kartu "Agen changelog" di Settings → Model sesi

**Files:**
- Modify: `src/src/screens/SettingsScreen.tsx` (state di sekitar baris 790, kartu baru sesudah kartu Telegram yang berakhir di baris ~1051)
- Test: `src/test/settings-changelog-engine.test.tsx` (create)

**Interfaces:**
- Consumes: `CHANGELOG_ENGINE_DEFAULTS` (Task 1) · helper yang sudah ada di dalam cabang `tab === "model"`: `save()`, `inherited`, `codexNote()`, `codexOptions()`, `AGENT_LABEL`, `S_MODELS`, `S_EFFORT`, `codexEfforts`, `coerceCodexEffort`.
- Produces: kontrol ber-`aria-label` **"Override agen changelog"**, **"Runtime changelog"**, **"Model changelog"**, **"Effort changelog"**, dan `data-testid="changelog-engine-inherited"`.

- [ ] **Step 1: Tulis test yang gagal**

Buat `src/test/settings-changelog-engine.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

// SPEC-518 · runtime/model/effort agen pembuat changelog (SPEC-516/ADR-0105). Sampai spec ini
// `generateChangelog` selalu memakai default sesi kerja dan operator tak punya satu pun kontrol.
vi.mock("../src/api/client", () => ({
  api: {
    getSettings: vi.fn(), putSettings: vi.fn(), getCodexVersion: vi.fn(),
    getLeadConfig: vi.fn(), putLeadConfig: vi.fn(),
  },
  ApiError: class extends Error { status = 0 },
}));

import { SettingsScreen } from "../src/screens/SettingsScreen";
import { api } from "../src/api/client";

const me: any = { id: "u1", email: "dena@nafanesia.id", createdAt: "x" };

const CHANGELOG = (over: object = {}) =>
  ({ enabled: false, agent: "claude", model: "claude-opus-5", effort: "xhigh", ...over });

const settings = (over: object = {}) => ({
  model: "claude-opus-5", effort: "xhigh", autoDefault: true, autoScaffold: true, notifyFail: true,
  notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert",
  agentAccessEnabled: false, scheduler: {}, goal: { enabled: false, condition: "" },
  agent: "claude", codex: { model: "gpt-5.6-sol", effort: "xhigh" }, verifyScope: "changed",
  conflict: { enabled: false, agent: "claude", model: "claude-opus-5", effort: "xhigh" },
  changelog: CHANGELOG(), ...over,
});

beforeEach(() => {
  vi.mocked(api.getSettings).mockResolvedValue(settings() as any);
  vi.mocked(api.putSettings).mockImplementation(async (s: any) => s);
  vi.mocked(api.getCodexVersion).mockResolvedValue(
    { version: "0.145.0", minRequired: "0.144.0", ok: true } as any);
});

const openModel = () => {
  render(<SettingsScreen me={me} onLoggedOut={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Model sesi" }));
};

describe("SPEC-518 · kartu agen changelog", () => {
  it("kartu ada di tab Model sesi", async () => {
    openModel();
    expect(await screen.findByText("Agen changelog")).toBeInTheDocument();
  });

  // Opt-in: mati = warisan penuh, dan kartunya HARUS menyebut nilai warisannya — kalau tidak
  // operator ditinggal bertanya "lalu changelog pakai apa?" (pelajaran SPEC-383).
  it("mati → tak ada picker, nilai warisan ditampilkan", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(
      settings({ agent: "codex", codex: { model: "gpt-5.6-terra", effort: "high" } }) as any);
    openModel();
    const inh = await screen.findByTestId("changelog-engine-inherited");
    expect(inh).toHaveTextContent("Codex CLI");
    expect(inh).toHaveTextContent("gpt-5.6-terra");
    expect(inh).toHaveTextContent("high");
    expect(screen.queryByLabelText("Runtime changelog")).toBeNull();
  });

  // Blok `Setting.changelog` TAK punya penulis kedua (tak seperti `lead` yang ditulis LeadScreen
  // dan `telegram` yang ditulis command chat), jadi pola `save()` → PUT /settings sah di sini —
  // sama seperti kartu konflik.
  it("menyalakan override → PUT /settings dengan changelog.enabled true", async () => {
    openModel();
    const wrap = await screen.findByLabelText("Override agen changelog");
    fireEvent.click(within(wrap).getByRole("switch"));
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith(
      expect.objectContaining({ changelog: expect.objectContaining({ enabled: true }) })));
  });

  it("menukar runtime ke codex → model & effort ikut bertukar ke katalog codex", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(
      settings({ changelog: CHANGELOG({ enabled: true }) }) as any);
    openModel();
    fireEvent.change(await screen.findByLabelText("Runtime changelog"), { target: { value: "codex" } });
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        changelog: { enabled: true, agent: "codex", model: "gpt-5.6-sol", effort: "xhigh" },
      })));
  });

  // SPEC-339 · effort adalah properti MODEL. Luna tak mendukung `ultra`.
  it("memilih model codex yang tak mendukung effort tersimpan → effort dikoersi", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(settings({
      changelog: CHANGELOG({ enabled: true, agent: "codex", model: "gpt-5.6-sol", effort: "ultra" }),
    }) as any);
    openModel();
    fireEvent.change(await screen.findByLabelText("Model changelog"), { target: { value: "gpt-5.6-luna" } });
    await waitFor(() => expect(api.putSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        changelog: expect.objectContaining({ model: "gpt-5.6-luna", effort: "xhigh" }),
      })));
  });

  it("picker effort codex hanya menawarkan effort yang didukung model terpilih", async () => {
    vi.mocked(api.getSettings).mockResolvedValue(settings({
      changelog: CHANGELOG({ enabled: true, agent: "codex", model: "gpt-5.6-luna", effort: "xhigh" }),
    }) as any);
    openModel();
    const sel = await screen.findByLabelText("Effort changelog");
    const values = Array.from(sel.querySelectorAll("option")).map((o) => o.getAttribute("value"));
    expect(values).not.toContain("ultra");
    expect(values).toContain("max");
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan MERAH**

```bash
env -u NODE_ENV pnpm vitest --run src/test/settings-changelog-engine.test.tsx
```

Expected: FAIL — `Unable to find an element with the text: Agen changelog`.

> `env -u NODE_ENV` wajib: shell sesi ini menyetel `NODE_ENV=production`, dan React di mode itu membuat `act()` RTL gagal massal (gagal palsu, bukan regresi).

- [ ] **Step 3: Tambahkan state kartu**

Di `src/src/screens/SettingsScreen.tsx`, di dalam cabang `if (tab === "model") {`, **sesudah** `saveTgEngine` (berakhir ~baris 813) dan **sebelum** `return (`, tambahkan:

```ts
      // SPEC-518 · blok `Setting.changelog` — runtime/model/effort agen PEMBUAT CHANGELOG.
      // `?? CHANGELOG_ENGINE_DEFAULTS` sama alasannya dengan `?? CONFLICT_DEFAULTS`: respons
      // GET /settings dari instance lama belum punya kuncinya, dan layar tak boleh mati
      // `undefined.enabled`.
      const changelog = s.changelog ?? CHANGELOG_ENGINE_DEFAULTS;
      // Menulis lewat `save()` (PUT /settings), BUKAN endpoint khusus seperti kartu lead dan bukan
      // baca-ulang seperti kartu Telegram. Keduanya melakukannya karena bloknya punya PENULIS
      // KEDUA — `LeadScreen` untuk lead, command `/runtime|/model|/effort` dari chat untuk
      // telegram — sehingga menulis dari snapshot mount akan mengembalikan nilai yang baru saja
      // diubah di tempat lain. Blok `changelog` tak punya penulis kedua: kartu ini satu-satunya.
      const saveChangelog = (patch: Partial<Setting["changelog"]>, msg: string) =>
        save({ changelog: { ...changelog, ...patch } }, msg);
```

Tambahkan `CHANGELOG_ENGINE_DEFAULTS` ke import `@hanoman/shared` di baris 6 bila Task 1 belum melakukannya.

- [ ] **Step 4: Tambahkan kartunya**

Sisipkan **sesudah** `</Card>` penutup kartu "Agen operator Telegram" (~baris 1051) dan **sebelum** `</>`:

```tsx
      {/* SPEC-518 · agen pembuat changelog (SPEC-516/ADR-0105) boleh punya runtime/model/effort
          sendiri. Pekerjaannya merangkum judul backlog/commit jadi prosa rilis pendek — jauh lebih
          ringan dari sesi kerja, dan tak selalu pantas memakai model termahal. Opt-in seperti
          kartu konflik/lead/Telegram: mati = mewarisi. */}
      <Card eyebrow="changelog" title="Agen changelog">
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
          Mesin yang menulis narasi changelog per project — panggilan sekali-jalan non-interaktif
          yang merangkum backlog selesai, rentang commit, atau isi sebuah rilis menjadi teks pendek
          berorientasi pemakai. Berlaku pada pembangkitan <b>berikutnya</b>, tanpa restart. Agen yang
          gagal tak menggagalkan changelog: barisnya tetap lahir sebagai draf ringkas ber-catatan.
        </div>
        <SettingRow title="Pakai setelan sendiri"
          desc="Mati = ikut default global di atas. Hidup = pembuat changelog memakai pilihan di bawah.">
          <Switch aria-label="Override agen changelog" checked={changelog.enabled}
            onChange={(v: boolean) => saveChangelog({ enabled: v },
              "Setelan changelog" + (v ? " · aktif" : " · ikut default global"))} />
        </SettingRow>
        {!changelog.enabled ? (
          <div data-testid="changelog-engine-inherited" style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "12px 0 2px", lineHeight: 1.5 }}>
            Pembuat changelog memakai default global: <b>{AGENT_LABEL[inherited.agent]}</b> ·{" "}
            <code>{inherited.model}</code> · <code>{inherited.effort}</code>.
          </div>
        ) : (
          <>
            <SettingRow title="Runtime" desc="Mesin yang menulis changelog. Bisa beda dari agen sesi kerja.">
              <Select size="sm" aria-label="Runtime changelog" value={changelog.agent} style={{ width: 190 }}
                options={[{ value: "claude", label: AGENT_LABEL.claude }, { value: "codex", label: AGENT_LABEL.codex }]}
                onChange={(e) => {
                  // Cermin `pickAgent`/kartu konflik/lead/Telegram: menukar runtime HARUS menukar
                  // model+effort sekalian, kalau tidak changelog lahir `codex -m claude-opus-5`.
                  const a = e.target.value as "claude" | "codex";
                  const d = a === "codex" ? codex : { model: s.model, effort: s.effort };
                  saveChangelog({ agent: a, model: d.model,
                    effort: a === "codex" ? coerceCodexEffort(d.model, d.effort) : d.effort },
                    "Runtime changelog → " + a);
                }} />
            </SettingRow>
            {changelog.agent === "codex" && codexNote(changelog.model)}
            <SettingRow title="Model">
              <Select size="sm" aria-label="Model changelog" value={changelog.model} style={{ width: 190 }}
                options={changelog.agent === "codex" ? codexOptions(changelog.model) : S_MODELS}
                onChange={(e) => {
                  const model = e.target.value;
                  saveChangelog({ model, ...(changelog.agent === "codex"
                    ? { effort: coerceCodexEffort(model, changelog.effort) } : {}) },
                    "Model changelog → " + model);
                }} />
            </SettingRow>
            <SettingRow title="Effort" last
              desc="Merangkum judul jadi prosa pendek — effort rendah biasanya cukup dan memangkas ongkos setiap pembangkitan.">
              <Select size="sm" aria-label="Effort changelog" value={changelog.effort} style={{ width: 130 }}
                options={changelog.agent === "codex"
                  ? codexEfforts(changelog.model).map((v) => ({ value: v, label: v }))
                  : S_EFFORT}
                onChange={(e) => saveChangelog({ effort: e.target.value }, "Effort changelog → " + e.target.value)} />
            </SettingRow>
          </>
        )}
      </Card>
```

- [ ] **Step 5: Jalankan test, pastikan HIJAU**

```bash
env -u NODE_ENV pnpm vitest --run src/test/settings-changelog-engine.test.tsx \
  src/test/settings-conflict.test.tsx src/test/settings-lead-engine.test.tsx \
  src/test/settings-telegram-engine.test.tsx
```

Expected: PASS — 6 test baru, dan tiga berkas kartu tetangga tak berubah verdict-nya (kartu baru tak boleh membuat `getByRole("switch")`/`findByText` mereka cocok ganda).

- [ ] **Step 6: Typecheck web**

```bash
pnpm --filter ./src typecheck
```

Expected: keluar tanpa galat.

- [ ] **Step 7: Commit**

```bash
git add src/src/screens/SettingsScreen.tsx src/test/settings-changelog-engine.test.tsx
git commit -m "feat(spec-518): kartu Agen changelog di Settings - Model sesi"
```

---

### Task 4: Docs Source of Truth

**Files:**
- Modify: `internal/docs/architecture/data-model.md` (daftar field `Setting`, sesudah butir `lead` yang berakhir ~baris 257)
- Modify: `internal/docs/architecture/api-contract.md` (blok `GET/PUT /settings`, ~baris 363-385)
- Modify: `internal/docs/adr/0105-changelog-per-project.md`
- Modify: `internal/skills/hanoman/SKILL.md` (butir changelog, ~baris 173-198)

**Interfaces:**
- Consumes: nama & bentuk final dari Task 1-3 (`Setting.changelog`, `changelogAgentDefaults()`).
- Produces: tak ada kode.

- [ ] **Step 1: `data-model.md` — butir `changelog` pada daftar field `Setting`**

Sisipkan sesudah butir `lead` (yang berakhir dengan kalimat tentang `lead-engine-argv.test.ts`), sebelum heading `## User / Session`:

```markdown
- `changelog` (SPEC-518, `zAgentEngine`, **default MATI**) — runtime/model/effort **khusus agen
  pembuat changelog** ([ADR-0105](../adr/0105-changelog-per-project.md)):
  `{ enabled:false, agent:"claude", model:"claude-opus-5", effort:"xhigh" }`. Dibaca
  `changelogAgentDefaults()` (`services/changelog/config.ts`) dan dipakai di **satu** call site —
  `generateChangelog()`, satu-satunya tempat changelog men-spawn agen. **Opt-in**: selama `enabled`
  mati helper mendelegasikan penuh ke `sessionAgentDefaults()`, jadi instalasi yang ada tak berubah
  satu argv pun. Skemanya **`zAgentEngine` yang sama** dengan `lead.engine` & `telegram.engine`
  (SPEC-492) — bukan definisi kelima; **flat**, bukan `changelog.engine`, karena bloknya hanya
  override agen dan tak punya knob tetangga (cermin `conflict`). Effort codex dikoersi di dalam
  resolver, bukan hanya di picker (`PUT /settings` ber-`AgentToken` tak lewat UI). Ditambahkan
  sebagai `.default(CHANGELOG_ENGINE_DEFAULTS)` → baris Setting lama tetap parse, **tanpa
  migration**. Permukaan operatornya kartu **"Agen changelog"** di Settings → Model sesi, yang
  menulis lewat **`PUT /settings`** (bukan endpoint khusus seperti kartu lead, dan bukan baca-ulang
  seperti kartu Telegram): blok ini **tak punya penulis kedua**.
```

- [ ] **Step 2: `api-contract.md` — blok `GET/PUT /settings`**

Sisipkan sesudah baris komentar blok `conflict { … }` di dalam blok kode `GET/PUT /settings`:

```
#                                         changelog { enabled:false, agent:"claude", model:"claude-opus-5",
#                                           effort:"xhigh" } — SPEC-518 · runtime/model/effort KHUSUS agen
#                                           pembuat changelog (ADR-0105). Skema = zAgentEngine yang sama dengan
#                                           lead.engine & telegram.engine. Opt-in: enabled mati → mewarisi
#                                           sessionAgentDefaults(). Blok selalu ADA di response (zod .default()),
#                                           jadi baris Setting lama tetap parse tanpa migration.
```

- [ ] **Step 3: `adr/0105-changelog-per-project.md` — catatan setelan agen**

Tambahkan satu paragraf di bagian Konsekuensi/Catatan (di akhir dokumen), tanpa mengubah keputusan yang sudah ada:

```markdown
### Catatan — SPEC-518: agen penarasi bersetelan sendiri

Keputusan ini menyebut `think()` sebagai mesin narasi tapi tidak menentukan **runtime/model/effort
mana** yang menjalankannya; implementasi pertamanya memakai `sessionAgentDefaults()`, yakni default
sesi kerja. SPEC-518 memberinya setelan sendiri lewat blok `Setting.changelog` (`zAgentEngine`,
**opt-in, default mati** → mewarisi) yang dibaca `changelogAgentDefaults()`. Mekanisme ADR ini tak
berubah: satu call site, `think()` tetap diimpor dari `lead/brain.ts`, anggaran waktu tetap
`CHANGELOG_TIMEOUT_MS` yang disebut di dalam prompt, dan agen gagal tetap **bukan galat**
(`generator:"fallback"` + `warning`). Yang berubah hanya dari mana triple-nya datang.
```

- [ ] **Step 4: `internal/skills/hanoman/SKILL.md` — butir changelog**

Di butir "**Changelog per project …**" (bagian Aturan Arsitektur), sesudah kalimat tentang `think()`
yang DIIMPOR & anggaran waktu, sisipkan:

```markdown
  Runtime/model/effort penarasinya punya setelan sendiri sejak **SPEC-518** — blok
  `Setting.changelog` bertipe **`zAgentEngine` yang sama** dengan `lead.engine`/`telegram.engine`
  (flat seperti `conflict`, bukan bersarang), dibaca `changelogAgentDefaults()`, **opt-in**:
  mati = mewarisi `sessionAgentDefaults()` persis seperti sebelumnya. Tanpa migration, tanpa
  endpoint baru; kartu "Agen changelog" di Settings → Model sesi menulis lewat `PUT /settings`
  karena blok itu **tak punya penulis kedua**.
```

- [ ] **Step 5: Verifikasi integritas index docs**

```bash
node cli/dist/index.js docs index --check 2>/dev/null || echo "cli belum dibangun — lewati; tak ada berkas doc BARU di task ini, jadi index tak bertambah entri"
```

Expected: lolos, atau pesan lewati. Tak ada berkas doc baru → `internal/docs/README.md` memang tak perlu berubah.

- [ ] **Step 6: Commit**

```bash
git add internal/docs/architecture/data-model.md internal/docs/architecture/api-contract.md \
        internal/docs/adr/0105-changelog-per-project.md internal/skills/hanoman/SKILL.md
git commit -m "docs(spec-518): Setting.changelog di data-model, api-contract, ADR-0105, SKILL"
```

---

### Task 5: Verifikasi akhir — test yang tersentuh + smoke endpoint nyata

**Files:** tak ada perubahan kode; task ini adalah gerbang bukti sebelum push.

**Interfaces:**
- Consumes: seluruh Task 1-4.
- Produces: bukti terekam bahwa `POST /projects/:id/changelog` benar-benar memakai setelan.

- [ ] **Step 1: Jalankan seluruh test yang tersentuh perubahan ini**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" env -u NODE_ENV \
  pnpm vitest --run --changed "$HANOMAN_BASE_SHA" --no-file-parallelism
```

Expected: PASS. **Jebakan yang wajib diperiksa:** `--changed` menyalakan `passWithNoTests`, jadi nol berkas test **terlihat hijau**. Baca ringkasannya dan pastikan `shared/src/agent-engine.test.ts`, `server/test/changelog-engine.test.ts`, `server/test/changelog-generate.test.ts`, dan `src/test/settings-changelog-engine.test.tsx` benar-benar **berjalan**. Bila tidak muncul, sebut path-nya langsung.

- [ ] **Step 2: Typecheck ketiga paket yang tersentuh**

```bash
pnpm --filter ./shared typecheck && pnpm --filter ./server typecheck && pnpm --filter ./src typecheck
```

Expected: ketiganya keluar tanpa galat. (Bukan `pnpm -r typecheck` — itu menyalakan satu tsc per paket sekaligus di mesin yang menjalankan beberapa sesi.)

- [ ] **Step 3: Boot server & smoke endpoint yang tersentuh**

Task ini menyentuh perilaku runtime `POST /projects/:id/changelog`, jadi endpoint-nya diuji nyata **sekali di akhir**. Pakai `HANOMAN_HOME` khusus supaya smoke tak menyentuh DB test bersama maupun DB kerja:

```bash
export HANOMAN_HOME="$(mktemp -d)"
pnpm --filter ./server exec prisma migrate deploy
pnpm --filter ./shared build && pnpm --filter ./server build
node server/dist/server.js &
SRV=$!
sleep 3
```

- [ ] **Step 4: Buktikan setelan benar-benar berlaku, lalu matikan server per-PID**

Ambil cookie sesi sesuai cara berkas smoke yang sudah ada di repo (register/login lewat `/api/auth`), lalu:

```bash
# baca setelan — blok changelog wajib ADA di response meski DB baru
curl -sS "$H/api/settings" -b cookies.txt | python3 -c 'import json,sys; print(json.load(sys.stdin)["changelog"])'
# ganti setelan changelog, lalu baca balik
curl -sS -X PUT "$H/api/settings" -b cookies.txt -H 'content-type: application/json' \
  -d "$(curl -sS "$H/api/settings" -b cookies.txt | python3 -c '
import json,sys; s=json.load(sys.stdin)
s["changelog"]={"enabled":True,"agent":"claude","model":"claude-fable-5","effort":"low"}
print(json.dumps(s))')" | python3 -c 'import json,sys; print(json.load(sys.stdin)["changelog"])'
```

Expected: bacaan pertama `{'enabled': False, 'agent': 'claude', 'model': 'claude-opus-5', 'effort': 'xhigh'}`; bacaan kedua memantulkan `claude-fable-5`/`low`.

Matikan server **per-PID** — jangan pernah `pkill -f node`/`pkill -f vitest` (prompt tiap sesi hidup di ARGV agennya dan pola itu membunuh sesi tetangga, SPEC-402):

```bash
kill $SRV
```

- [ ] **Step 5: Centang plan & commit**

Centang seluruh kotak `- [ ]` di berkas plan ini menjadi `- [x]`, lalu:

```bash
git add docs/superpowers/plans/2026-08-04-spec-518-changelog-engine.md
git commit -m "docs(spec-518): centang plan"
git push origin HEAD:refs/heads/hanoman/spec-518
```

---

## Self-review

**Cakupan spec → task:** D1 → Task 1 · D2 → Task 2 · D3 → Task 2 Step 4 · D4 → Task 3 · Bentuk data & aliran → Task 1-2 · Penanganan galat → tak ada jalur baru (dinyatakan di spec; dijaga test SPEC-516 yang ikut dijalankan di Task 2 Step 5) · AC-1..AC-12 → Task 1 (AC-1/2), Task 2 (AC-3..7), Task 3 (AC-8..12) · Docs → Task 4. Tak ada butir spec tanpa task.

**Placeholder:** nihil — setiap step yang mengubah kode memuat kode utuhnya.

**Konsistensi tipe:** `CHANGELOG_ENGINE_DEFAULTS` (Task 1) dipakai apa adanya di Task 2 Step 3 dan Task 3 Step 3. `changelogAgentDefaults()` (Task 2) bertanda tangan sama dengan `leadAgentDefaults()`/`conflictSessionDefaults()` yang sudah ada, jadi tujuan pemakaiannya di `generate.ts` (destructuring `{ agent, model, effort }`) tak berubah bentuk. `aria-label` yang ditulis Task 3 Step 4 sama persis dengan yang dicari Task 3 Step 1.
