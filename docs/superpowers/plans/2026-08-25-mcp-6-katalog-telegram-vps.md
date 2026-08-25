# MCP Rencana 6 — Katalog `telegram` & `vps`, lalu nyalakan gerbang cakupan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 26 tool terakhir — 8 `telegram`, 18 `vps` — lalu menyalakan gerbang cakupan yang di-skip sejak Rencana 2, sehingga endpoint baru yang terjangkau agent token tak bisa lagi lupa dibungkus tanpa test merah.

**Architecture:** Dua berkas katalog baru. `vps` adalah domain paling tajam: sepuluh dari delapan belas tool-nya menjalankan perintah di VPS produksi dan menuntut `vps:exec`. Task terakhir membuang `it.skip` di `server/test/mcp-coverage.test.ts` — momen katalog berhenti bisa tertinggal diam-diam.

**Tech Stack:** TypeScript strict, JSON Schema polos, vitest.

## Global Constraints

- Rencana 1–5 **wajib selesai**.
- Empat route Telegram **tak terjangkau agent token** dan tak boleh dibungkus: `GET`/`PUT /telegram/settings`, `POST /telegram/test`, `DELETE /telegram/credentials` (`agent-capabilities.ts:64`, permukaan KREDENSIAL). Gerbang cakupan meloncatinya sendiri karena `COOKIE_ONLY`; jangan menambahkannya ke `UNWRAPPED`.
- Skema parameter diturunkan dari handler.
- Sesudah rencana ini `MCP_TOOL_SCHEMA_VERSION` **tetap 1**. Ia baru naik bila ada nama tool yang berubah atau hilang.

---

## File Structure

- Create: `shared/src/mcp-catalog/telegram.ts` (8), `vps.ts` (18)
- Modify: `shared/src/mcp-catalog/index.ts`, `shared/src/mcp-catalog.test.ts`
- Modify: `server/test/mcp-coverage.test.ts` — buang `it.skip` dan `it.todo`
- Modify: `internal/docs/adr/0155-*.md`, `internal/docs/README.md`
- Test: `shared/src/mcp-catalog.telegram.test.ts`, `.vps.test.ts`

---

### Task 1: `telegram.ts` — 8 tool

| Tool | Method + path | Handler | mode | capability |
|---|---|---|---|---|
| `hanoman_telegram_status` | GET `/telegram/status` | `telegram.ts:45` | read | `telegram:read` |
| `hanoman_telegram_audit` | GET `/telegram/audit` | `telegram.ts:122` | read | `telegram:read` |
| `hanoman_telegram_context_get` | GET `/telegram/chats/:chatId/context` | `telegram.ts:47` | read | `telegram:read` |
| `hanoman_telegram_context_set` | PATCH `/telegram/chats/:chatId/context` | `telegram.ts:52` | write | `telegram:write` |
| `hanoman_telegram_memory_add` | POST `/telegram/chats/:chatId/memories` | `telegram.ts:64` | write | `telegram:write` |
| `hanoman_telegram_memory_delete` | DELETE `/telegram/chats/:chatId/memories/:id` | `telegram.ts:74` | write | `telegram:write` |
| `hanoman_telegram_memories_clear` | DELETE `/telegram/chats/:chatId/memories` | `telegram.ts:80` | write | `telegram:write` |
| `hanoman_telegram_reply_send` | POST `/telegram/replies` | `telegram.ts:87` | **danger** | `telegram:write` |

`hanoman_telegram_reply_send` bermode `danger` bukan karena merusak data, melainkan karena **mengirim pesan ke manusia di luar hanoman** — tak ada undo, dan agen yang salah memanggilnya menghasilkan pesan yang dibaca orang. Masuk `DESTRUCTIVE_BUT_WRITE`.

- [x] **Step 1: Baca handler** — `sed -n '44,140p' server/src/routes/telegram.ts`

- [x] **Step 2: Tulis test yang gagal**

```ts
describe("katalog telegram", () => {
  it("8 tool, satu danger", () => {
    expect(TELEGRAM_TOOLS).toHaveLength(8);
    expect(TELEGRAM_TOOLS.filter((t) => t.mode === "danger").map((t) => t.name))
      .toEqual(["hanoman_telegram_reply_send"]);
  });

  it("TAK ADA tool yang menyentuh permukaan kredensial", () => {
    for (const t of TELEGRAM_TOOLS)
      expect(t.samplePath, t.name).not.toMatch(/\/telegram\/(settings|test|credentials)/);
  });

  it("memories_clear dan memory_delete adalah tool BERBEDA — menghapus semua tak boleh tak sengaja", () => {
    expect(TELEGRAM_TOOLS.find((t) => t.name === "hanoman_telegram_memories_clear")!.description)
      .toMatch(/SELURUH|semua/i);
  });
});
```

- [x] **Step 3: Jalankan test, pastikan GAGAL** — Run: `pnpm vitest --run shared/src/mcp-catalog.telegram.test.ts`

- [x] **Step 4: Tulis `telegram.ts`.** Kepala berkas:

```ts
// ADR-0099 · ADR-0155 · katalog tool domain `telegram`: status gateway, context & memory per chat,
// reply, audit. Empat route permukaan KREDENSIAL (`/telegram/{settings,test,credentials}`) sengaja
// tak ada di sini dan tak bisa ada: `capabilityForRoute` memberinya COOKIE_ONLY karena ia menyimpan
// bot token & AgentToken — termasuk milik gateway itu sendiri (ADR-0097).
```

Deskripsi `reply_send`:

```ts
    description:
      "BERBAHAYA — mengirim pesan ke chat Telegram operator. Pesannya dibaca MANUSIA di luar hanoman dan tak bisa ditarik kembali. Pakai hanoman_telegram_status untuk memastikan gateway hidup sebelum mengirim. Hanya muncul saat tingkat `--danger` menyala.",
```

- [x] **Step 5: Tambahkan `reply_send` ke `DESTRUCTIVE_BUT_WRITE`**

Di `shared/src/mcp-catalog.test.ts`, tambahkan entri terakhir daftar itu:

```ts
  "hanoman_telegram_reply_send",   // mengirim pesan ke manusia; capability tetap telegram:write
```

Sesudah baris ini daftarnya berisi **14 nama**, dan bersama 20 tool bercapability `danger`
(7 `ide:git` + 1 `sessions:spawn` + 2 `backlog:lifecycle` + 10 `vps:exec`) itu menjelaskan seluruh
34 tool bermode `danger`. Bila jumlahnya tak cocok, ada tool yang modenya salah — jangan
menyesuaikan angkanya, cari toolnya.

- [x] **Step 6: Rangkai di `index.ts`, jalankan test, pastikan LULUS**

```bash
pnpm vitest --run shared/src/mcp-catalog.telegram.test.ts shared/src/mcp-catalog.test.ts
```

- [x] **Step 7: Commit**

```bash
git add shared/src/mcp-catalog/telegram.ts shared/src/mcp-catalog/index.ts \
        shared/src/mcp-catalog.telegram.test.ts shared/src/mcp-catalog.test.ts
git commit -m "feat(mcp): 8 tool telegram, tanpa permukaan kredensial"
```

---

### Task 2: `vps.ts` — 18 tool

| Tool | Method + path | Handler | mode | capability |
|---|---|---|---|---|
| `hanoman_vps_list` | GET `/vps` | `vps.ts:31` | read | `vps:read` |
| `hanoman_vps_components` | GET `/vps/components` | `vps.ts:195` | read | `vps:read` |
| `hanoman_vps_checklist` | GET `/vps/:id/checklist` | `vps.ts:86` | read | `vps:read` |
| `hanoman_vps_create` | POST `/vps` | `vps.ts:35` | write | `vps:write` |
| `hanoman_vps_update` | PATCH `/vps/:id` | `vps.ts:49` | write | `vps:write` |
| `hanoman_vps_delete` | DELETE `/vps/:id` | `vps.ts:69` | write | `vps:write` |
| `hanoman_vps_item_na` | POST `/vps/:id/items/:itemId/na` (+`items/na-bulk` bila `items[]`) | `vps.ts:93`, `:111` | write | `vps:write` |
| `hanoman_vps_item_attest` | POST `/vps/:id/items/:itemId/attest` | `vps.ts:128` | write | `vps:write` |
| `hanoman_vps_audit` | POST `/vps/:id/audit` | `vps.ts:76` | **danger** | `vps:exec` |
| `hanoman_vps_probe` | POST `/vps/:id/probe` | `vps.ts:219` | **danger** | `vps:exec` |
| `hanoman_vps_remediate_preview` | POST `/vps/:id/remediate/preview` | `vps.ts:157` | **danger** | `vps:exec` |
| `hanoman_vps_remediate` | POST `/vps/:id/remediate` | `vps.ts:171` | **danger** | `vps:exec` |
| `hanoman_vps_provision_preview` | POST `/vps/:id/provision/preview` | `vps.ts:228` | **danger** | `vps:exec` |
| `hanoman_vps_provision` | POST `/vps/:id/provision` | `vps.ts:244` | **danger** | `vps:exec` |
| `hanoman_vps_harden` | POST `/vps/:id/harden` | `vps.ts:290` | **danger** | `vps:exec` |
| `hanoman_vps_test` | POST `/vps/:id/test` | `vps.ts:311` | **danger** | `vps:exec` |
| `hanoman_vps_console` | POST `/vps/:id/console` | `vps.ts:321` | **danger** | `vps:exec` |
| `hanoman_vps_session` | POST `/vps/:id/session` | `vps.ts:331` | **danger** | `vps:exec` |

Sepuluh tool bercapability `vps:exec`, semuanya **wajib** bermode `danger` — gerbang Rencana 2 Task 4 menolak kalau tidak. Tak ada yang masuk `DESTRUCTIVE_BUT_WRITE`: kesepuluhnya sudah punya capability `danger` sendiri.

**`hanoman_vps_audit` masuk `vps:exec`, bukan `vps:read`,** meski namanya terdengar pasif: ia menjalankan probe di mesin remote. Bila pembacaan handler di Step 1 ternyata membuktikan sebaliknya — bahwa `audit` hanya membaca hasil tersimpan tanpa menyentuh mesin — **hentikan dan laporkan**, karena `capabilityForRoute` di Rencana 1 juga perlu diubah.

- [x] **Step 1: Baca handler**

```bash
sed -n '28,200p' server/src/routes/vps.ts
sed -n '215,345p' server/src/routes/vps.ts
```

Perhatikan khusus `POST /vps/:id/console` (`vps.ts:321`): parameter perintahnya wajib **wajib** (bukan opsional dengan default), dan deskripsinya wajib menyebut bahwa perintahnya berjalan sebagai pengguna remote apa adanya.

- [x] **Step 2: Tulis test yang gagal**

```ts
describe("katalog vps", () => {
  it("18 tool, sepuluh bermode danger", () => {
    expect(VPS_TOOLS).toHaveLength(18);
    expect(VPS_TOOLS.filter((t) => t.mode === "danger")).toHaveLength(10);
  });

  it("setiap tool vps:exec bermode danger, dan sebaliknya", () => {
    for (const t of VPS_TOOLS) {
      if (t.capability === "vps:exec") expect(t.mode, t.name).toBe("danger");
      if (t.mode === "danger") expect(t.capability, t.name).toBe("vps:exec");
    }
  });

  it("membaca checklist & daftar VPS TIDAK menuntut vps:exec", () => {
    for (const n of ["hanoman_vps_list", "hanoman_vps_checklist", "hanoman_vps_components"])
      expect(VPS_TOOLS.find((t) => t.name === n)!.capability, n).toBe("vps:read");
  });

  it("item_na memilih na-bulk hanya saat items[] diisi", () => {
    const t = VPS_TOOLS.find((x) => x.name === "hanoman_vps_item_na")!;
    expect(t.build({ vps: "v1", item: "i1" })?.path).toBe("/vps/v1/items/i1/na");
    expect(t.build({ vps: "v1", items: ["i1", "i2"] })?.path).toBe("/vps/v1/items/na-bulk");
  });

  it("console menuntut perintahnya eksplisit", () => {
    const t = VPS_TOOLS.find((x) => x.name === "hanoman_vps_console")!;
    expect(t.inputSchema.required).toContain("command");
  });
});
```

- [x] **Step 3: Jalankan test, pastikan GAGAL** — Run: `pnpm vitest --run shared/src/mcp-catalog.vps.test.ts`

- [x] **Step 4: Tulis `vps.ts`.** Kepala berkas:

```ts
// ADR-0099 · ADR-0155 · katalog tool domain `vps`. DUA capability: mengelola daftar VPS & checklist
// kepatuhan = `vps:read|write`; menjalankan perintah di mesin remote = `vps:exec` (ADR-0155).
// ADR-0099 §4 dulu menolak seluruh domain ini dari MCP. ADR-0155 membalikkannya dengan alasan yang
// ditulis di sana: route-route ini SUDAH terjangkau agent token lewat REST, jadi tidak
// membungkusnya tak menutup apa pun — ia hanya memaksa agen memakai curl tanpa skema.
```

Deskripsi `console`:

```ts
    description:
      "BERBAHAYA — menjalankan perintah shell di VPS produksi sebagai pengguna remote, apa adanya. Tak ada sandbox, tak ada dry-run, dan hanoman tidak menyaring perintahnya. Menuntut capability `vps:exec`; `vps:write` tidak cukup. Hanya muncul saat tingkat `--danger` menyala. Pertimbangkan hanoman_vps_remediate_preview lebih dulu bila yang kamu inginkan adalah perbaikan kepatuhan.",
```

- [x] **Step 5: Rangkai di `index.ts`, jalankan test, pastikan LULUS**

```bash
pnpm vitest --run shared/src/mcp-catalog.vps.test.ts shared/src/mcp-catalog.test.ts
```

- [x] **Step 6: Commit**

```bash
git add shared/src/mcp-catalog/vps.ts shared/src/mcp-catalog/index.ts shared/src/mcp-catalog.vps.test.ts
git commit -m "feat(mcp): 18 tool vps, sepuluh di antaranya menuntut vps:exec"
```

---

### Task 3: Nyalakan gerbang cakupan

**Files:**
- Modify: `server/test/mcp-coverage.test.ts`

Ini task paling penting di seluruh enam rencana. Sampai `it.skip` dibuang, katalog masih bisa tertinggal diam-diam.

- [x] **Step 1: Buang `it.skip` dan `it.todo`**

Ganti `it.skip("setiap route yang TERJANGKAU agent token punya tool…"` menjadi `it(`, buang baris `it.todo`, dan buang komentar "Dinyalakan (skip dibuang) di Task terakhir Rencana 6".

- [x] **Step 2: Jalankan test**

Run: `TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/mcp-coverage.test.ts`

Expected: PASS. **Bila MERAH**, pesannya menyebut route mana yang tertinggal. Dua kemungkinan, dan keduanya nyata:
1. Tool-nya memang belum dibuat → kembali ke rencana domain yang bersangkutan dan buat.
2. Route-nya sengaja tak dibungkus → tambahkan ke `UNWRAPPED` **dengan alasan tertulis di sebelahnya**. Menambahkan entri tanpa alasan membuat gerbang ini kehilangan gunanya dalam beberapa bulan.

**Jangan** melonggarkan pola pencocokan `toPattern` untuk membuatnya hijau. Kalau pencocokannya salah, perbaiki pencocokannya dan buktikan dengan test unit atasnya.

- [x] **Step 3: Tambahkan test yang menjaga gerbangnya sendiri**

```ts
it("gerbang cakupan benar-benar mendeteksi route yang lupa dibungkus", () => {
  // Membuktikan gerbang di atas bukan hijau palsu: route palsu yang terjangkau agent token
  // harus terdeteksi. Kalau assert ini lulus sementara gerbangnya juga lulus, gerbangnya bekerja.
  const fake = { method: "GET", path: "/specs/:id/tak-pernah-ada" };
  expect(capabilityForRoute(fake.method, fake.path)).toBe("backlog:read");
  const re = new RegExp("^" + fake.path.replace(/:[^/]+/g, "[^/]+") + "$");
  expect(MCP_TOOLS.some((t) => t.sampleMethod === "GET" && re.test(t.samplePath))).toBe(false);
});
```

- [x] **Step 4: Commit**

```bash
git add server/test/mcp-coverage.test.ts
git commit -m "test(mcp): nyalakan gerbang cakupan route"
```

---

### Task 4: Verifikasi akhir & dokumentasi

- [x] **Step 1: Angka akhir, dihitung dari katalog nyata**

```bash
pnpm vitest --run shared/src/
TEST_DATABASE_URL="file:$(mktemp -d)/t.test.db" pnpm vitest --run --no-file-parallelism server/test/
```
Expected: PASS. Test `shared/src/mcp-catalog.test.ts` yang menyebut "17 tool" sejak SPEC-482 harus diperbarui ke **152**, dan yang menyebut "13" untuk read-only diperbarui ke angka nyata yang dihitung dari katalog — jangan menuliskan angka yang tak kamu hitung.

- [x] **Step 2: Hitung lewat CLI, bandingkan dengan test**

```bash
pnpm -F hanoman build
count() { HANOMAN_HOST=http://localhost:8787 HANOMAN_AGENT_TOKEN=hnm_agt_… "$@" \
  node cli/dist/hanoman.js mcp <<< '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["result"]["tools"]))'; }
count                              # → 118
count env HANOMAN_MCP_DANGER=1     # → 152
count env HANOMAN_MCP_READ_ONLY=1  # → jumlah tool bermode read
```

Bila angkanya berbeda dari test, **test yang benar** — CLI membaca katalog yang sama, jadi selisih berarti ada yang salah di jalur `mcpToolsFor`.

- [x] **Step 3: Uji satu tool berbahaya dari tiap capability baru, terhadap server hidup**

Dengan token yang **tidak** memegang capability berbahayanya, panggil `hanoman_session_create`, `hanoman_ide_git_merge`, `hanoman_backlog_delete`, `hanoman_vps_console`. Keempatnya harus `isError` dengan nama capability yang tepat, dan **tak satu pun** boleh menghasilkan efek samping: tak ada sesi tmux baru (`tmux ls`), tak ada branch yang bergerak (`git log --oneline -1`), backlog masih ada, tak ada koneksi SSH keluar.

- [x] **Step 4: Perbarui ADR-0155 dan docs**

- Tambahkan bagian "Katalog: 152 tool" ke ADR-0155 dengan tabel per-domain dari spec.
- Tambahkan daftar `UNWRAPPED` beserta alasannya — supaya "kok tidak ada" tak jadi pertanyaan berulang.
- Perbarui `internal/docs/architecture/stack.md` bila ia menyebut jumlah tool MCP.
- Perbarui `internal/skills/hanoman/SKILL.md` bila ia mendaftar tool MCP.
- Perbarui `MCP_INSTRUCTIONS` (`shared/src/mcp.ts`): paragraf "Tool yang MENJALANKAN sesuatu sengaja tidak ada di sini" **sudah tidak benar** sejak Rencana 3 dan wajib diganti di Rencana 2 Task 2 — pastikan penggantinya masih akurat sesudah semua tool lahir.

- [x] **Step 5: Release note breaking change**

Tulis catatan rilis yang menyebut:
- empat capability baru dan bahwa token lama **kehilangan** hak berbahaya;
- gateway Telegram **tidak akan menyala** sampai keempatnya dicentang;
- `--danger` dan bahwa ia bukan kontrol keamanan.

- [x] **Step 6: Commit**

```bash
git add internal/docs/ internal/skills/ shared/src/mcp.ts docs/superpowers/plans/
git commit -m "docs(mcp): katalog 152 tool lengkap, ADR-0155 & release note"
```

---

## Catatan pelaksanaan (2026-08-25)

- **`password` VPS tidak diekspos.** Ia kredensial transien, dan ADR-0097 sudah menetapkan permukaan
  kredensial bukan wilayah agent token (preseden `/telegram/credentials`). Agen memakai `keyPath`;
  bootstrap dengan password tetap pekerjaan manusia lewat cookie.
- **Gerbang cakupan DINYALAKAN dan hijau tanpa skip.** Saat pertama dinyalakan ia menyisakan 12
  route, semuanya jatuh ke dua kategori jujur: tercakup tool BERCABANG (samplePath hanya bisa
  menyebut satu cabang) dan sengaja dikecualikan. Yang pertama dicatat di `COVERED_BY_BRANCH`
  **dengan nama tool-nya**, dan nama itu diverifikasi ada — jadi daftar itu tak bisa jadi tempat
  menyembunyikan route.
- **Regex `^/vps` di uji kontrak terlalu luas** — ia ikut mencocokkan `hanoman_vps_list` yang tak
  mengeksekusi apa pun. Dipersempit ke sub-path yang benar-benar menyentuh mesin remote.
- **Angka tool di test CLI dibuang**, diganti invarian: tingkat yang lebih sempit adalah HIMPUNAN
  BAGIAN. Angka mati hanya membuat berkas itu disunting berulang tanpa menjaga apa pun.

Verifikasi akhir lewat MCP nyata terhadap server hidup, token 12×`:write` tanpa satu pun capability
`danger`:

```
hanoman_session_create      isError | kurang capability `sessions:spawn`
hanoman_ide_git_merge       isError | kurang capability `ide:git`
hanoman_backlog_delete      isError | kurang capability `backlog:lifecycle`
hanoman_vps_console         isError | kurang capability `vps:exec`
hanoman_backlog_stage_set   isError | kurang capability `backlog:lifecycle`   ← gerbang HANDLER
hanoman_projects_list       ok      | {"items":[],"total":0,...}
```

Nol sesi tmux baru, nol proses ssh keluar. Baris `stage_set` adalah buktinya: katalognya mengklaim
`backlog:write`, server menjawab `backlog:lifecycle` — gerbang yang hidup di handler bekerja lewat
MCP persis seperti yang dirancang.
