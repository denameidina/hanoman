// ADR-0099 · katalog tool domain `sessions`. Entri dipindahkan APA ADANYA dari berkas
// `shared/src/mcp-catalog.ts` yang lama; perilakunya identik.
import { PAGE_PARAMS, bool, enumStr, int, obj, str } from "../mcp-schema";
import { shapeSession } from "../mcp-shape";
import { enc, localPage, n, query, s } from "./helpers";
import type { McpToolDef } from "./types";

const CORE: readonly McpToolDef[] = [
  {
    name: "hanoman_sessions_list",
    title: "Sesi berjalan",
    description:
      "Sesi agen yang hidup sekarang (sumber kebenarannya tmux, bukan database). `exited: true` berarti prosesnya sudah mati — `exitCode` bukan 0 berarti gagal. Tool ini hanya MEMBACA; membuat sesi baru tidak tersedia lewat MCP.",
    inputSchema: obj({ properties: { ...PAGE_PARAMS } }),
    mode: "read", capability: "sessions:read", samplePath: "/terminal/sessions", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/terminal/sessions" }),
    shape: (raw, a) => localPage(raw, a, shapeSession),
  },
];

// ADR-0155 · sisa permukaan domain `sessions`.
//
// TIGA endpoint dialog (`/dialog`, `/dialog/answer`, `/dialog/takeover`) SENGAJA tak dibungkus,
// dan itu bukan kelalaian: SPEC-899 · ADR-0142 menuliskannya di route-nya sendiri — agen yang bisa
// menjawab `AskUserQuestion` bisa menjawab pertanyaannya SENDIRI, dan gerbang "manusia yang
// terakhir memutuskan" runtuh lewat pintu itu. `server/test/mcp-capability.test.ts` menegakkannya
// dengan assert bahwa tak ada samplePath katalog yang memuat `/dialog`. Jangan menambahkannya.
const MORE: readonly McpToolDef[] = [
  {
    name: "hanoman_session_phases",
    title: "Fase sesi",
    description:
      "Pipeline fase sebuah sesi beserta posisinya sekarang. Menjawab 404 bila sesi itu bukan sesi ber-flow (terminal biasa tak punya fase).",
    inputSchema: obj({ properties: { session: str("Id sesi, dari hanoman_sessions_list.") }, required: ["session"] }),
    mode: "read", capability: "sessions:read",
    samplePath: "/terminal/sessions/s1/phases", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `/terminal/sessions/${enc(String(a.session))}/phases` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_session_review",
    title: "Review diff sesi",
    description:
      "Diff pekerjaan sebuah sesi project-level di worktree-nya. Tanpa `path` ia mengembalikan daftar berkas yang berubah; mengisi `path` mengembalikan diff satu berkas. 409 berarti worktree-nya sudah lenyap (sesi ditutup) — bukan galat server.",
    inputSchema: obj({
      properties: {
        session: str("Id sesi."),
        path: str("Jalur berkas. Mengisinya menghasilkan diff satu berkas, bukan daftar."),
      },
      required: ["session"],
    }),
    mode: "read", capability: "sessions:read",
    samplePath: "/terminal/sessions/s1/review", sampleMethod: "GET",
    build: (a) => {
      const path = s(a.path);
      const base = `/terminal/sessions/${enc(String(a.session))}/review`;
      return { method: "GET", path: path ? `${base}/${String(path).split("/").map(enc).join("/")}` : base };
    },
    shape: (raw) => raw,
  },
  {
    name: "hanoman_session_cleanups",
    title: "Pembersihan worktree yang tertunda",
    description:
      "Worktree yang sesinya sudah lenyap tapi pembersihannya belum selesai. Baris yang MUNCUL berarti masih `closing`; yang hilang berarti sudah `closed` — jadi daftar kosong adalah kabar baik.",
    inputSchema: obj({ properties: {} }),
    mode: "read", capability: "sessions:read",
    samplePath: "/terminal/cleanups", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/terminal/cleanups" }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_session_history_list",
    title: "Riwayat sesi",
    description:
      "Sesi yang sudah berakhir, berhalaman. `exitCode: null` adalah keadaan NORMAL untuk sesi yang ditutup operator, bukan tanda kegagalan.",
    inputSchema: obj({
      properties: {
        project: str("Saring menurut id project."),
        spec: str("Saring menurut id backlog."),
        kind: str("Saring menurut jenis sesi."),
        q: str("Kata kunci penyaring."),
        page: int("Halaman, mulai 1.", { minimum: 1 }),
        limit: int("Item per halaman.", { minimum: 1, maximum: 200 }),
      },
    }),
    mode: "read", capability: "sessions:read",
    samplePath: "/terminal/history", sampleMethod: "GET",
    build: (a) => ({
      method: "GET", path: "/terminal/history",
      query: query({
        projectId: s(a.project), specId: s(a.spec), kind: s(a.kind), q: s(a.q),
        page: n(a.page)?.toString(), limit: n(a.limit)?.toString(),
      }),
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_session_history_get",
    title: "Satu riwayat sesi",
    description:
      "Detail satu sesi yang sudah berakhir: project, backlog, alur, kapan mulai & berakhir, dan sebabnya. Transkripnya terpisah — pakai hanoman_session_history_transcript.",
    inputSchema: obj({ properties: { history: str("Id riwayat, dari hanoman_session_history_list.") }, required: ["history"] }),
    mode: "read", capability: "sessions:read",
    samplePath: "/terminal/history/h1", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `/terminal/history/${enc(String(a.history))}` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_session_history_transcript",
    title: "Transkrip sesi",
    description:
      "Transkrip lengkap sebuah sesi yang sudah berakhir. Bisa sangat panjang — balasan dipotong di batas ukuran dan ditandai `truncated`. Riwayat tanpa transkrip menjawab 404, sama seperti riwayat yang tak ada.",
    inputSchema: obj({ properties: { history: str("Id riwayat.") }, required: ["history"] }),
    mode: "read", capability: "sessions:read",
    samplePath: "/terminal/history/h1/transcript", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `/terminal/history/${enc(String(a.history))}/transcript` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_session_steer",
    title: "Kirim teks ke sesi hidup",
    description:
      "Mengetik teks ke pane sesi yang sedang berjalan, seolah operator mengetiknya. Sesi yang sudah berakhir menjawab 404. Tak bisa dipakai menjawab dialog `AskUserQuestion` — itu sengaja hanya bisa dijawab manusia.",
    inputSchema: obj({
      properties: { session: str("Id sesi hidup."), text: str("Teks yang diketikkan ke pane.") },
      required: ["session", "text"],
    }),
    mode: "write", capability: "sessions:write",
    samplePath: "/terminal/sessions/s1/steer", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: `/terminal/sessions/${enc(String(a.session))}/steer`, body: { text: String(a.text) } }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_session_interrupt",
    title: "Interupsi sesi hidup",
    description:
      "Mengirim interupsi (Ctrl-C) ke pane sesi yang sedang berjalan. Menghentikan apa yang sedang dikerjakan agen TANPA menutup sesinya.",
    inputSchema: obj({ properties: { session: str("Id sesi hidup.") }, required: ["session"] }),
    mode: "write", capability: "sessions:write",
    samplePath: "/terminal/sessions/s1/interrupt", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: `/terminal/sessions/${enc(String(a.session))}/interrupt` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_session_create",
    title: "Buka sesi agen baru (BERBAHAYA)",
    description:
      "BERBAHAYA — membuka sesi agen BARU: hanoman menjalankan claude/codex dengan IZIN PENUH di worktree project, dan sesi itu bisa menulis berkas, menjalankan perintah, serta membuat commit tanpa manusia di pane. Menuntut capability `sessions:spawn`; `sessions:write` — yang cukup untuk mengendalikan sesi yang SUDAH ada — tidak cukup di sini. Panggil hanoman_sessions_list lebih dulu: sesi yang sudah berjalan untuk backlog yang sama akan DILANJUTKAN, bukan digandakan. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: {
        spec: str("Id backlog, mis. `SPEC-482`. Mengisinya membuka sesi BACKLOG dan mewajibkan `flow`."),
        project: str("Id project. Dipakai untuk sesi tingkat-project (reverse/prd/breakdown/scaffold) atau terminal biasa."),
        flow: enumStr(["feature", "qa", "audit", "goal", "no_effort", "reverse", "prd", "breakdown", "scaffold"],
          "Alur sesi. Wajib bila `spec` diisi. `reverse`/`prd`/`breakdown`/`scaffold` adalah sesi tingkat-project dan dipasangkan dengan `project`."),
        shell: bool("true = terminal shell biasa di repo project, tanpa agen. Hanya dengan `project`."),
        agent: enumStr(["claude", "codex"], "Mesin sesi. Kosong = default global."),
        model: str("Model. Kosong = default global."),
        effort: str("Effort. Kosong = default global."),
        goal: bool("Mode goal per-sesi. Kosong = ikut setelan global."),
        goalCondition: str("Kondisi selesai mode goal (maks 4000 karakter)."),
        verifyScope: enumStr(["changed", "full"], "Scope verifikasi. Kosong = ikut setelan global."),
        method: str("Metode workflow. Id tak dikenal jatuh ke default, bukan ditolak."),
        prdPath: str("flow `breakdown`: jalur PRD yang dipecah. WAJIB untuk alur itu."),
        force: bool("Lewati gerbang dependency. Pakai HANYA sesudah melihat daftar pemblokirnya."),
      },
      allOf: [
        { if: { required: ["spec"] }, then: { required: ["flow"] } },
        { if: { properties: { flow: { const: "breakdown" } }, required: ["flow"] }, then: { required: ["project", "prdPath"] } },
        { if: { properties: { flow: { const: "reverse" } }, required: ["flow"] }, then: { required: ["project"] } },
        { if: { properties: { flow: { const: "scaffold" } }, required: ["flow"] }, then: { required: ["project"] } },
        { if: { required: ["shell"] }, then: { required: ["project"] } },
      ],
    }),
    mode: "danger", capability: "sessions:spawn",
    samplePath: "/terminal/sessions", sampleMethod: "POST",
    build: (a) => {
      // Bentuk body ditentukan varian union di server; mengirim gabungan semua field akan ditolak
      // 400 karena varian permisif `{project, flow: undefined}` sengaja menolak `flow` yang cacat.
      if (s(a.spec)) {
        const body: Record<string, unknown> = { spec: String(a.spec), flow: String(a.flow) };
        for (const k of ["model", "effort", "goalCondition", "agent", "verifyScope", "method"])
          if (s(a[k]) !== undefined) body[k] = s(a[k]);
        for (const k of ["goal", "force"]) if (typeof a[k] === "boolean") body[k] = a[k];
        return { method: "POST", path: "/terminal/sessions", body };
      }
      const project = String(a.project);
      if (a.shell === true) return { method: "POST", path: "/terminal/sessions", body: { project, shell: true } };
      const flow = s(a.flow);
      if (flow === "breakdown") return { method: "POST", path: "/terminal/sessions", body: { project, flow, prdPath: String(a.prdPath) } };
      if (flow === "reverse" || flow === "scaffold") return { method: "POST", path: "/terminal/sessions", body: { project, flow } };
      const body: Record<string, unknown> = { project };
      for (const k of ["agent", "model", "effort"]) if (s(a[k]) !== undefined) body[k] = s(a[k]);
      return { method: "POST", path: "/terminal/sessions", body };
    },
    shape: (raw) => raw,
  },
  {
    name: "hanoman_session_integrate",
    title: "Integrate branch sesi (BERBAHAYA)",
    description:
      "BERBAHAYA — merge atau rebase branch sebuah sesi tingkat-project. Konflik MEMBUKA SESI AGEN baru untuk menyelesaikannya. Sesi tanpa branch menjawab 409. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: {
        session: str("Id sesi."),
        op: enumStr(["merge", "rebase"], "Cara integrasi. `rebase` menulis ulang sejarah."),
        target: str("Tujuan, berbentuk `local:<branch>` atau `origin:<branch>`."),
      },
      required: ["session", "op", "target"],
    }),
    mode: "danger", capability: "sessions:write",
    samplePath: "/terminal/sessions/s1/integrate", sampleMethod: "POST",
    build: (a) => ({
      method: "POST", path: `/terminal/sessions/${enc(String(a.session))}/integrate`,
      body: { op: String(a.op), target: String(a.target) },
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_session_close",
    title: "Tutup sesi (BERBAHAYA)",
    description:
      "BERBAHAYA — menutup sesi yang sedang berjalan dan menjadwalkan pembersihan worktree-nya. Pekerjaan yang belum di-commit di worktree itu HILANG. Menjawab 202: penutupannya asinkron, dan pembersihannya terpantau lewat hanoman_session_cleanups. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({ properties: { session: str("Id sesi yang ditutup.") }, required: ["session"] }),
    mode: "danger", capability: "sessions:write",
    samplePath: "/terminal/sessions/s1", sampleMethod: "DELETE",
    build: (a) => ({ method: "DELETE", path: `/terminal/sessions/${enc(String(a.session))}` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_session_history_purge",
    title: "Hapus riwayat sesi (BERBAHAYA)",
    description:
      "BERBAHAYA — menghapus riwayat sesi secara permanen. WAJIB ber-scope: sebutkan `project` dan/atau `before`; tanpa keduanya server menolak 400, justru supaya satu salah ketik tak menghapus seluruh riwayat. Transkrip ikut hilang. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: {
        project: str("Batasi penghapusan ke satu project."),
        before: str("Batasi ke riwayat sebelum tanggal ini (ISO 8601)."),
      },
    }),
    mode: "danger", capability: "sessions:write",
    samplePath: "/terminal/history", sampleMethod: "DELETE",
    build: (a) => ({ method: "DELETE", path: "/terminal/history", query: query({ projectId: s(a.project), before: s(a.before) }) }),
    shape: (raw) => raw,
  },
];

export const SESSIONS_TOOLS: readonly McpToolDef[] = [...CORE, ...MORE];
