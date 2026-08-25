# MCP Rencana 5 — Katalog `settings`, `agents`, `lead`, `support`, `notifications`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 36 tool baru — 11 `settings`, 5 `agents`, 8 `lead`, 11 `support`, 1 `notifications` — melengkapi permukaan konfigurasi, persona agen, alur lead, dan triase.

**Architecture:** Dua berkas katalog baru (`settings.ts`, `agents.ts`) dan tiga yang diperluas (`lead.ts`, `support.ts`, `notifications.ts`). Domain paling banyak jebakannya di sini adalah `scheduler`: sebagiannya `settings:*`, tapi seluruh `crons` **tak terjangkau agent token** dan tak boleh dibungkus.

**Tech Stack:** TypeScript strict, JSON Schema polos, vitest.

## Global Constraints

- Rencana 1–4 **wajib selesai**.
- **`scheduler/crons` TIDAK BOLEH dibungkus.** `capabilityForRoute` memberinya cabang `COOKIE_ONLY` sendiri (`agent-capabilities.ts:44`) dengan alasan yang tertulis di sana: *"cron adalah `POST /terminal/sessions` yang ditunda"*. Enam route cron akan diloncati sendiri oleh gerbang cakupan karena `COOKIE_ONLY`; **jangan** menambahkannya ke `UNWRAPPED` — itu akan menyamarkannya sebagai keputusan katalog, padahal ia keputusan gate server.
- Skema parameter diturunkan dari handler. Tabel menyebut `berkas:baris`.
- `MCP_TOOL_SCHEMA_VERSION` tetap 1.

---

## File Structure

- Create: `shared/src/mcp-catalog/settings.ts` (11), `agents.ts` (5)
- Modify: `shared/src/mcp-catalog/lead.ts` (+8), `support.ts` (+11), `notifications.ts` (+1), `index.ts`
- Modify: `shared/src/mcp-catalog.test.ts`
- Test: `shared/src/mcp-catalog.settings.test.ts`, `.agents.test.ts`, `.lead.test.ts`, `.support.test.ts`

---

### Task 1: `settings.ts` — 11 tool

| Tool | Method + path | Handler | mode | capability |
|---|---|---|---|---|
| `hanoman_settings_get` | GET `/settings` | `settings.ts:8` | read | `settings:read` |
| `hanoman_settings_set` | PUT `/settings` | `settings.ts:9` | write | `settings:write` |
| `hanoman_config_get` | GET `/config` | `config.ts:30` | read | `settings:read` |
| `hanoman_config_set` | PUT `/config` | `config.ts:34` | write | `settings:write` |
| `hanoman_config_unset` | DELETE `/config/:key` | `config.ts:58` | write | `settings:write` |
| `hanoman_scheduler_state` | GET `/scheduler/state` | `scheduler.ts:59` | read | `settings:read` |
| `hanoman_scheduler_queue` | GET `/scheduler/queue` | `scheduler.ts:62` | read | `settings:read` |
| `hanoman_scheduler_config_get` | GET `/scheduler/config` | `scheduler.ts:29` | read | `settings:read` |
| `hanoman_scheduler_config_set` | PUT `/scheduler/config` | `scheduler.ts:31` | write | `settings:write` |
| `hanoman_scheduler_queue_cancel` | POST `/scheduler/queue/:id/cancel` | `scheduler.ts:40` | write | `settings:write` |
| `hanoman_scheduler_queue_requeue` | POST `/scheduler/queue/:id/requeue` | `scheduler.ts:51` | write | `settings:write` |

Nol tool bermode `danger` di domain ini.

- [ ] **Step 1: Baca handler**

```bash
sed -n '1,20p' server/src/routes/settings.ts
sed -n '25,70p' server/src/routes/config.ts
sed -n '25,70p' server/src/routes/scheduler.ts
```

Perhatikan: `config.ts:11` mencatat bahwa `capabilityForRoute` tak pernah melihat isi — sebagian kunci config memuat kredensial. Deskripsi `hanoman_config_get` **wajib** menyebut bahwa nilai rahasia diredaksi server, dan bila ternyata tidak diredaksi, **hentikan task ini dan laporkan** alih-alih membungkusnya.

- [ ] **Step 2: Tulis test yang gagal**

```ts
describe("katalog settings", () => {
  it("11 tool, nol danger", () => {
    expect(SETTINGS_TOOLS).toHaveLength(11);
    expect(SETTINGS_TOOLS.some((t) => t.mode === "danger")).toBe(false);
  });

  it("TAK ADA tool cron — cron adalah POST /terminal/sessions yang ditunda", () => {
    for (const t of SETTINGS_TOOLS) expect(t.samplePath, t.name).not.toMatch(/crons/);
  });

  it("config_get menyebut redaksi nilai rahasia", () => {
    expect(SETTINGS_TOOLS.find((t) => t.name === "hanoman_config_get")!.description)
      .toMatch(/redaksi|diredaksi|disembunyikan/i);
  });
});
```

- [ ] **Step 3: Jalankan test, pastikan GAGAL** — Run: `pnpm vitest --run shared/src/mcp-catalog.settings.test.ts`

- [ ] **Step 4: Tulis `settings.ts`.** Kepala berkas:

```ts
// ADR-0099 · ADR-0155 · katalog tool domain `settings`: setelan instance, config runtime, dan
// scheduler NON-CRON. Enam route `/scheduler/crons*` sengaja tak ada di sini dan tak akan pernah
// ada tanpa ADR baru: `capabilityForRoute` memberinya cabang COOKIE_ONLY sendiri karena satu baris
// cron membuka sesi agen berulang tanpa manusia di pane (agent-capabilities.ts:44).
```

- [ ] **Step 5: Rangkai di `index.ts`, jalankan test, pastikan LULUS**

```bash
pnpm vitest --run shared/src/mcp-catalog.settings.test.ts shared/src/mcp-catalog.test.ts
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/mcp-coverage.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add shared/src/mcp-catalog/settings.ts shared/src/mcp-catalog/index.ts shared/src/mcp-catalog.settings.test.ts
git commit -m "feat(mcp): 11 tool settings/config/scheduler, tanpa cron"
```

---

### Task 2: `agents.ts` — 5 tool

| Tool | Method + path | Handler | mode | capability |
|---|---|---|---|---|
| `hanoman_agents_catalog` | GET `/custom-agents/catalog` | `custom-agents.ts:82` | read | `agents:read` |
| `hanoman_agents_list` | GET `/custom-agents` | `custom-agents.ts:91` | read | `agents:read` |
| `hanoman_agent_create` | POST `/custom-agents` | `custom-agents.ts:108` | write | `agents:write` |
| `hanoman_agent_update` | PATCH `/custom-agents/:id` | `custom-agents.ts:151` | write | `agents:write` |
| `hanoman_agent_delete` | DELETE `/custom-agents/:id` | `custom-agents.ts:210` | **danger** | `agents:write` |

`hanoman_agent_delete` masuk `DESTRUCTIVE_BUT_WRITE` (Task 5).

- [ ] **Step 1: Baca handler** — `sed -n '82,230p' server/src/routes/custom-agents.ts`

Catat: mana yang global dan mana yang per-project, dan apakah agen bawaan sistem (delapan persona yang di-seed) bisa dihapus. Bila tak bisa, deskripsi `hanoman_agent_delete` wajib menyebutnya — kalau tidak, agen akan mencoba dan mendapat error yang membingungkan.

- [ ] **Step 2: Tulis test yang gagal**

```ts
describe("katalog agents", () => {
  it("5 tool, satu danger", () => {
    expect(AGENTS_TOOLS).toHaveLength(5);
    expect(AGENTS_TOOLS.filter((t) => t.mode === "danger").map((t) => t.name))
      .toEqual(["hanoman_agent_delete"]);
  });

  it("agent_create menyebut bahwa definisinya dipakai SETIAP sesi baru", () => {
    expect(AGENTS_TOOLS.find((t) => t.name === "hanoman_agent_create")!.description)
      .toMatch(/setiap sesi baru/i);
  });
});
```

- [ ] **Step 3: Jalankan test, pastikan GAGAL** — Run: `pnpm vitest --run shared/src/mcp-catalog.agents.test.ts`

- [ ] **Step 4: Tulis `agents.ts` dan rangkai di `index.ts`.**

- [ ] **Step 5: Jalankan test, pastikan LULUS** — perintah sama seperti Task 1 Step 5.

- [ ] **Step 6: Commit**

```bash
git add shared/src/mcp-catalog/agents.ts shared/src/mcp-catalog/index.ts shared/src/mcp-catalog.agents.test.ts
git commit -m "feat(mcp): 5 tool custom agent"
```

---

### Task 3: `lead.ts` — 8 tool baru (total 10)

| Tool | Method + path | Handler | mode | capability |
|---|---|---|---|---|
| `hanoman_lead_status` | GET `/lead/status` | `lead.ts:36` | read | `lead:read` |
| `hanoman_lead_config_get` | GET `/lead/config` | `lead.ts:27` | read | `lead:read` |
| `hanoman_lead_flows_list` | GET `/lead/flows` | `lead.ts:56` | read | `lead:read` |
| `hanoman_lead_config_set` | PUT `/lead/config` | `lead.ts:29` | write | `lead:write` |
| `hanoman_lead_flow_cancel` | POST `/lead/flows/:id/cancel` | `lead.ts:76` | write | `lead:write` |
| `hanoman_lead_decision_override` | POST `/lead/decisions/:id/override` | `lead.ts:170` | write | `lead:write` |
| `hanoman_lead_decision_cancel` | POST `/lead/decisions/:id/cancel` | `lead.ts:189` | write | `lead:write` |
| `hanoman_lead_flow_submit` | POST `/lead/flows/:id/submit` | `lead.ts:69` | **danger** | `lead:write` |

`hanoman_lead_flow_submit` bermode `danger` karena submit alur lead **menggerakkan sesi** — masuk `DESTRUCTIVE_BUT_WRITE`.

- [ ] **Step 1: Baca handler** — `sed -n '25,200p' server/src/routes/lead.ts`

- [ ] **Step 2: Tulis test yang gagal**

```ts
describe("katalog lead", () => {
  it("10 tool, satu danger", () => {
    expect(LEAD_TOOLS).toHaveLength(10);
    expect(LEAD_TOOLS.filter((t) => t.mode === "danger").map((t) => t.name))
      .toEqual(["hanoman_lead_flow_submit"]);
  });

  it("lead_ask lama tak tersentuh", () => {
    expect(LEAD_TOOLS.find((t) => t.name === "hanoman_lead_ask")!.mode).toBe("write");
  });
});
```

- [ ] **Step 3: Jalankan test, pastikan GAGAL** — Run: `pnpm vitest --run shared/src/mcp-catalog.lead.test.ts`

- [ ] **Step 4: Tambahkan delapan entri.** Deskripsi `flow_submit`:

```ts
    description:
      "BERBAHAYA — mengirim alur lead untuk diputuskan. Putusan lead bisa MENGGERAKKAN SESI: ia dapat membuka, mengarahkan, atau menutup sesi agen tanpa manusia di pane. Pakai hanoman_lead_flows_list lebih dulu untuk melihat isi alurnya. Hanya muncul saat tingkat `--danger` menyala.",
```

- [ ] **Step 5: Jalankan test, pastikan LULUS** — perintah sama seperti Task 1 Step 5.

- [ ] **Step 6: Commit**

```bash
git add shared/src/mcp-catalog/lead.ts shared/src/mcp-catalog.lead.test.ts
git commit -m "feat(mcp): 8 tool lead termasuk flow_submit di balik --danger"
```

---

### Task 4: `support.ts` (+11) & `notifications.ts` (+1)

| Tool | Method + path | Handler | mode | capability |
|---|---|---|---|---|
| `hanoman_ticket_attachment_read` | GET `/tickets/:id/attachments/:attId` | `tickets.ts:52` | read | `support:read` |
| `hanoman_ticket_accept` | POST `/tickets/:id/accept` | `tickets.ts:67` | write | `support:write` |
| `hanoman_ticket_unlink` | POST `/tickets/:id/unlink` | `tickets.ts:82` | write | `support:write` |
| `hanoman_ticket_reject` | POST `/tickets/:id/reject` | `tickets.ts:92` | write | `support:write` |
| `hanoman_ticket_update` | PATCH `/tickets/:id` | `tickets.ts:102` | write | `support:write` |
| `hanoman_ticket_delete` | DELETE `/tickets/:id` | `tickets.ts:121` | **danger** | `support:write` |
| `hanoman_github_issues_pull` | POST `/projects/:id/github/pull` | `github-issues.ts:46` | write | `support:write` |
| `hanoman_github_issues_accept_bulk` | POST `/github-issues/accept` | `github-issues.ts:71` | write | `support:write` |
| `hanoman_github_issue_accept` | POST `/github-issues/:id/accept` | `github-issues.ts:88` | write | `support:write` |
| `hanoman_github_issue_reject` | POST `/github-issues/:id/reject` | `github-issues.ts:99` | write | `support:write` |
| `hanoman_github_issue_unlink` | POST `/github-issues/:id/unlink` | `github-issues.ts:108` | write | `support:write` |
| `hanoman_notifications_clear` | DELETE `/notifications` | `notifications.ts:15` | **danger** | `notifications:write` |

Dua tool `danger`, keduanya bercapability `:write` → `DESTRUCTIVE_BUT_WRITE`.

- [ ] **Step 1: Baca handler**

```bash
sed -n '45,140p' server/src/routes/tickets.ts
sed -n '40,120p' server/src/routes/github-issues.ts
sed -n '1,25p' server/src/routes/notifications.ts
```

Perhatikan: `accept` melahirkan backlog. Bila handler-nya menerima parameter yang menentukan bentuk backlog (priority, project, goal), semuanya wajib muncul di skema — menerima tiket tanpa kendali atas backlog yang lahir adalah persis kelas kejutan yang katalog ini ada untuk mencegahnya.

- [ ] **Step 2: Tulis test yang gagal**

```ts
describe("katalog support", () => {
  it("14 tool, satu danger", () => {
    expect(SUPPORT_TOOLS).toHaveLength(14);
    expect(SUPPORT_TOOLS.filter((t) => t.mode === "danger").map((t) => t.name))
      .toEqual(["hanoman_ticket_delete"]);
  });

  it("accept_bulk dan accept per-issue adalah tool BERBEDA — jalur massalnya tak tersembunyi", () => {
    expect(SUPPORT_TOOLS.find((t) => t.name === "hanoman_github_issues_accept_bulk")).toBeTruthy();
    expect(SUPPORT_TOOLS.find((t) => t.name === "hanoman_github_issue_accept")).toBeTruthy();
  });
});

describe("katalog notifications", () => {
  it("3 tool, satu danger", () => {
    expect(NOTIFICATIONS_TOOLS).toHaveLength(3);
    expect(NOTIFICATIONS_TOOLS.filter((t) => t.mode === "danger").map((t) => t.name))
      .toEqual(["hanoman_notifications_clear"]);
  });
});
```

- [ ] **Step 3: Jalankan test, pastikan GAGAL** — Run: `pnpm vitest --run shared/src/mcp-catalog.support.test.ts`

- [ ] **Step 4: Tambahkan dua belas entri.**

- [ ] **Step 5: Jalankan test, pastikan LULUS** — perintah sama seperti Task 1 Step 5.

- [ ] **Step 6: Commit**

```bash
git add shared/src/mcp-catalog/support.ts shared/src/mcp-catalog/notifications.ts shared/src/mcp-catalog.support.test.ts
git commit -m "feat(mcp): 12 tool support & notifications"
```

---

### Task 5: Daftar-kecuali & verifikasi

- [ ] **Step 1: Tambahkan lima nama ke `DESTRUCTIVE_BUT_WRITE`**

```ts
  "hanoman_agent_delete", "hanoman_lead_flow_submit",
  "hanoman_ticket_delete", "hanoman_notifications_clear",
```

- [ ] **Step 2: Jalankan seluruh test katalog**

```bash
pnpm vitest --run shared/src/
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/mcp-coverage.test.ts
```
Expected: PASS.

- [ ] **Step 3: Hitung tool nyata lewat CLI**

```bash
pnpm -F hanoman build
HANOMAN_HOST=http://localhost:8787 HANOMAN_AGENT_TOKEN=hnm_agt_… \
  node cli/dist/hanoman.js mcp <<< '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["result"]["tools"]))'
```
Expected: **103** tanpa `--danger` (126 tool sudah lahir, 23 di antaranya danger). Dengan `HANOMAN_MCP_DANGER=1`: **126**.

- [ ] **Step 4: Commit**

```bash
git add shared/src/mcp-catalog.test.ts docs/superpowers/plans/2026-08-25-mcp-5-katalog-settings-agents-lead-support.md
git commit -m "test(mcp): daftar destruktif settings/agents/lead/support"
```
