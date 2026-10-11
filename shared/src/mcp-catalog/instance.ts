// ADR-0199 · ADR-0200 · ADR-0201 · katalog tool `sync` (permukaan UI), `instance` (pasang pembaruan &
// restart), dan panduan agen. Ketiganya dulu SENGAJA di luar katalog: `sync` cookie-only sejak SPEC-268/
// 270/799, `/update/apply` + `/restart` cookie-only sejak SPEC-405 (ADR-0088), panduan agen publik
// tanpa tool. Pemilik repo membalik itu — dengan capability BARU yang opt-in (`sync:read|write|resolve`,
// `instance:admin`), bukan dengan melebarkan capability lama.
//
// Yang TIDAK dibungkus di sini (dan kenapa) ada di `UNWRAPPED` `server/test/mcp-coverage.test.ts` dan
// ADR-0199 §3: kanal sync mesin-ke-mesin (pull/bootstrap/push/logs/attachments/qa-attachments/ws/relay)
// ber-Bearer DEVICE-TOKEN, dan `POST /ws-tickets` menerbitkan tiket WebSocket — membungkusnya berarti
// menyerahkan kredensial mesin ke agen. Help Center publik (ADR-0201) juga tidak: anonim by design.
import { bool, enumStr, int, obj, str } from "../mcp-schema";
import { enc, localPage, n } from "./helpers";
import type { McpToolDef } from "./types";

const CLIP = 300;
/** Nilai sisi konflik → teks pendek. Data record bisa besar (payload spec, detail tiket). */
function clip(v: unknown): string {
  const t = typeof v === "string" ? v : JSON.stringify(v) ?? "null";
  return t.length <= CLIP ? t : `${t.slice(0, CLIP)}… (+${t.length - CLIP} karakter)`;
}

/** Hash kunci akses tiket tak ikut dipamerkan: tak ada gunanya bagi pemutus konflik. */
const HIDDEN_FIELDS = new Set(["accessKeyHash"]);

/**
 * Konflik rekonsil → ringkasan yang bisa diputuskan: field yang BERBEDA saja, kedua sisinya
 * dipotong. Dua `data` utuh akan membanjiri konteks dan memaparkan seluruh record entitas lain
 * di luar capability domainnya; yang perlu dilihat pemutus hanyalah apa yang bentrok.
 */
function shapeConflict(r: Record<string, unknown>): unknown {
  const local = (r.localData ?? {}) as Record<string, unknown>;
  const server = (r.serverData ?? {}) as Record<string, unknown>;
  const fields = [...new Set([...Object.keys(local), ...Object.keys(server)])]
    .filter((k) => !HIDDEN_FIELDS.has(k) && JSON.stringify(local[k]) !== JSON.stringify(server[k]));
  return {
    entity: r.entity, recordId: r.recordId,
    localVersion: r.localVersion, serverVersion: r.serverVersion,
    localUpdatedAt: r.localUpdatedAt, serverUpdatedAt: r.serverUpdatedAt, detectedAt: r.detectedAt,
    differs: fields.map((k) => ({ field: k, local: clip(local[k]), server: clip(server[k]) })),
  };
}

const RESOLVE_HINT: Record<string, string> = {
  "not-found": "Konflik tak ditemukan atau sudah diputuskan, atau (untuk `local`) hub tak menjawab push. Baca ulang lewat hanoman_sync_conflicts.",
  "still-conflict": "Hub bergeser lagi di sela push, jadi konfliknya hidup kembali dan TIDAK diputuskan. Baca ulang lewat hanoman_sync_conflicts sebelum mencoba lagi.",
};

export const INSTANCE_TOOLS: readonly McpToolDef[] = [
  {
    name: "hanoman_sync_conflicts",
    title: "Antrean konflik sync",
    description:
      "Konflik rekonsil yang BELUM diputuskan antara data mesin ini dan hub (hanya relevan di instance klien). Tiap konflik memuat entity, recordId, versi & jam kedua sisi, dan `differs`: hanya field yang bentrok, tiap sisi dipotong 300 karakter. Dipakai SEBELUM hanoman_sync_conflict_resolve — memutuskan tanpa membaca ini berarti membuang satu sisi tanpa tahu isinya.",
    inputSchema: obj({
      properties: {
        page: int("Halaman, mulai dari 1. Default 1.", { minimum: 1 }),
        limit: int("Jumlah konflik per halaman. Default 20, maksimum 100.", { minimum: 1, maximum: 100 }),
      },
    }),
    mode: "read", capability: "sync:read", samplePath: "/sync/conflicts", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/sync/conflicts" }),
    shape: (raw, a) => localPage(
      (raw as { conflicts?: unknown[] } | null)?.conflicts ?? [], a, shapeConflict,
    ),
  },
  {
    name: "hanoman_sync_pending",
    title: "Penghapusan sync tertunda",
    description:
      "Penghapusan lokal yang belum sempat menyeberang ke hub (client offline atau sync belum jalan): entity, recordId, deletedAt. Daftar kosong berarti semua penghapusan sudah sampai. Baca-saja; memicu siklus sync lewat hanoman_sync_now.",
    inputSchema: obj({
      properties: {
        page: int("Halaman, mulai dari 1. Default 1.", { minimum: 1 }),
        limit: int("Jumlah item per halaman. Default 20, maksimum 100.", { minimum: 1, maximum: 100 }),
      },
    }),
    mode: "read", capability: "sync:read", samplePath: "/sync/pending", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/sync/pending" }),
    shape: (raw, a) => localPage((raw as { deletes?: unknown[] } | null)?.deletes ?? [], a, (r) => r),
  },
  {
    name: "hanoman_sync_now",
    title: "Jalankan sync sekarang",
    description:
      "Memicu SATU siklus sync ke hub sekarang (pull lalu push), sama dengan tombol di dashboard. `full: true` menarik ulang changefeed dari kursor 0 — pemulihan baris yang terlanjur terlewat; jauh lebih berat, jangan jadi kebiasaan. Menjawab `ok:false, reason:\"not-configured\"` bila instance ini bukan klien (tak ada hub yang dituju). Tak memutuskan konflik: itu hanoman_sync_conflict_resolve.",
    inputSchema: obj({
      properties: {
        full: bool("true = tarik ulang feed dari kursor 0 (pemulihan). Default false = satu siklus biasa."),
      },
    }),
    mode: "write", capability: "sync:write", samplePath: "/sync/now", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: "/sync/now", body: { full: a.full === true } }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_sync_conflict_resolve",
    title: "Putuskan konflik sync (BERBAHAYA)",
    description:
      "BERBAHAYA — memutuskan satu konflik rekonsil dengan MEMBUANG satu sisi tanpa jalan pulang. `choice: \"local\"` = force-push data mesin ini ke hub (menimpa versi hub); `choice: \"server\"` = adopsi versi hub dan buang edit lokal. Baca dulu hanoman_sync_conflicts dan tanyakan manusia bila ragu: ini keputusan atas data orang, bukan konflik teknis. `ok:false` bukan galat HTTP — lihat `reason`/`hint`. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: {
        entity: str("Jenis record, persis seperti di hanoman_sync_conflicts (mis. `spec`, `project`)."),
        recordId: str("Id record yang berkonflik, persis seperti di hanoman_sync_conflicts."),
        choice: enumStr(["local", "server"], "Sisi yang MENANG. `local` menimpa hub; `server` membuang edit lokal."),
      },
      required: ["entity", "recordId", "choice"],
    }),
    mode: "danger", capability: "sync:resolve",
    samplePath: "/sync/conflicts/spec/SPEC-1/resolve", sampleMethod: "POST",
    build: (a) => ({
      method: "POST",
      path: `/sync/conflicts/${enc(String(a.entity ?? ""))}/${enc(String(a.recordId ?? ""))}/resolve`,
      body: { choice: a.choice },
    }),
    shape: (raw) => {
      const r = raw as { ok?: boolean; reason?: string } | null;
      return r && r.ok === false && r.reason ? { ...r, hint: RESOLVE_HINT[r.reason] ?? undefined } : raw;
    },
  },
  {
    name: "hanoman_update_apply",
    title: "Pasang pembaruan hanoman (BERBAHAYA)",
    description:
      "BERBAHAYA — memasang versi hanoman terbaru dari registry npm lalu me-RESTART proses server lewat supervisor `hanoman start`: koneksi (dashboard, MCP ini) putus beberapa detik; pane tmux & agen di dalamnya selamat. Hanya sah bila `canApply` di hanoman_update_status bernilai true dan ada versi baru. `confirm` WAJIB diisi: `false` hanya melapor (versi, jumlah sesi hidup) tanpa memasang apa pun; `true` memasang — setelah manusia menyetujui. Balasan 202 dikirim SEBELUM proses mati. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: {
        confirm: bool("true = pasang dan restart sekarang. false = hanya laporkan apa yang akan terjadi."),
      },
      required: ["confirm"],
    }),
    mode: "danger", capability: "instance:admin", samplePath: "/update/apply", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: "/update/apply", body: { confirm: a.confirm === true } }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_instance_restart",
    title: "Restart instance hanoman (BERBAHAYA)",
    description:
      "BERBAHAYA — me-restart proses server hanoman TANPA memasang apa pun (untuk server yang macet). Koneksi putus beberapa detik; pane tmux selamat. Hanya sah bila instance punya supervisor (`hanoman start`); tanpa itu menjawab bentrok dan TIDAK keluar. `confirm` WAJIB diisi: `false` hanya melapor jumlah sesi hidup; `true` me-restart. Balasan 202 dikirim SEBELUM proses mati. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: {
        confirm: bool("true = restart sekarang. false = hanya laporkan jumlah sesi hidup."),
      },
      required: ["confirm"],
    }),
    mode: "danger", capability: "instance:admin", samplePath: "/restart", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: "/restart", body: { confirm: a.confirm === true } }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_agent_guide",
    title: "Panduan AI agent hanoman",
    description:
      "Isi `docs/agent-integration.md` dari instance ini: arti 401/403, tabel capability, jebakan yang sudah diketahui. Naskahnya panjang (±30 KB) dan balasan tool dibatasi ukurannya, jadi dibaca BERPOTONG: mulai dari `offset` 0, lalu ikuti `nextOffset` sampai null. Endpoint ini publik — tak menuntut capability apa pun.",
    inputSchema: obj({
      properties: {
        offset: int("Posisi karakter awal potongan. Default 0. Pakai `nextOffset` dari balasan sebelumnya.", { minimum: 0 }),
        limit: int("Jumlah karakter per potongan. Default 10000, maksimum 12000 (JSON menggandakan sebagian karakter; plafon balasan tool 24 KB).", { minimum: 500, maximum: 12000 }),
      },
    }),
    mode: "read", capability: null, samplePath: "/agent-integration.md", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/agent-integration.md" }),
    shape: (raw, a) => {
      const text = typeof raw === "string" ? raw : JSON.stringify(raw);
      const offset = Math.max(0, Math.floor(n(a.offset) ?? 0));
      const size = Math.min(12000, Math.max(500, Math.floor(n(a.limit) ?? 10000)));
      const end = Math.min(text.length, offset + size);
      return {
        offset, total: text.length,
        nextOffset: end < text.length ? end : null,
        text: text.slice(offset, end),
      };
    },
  },
];
