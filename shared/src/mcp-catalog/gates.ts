// ADR-0190 · ADR-0191 · ADR-0192 · katalog tool dua permukaan yang dulu SENGAJA tak dibungkus
// (ADR-0142/0146 untuk dialog sesi, ADR-0112 untuk cron) dan kini dibungkus atas permintaan
// eksplisit pemilik — dengan GERBANG DI SERVER, bukan hanya di deskripsi:
//
//   • dialog sesi  → capability BARU `sessions:decide` (tak diimplikasikan `sessions:write`);
//     server menolak 403 token yang meluncurkan sesi itu atau memanggil dari DALAM sesi
//     (`server/src/services/decision-guard.ts`), dan 409 deciding/answering tetap berlaku.
//   • cron         → capability BARU `scheduler:read|write`; create/patch-eksekusi/run juga menuntut
//     `sessions:spawn` (handler `server/src/routes/scheduler.ts`), karena cron = sesi tertunda.
//
// Semua tool yang menjawab/merebut/membuat/menjalankan bermode `danger`: tak terlihat di tingkat
// default. Tingkat itu BUKAN kontrol keamanan; yang menahan sungguhan adalah dua gerbang di atas.
import { PAGE_PARAMS, bool, enumStr, int, obj, str } from "../mcp-schema";
import type { JsonSchemaNode } from "../mcp-schema";
import { enc, n, query, s } from "./helpers";
import type { McpToolDef } from "./types";

const SESSION = str("Id sesi hidup, dari hanoman_sessions_list.");
const CRON = str("Id cron, dari hanoman_scheduler_crons_list.");
const intArray = (description: string): JsonSchemaNode =>
  ({ type: "array", description, items: { type: "integer", minimum: 1 }, maxItems: 32 });

const DECIDE_NOTE =
  "Menuntut capability `sessions:decide` (BUKAN `sessions:write`). Server menolak 403 bila token ini yang meluncurkan sesi tersebut, atau bila panggilan datang dari dalam sebuah sesi hanoman — agen tak boleh memutuskan pertanyaan sesinya sendiri.";

const DIALOG: readonly McpToolDef[] = [
  {
    name: "hanoman_session_dialog_get",
    title: "Baca dialog pertanyaan sesi (BERBAHAYA)",
    description:
      `BERBAHAYA — membaca dialog AskUserQuestion yang sedang tampil di pane sebuah sesi: judul, opsi bernomor, dan \`screenHash\` yang wajib dikirim balik saat menjawab. Hasil kosong (\`dialog: null\`) berarti layar bukan dialog yang bisa dijawab (atau sesinya sudah berakhir). Dialog trust & prompt izin sengaja TIDAK pernah muncul di sini. ${DECIDE_NOTE} Hanya muncul saat tingkat \`--danger\` menyala.`,
    inputSchema: obj({ properties: { session: SESSION }, required: ["session"] }),
    mode: "danger", capability: "sessions:decide",
    samplePath: "/terminal/sessions/s1/dialog", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `/terminal/sessions/${enc(String(a.session))}/dialog` }),
    shape: (raw) => raw ?? { dialog: null, note: "tak ada dialog pilihan yang bisa dijawab di layar sesi ini" },
  },
  {
    name: "hanoman_session_dialog_answer",
    title: "Jawab dialog pertanyaan sesi (BERBAHAYA)",
    description:
      `BERBAHAYA — mengetikkan jawaban ke dialog AskUserQuestion sebuah sesi; sesi langsung bergerak dan tak ada undo. Ambil \`screenHash\` dari hanoman_session_dialog_get tepat sebelumnya: 409 \`stale\` berarti layar sudah berganti — baca ulang, jangan menebak. 409 \`deciding\` berarti hanoman-lead sedang menyusun keputusan untuk sesi itu (jangan dipaksa; rebut dulu lewat hanoman_session_dialog_takeover bila memang perlu). 409 \`answering\` berarti jawaban lain sedang dikirim. Isi TEPAT SATU bentuk: \`choice\` (single-select), \`choices\` (multi-select; [] = kosongkan semua lalu submit), atau \`text\` (prosa untuk kolom bebas/catatan; boleh menyertai \`choices\`). ${DECIDE_NOTE} Ini gerbang "manusia yang memutuskan": jawablah hanya atas instruksi manusia. Hanya muncul saat tingkat \`--danger\` menyala.`,
    inputSchema: obj({
      properties: {
        session: SESSION,
        screenHash: str("Nilai `screenHash` dari hanoman_session_dialog_get untuk layar yang sedang dijawab."),
        choice: int("Nomor baris opsi (`options[].n`) untuk dialog single-select.", { minimum: 1 }),
        choices: intArray("Nomor baris yang dicentang untuk dialog multi-select; [] mengosongkan semuanya. Tak boleh bersama `choice`."),
        text: str("Jawaban prosa untuk kolom bebas atau kolom catatan (maks 16000 karakter).", { maxLength: 16000 }),
      },
      required: ["session", "screenHash"],
    }),
    mode: "danger", capability: "sessions:decide",
    samplePath: "/terminal/sessions/s1/dialog/answer", sampleMethod: "POST",
    build: (a) => {
      const body: Record<string, unknown> = { screenHash: String(a.screenHash) };
      if (n(a.choice) !== undefined) body.choice = n(a.choice);
      if (Array.isArray(a.choices)) body.choices = a.choices;
      if (s(a.text) !== undefined) body.text = s(a.text);
      return { method: "POST", path: `/terminal/sessions/${enc(String(a.session))}/dialog/answer`, body };
    },
    shape: (raw) => raw,
  },
  {
    name: "hanoman_session_dialog_takeover",
    title: "Rebut sesi dari hanoman-lead (BERBAHAYA)",
    description:
      `BERBAHAYA — merebut sesi yang pertanyaannya sedang ditangani hanoman-lead: lead dibatalkan dan hanya pemegang \`sessions:decide\` yang bisa menjawab sesudahnya. 404 berarti tak ada pertanyaan hidup untuk sesi itu; 409 \`answering\` berarti lead sudah terlanjur mengetik jawabannya ke pane (rebutan kalah). ${DECIDE_NOTE} Hanya muncul saat tingkat \`--danger\` menyala.`,
    inputSchema: obj({ properties: { session: SESSION }, required: ["session"] }),
    mode: "danger", capability: "sessions:decide",
    samplePath: "/terminal/sessions/s1/dialog/takeover", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: `/terminal/sessions/${enc(String(a.session))}/dialog/takeover` }),
    shape: (raw) => raw,
  },
];

const SPAWN_NOTE =
  "Menuntut DUA capability pada agent token: `scheduler:write` DAN `sessions:spawn` — server menolak 403 (`need: sessions:spawn`) bila yang kedua tak dicentang, sebab cron adalah sesi agen berizin penuh yang ditunda.";

const CRON_FIELDS = {
  name: str("Nama cron (1–120 karakter)."),
  expr: str("Cron expression 5 kolom (menit jam tanggal bulan hari-minggu), mis. `0 7 * * *`. Ekspresi tak sah ditolak 400."),
  prompt: str("Prompt awal yang dikirim ke sesi agen setiap kali cron jatuh tempo (maks 8000 karakter).", { maxLength: 8000 }),
  agent: enumStr(["claude", "codex", "antigravity"], "Mesin sesi. Kosong = default global."),
  model: str("Model. Kosong = default global."),
  effort: str("Effort. Kosong = default global."),
} as const;

const CRONS: readonly McpToolDef[] = [
  {
    name: "hanoman_scheduler_crons_list",
    title: "Daftar cronjob",
    description:
      "Cronjob per project: jadwal (`expr`), `prompt`, mesin, `enabled`, `nextRunAt`/`lastRunAt`. Amplop berhalaman `{items,total,page,pageSize}`. Hanya MEMBACA — sebuah cron membuka sesi agen saat jatuh tempo; perubahannya lewat hanoman_scheduler_cron_create/update.",
    inputSchema: obj({ properties: { project: str("Saring menurut id project."), ...PAGE_PARAMS } }),
    mode: "read", capability: "scheduler:read",
    samplePath: "/scheduler/crons", sampleMethod: "GET",
    build: (a) => ({
      method: "GET", path: "/scheduler/crons",
      query: query({ projectId: s(a.project), page: n(a.page)?.toString(), limit: n(a.limit)?.toString() }),
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_scheduler_cron_runs",
    title: "Riwayat run sebuah cron",
    description:
      "Run sebuah cron, berhalaman: `dueAt`, `status`, `sessionId` sesi yang diluncurkan, `note` (alasan bila dilewati/gagal), `manual` (true bila dari hanoman_scheduler_cron_run). Cron yang tak ada menjawab 404.",
    inputSchema: obj({ properties: { cron: CRON, ...PAGE_PARAMS }, required: ["cron"] }),
    mode: "read", capability: "scheduler:read",
    samplePath: "/scheduler/crons/c1/runs", sampleMethod: "GET",
    build: (a) => ({
      method: "GET", path: `/scheduler/crons/${enc(String(a.cron))}/runs`,
      query: query({ page: n(a.page)?.toString(), limit: n(a.limit)?.toString() }),
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_scheduler_cron_create",
    title: "Buat cronjob (BERBAHAYA)",
    description:
      `BERBAHAYA — membuat cron: sesudah \`enabled\`, hanoman akan membuka sesi agen BERIZIN PENUH di worktree project pada tiap jadwal, tanpa manusia di pane, berulang tanpa batas. Cron baru lahir NONAKTIF kecuali \`enabled: true\` diberikan eksplisit; nyalakan hanya atas instruksi manusia. ${SPAWN_NOTE} Project tak ada = 404. Hanya muncul saat tingkat \`--danger\` menyala.`,
    inputSchema: obj({
      properties: {
        project: str("Id project tempat sesi cron dibuka."),
        ...CRON_FIELDS,
        enabled: bool("true = langsung aktif. Default false (nonaktif)."),
      },
      required: ["project", "name", "expr", "prompt"],
    }),
    mode: "danger", capability: "scheduler:write",
    samplePath: "/scheduler/crons", sampleMethod: "POST",
    build: (a) => {
      const body: Record<string, unknown> = {
        project: String(a.project), name: String(a.name), expr: String(a.expr), prompt: String(a.prompt),
      };
      for (const k of ["agent", "model", "effort"] as const) if (s(a[k]) !== undefined) body[k] = s(a[k]);
      if (typeof a.enabled === "boolean") body.enabled = a.enabled;
      return { method: "POST", path: "/scheduler/crons", body };
    },
    shape: (raw) => raw,
  },
  {
    name: "hanoman_scheduler_cron_update",
    title: "Ubah cronjob (BERBAHAYA)",
    description:
      `BERBAHAYA — mengubah cron. Yang menggeser APA, KAPAN, atau OLEH SIAPA sesi diluncurkan (\`prompt\`, \`expr\`, \`agent\`, \`model\`, \`effort\`) atau MENYALAKAN cron (\`enabled: true\`) sama dengan mengeksekusi; hanya mengganti \`name\` atau menonaktifkan (\`enabled: false\`) yang cukup dengan \`scheduler:write\`. ${SPAWN_NOTE} Untuk mengosongkan \`agent\`/\`model\`/\`effort\` kembali ke default global, sebut namanya di \`clear\`. Cron yang tak ada = 404. Hanya muncul saat tingkat \`--danger\` menyala.`,
    inputSchema: obj({
      properties: {
        cron: CRON,
        name: CRON_FIELDS.name,
        expr: CRON_FIELDS.expr,
        prompt: CRON_FIELDS.prompt,
        agent: CRON_FIELDS.agent,
        model: CRON_FIELDS.model,
        effort: CRON_FIELDS.effort,
        enabled: bool("true = aktifkan, false = nonaktifkan."),
        clear: { type: "array", description: "Field yang dikosongkan kembali ke default global.", items: { type: "string", enum: ["agent", "model", "effort"] } },
      },
      required: ["cron"],
    }),
    mode: "danger", capability: "scheduler:write",
    samplePath: "/scheduler/crons/c1", sampleMethod: "PATCH",
    build: (a) => {
      const body: Record<string, unknown> = {};
      for (const k of ["name", "expr", "prompt", "agent", "model", "effort"] as const)
        if (s(a[k]) !== undefined) body[k] = s(a[k]);
      if (typeof a.enabled === "boolean") body.enabled = a.enabled;
      // `null` = kosongkan; field yang disebut di `clear` MENANG atas nilai yang dikirim bersamanya.
      if (Array.isArray(a.clear))
        for (const k of a.clear) if (k === "agent" || k === "model" || k === "effort") body[k] = null;
      return { method: "PATCH", path: `/scheduler/crons/${enc(String(a.cron))}`, body };
    },
    shape: (raw) => raw,
  },
  {
    name: "hanoman_scheduler_cron_delete",
    title: "Hapus cronjob (BERBAHAYA)",
    description:
      "BERBAHAYA — menghapus cron BESERTA seluruh riwayat run-nya, permanen. Sesi yang sudah diluncurkan dari cron itu tetap berjalan (tutup terpisah bila perlu). Menuntut `scheduler:write`. Cron yang tak ada = 404. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({ properties: { cron: CRON }, required: ["cron"] }),
    mode: "danger", capability: "scheduler:write",
    samplePath: "/scheduler/crons/c1", sampleMethod: "DELETE",
    build: (a) => ({ method: "DELETE", path: `/scheduler/crons/${enc(String(a.cron))}` }),
    shape: (raw) => raw ?? { deleted: true },
  },
  {
    name: "hanoman_scheduler_cron_run",
    title: "Jalankan cron sekarang (BERBAHAYA)",
    description:
      `BERBAHAYA — meminta satu run manual: hanoman membuka sesi agen berizin penuh dari prompt cron pada tick berikutnya (≤10 detik) lewat governor. Dibuat sebagai run \`queued\`, BUKAN sesi langsung — pantau lewat hanoman_scheduler_cron_runs. 409 bila scheduler berhenti/dijeda atau masih ada run yang menunggu. ${SPAWN_NOTE} Hanya muncul saat tingkat \`--danger\` menyala.`,
    inputSchema: obj({ properties: { cron: CRON }, required: ["cron"] }),
    mode: "danger", capability: "scheduler:write",
    samplePath: "/scheduler/crons/c1/run", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: `/scheduler/crons/${enc(String(a.cron))}/run` }),
    shape: (raw) => raw,
  },
];

export const GATES_TOOLS: readonly McpToolDef[] = [...DIALOG, ...CRONS];
