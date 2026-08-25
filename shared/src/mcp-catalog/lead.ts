// ADR-0099 · katalog tool domain `lead`. Entri dipindahkan APA ADANYA dari berkas
// `shared/src/mcp-catalog.ts` yang lama; perilakunya identik.
import { PAGE_PARAMS, bool, int, obj, str, strArray } from "../mcp-schema";
import { shapeLeadDecision } from "../mcp-shape";
import { localPage, n, query, s } from "./helpers";
import type { McpToolDef } from "./types";

export const LEAD_TOOLS: readonly McpToolDef[] = [
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
        ...PAGE_PARAMS,
      },
    }),
    mode: "read", capability: "lead:read", samplePath: "/lead/decisions", sampleMethod: "GET",
    build: (a) => ({
      method: "GET", path: "/lead/decisions",
      query: query({ projectId: s(a.project), specId: s(a.spec), status: s(a.status) }),
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
