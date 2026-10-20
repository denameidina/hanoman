import { describe, expect, it } from "vitest";
import { MCP_TOOLS, MCP_TOOL_SCHEMA_VERSION, mcpToolsFor, MCP_INSTRUCTIONS } from "./mcp";

const byName = (n: string) => MCP_TOOLS.find((t) => t.name === n)!;

describe("katalog tool MCP", () => {
  it("nama tool unik dan semuanya berprefix hanoman_", () => {
    expect(new Set(MCP_TOOLS.map((t) => t.name)).size).toBe(MCP_TOOLS.length);
    for (const t of MCP_TOOLS) expect(t.name).toMatch(/^hanoman_[a-z0-9_]+$/);
  });

  it("mode baca-saja MENGHILANGKAN tool tulis, bukan menolaknya saat dipanggil", () => {
    const ro = mcpToolsFor("read-only");
    expect(ro.every((t) => t.mode === "read")).toBe(true);
    expect(ro.length).toBe(MCP_TOOLS.filter((t) => t.mode === "read").length);
    expect(mcpToolsFor("default").length).toBe(MCP_TOOLS.filter((t) => t.mode !== "danger").length);
    expect(ro.map((t) => t.name)).not.toContain("hanoman_backlog_create");
  });

  // ADR-0099 §4 dulu melarang tool yang mengeksekusi hadir SAMA SEKALI. ADR-0155 membalikkannya:
  // permukaan itu sudah terjangkau agent token lewat REST, jadi larangan di katalog tak menutup apa
  // pun — ia hanya memaksa agen memakai curl tanpa skema. Yang menggantikan invarian lama BUKAN
  // "tak ada", melainkan "tak ada yang lolos tanpa penandaan": setiap tool yang mengeksekusi wajib
  // bermode `danger` sehingga hilang dari tingkat default, dan wajib menuntut capability yang tak
  // diimplikasikan `:write`.
  it("tool yang MENGEKSEKUSI selalu bermode danger — tak ada yang lolos ke tingkat default", () => {
    // "Mengeksekusi" = memulai pekerjaan baru di luar proses hanoman, atau memindahkan ref git.
    // MENGENDALIKAN sesi yang sudah ada (steer, interrupt) sengaja TIDAK termasuk: ia tak memulai
    // apa pun, dan ADR-0155 menahannya di `sessions:write`. Membuatnya `danger` akan mengaburkan
    // batas yang justru jadi inti pemecahan itu.
    const executing = MCP_TOOLS.filter((t) =>
      /^\/vps\/[^/]+\/(console|session|audit|probe|test|harden|provision|remediate)/.test(t.samplePath)
      || t.samplePath.includes("integrate")
      || (t.samplePath === "/terminal/sessions" && t.sampleMethod === "POST")
      || /\/git(\/|$)/.test(t.samplePath));
    for (const t of executing) expect(t.mode, t.name).toBe("danger");
    const visible = new Set(mcpToolsFor("default").map((t) => t.name));
    for (const t of executing) expect(visible.has(t.name), t.name).toBe(false);
  });

  // ADR-0196..0198 · `auth/users`, `agent-tokens`, `device-tokens` kini punya tool (capability
  // opt-in). Yang TETAP cookie-only dan tak boleh pernah dibungkus: login/logout/setup/status
  // (cookie sesi & bootstrap) dan `sync` (Bearer device-token mesin-ke-mesin).
  it("tak ada tool yang menyentuh route cookie-only", () => {
    for (const t of MCP_TOOLS) {
      // ADR-0199 · `sync` dibelah: now/conflicts/pending punya tool; kanal mesin-ke-mesin ber-device-token tetap terlarang.
      expect(t.samplePath, t.name).not.toMatch(/^\/(auth\/(status|setup|login|logout)|sync\/(pull|bootstrap|push|logs|attachments|qa-attachments|ws|relay)|session-events)\b/);
      expect(t.samplePath, t.name).not.toMatch(/^\/terminal\/workspace/);
    }
  });

  it("setiap tool punya deskripsi yang menyebut apa yang dikembalikan", () => {
    for (const t of MCP_TOOLS) {
      expect(t.description.length, t.name).toBeGreaterThan(40);
      expect(t.title.length, t.name).toBeGreaterThan(0);
    }
  });

  it("startable diekspos sebagai BOOLEAN — jebakan `startable=1` diabaikan senyap tak bisa terjadi", () => {
    const t = byName("hanoman_backlog_search");
    expect(t.inputSchema.properties.startable?.type).toBe("boolean");
    expect(t.build({ startable: true })?.query).toMatchObject({ startable: "true" });
    expect(t.build({ startable: false })?.query?.startable).toBeUndefined();
    expect(t.build({})?.query?.startable).toBeUndefined();
  });

  it("q dinyatakan tak menyentuh payload", () => {
    expect(byName("hanoman_backlog_search").inputSchema.properties.q?.description).toMatch(/payload/i);
  });

  it("backlog_create mengikat source ke bentuk payload lewat allOf", () => {
    const t = byName("hanoman_backlog_create");
    expect(t.inputSchema.allOf).toHaveLength(3);
    expect(t.inputSchema.properties.stage).toBeUndefined();  // stage selalu lahir brainstorming
    expect(t.inputSchema.properties.id).toBeUndefined();     // id diturunkan server
  });

  it("backlog_update hanya konten — tak ada stage/confirmDelete yang bisa menghapus artefak", () => {
    const t = byName("hanoman_backlog_update");
    expect(Object.keys(t.inputSchema.properties).sort())
      .toEqual(["dependsOn", "payload", "priority", "spec", "title"]);
  });

  it("backlog_get membaca GET /specs/:id (detail penuh), bukan daftar", () => {
    const t = byName("hanoman_backlog_get");
    expect(t.build({ spec: " SPEC-482 " })).toMatchObject({ method: "GET", path: "/specs/SPEC-482" });
    expect(t.shape({ id: "SPEC-482", stage: "planned", payload: { context: "c" } }, { spec: "SPEC-482" }))
      .toMatchObject({ id: "SPEC-482", stage: "planned" });
  });

  it("versi skema tool ada dan disebut di instructions", () => {
    expect(MCP_TOOL_SCHEMA_VERSION).toBe(2);
    expect(MCP_INSTRUCTIONS).toContain(String(MCP_TOOL_SCHEMA_VERSION));
  });

  // SNAPSHOT KONTRAK v1. Kontrak `MCP_TOOL_SCHEMA_VERSION` (mcp.ts) menyebutnya sendiri:
  // MENAMBAH tool bersifat ADITIF dalam satu versi; yang menuntut naik versi adalah mengganti atau
  // MENGHAPUS nama tool, dan menjadikan parameter opsional jadi WAJIB. Assertion lama memakai
  // `toEqual` atas seluruh daftar, sehingga ia memperlakukan penambahan sebagai pemutusan — lebih
  // ketat daripada kontraknya, dan satu-satunya cara melewatinya adalah menyunting daftar ini
  // setiap kali, yang justru melatih orang mengabaikannya.
  //
  // Yang dijaga sekarang persis yang memutus klien lama: tiap entri v1 masih ADA, dengan himpunan
  // parameter wajib yang SAMA PERSIS. Tool baru bebas menyusul.
  const V1_CONTRACT = [
    "hanoman_about()",
    "hanoman_backlog_create(payload,priority,project,source,title)",
    "hanoman_backlog_doc_read(path,spec)",
    "hanoman_backlog_docs_list(spec)",
    "hanoman_backlog_get(spec)",
    "hanoman_backlog_search()",
    "hanoman_backlog_update(spec)",
    "hanoman_github_issues_list(project)",
    "hanoman_lead_ask(project,question)",
    "hanoman_lead_decisions_list()",
    "hanoman_notifications_list()",
    "hanoman_notifications_mark_read()",
    "hanoman_project_get(project)",
    "hanoman_projects_list()",
    "hanoman_sessions_list()",
    "hanoman_ticket_get(ticket)",
    "hanoman_tickets_list()",
  ];
  const signature = (t: (typeof MCP_TOOLS)[number]) =>
    `${t.name}(${[...(t.inputSchema.required ?? [])].sort().join(",")})`;

  it("KONTRAK v1 — tiap tool v1 masih ada dengan parameter wajib yang sama persis", () => {
    const now = new Set(MCP_TOOLS.map(signature));
    const broken = V1_CONTRACT.filter((sig) => !now.has(sig));
    expect(broken, `tanda tangan v1 yang patah (rename, hapus, atau parameter wajib berubah):\n${broken.join("\n")}`)
      .toEqual([]);
  });

  it("versi 2 menghapus memori/changelog, kontrak inti v1 tetap tersedia", () => {
    expect(MCP_TOOL_SCHEMA_VERSION).toBe(2);
    expect(MCP_TOOLS.length).toBeGreaterThanOrEqual(V1_CONTRACT.length);
  });
});

// SPEC-485 · ADR-0102 · tambahan ADITIF pada `hanoman_lead_ask`: agen bisa menyatakan bahwa opsinya
// TIDAK saling eksklusif. Protokol berantai sengaja TIDAK dibuka lewat MCP — ia butuh beberapa
// panggilan berurutan + submit, dan tanpa pintu submit yang lahir hanyalah alur menggantung.
describe("SPEC-485 · lead_ask menerima pilihan jamak", () => {
  const tool = () => MCP_TOOLS.find((t) => t.name === "hanoman_lead_ask")!;

  it("punya parameter multi/minChoices/maxChoices", () => {
    expect(Object.keys(tool().inputSchema.properties)).toEqual(
      expect.arrayContaining(["multi", "minChoices", "maxChoices"]));
  });

  it("default TETAP single — permintaan lama tak berubah satu bit pun", () => {
    expect(tool().build({ project: "p", question: "q" })!.body).not.toHaveProperty("select");
  });

  it("multi merakit blok select yang dimengerti server", () => {
    expect(tool().build({
      project: "p", question: "q", options: ["a", "b"], multi: true, minChoices: 1, maxChoices: 2,
    })!.body).toMatchObject({ select: { mode: "multi", min: 1, max: 2 } });
  });

  it("maxChoices yang tak disebut jadi null (sebanyak opsinya)", () => {
    expect(tool().build({ project: "p", question: "q", options: ["a", "b"], multi: true })!.body)
      .toMatchObject({ select: { mode: "multi", min: 0, max: null } });
  });

  // SPEC-485 melarang tool BERSARANG untuk langkah rantai: langkah adalah baris jejak biasa, dan
  // menyalinnya ke serializer kedua berarti dua bentuk yang bisa berselisih diam-diam. ADR-0155
  // menambah tool untuk rantai ITU SENDIRI (daftar/batal/submit) — itu permukaan yang berbeda, dan
  // route-nya memang terjangkau agent token. Yang dijaga di sini tetap larangan aslinya.
  it("langkah rantai tetap dibaca lewat decisions?flowId, bukan tool bersarang sendiri", () => {
    expect(MCP_TOOLS.filter((t) => /flow.*(step|decision)|decision.*flow/.test(t.name))).toHaveLength(0);
    const list = MCP_TOOLS.find((t) => t.name === "hanoman_lead_decisions_list")!;
    expect(Object.keys(list.inputSchema.properties)).toContain("flow");
  });
});

// ADR-0155 · tingkat mode ketiga. Tiga sifat dikunci: yang lebih sempit MENGHILANGKAN tool (bukan
// menolaknya saat dipanggil — ADR-0099 §5), `danger` memuat semuanya, dan instruksi menyatakan
// terang-terangan bahwa tingkat ini BUKAN kontrol keamanan. Yang terakhir bukan kosmetik: menyebut
// `--danger` sebagai gerbang keamanan di dokumen mana pun adalah kekeliruan yang menular.
describe("tingkat mode", () => {
  it("read-only hanya tool baca", () => {
    expect(mcpToolsFor("read-only").every((t) => t.mode === "read")).toBe(true);
  });

  it("default menyembunyikan danger tapi menyimpan write", () => {
    const t = mcpToolsFor("default");
    expect(t.some((x) => x.mode === "danger")).toBe(false);
    expect(t.some((x) => x.mode === "write")).toBe(true);
  });

  it("danger memuat semuanya", () => {
    expect(mcpToolsFor("danger")).toHaveLength(MCP_TOOLS.length);
  });

  it("tingkat yang lebih longgar tak pernah MENGHILANGKAN tool yang lebih sempit sudah punya", () => {
    const names = (l: Parameters<typeof mcpToolsFor>[0]) => new Set(mcpToolsFor(l).map((t) => t.name));
    const ro = names("read-only"), def = names("default"), dg = names("danger");
    for (const n of ro) expect(def.has(n), n).toBe(true);
    for (const n of def) expect(dg.has(n), n).toBe(true);
  });

  it("instruksi menyatakan tingkat ini BUKAN kontrol keamanan", () => {
    expect(MCP_INSTRUCTIONS).toMatch(/bukan kontrol keamanan/i);
  });
});

// ADR-0155 · gerbang anti-drift #1. 152 tool tak bisa dijaga dengan ketelitian manusia; yang bisa
// dijaga adalah INVARIANNYA. Dua arah dikunci, dan arah kedua yang paling mudah lolos: sebuah tool
// bisa bermode `danger` sambil menuntut capability yang lemah, dan tak ada yang menyadarinya sampai
// seseorang memakainya.
const DANGER_CAPS = new Set([
  "sessions:spawn", "ide:git", "backlog:lifecycle", "vps:exec", "qa:delete", "sessions:decide", "telegram:admin",
  "access:admin", "remote:control", "relay:exec", "sync:resolve", "instance:admin",
  "lead:approve",   // ADR-0228
]);

// Tool DESTRUKTIF yang capability-nya tetap `:write` — bukan karena ringan, melainkan karena tak
// ada capability `danger` di domainnya. Mode `danger`-nya murni ergonomi (mencegah salah pilih),
// bukan gerbang. Daftar ini sengaja EKSPLISIT: menambahnya menuntut seseorang mengetik namanya.
// Diisi bertahap oleh rencana katalog per domain. Assert terakhir menolak nama yang tak punya
// tool, jadi daftar ini tak bisa mendahului katalognya.
const DESTRUCTIVE_BUT_WRITE = new Set<string>([
  "hanoman_docs_delete",       // menghapus berkas .md; capability tetap docs:write
  "hanoman_ide_entry_delete",  // menghapus berkas/folder working tree; capability tetap ide:write
  "hanoman_skill_delete",      // menghapus folder skill dari disk; capability tetap skills:write
  // Gerbang `backlog:lifecycle`-nya hidup di HANDLER (routes/specs.ts), bukan di
  // capabilityForRoute, karena keputusannya bergantung body. Katalog karena itu wajib
  // menyebut `backlog:write` agar uji kontrak hijau — deskripsi tool yang memberitahu
  // agen capability apa yang sebenarnya dituntut server.
  "hanoman_backlog_stage_set",
  // `projects:destroy` sengaja TIDAK dibuat (ADR-0155), jadi kedua tool ini destruktif dengan
  // capability `projects:write` biasa. Mode `danger`-nya murni ergonomi.
  "hanoman_project_rename", "hanoman_project_delete",
  // Menutup sesi & menghapus riwayat destruktif, tapi `sessions:spawn` hanya untuk MEMBUKA
  // sesi baru — menahannya di sini akan salah alamat. `integrate` sesi sama halnya.
  "hanoman_session_close", "hanoman_session_history_purge", "hanoman_session_integrate",
  "hanoman_agent_delete", "hanoman_lead_flow_submit",
  // ADR-0228 · melahirkan/menghentikan/merotasi pane lead menggerakkan sebuah agen hidup, tapi
  // domain `lead` hanya punya `lead:approve` sebagai pecahan danger — dan menyetujui tindakan
  // lead bukan hal yang sama dengan menyalakan pane-nya.
  "hanoman_lead_session_start", "hanoman_lead_session_stop", "hanoman_lead_session_rotate",
  "hanoman_ticket_delete", "hanoman_notifications_clear",
  // Mengirim pesan ke MANUSIA di luar hanoman: tak ada undo, tapi domainnya tak punya
  // pecahan `danger`.
  "hanoman_telegram_reply_send",
  // ADR-0157 · papan Tim. Menghapus kartu/anggota permanen di seluruh mesin tersync, tapi domain
  // `team` tak punya pecahan `danger` — mode `danger`-nya ergonomi, bukan gerbang.
  "hanoman_task_delete", "hanoman_member_delete",
  // ADR-0188/0189 · tiga tool danger yang capability-nya domain biasa (`activity:write`,
  // `portal-chat:write`/`:read`): purge menyeberang ke semua mesin lewat tombstone sync, tulis-PRD
  // menimpa berkas di checkout dengan isi berasal dari klien, ekspor menarik email+transkrip klien.
  // Tak satu pun MEMULAI pekerjaan di luar proses hanoman, jadi bukan `danger` berakses — mode
  // `danger`-nya ergonomi (tak terlihat di tingkat default), bukan gerbang.
  "hanoman_activity_purge", "hanoman_portal_admin_chat_prd_write", "hanoman_portal_admin_chat_export",
  // ADR-0191 · cron: `scheduler:write` + (create/update/run) `sessions:spawn` yang ditegakkan di
  // HANDLER server, bukan di katalog — katalog hanya menyebut satu capability per tool. Mode
  // `danger`-nya bukan ergonomi belaka: tiga di antaranya membuka sesi berizin penuh secara tertunda.
  "hanoman_scheduler_cron_create", "hanoman_scheduler_cron_update",
  "hanoman_scheduler_cron_delete", "hanoman_scheduler_cron_run",
  // ADR-0194 · webhook keluar & akun klien. Domain `webhooks`/`clients` tak punya pecahan `danger`;
  // semua tulisnya bermode `danger` (mengirim data keluar / membuka login baru) tapi capability-nya
  // tetap `:write`. Mode `danger`-nya ergonomi, bukan gerbang.
  "hanoman_webhook_create", "hanoman_webhook_update", "hanoman_webhook_delete",
  "hanoman_webhook_test", "hanoman_webhook_delivery_retry",
  "hanoman_client_account_create", "hanoman_client_account_update",
  "hanoman_client_account_password_reset", "hanoman_client_account_delete",
  // ADR-0196..0198 · permukaan admin: tulisnya (`tokens:write`, `devices:write`, `logs:write`,
  // `metrics:write`) mencetak/mencabut kredensial atau menghapus jejak audit/vonis manusia, tapi
  // aksesnya `write` biasa di domainnya. Mode `danger` di sini ergonomi; gerbang sungguhannya
  // adalah capability opt-in + pagar tak-eskalasi-diri di handler server.
  "hanoman_agent_token_create", "hanoman_agent_token_update", "hanoman_agent_token_revoke",
  "hanoman_device_token_create", "hanoman_device_token_revoke",
  "hanoman_logs_retention_set", "hanoman_agent_invocation_disposition",
]);

describe("mode ⇔ capability", () => {
  it("tool bercapability danger WAJIB bermode danger", () => {
    for (const t of MCP_TOOLS)
      if (t.capability && DANGER_CAPS.has(t.capability)) expect(t.mode, t.name).toBe("danger");
  });

  it("tool bermode danger WAJIB bercapability danger, kecuali yang terdaftar", () => {
    for (const t of MCP_TOOLS) {
      if (t.mode !== "danger" || DESTRUCTIVE_BUT_WRITE.has(t.name)) continue;
      expect(DANGER_CAPS.has(t.capability ?? ""), t.name).toBe(true);
    }
  });

  it("daftar-kecuali tak memuat nama yang sudah tak ada — tool dihapus, daftarnya ikut", () => {
    const names = new Set(MCP_TOOLS.map((t) => t.name));
    for (const n of DESTRUCTIVE_BUT_WRITE) expect(names.has(n), n).toBe(true);
  });

  it("nol tool danger yang bocor ke tingkat default, nol non-read yang bocor ke read-only", () => {
    expect(mcpToolsFor("default").filter((t) => t.mode === "danger")).toHaveLength(0);
    expect(mcpToolsFor("read-only").filter((t) => t.mode !== "read")).toHaveLength(0);
  });

  it("setiap tool danger membuka deskripsinya dengan penandaan yang terbaca agen", () => {
    for (const t of MCP_TOOLS.filter((x) => x.mode === "danger"))
      expect(t.description.slice(0, 12), t.name).toMatch(/BERBAHAYA/);
  });

  it("tool memori project dan changelog tidak lagi ditawarkan", () => {
    expect(MCP_TOOLS.filter((t) => /^hanoman_(memory|changelog)_/.test(t.name))).toEqual([]);
  });
});

// ADR-0228 · permukaan sesi lead untuk manusia & agen eksternal.
describe("katalog MCP · sesi lead (ADR-0228)", () => {
  it("menawarkan inbox, izin, dan kendali pane lead dengan tingkat & capability yang benar", () => {
    expect(byName("hanoman_lead_inbox")).toMatchObject({ mode: "read", capability: "lead:read" });
    expect(byName("hanoman_lead_inbox_take")).toMatchObject({ mode: "write", capability: "lead:write" });
    expect(byName("hanoman_lead_approvals_list")).toMatchObject({ mode: "read", capability: "lead:read" });
    expect(byName("hanoman_lead_approval_decide")).toMatchObject({ mode: "danger", capability: "lead:approve" });
    for (const op of ["start", "stop", "rotate"])
      expect(byName(`hanoman_lead_session_${op}`)).toMatchObject({ mode: "danger", capability: "lead:write" });
  });
  it("membangun request yang tepat", () => {
    expect(byName("hanoman_lead_approval_decide").build({ approval: "a 1", approve: true, note: "ok" }))
      .toEqual({ method: "POST", path: "/lead/approvals/a%201/decide", body: { approve: true, note: "ok" } });
    expect(byName("hanoman_lead_approval_decide").build({ approval: "a1", approve: "ya" }).body).toEqual({ approve: false });
    expect(byName("hanoman_lead_session_rotate").build({ project: "erp" })).toEqual({ method: "POST", path: "/lead/sessions/erp/rotate" });
  });
  it("tak pernah membungkus permukaan pane lead", () => {
    expect(MCP_TOOLS.filter((t) => t.samplePath.startsWith("/lead-pane"))).toEqual([]);
  });
});
