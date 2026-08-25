# MCP Rencana 1 — Fondasi capability berbahaya

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Memasang empat capability berbahaya (`sessions:spawn`, `ide:git`, `backlog:lifecycle`, `vps:exec`) sebagai batas otorisasi nyata di server, dan menyempitkan token yang sudah terbit.

**Architecture:** Kosakata capability di `shared/src/agent.ts` bertambah empat entri dengan akses ketiga `danger`. `capabilityForRoute` memindahkan route berbahaya ke capability barunya. Satu gerbang tambahan dipasang di handler `PATCH /specs/:id` karena keputusannya bergantung isi body — sesuatu yang `capabilityForRoute` sengaja tak pernah lihat. Panel Settings mendapat kolom keempat. **Nol tool MCP baru** di rencana ini; katalog disentuh Rencana 2.

**Tech Stack:** TypeScript strict, Fastify, Prisma 6 (SQLite), zod v3, React 19 + Vite, vitest.

## Global Constraints

- Sumber kebenaran desain: `docs/superpowers/specs/2026-08-25-mcp-cakupan-penuh-design.md`.
- **Tidak ada Prisma migration.** `AgentToken.capabilities` bertipe `Json` (`server/prisma/schema.prisma:426`); menambah nilai capability tak mengubah skema, dan pilihan "sempitkan" berarti tak ada baris token yang disentuh.
- `grantsCapability` (`shared/src/agent.ts:85`) **tidak boleh diubah aturannya**. `:write` mengimplikasikan `:read` dan itu saja. Akses `danger` tak pernah diimplikasikan apa pun — kalau diimplikasikan, seluruh rencana ini kosmetik.
- `capabilityForRoute` harus tetap fungsi murni `(method, path)`. Jangan pernah menambahkan parameter body ke sana.
- Setiap perubahan `internal/docs/**` masuk commit yang sama.
- Test dijalankan dengan `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db"` dan `--no-file-parallelism` bila menyentuh test server.

---

## File Structure

- Modify: `shared/src/agent.ts` — kosakata capability + metadata UI
- Modify: `server/src/services/agent-capabilities.ts` — peta route→capability
- Modify: `server/src/routes/specs.ts` — gerbang `{stage}` di handler
- Modify: `server/src/services/telegram/bootstrap.ts` — daftar capability wajib gateway
- Modify: `src/src/screens/SettingsScreen.tsx` — kolom keempat grid + kartu peringatan
- Test: `shared/src/agent.test.ts`, `server/test/agent-capabilities.test.ts`, `server/test/specs.route.test.ts`, `server/test/telegram-credentials.test.ts`
- Create: `internal/docs/adr/0155-mcp-cakupan-penuh-capability-danger.md`

---

### Task 1: Kosakata capability bertambah empat, dengan akses ketiga

**Files:**
- Modify: `shared/src/agent.ts:5` (CAPABILITY_IDS), `:31` (zCapabilityInfo), `:38` (CAPABILITIES)
- Test: `shared/src/agent.test.ts`

**Interfaces:**
- Consumes: —
- Produces: `Capability` kini memuat `"sessions:spawn" | "ide:git" | "backlog:lifecycle" | "vps:exec"`. `CapabilityInfo.access: "read" | "write" | "danger"`.

- [x] **Step 1: Tulis test yang gagal**

Di `shared/src/agent.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CAPABILITIES, CAPABILITY_IDS, grantsCapability, type Capability } from "./agent";

describe("capability berbahaya", () => {
  const DANGER = ["sessions:spawn", "ide:git", "backlog:lifecycle", "vps:exec"] as const;

  it("keempatnya ada di kosakata dan berakses danger", () => {
    for (const id of DANGER) {
      expect(CAPABILITY_IDS).toContain(id);
      expect(CAPABILITIES.find((c) => c.id === id)?.access).toBe("danger");
    }
  });

  it("write TIDAK mengimplikasikan danger — kalau iya, pemecahannya kosmetik", () => {
    expect(grantsCapability(["sessions:write"], "sessions:spawn" as Capability)).toBe(false);
    expect(grantsCapability(["ide:write"], "ide:git" as Capability)).toBe(false);
    expect(grantsCapability(["backlog:write"], "backlog:lifecycle" as Capability)).toBe(false);
    expect(grantsCapability(["vps:write"], "vps:exec" as Capability)).toBe(false);
  });

  it("danger TIDAK mengimplikasikan read", () => {
    expect(grantsCapability(["sessions:spawn"], "sessions:read" as Capability)).toBe(false);
  });

  it("setiap capability danger menyandang risk", () => {
    for (const id of DANGER) expect(CAPABILITIES.find((c) => c.id === id)?.risk).toBeTruthy();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm vitest --run shared/src/agent.test.ts`
Expected: FAIL — `CAPABILITY_IDS` tak memuat `sessions:spawn`.

- [x] **Step 3: Implementasi minimal**

Di `shared/src/agent.ts`, tambahkan ke akhir `CAPABILITY_IDS` (sebelum `] as const;`):

```ts
  // SPEC-<nnn> · ADR-0155 · akses KETIGA: `danger`. Dipecah dari `:write` karena empat operasi ini
  // bukan "menulis lebih banyak", melainkan menjalankan sesuatu di luar proses hanoman. `:write`
  // TIDAK mengimplikasikannya (lihat grantsCapability) — kalau diimplikasikan, pemecahan ini
  // kosmetik dan tak menghasilkan batas apa pun.
  "sessions:spawn", "ide:git", "backlog:lifecycle", "vps:exec",
```

Ubah `zCapabilityInfo` (`agent.ts:31`):

```ts
export const zCapabilityInfo = z.object({
  id: zCapability, domain: z.string(), access: z.enum(["read", "write", "danger"]),
  label: z.string(), desc: z.string(), risk: z.enum(["rce", "exec"]).optional(),
});
```

Tambahkan ke akhir array `CAPABILITIES`:

```ts
  { id: "sessions:spawn", domain: "sessions", access: "danger", label: "Sesi — buka sesi baru", desc: "Membuka sesi agen baru di worktree (menjalankan claude/codex). Dipisah dari Sesi — tulis: mengendalikan sesi yang sudah ada tidak lagi cukup untuk membuka yang baru.", risk: "rce" },
  { id: "ide:git", domain: "ide", access: "danger", label: "IDE/Git — operasi git", desc: "merge, rebase, pull, drop, hapus branch, hapus worktree. Mengubah sejarah dan menghapus pekerjaan; dipisah dari menulis berkas working tree.", risk: "exec" },
  { id: "backlog:lifecycle", domain: "backlog", access: "danger", label: "Backlog — siklus hidup", desc: "Integrate, hapus backlog, dan geser stage. Ketiganya menghapus artefak dokumen; dipisah dari menyunting isi backlog.", risk: "exec" },
  { id: "vps:exec", domain: "vps", access: "danger", label: "VPS — remote exec", desc: "console, session, provision, harden, remediate, probe, test. Menjalankan perintah di VPS produksi; dipisah dari mengelola daftar VPS & checklist.", risk: "exec" },
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm vitest --run shared/src/agent.test.ts`
Expected: PASS. `grantsCapability` tak disentuh — ia sudah mengembalikan `false` untuk `need` yang tak berakhiran `:read` dan tak ada di `granted`.

- [x] **Step 5: Commit**

```bash
git add shared/src/agent.ts shared/src/agent.test.ts
git commit -m "feat(mcp): empat capability berbahaya dengan akses ketiga danger"
```

---

### Task 2: `capabilityForRoute` memindahkan route berbahaya

**Files:**
- Modify: `server/src/services/agent-capabilities.ts:19-105`
- Test: `server/test/agent-capabilities.test.ts`

**Interfaces:**
- Consumes: `Capability` dari Task 1.
- Produces: `capabilityForRoute("POST", "/api/terminal/sessions") === "sessions:spawn"`, dst. Tanda tangan fungsi **tak berubah**: `(method: string, path: string) => Resolved`.

- [x] **Step 1: Tulis test yang gagal**

Di `server/test/agent-capabilities.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { capabilityForRoute, checkAgentCapability } from "../src/services/agent-capabilities";

describe("route berbahaya pindah ke capability danger", () => {
  it("spawn sesi ≠ menulis sesi", () => {
    expect(capabilityForRoute("POST", "/api/terminal/sessions")).toBe("sessions:spawn");
    expect(capabilityForRoute("POST", "/api/terminal/sessions/s1/steer")).toBe("sessions:write");
    expect(capabilityForRoute("GET", "/api/terminal/sessions")).toBe("sessions:read");
  });

  it("operasi git ≠ menulis berkas", () => {
    for (const p of ["git", "git/merge", "git/rebase", "git/pull", "git/drop"])
      expect(capabilityForRoute("POST", `/api/projects/p/${p}`), p).toBe("ide:git");
    expect(capabilityForRoute("POST", "/api/projects/p/branches/delete")).toBe("ide:git");
    expect(capabilityForRoute("POST", "/api/projects/p/worktrees/delete")).toBe("ide:git");
    expect(capabilityForRoute("PUT", "/api/projects/p/file")).toBe("ide:write");
    expect(capabilityForRoute("GET", "/api/projects/p/worktrees")).toBe("ide:read");
  });

  it("siklus hidup backlog ≠ menyunting backlog", () => {
    expect(capabilityForRoute("DELETE", "/api/specs/SPEC-1")).toBe("backlog:lifecycle");
    expect(capabilityForRoute("POST", "/api/specs/SPEC-1/integrate")).toBe("backlog:lifecycle");
    expect(capabilityForRoute("POST", "/api/specs")).toBe("backlog:write");
    // PATCH tetap backlog:write di sini — cabang {stage} hidup di handler (Task 3).
    expect(capabilityForRoute("PATCH", "/api/specs/SPEC-1")).toBe("backlog:write");
  });

  it("remote exec VPS ≠ mengelola daftar VPS", () => {
    for (const p of ["console", "session", "harden", "test", "probe", "provision", "provision/preview", "remediate", "remediate/preview"])
      expect(capabilityForRoute("POST", `/api/vps/v1/${p}`), p).toBe("vps:exec");
    expect(capabilityForRoute("POST", "/api/vps/v1/audit")).toBe("vps:exec");
    expect(capabilityForRoute("GET", "/api/vps")).toBe("vps:read");
    expect(capabilityForRoute("POST", "/api/vps")).toBe("vps:write");
    expect(capabilityForRoute("GET", "/api/vps/v1/checklist")).toBe("vps:read");
    expect(capabilityForRoute("POST", "/api/vps/v1/items/i1/attest")).toBe("vps:write");
  });

  it("403 menyebut capability yang kurang, bukan sekadar cookie-only", () => {
    const r = checkAgentCapability(["sessions:write"], "POST", "/api/terminal/sessions");
    expect(r).toMatchObject({ ok: false, status: 403, need: "sessions:spawn", reason: "capability" });
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/agent-capabilities.test.ts`
Expected: FAIL — `POST /api/terminal/sessions` masih `sessions:write`.

- [x] **Step 3: Implementasi minimal**

Di `server/src/services/agent-capabilities.ts`, tambahkan konstanta di dekat `IDE_SUBS`:

```ts
// ADR-0155 · sub-path git yang MENGUBAH SEJARAH atau MENGHAPUS pekerjaan. Dipisah dari `ide:write`
// yang hanya menulis isi berkas working tree.
const IDE_GIT_SUBS = new Set(["git", "branches", "worktrees"]);
// ADR-0155 · aksi VPS yang menjalankan perintah di mesin remote. Sisanya (CRUD, checklist,
// items/na, items/attest, components) tetap `vps:read|write`.
const VPS_EXEC_SUBS = new Set([
  "console", "session", "audit", "probe", "test", "harden", "provision", "remediate",
]);
```

Ganti cabang `terminal` menjadi:

```ts
  if (top === "terminal") {
    if (seg[1] === "workspace") return "COOKIE_ONLY";
    if (seg[seg.length - 1] === "ws") return "sessions:write";
    // ADR-0155 · membuka sesi BARU ≠ mengendalikan sesi yang ada. Dicocokkan ke panjang segmen
    // PERSIS (`/terminal/sessions`), bukan prefix — `/terminal/sessions/:id/steer` juga berawalan
    // sama, dan memetakannya lewat prefix mengulang kelas bug SPEC-405.
    if (method === "POST" && seg.length === 2 && seg[1] === "sessions") return "sessions:spawn";
    return rw("sessions");
  }
```

Ganti cabang `specs`:

```ts
  if (top === "specs") {
    // ADR-0155 · integrate & delete menghapus artefak dokumen. PATCH {stage} juga — tapi
    // keputusannya bergantung BODY, dan fungsi ini sengaja tak pernah melihat body; gerbangnya
    // ada di handler `PATCH /specs/:id` (routes/specs.ts).
    if (method === "DELETE" && seg.length === 2) return "backlog:lifecycle";
    if (seg[2] === "integrate") return "backlog:lifecycle";
    return rw("backlog");
  }
```

Ganti cabang `vps`:

```ts
  if (top === "vps") {
    // seg = ["vps", ":id", sub, …]. `remediate/preview` & `provision/preview` ikut sub-nya.
    const sub = seg[2] ?? "";
    if (VPS_EXEC_SUBS.has(sub)) return "vps:exec";
    return rw("vps");
  }
```

Di dalam cabang `projects`, sisipkan **sebelum** `if (sub && IDE_SUBS.has(sub))`:

```ts
    // ADR-0155 · git/branches/worktrees bercabang MENURUT METHOD: membaca daftar branch atau
    // worktree tetap `ide:read`; yang menulis di ketiga sub-path ini selalu merusak, jadi
    // `ide:write` tak pernah cukup.
    if (sub && IDE_GIT_SUBS.has(sub)) return read ? "ide:read" : "ide:git";
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/agent-capabilities.test.ts`
Expected: PASS.

- [x] **Step 5: Jalankan seluruh test server yang tersentuh**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/`
Expected: PASS. Bila ada test lama yang mengasumsikan `sessions:write` cukup untuk `POST /terminal/sessions`, perbarui test itu — asumsinya memang sudah tidak benar.

- [x] **Step 6: Commit**

```bash
git add server/src/services/agent-capabilities.ts server/test/agent-capabilities.test.ts
git commit -m "feat(mcp): route berbahaya pindah ke capability danger"
```

---

### Task 3: Gerbang `{stage}` di handler `PATCH /specs/:id`

**Files:**
- Modify: `server/src/routes/specs.ts` (handler `patch /specs/:id`)
- Test: `server/test/specs.route.test.ts`

**Interfaces:**
- Consumes: `checkAgentCapability` dari `server/src/services/agent-capabilities.ts`, `Capability` dari Task 1.
- Produces: —

**Kenapa di sini, bukan di `capabilityForRoute`:** fungsi itu murni `(method, path)`, dan kemurnian itulah yang membuat uji kontrak katalog MCP (`samplePath`/`sampleMethod`) mungkin. Konsekuensi yang harus disadari: gerbang ini **tak terlihat** uji kontrak, jadi ia wajib punya test sendiri.

- [x] **Step 1: Tulis test yang gagal**

Tambahkan ke `server/test/specs.route.test.ts`:

```ts
describe("PATCH /specs/:id — {stage} menuntut backlog:lifecycle", () => {
  it("token backlog:write TANPA lifecycle: 403 saat mengirim stage", async () => {
    const token = await mintAgentToken(["backlog:write"]);
    const r = await app.inject({
      method: "PATCH", url: "/api/specs/SPEC-1",
      headers: { authorization: `Bearer ${token}` },
      payload: { stage: "execute" },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ need: "backlog:lifecycle" });
  });

  it("token yang sama: 200 saat mengirim field non-stage", async () => {
    const token = await mintAgentToken(["backlog:write"]);
    const r = await app.inject({
      method: "PATCH", url: "/api/specs/SPEC-1",
      headers: { authorization: `Bearer ${token}` },
      payload: { title: "judul baru" },
    });
    expect(r.statusCode).toBe(200);
  });

  it("token dengan lifecycle: 200 saat mengirim stage", async () => {
    const token = await mintAgentToken(["backlog:write", "backlog:lifecycle"]);
    const r = await app.inject({
      method: "PATCH", url: "/api/specs/SPEC-1",
      headers: { authorization: `Bearer ${token}` },
      payload: { stage: "execute" },
    });
    expect(r.statusCode).toBe(200);
  });

  it("sesi cookie tak tersentuh gerbang ini", async () => {
    const r = await app.inject({
      method: "PATCH", url: "/api/specs/SPEC-1",
      headers: { cookie: await adminCookie() },
      payload: { stage: "execute" },
    });
    expect(r.statusCode).toBe(200);
  });
});
```

Bila helper `mintAgentToken` / `adminCookie` belum ada di berkas itu, pakai helper yang sudah dipakai test route lain di `server/test/` — cari dengan `grep -rn "mintAgentToken\|adminCookie" server/test/ | head`.

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/specs.route.test.ts`
Expected: FAIL — kasus pertama menjawab 200, bukan 403.

- [x] **Step 3: Implementasi minimal**

Di `server/src/routes/specs.ts`, di awal handler `PATCH /specs/:id`, sebelum validasi payload:

```ts
    // ADR-0155 · gerbang KEDUA, sadar-body. `capabilityForRoute` memetakan PATCH /specs/:id ke
    // `backlog:write` dan sengaja tak pernah melihat body (kemurnian (method, path) itulah yang
    // membuat uji kontrak katalog MCP mungkin). Menggeser stage menghapus artefak dokumen, jadi
    // ia menuntut `backlog:lifecycle` — diperiksa di sini, satu-satunya tempat yang tahu body.
    // Gerbang ini TAK TERLIHAT uji kontrak katalog; test-nya ada di specs.route.test.ts.
    if ((req.body as { stage?: unknown } | null)?.stage !== undefined) {
      const agent = req.agentToken;   // di-set gate agent di app.ts; undefined untuk sesi cookie
      if (agent && !grantsCapability(agent.capabilities, "backlog:lifecycle")) {
        return reply.code(403).send({
          error: "forbidden", need: "backlog:lifecycle", reason: "capability",
          message: "Menggeser stage menghapus artefak dokumen dan menuntut capability `backlog:lifecycle`. Minta manusia mencentangnya di Settings → Akses AI Agent.",
        });
      }
    }
```

Periksa nama field request yang membawa agent token di `server/src/app.ts:191` (`agentTokenFromReq`) dan sesuaikan `req.agentToken` dengan yang benar-benar dipasang di sana — jangan menebak namanya.

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/specs.route.test.ts`
Expected: PASS, keempat kasus.

- [x] **Step 5: Commit**

```bash
git add server/src/routes/specs.ts server/test/specs.route.test.ts
git commit -m "feat(mcp): gerbang backlog:lifecycle untuk PATCH /specs/:id {stage}"
```

---

### Task 4: Gateway Telegram menuntut empat capability baru

**Files:**
- Modify: `server/src/services/telegram/bootstrap.ts:18-24`
- Test: `server/test/telegram-credentials.test.ts`

**Interfaces:**
- Consumes: kosakata Task 1.
- Produces: `TELEGRAM_REQUIRED_CAPABILITIES` panjang 27 (dari 23).

**Radius ledakan yang disengaja:** `credentials.ts:60` menolak menyalakan gateway bila **satu pun** capability kurang — bukan 403 per-panggilan, tapi gateway tak jalan. Ini kelas kegagalan SPEC-491 ("Telegram diam total"). Karena itu Task 5 harus menampilkan `missingCapabilities` di panel Settings, dan release note harus menyebutnya.

- [x] **Step 1: Tulis test yang gagal**

```ts
import { describe, expect, it } from "vitest";
import { TELEGRAM_REQUIRED_CAPABILITIES } from "../src/services/telegram/bootstrap";
import { verifyTelegramAgentToken } from "../src/services/telegram/credentials";

describe("gateway Telegram menuntut capability berbahaya", () => {
  it("keempatnya wajib", () => {
    for (const c of ["sessions:spawn", "ide:git", "backlog:lifecycle", "vps:exec"])
      expect(TELEGRAM_REQUIRED_CAPABILITIES).toContain(c);
  });

  it("token lama (23 capability) ditolak dengan daftar yang kurang, bukan diam", async () => {
    const old = TELEGRAM_REQUIRED_CAPABILITIES.filter(
      (c) => !["sessions:spawn", "ide:git", "backlog:lifecycle", "vps:exec"].includes(c));
    const gate = await verifyTelegramAgentToken("hnm_agt_x", {
      verifyAgentToken: async () => ({ id: "t1", capabilities: [...old] }),
    });
    expect(gate.ok).toBe(false);
    expect(gate.ok === false && gate.missing).toEqual(
      expect.arrayContaining(["sessions:spawn", "ide:git", "backlog:lifecycle", "vps:exec"]));
  });
});
```

Sesuaikan bentuk `deps` yang disuntikkan dengan `TelegramGateDeps` yang nyata di `server/src/services/telegram/credentials.ts:39` — baca dulu, jangan menebak.

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/telegram-credentials.test.ts`
Expected: FAIL — daftar belum memuat keempatnya.

- [x] **Step 3: Implementasi minimal**

Di `server/src/services/telegram/bootstrap.ts`, tambahkan sebelum `] as const;`:

```ts
  // ADR-0155 · empat capability berbahaya yang dipecah dari `:write`. Gateway Telegram menjalankan
  // pekerjaan operator penuh — termasuk membuka sesi — jadi ia menuntut semuanya. Konsekuensi yang
  // disengaja: token gateway lama BERHENTI menyalakan gateway sampai manusia mencentang keempatnya
  // (credentials.ts:60 menolak start bila satu pun kurang). Panel Settings menampilkan daftarnya.
  "sessions:spawn", "ide:git", "backlog:lifecycle", "vps:exec",
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/telegram-credentials.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add server/src/services/telegram/bootstrap.ts server/test/telegram-credentials.test.ts
git commit -m "feat(mcp): gateway Telegram menuntut empat capability berbahaya"
```

---

### Task 5: Grid Settings mendapat kolom keempat + kartu peringatan

**Files:**
- Modify: `src/src/screens/SettingsScreen.tsx:448-516`
- Test: `src/test/SettingsScreen.agent.test.tsx`

**Interfaces:**
- Consumes: `CAPABILITIES` (dengan `access: "danger"`) dan `CAPABILITY_DOMAINS` dari `@hanoman/shared`.
- Produces: —

- [x] **Step 1: Tulis test yang gagal**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("grid capability", () => {
  it("punya kolom berbahaya dengan checkbox terpisah", async () => {
    render(<SettingsScreen … />);   // pakai pola render yang sudah dipakai test SettingsScreen lain
    expect(await screen.findByText("berbahaya")).toBeTruthy();
    expect(screen.getByLabelText("sessions:spawn")).toBeTruthy();
    expect(screen.getByLabelText("ide:git")).toBeTruthy();
    expect(screen.getByLabelText("backlog:lifecycle")).toBeTruthy();
    expect(screen.getByLabelText("vps:exec")).toBeTruthy();
  });

  it("token yang kehilangan hak menampilkan kalimat yang menyebut haknya", async () => {
    // token ber-`sessions:write` tanpa `sessions:spawn`
    render(<SettingsScreen … />);
    expect(await screen.findByText(/dulu bisa membuka sesi baru/i)).toBeTruthy();
  });
});
```

- [x] **Step 2: Jalankan test, pastikan GAGAL**

Run: `pnpm vitest --run src/test/SettingsScreen.agent.test.tsx`
Expected: FAIL — teks "berbahaya" tak ada.

- [x] **Step 3: Implementasi minimal**

Ubah grid (`SettingsScreen.tsx:496`) dari tiga kolom jadi empat:

```tsx
          <div className="hn-grid-mobile" style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr auto auto auto", gap: "6px 14px", alignItems: "center" }}>
            <div />
            <div style={{ fontSize: 11.5, color: "var(--text-subtle)", textAlign: "center" }}>baca</div>
            <div style={{ fontSize: 11.5, color: "var(--text-subtle)", textAlign: "center" }}>tulis</div>
            <div style={{ fontSize: 11.5, color: "var(--danger-600)", textAlign: "center" }}>berbahaya</div>
            {domains.map((d) => {
              const r = caps.find((c) => c.domain === d && c.access === "read");
              const w = caps.find((c) => c.domain === d && c.access === "write");
              const x = caps.find((c) => c.domain === d && c.access === "danger");
              const meta = CAPABILITY_DOMAINS.find((m) => m.domain === d);
              return (
                <React.Fragment key={d}>
                  <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                    <div style={{ fontWeight: 600, color: "var(--text-strong)" }}>{meta?.label ?? d}{w?.risk || x?.risk ? " ⚠" : ""}</div>
                    {meta?.desc && <div style={{ fontSize: 11.5, color: "var(--text-subtle)", lineHeight: 1.4, marginTop: 1 }}>{meta.desc}</div>}
                    {x && <div style={{ fontSize: 11.5, color: "var(--danger-600)", lineHeight: 1.4, marginTop: 2 }}>{x.desc}</div>}
                  </div>
                  <div style={{ textAlign: "center" }}>{r && <input type="checkbox" aria-label={r.id} checked={picked.includes(r.id)} onChange={() => toggleCap(r.id)} />}</div>
                  <div style={{ textAlign: "center" }}>{w && <input type="checkbox" aria-label={w.id} checked={picked.includes(w.id)} onChange={() => toggleCap(w.id)} />}</div>
                  <div style={{ textAlign: "center" }}>{x && <input type="checkbox" aria-label={x.id} checked={picked.includes(x.id)} onChange={() => toggleCap(x.id)} />}</div>
                </React.Fragment>
              );
            })}
          </div>
```

Tambahkan kartu peringatan tepat di atas daftar token aktif. `LOST` adalah data murni, bukan logika tersebar:

```tsx
// ADR-0155 · token yang haknya menyempit. Kalimatnya menyebut HAK YANG HILANG — checkbox kosong
// baru tak berbicara apa-apa kepada orang yang tak membaca release note.
const LOST: { had: string; needs: string; sentence: string }[] = [
  { had: "sessions:write", needs: "sessions:spawn", sentence: "dulu bisa membuka sesi baru" },
  { had: "ide:write", needs: "ide:git", sentence: "dulu bisa merge/rebase & menghapus branch" },
  { had: "backlog:write", needs: "backlog:lifecycle", sentence: "dulu bisa integrate & menghapus backlog" },
  { had: "vps:write", needs: "vps:exec", sentence: "dulu bisa menjalankan perintah di VPS" },
];

function lostRights(caps: string[]): string[] {
  return LOST.filter((l) => caps.includes(l.had) && !caps.includes(l.needs)).map((l) => l.sentence);
}
```

Render di dalam `SettingRow` tiap token aktif:

```tsx
              {lostRights(t.capabilities).length > 0 && (
                <div style={{ fontSize: 11.5, color: "var(--danger-600)", lineHeight: 1.4, marginTop: 4 }}>
                  Token ini {lostRights(t.capabilities).join(", ")} — sekarang tidak, sampai capability berbahayanya dicentang. Cabut lalu buat ulang bila memang perlu.
                </div>
              )}
```

- [x] **Step 4: Jalankan test, pastikan LULUS**

Run: `pnpm vitest --run src/test/SettingsScreen.agent.test.tsx`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/src/screens/SettingsScreen.tsx src/test/SettingsScreen.agent.test.tsx
git commit -m "feat(mcp): kolom capability berbahaya + peringatan hak yang menyempit"
```

---

### Task 6: ADR-0155 + docs yang tersentuh

**Files:**
- Create: `internal/docs/adr/0155-mcp-cakupan-penuh-capability-danger.md`
- Modify: `internal/docs/README.md` (tautkan ADR baru), `internal/docs/architecture/stack.md` (bila menyebut kosakata capability)

- [x] **Step 1: Periksa nomor ADR belum dipakai**

Run: `ls internal/docs/adr/ | grep -E "^015[0-9]"`
Bila `0155` sudah ada, pakai nomor bebas berikutnya dan **ganti seluruh rujukan `ADR-0155` di komentar kode yang sudah ditulis Task 1–5**. Tabrakan nomor ADR pernah terjadi di repo ini saat beberapa sesi berjalan bersamaan.

- [x] **Step 2: Tulis ADR**

Isinya menyalin bagian **Keputusan 1, 2, 3, 4, 6** dari spec `docs/superpowers/specs/2026-08-25-mcp-cakupan-penuh-design.md`, ditambah:
- kalimat eksplisit bahwa ADR ini **mengamandemen ADR-0099 §4** dan **ADR-0065**;
- kalimat eksplisit bahwa `--danger` (Rencana 2) **bukan** kontrol keamanan;
- catatan bahwa gerbang `{stage}` tak terlihat uji kontrak katalog dan karena itu punya test sendiri;
- catatan bahwa **tak ada Prisma migration** — `capabilities` bertipe `Json` dan tak ada baris yang disentuh.

- [x] **Step 3: Tautkan di index**

Tambahkan satu baris ke `internal/docs/README.md` di bagian ADR, mengikuti format baris tetangganya persis.

- [x] **Step 4: Commit**

```bash
git add internal/docs/
git commit -m "docs(mcp): ADR-0155 capability berbahaya + index"
```

---

### Task 7: Verifikasi menyeluruh rencana 1

- [x] **Step 1: Jalankan test yang tersentuh**

```bash
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism \
  shared/src/agent.test.ts server/test/ src/test/SettingsScreen.agent.test.tsx
```
Expected: PASS. Kegagalan ramai dengan 404/P2022 hampir selalu isolasi DB, bukan regresi — periksa `TEST_DATABASE_URL` sebelum menuduh kode.

- [x] **Step 2: Uji nyata terhadap server hidup**

```bash
pnpm dev        # di terminal lain
# buat token ber-`sessions:write` SAJA lewat Settings, lalu:
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:8787/api/terminal/sessions \
  -H "Authorization: Bearer hnm_agt_…" -H 'content-type: application/json' -d '{}'
```
Expected: `403`. Badan responsnya memuat `"need":"sessions:spawn"`.

- [x] **Step 3: Centang task di rencana ini dan commit**

```bash
git add docs/superpowers/plans/2026-08-25-mcp-1-fondasi-capability.md
git commit -m "docs(mcp): rencana 1 selesai"
```

---

## Catatan pelaksanaan (2026-08-25)

Lima penyimpangan dari rencana, semuanya karena rencana menebak dan kode berkata lain:

1. **`req.agent`, bukan `req.agentToken`** (`server/src/services/agent-auth.ts:6`).
2. **Bentuk 403 mengikuti yang sudah ada** — `{ error: "capability required", need }` (`app.ts:200`),
   bukan bentuk baru ber-`reason`/`message` yang ditulis rencana.
3. **`shared/src/agent.test.ts` tak ada**; yang ada `shared/test/agent.test.ts`, dan assertion-nya
   "12 domain × read/write = 24" — premis yang memang runtuh oleh akses ketiga. Diperluas di sana,
   dan berkas test baru yang sempat saya buat dibuang karena redundan.
4. **`branches` bukan permukaan `ide`.** Rencana 3 menulis `branches_unused → ide:read`; nyatanya
   `capabilityForRoute` memetakan seluruh `branches/*` ke `projects:*` (SPEC-360 sengaja menjauhkannya
   dari `IDE_SUBS`). Yang dipindahkan hanya `POST /branches/delete`; pembacaannya tetap `projects:read`.
   **Rencana 3 harus dikoreksi sebelum dieksekusi.**
5. **Berkas test Settings** bernama `src/test/settings-agent*.tsx`; `AgentAccessPanel` diekspor
   sendiri, jadi dirender langsung tanpa seluruh `SettingsScreen`.

Kegagalan test yang BUKAN regresi, semuanya dibuktikan bukan ditebak:

- `pty.test.ts` & `vps-ssh.test.ts` (3 gagal) — `SSH_ASKPASS`/`SSH_ASKPASS_REQUIRE` bocor dari shell
  sesi ini. Dilepas → 75/75 lulus.
- `agent-tokens.route.test.ts` 404-bukan-401 — `HANOMAN_CONTROL_ORIGINS` bocor, mematikan pendaftaran
  route. `NODE_ENV=development` juga menang atas `??= "test"` milik vitest.
- `notifications.route.test.ts` — flaky urutan `createdAt`; di base 7/7 gagal, di sini 1/7.
- 26 gagal suite frontend — identik dengan base (`portalApi.listChatSessions`, `placeholder-contract`).
- `git-graph-live.test.tsx` — flaky di bawah beban suite; 3/3 lulus terisolasi di base MAUPUN di sini.

Verifikasi terhadap server hidup (instance terpisah, port 8799, HANOMAN_HOME & DB sendiri):

```
GET  /terminal/sessions              → 200
POST /terminal/sessions              → 403 need sessions:spawn
POST /projects/p/git/merge           → 403 need ide:git
DELETE /specs/SPEC-1                 → 403 need backlog:lifecycle
POST /vps/v1/console                 → 403 need vps:exec
POST /terminal/sessions (punya spawn)→ 400 invalid body   ← gerbang dilewati, bukan 403
PATCH {title} · backlog:write        → 200
PATCH {stage} · backlog:write        → 403 need backlog:lifecycle
PATCH {stage} · +backlog:lifecycle   → 422 aturan bisnis  ← gerbang dilewati
stage di DB sesudah percobaan 403    → tak bergeser
```

Suite server akhir: **3200/3201 lulus** (satu merah = `notifications.route`, merah juga di base).
