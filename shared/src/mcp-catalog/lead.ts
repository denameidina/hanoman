// ADR-0099 · katalog tool domain `lead`. Entri dipindahkan APA ADANYA dari berkas
// `shared/src/mcp-catalog.ts` yang lama; perilakunya identik.
import { PAGE_PARAMS, bool, int, obj, str, strArray } from "../mcp-schema";
import { shapeLeadDecision } from "../mcp-shape";
import { enc, localPage, n, query, s } from "./helpers";
import type { McpToolDef } from "./types";

const CORE: readonly McpToolDef[] = [
  {
    name: "hanoman_lead_decisions_list",
    title: "Jejak keputusan hanoman-lead",
    description:
      "Jejak keputusan hanoman-lead, terbaru dulu. `status`: `berlaku`, `gagal`, `ditimpa`, `dibatalkan`. `confidence: ragu` berarti lead memutuskan tapi memilih opsi yang paling mudah dibatalkan.",
    inputSchema: obj({
      properties: {
        project: str("Id proyek."),
        spec: str("Id backlog, mis. `SPEC-482`."),
        status: str("Status keputusan: `berlaku`, `gagal`, `ditimpa`, atau `dibatalkan`."),
        // ADR-0155 · parameter OPSIONAL, jadi aditif menurut kontrak MCP_TOOL_SCHEMA_VERSION.
        // Inilah satu-satunya cara membaca LANGKAH sebuah rantai: SPEC-485 sengaja tak membuat
        // tool bersarang untuknya, karena serializer kedua akan berselisih diam-diam.
        flow: str("Id rantai keputusan. Mengisinya mengembalikan LANGKAH rantai itu, urut NAIK. Dapatkan dari hanoman_lead_flows_list."),
        ...PAGE_PARAMS,
      },
    }),
    mode: "read", capability: "lead:read", samplePath: "/lead/decisions", sampleMethod: "GET",
    build: (a) => ({
      method: "GET", path: "/lead/decisions",
      query: query({ projectId: s(a.project), specId: s(a.spec), status: s(a.status), flowId: s(a.flow) }),
    }),
    shape: (raw, a) => localPage(raw, a, shapeLeadDecision),
  },
  {
    name: "hanoman_lead_ask",
    title: "Minta putusan hanoman-lead",
    description:
      "Minta putusan ke hanoman-lead saat menemui persimpangan yang biasanya butuh manusia. Jawabannya terbaca mesin (`decision`, `reason`, `refs`, `confidence`, `action`, `choices`) dan `refs` hanya memuat rujukan yang benar-benar ada di repo. Bila opsinya TIDAK saling eksklusif, set `multi: true` — balasannya memuat `choices` (daftar), bukan hanya `choice`. Panggilan ini melahirkan jejak permanen dan putusannya bisa menggerakkan sesi — pakai hanya saat memang buntu. 409 = lead tak aktif atau proyek belum opt-in: kembali ke perilaku biasa, berhenti dan tunggu manusia; 400 = bentuk `multi`/`minChoices`/`maxChoices` mustahil dipenuhi oleh daftar opsi yang kamu kirim.",
    inputSchema: obj({
      properties: {
        project: str("Id proyek."),
        question: str("Pertanyaannya, maksimum 8000 karakter."),
        spec: str("Opsional. Id backlog yang bersangkutan."),
        session: str("Opsional. Id sesi yang bersangkutan."),
        options: strArray("Opsional. Pilihan yang tersedia, maksimum 20, masing-masing maksimum 2000 karakter. Lead memilih salah satunya."),
        context: str("Opsional. Konteks pendukung, maksimum 20.000 karakter."),
        multi: bool("Opsional. `true` bila opsinya TIDAK saling eksklusif dan lead boleh memilih beberapa sekaligus. Menuntut `options` terisi."),
        minChoices: int("Opsional, hanya untuk `multi`. Paling sedikit berapa opsi harus dipilih."),
        maxChoices: int("Opsional, hanya untuk `multi`. Paling banyak berapa opsi boleh dipilih; tanpa ini sebanyak opsinya."),
      },
      required: ["project", "question"],
    }),
    mode: "write", capability: "lead:write", samplePath: "/lead/decisions", sampleMethod: "POST",
    build: (a) => ({
      method: "POST", path: "/lead/decisions",
      body: {
        projectId: a.project, question: a.question,
        ...(s(a.spec) ? { specId: a.spec } : {}),
        ...(s(a.session) ? { sessionId: a.session } : {}),
        ...(Array.isArray(a.options) ? { options: a.options } : {}),
        ...(s(a.context) ? { context: a.context } : {}),
        // SPEC-485 · ADITIF: tanpa `multi` bentuk permintaannya identik dengan sebelum ADR-0102,
        // jadi klien MCP lama tak berubah perilakunya satu bit pun.
        ...(a.multi === true
          ? { select: { mode: "multi", min: n(a.minChoices) ?? 0, max: n(a.maxChoices) ?? null } }
          : {}),
      },
    }),
    shape: (raw) => raw,
  },
];

// ADR-0155 · sisa permukaan domain `lead`. Satu tool bermode `danger`: menutup sebuah rantai
// dengan submit adalah putusan akhir yang bisa MENGGERAKKAN SESI.
const MORE: readonly McpToolDef[] = [
  {
    name: "hanoman_lead_status",
    title: "Status hanoman-lead",
    description: "Keadaan lead sekarang: aktif atau dijeda, keputusan yang sedang disusun, dan ringkasan jejaknya.",
    inputSchema: obj({ properties: {} }),
    mode: "read", capability: "lead:read",
    samplePath: "/lead/status", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/lead/status" }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_lead_config_get",
    title: "Baca setelan lead",
    description: "Setelan hanoman-lead: runtime, model, effort, anggaran, dan status pause. Panggil sebelum hanoman_lead_config_set.",
    inputSchema: obj({ properties: {} }),
    mode: "read", capability: "lead:read",
    samplePath: "/lead/config", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/lead/config" }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_lead_config_set",
    title: "Simpan setelan lead",
    description:
      "Menyimpan setelan hanoman-lead. MENGGANTI blok penuh — kirim hasil hanoman_lead_config_get yang sudah diubah. `paused: true` menghentikan lead untuk SELURUH project.",
    inputSchema: obj({
      properties: { lead: { type: "object", description: "Blok setelan lead UTUH. PUT ini mengganti, bukan menambal." } },
      required: ["lead"],
    }),
    mode: "write", capability: "lead:write",
    samplePath: "/lead/config", sampleMethod: "PUT",
    build: (a) => ({ method: "PUT", path: "/lead/config", body: a.lead }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_lead_flows_list",
    title: "Daftar rantai keputusan lead",
    description:
      "Rantai keputusan lead, berhalaman. LANGKAH tiap rantai TIDAK bersarang di sini — baca lewat hanoman_lead_decisions_list dengan `flowId`, karena langkah adalah baris jejak biasa dan menyalinnya ke bentuk kedua akan membuat keduanya berselisih diam-diam.",
    inputSchema: obj({
      properties: {
        project: str("Saring menurut id project."),
        status: str("Saring menurut status rantai."),
        page: int("Halaman, mulai 1.", { minimum: 1 }),
        limit: int("Item per halaman.", { minimum: 1, maximum: 200 }),
      },
    }),
    mode: "read", capability: "lead:read",
    samplePath: "/lead/flows", sampleMethod: "GET",
    build: (a) => ({
      method: "GET", path: "/lead/flows",
      query: query({ projectId: s(a.project), status: s(a.status), page: n(a.page)?.toString(), limit: n(a.limit)?.toString() }),
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_lead_flow_cancel",
    title: "Batalkan rantai keputusan",
    description:
      "Menutup sebuah rantai keputusan TANPA putusan. Rantai yang sudah tertutup menjawab 409 — tak ada yang rusak, kesempatannya yang sudah lewat.",
    inputSchema: obj({ properties: { flow: str("Id rantai, dari hanoman_lead_flows_list.") }, required: ["flow"] }),
    mode: "write", capability: "lead:write",
    samplePath: "/lead/flows/f1/cancel", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: `/lead/flows/${enc(String(a.flow))}/cancel` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_lead_decision_override",
    title: "Timpa keputusan lead",
    description:
      "Menimpa sebuah keputusan lead dengan jawaban operator. Bila pane sesinya masih hidup, jawaban itu DIKETIK ke sesi tersebut dan pilihannya ikut dicentang di dialog — jadi ini menggerakkan sesi, bukan sekadar menulis jejak. Keputusan yang sudah tak berlaku menjawab 409.",
    inputSchema: obj({
      properties: {
        decision: str("Id keputusan, dari hanoman_lead_decisions_list."),
        answer: str("Jawaban operator (1–8000 karakter). Inilah yang diketikkan ke pane."),
        reason: str("Alasan menimpa, tersimpan di jejak."),
        choices: strArray("Opsi yang dicentang, dipetakan ke opsi baris yang ditimpa (maks 20)."),
      },
      required: ["decision", "answer"],
    }),
    mode: "write", capability: "lead:write",
    samplePath: "/lead/decisions/d1/override", sampleMethod: "POST",
    build: (a) => ({
      method: "POST", path: `/lead/decisions/${enc(String(a.decision))}/override`,
      body: {
        answer: String(a.answer),
        ...(s(a.reason) ? { reason: s(a.reason) } : {}),
        ...(Array.isArray(a.choices) ? { choices: a.choices } : {}),
      },
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_lead_decision_cancel",
    title: "Batalkan keputusan lead",
    description:
      "Membatalkan sebuah keputusan lead yang masih berlaku. Penghitung jawaban otomatis sesi terkait ikut di-reset. Keputusan yang sudah tak berlaku menjawab 409.",
    inputSchema: obj({ properties: { decision: str("Id keputusan.") }, required: ["decision"] }),
    mode: "write", capability: "lead:write",
    samplePath: "/lead/decisions/d1/cancel", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: `/lead/decisions/${enc(String(a.decision))}/cancel` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_lead_flow_submit",
    title: "Tutup rantai dengan putusan (BERBAHAYA)",
    description:
      "BERBAHAYA — menutup rantai keputusan dengan SUBMIT. Rantai tak lagi menerima pertanyaan lanjutan, dan putusannya bisa MENGGERAKKAN SESI: ia dapat mengarahkan atau menutup sesi agen tanpa manusia di pane. Baca isi rantainya lebih dulu lewat hanoman_lead_decisions_list dengan `flowId`. Rantai yang sudah tertutup menjawab 409. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({ properties: { flow: str("Id rantai yang ditutup.") }, required: ["flow"] }),
    mode: "danger", capability: "lead:write",
    samplePath: "/lead/flows/f1/submit", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: `/lead/flows/${enc(String(a.flow))}/submit` }),
    shape: (raw) => raw,
  },
];

export const LEAD_TOOLS: readonly McpToolDef[] = [...CORE, ...MORE];
