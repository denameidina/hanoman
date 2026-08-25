// ADR-0099 · ADR-0155 · katalog tool domain `settings`: setelan instance, config runtime, dan
// scheduler NON-CRON.
//
// Enam route `/scheduler/crons*` sengaja tak ada di sini dan tak bisa ada tanpa ADR baru:
// `capabilityForRoute` memberinya cabang COOKIE_ONLY sendiri (ADR-0112) karena satu baris cron
// membuka sesi agen di worktree, berulang, tanpa manusia di pane — "cron adalah
// `POST /terminal/sessions` yang ditunda".
import { enumStr, int, obj, str } from "../mcp-schema";
import { enc, n, query, s } from "./helpers";
import type { McpToolDef } from "./types";

// PUT /settings dan PUT /scheduler/config MENGGANTI blok penuh, bukan menambal. Skema di sini
// karena itu menerima objek utuh alih-alih mencacah tiap field: mencacahnya berarti menduplikasi
// `zSetting`/`zScheduler` di dua tempat, dan duplikat itu akan drift tanpa suara. Yang menjaga
// agen dari menghapus setelan bukan skema, melainkan kalimat di deskripsi + `..._get` yang wajib
// dipanggil lebih dulu.
const WHOLE_BLOCK = (what: string) =>
  ({ type: "object", description: `Blok ${what} UTUH. Panggil tool baca pasangannya lebih dulu, ubah yang perlu, lalu kirim balik SELURUH objeknya — PUT ini MENGGANTI blok, bukan menambal, jadi field yang hilang berarti field yang dihapus.` });

export const SETTINGS_TOOLS: readonly McpToolDef[] = [
  {
    name: "hanoman_settings_get",
    title: "Baca setelan instance",
    description:
      "Seluruh setelan instance: agen & model default, effort, notifikasi, mode goal, verifikasi, dan blok Telegram. Panggil ini sebelum hanoman_settings_set — setelan disimpan sebagai satu blok.",
    inputSchema: obj({ properties: {} }),
    mode: "read", capability: "settings:read",
    samplePath: "/settings", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/settings" }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_settings_set",
    title: "Simpan setelan instance",
    description:
      "Menyimpan setelan instance. MENGGANTI blok penuh — kirim hasil hanoman_settings_get yang sudah diubah, bukan potongan. Setelan ini berlaku untuk SETIAP sesi baru di seluruh workspace. Menyentuh blok Telegram akan memuat ulang gateway.",
    inputSchema: obj({ properties: { settings: WHOLE_BLOCK("setelan") }, required: ["settings"] }),
    mode: "write", capability: "settings:write",
    samplePath: "/settings", sampleMethod: "PUT",
    build: (a) => ({ method: "PUT", path: "/settings", body: a.settings }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_config_get",
    title: "Baca config runtime",
    description:
      "Entri config runtime instance beserta status sync-nya. Nilai RAHASIA dikembalikan dalam bentuk ter-mask (`masked` + `hasValue`), tak pernah apa adanya — jangan menebak nilai aslinya dari mask itu.",
    inputSchema: obj({ properties: {} }),
    mode: "read", capability: "settings:read",
    samplePath: "/config", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/config" }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_config_set",
    title: "Setel satu entri config",
    description:
      "Menyetel satu entri config runtime. Key harus dikenal registry (lihat hanoman_config_get); yang tak dikenal ditolak 400. Entri kategori `bootstrap` read-only, dan entri KREDENSIAL menolak agent token dengan 403 `cookie session required` — itu gerbang yang disengaja, bukan galat.",
    inputSchema: obj({
      properties: {
        key: str("Key config, persis seperti di hanoman_config_get."),
        value: str("Nilai baru. Untuk entri rahasia, string kosong berarti PERTAHANKAN yang lama."),
      },
      required: ["key", "value"],
    }),
    mode: "write", capability: "settings:write",
    samplePath: "/config", sampleMethod: "PUT",
    build: (a) => ({ method: "PUT", path: "/config", body: { key: String(a.key), value: String(a.value) } }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_config_unset",
    title: "Kosongkan satu entri config",
    description:
      "Mengosongkan satu entri config runtime sehingga nilainya jatuh kembali ke env atau default. Entri `bootstrap` dan entri kredensial ditolak, sama seperti pada hanoman_config_set.",
    inputSchema: obj({ properties: { key: str("Key config yang dikosongkan.") }, required: ["key"] }),
    mode: "write", capability: "settings:write",
    samplePath: "/config/SYNC_SERVER_URL", sampleMethod: "DELETE",
    build: (a) => ({ method: "DELETE", path: `/config/${enc(String(a.key))}` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_scheduler_config_get",
    title: "Baca setelan scheduler",
    description: "Setelan scheduler otonom: jeda, batas, dan status pause. Panggil sebelum hanoman_scheduler_config_set.",
    inputSchema: obj({ properties: {} }),
    mode: "read", capability: "settings:read",
    samplePath: "/scheduler/config", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/scheduler/config" }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_scheduler_config_set",
    title: "Simpan setelan scheduler",
    description:
      "Menyimpan setelan scheduler. MENGGANTI blok penuh, seperti setelan instance. Menyetel `paused: true` menghentikan SELURUH antrean, bukan satu baris — untuk satu baris pakai hanoman_scheduler_queue_cancel.",
    inputSchema: obj({ properties: { scheduler: WHOLE_BLOCK("scheduler") }, required: ["scheduler"] }),
    mode: "write", capability: "settings:write",
    samplePath: "/scheduler/config", sampleMethod: "PUT",
    build: (a) => ({ method: "PUT", path: "/scheduler/config", body: a.scheduler }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_scheduler_state",
    title: "Status scheduler",
    description: "Keadaan scheduler sekarang: berjalan atau dijeda, apa yang sedang dikerjakan, dan ringkasan antreannya.",
    inputSchema: obj({ properties: {} }),
    mode: "read", capability: "settings:read",
    samplePath: "/scheduler/state", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/scheduler/state" }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_scheduler_queue",
    title: "Antrean scheduler",
    description: "Baris antrean scheduler, berhalaman, bisa disaring menurut status.",
    inputSchema: obj({
      properties: {
        status: str("Saring menurut status baris antrean."),
        page: int("Halaman, mulai 1.", { minimum: 1 }),
        limit: int("Item per halaman.", { minimum: 1, maximum: 200 }),
      },
    }),
    mode: "read", capability: "settings:read",
    samplePath: "/scheduler/queue", sampleMethod: "GET",
    build: (a) => ({
      method: "GET", path: "/scheduler/queue",
      query: query({ status: s(a.status), page: n(a.page)?.toString(), limit: n(a.limit)?.toString() }),
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_scheduler_queue_cancel",
    title: "Batalkan satu baris antrean",
    description:
      "Membatalkan SATU baris antrean scheduler sebelum ia meluncur. Baris yang statusnya tak lagi bisa dibatalkan menjawab 409 beserta statusnya. Ini bukan rem global — untuk menghentikan seluruh antrean pakai `paused` di setelan scheduler.",
    inputSchema: obj({
      properties: {
        item: str("Id baris antrean, dari hanoman_scheduler_queue."),
        reason: str("Alasan singkat, tersimpan di catatan baris."),
      },
      required: ["item"],
    }),
    mode: "write", capability: "settings:write",
    samplePath: "/scheduler/queue/q1/cancel", sampleMethod: "POST",
    build: (a) => ({
      method: "POST", path: `/scheduler/queue/${enc(String(a.item))}/cancel`,
      body: s(a.reason) ? { reason: s(a.reason) } : {},
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_scheduler_queue_requeue",
    title: "Kembalikan baris ke antrean",
    description:
      "Mengembalikan baris antrean yang sudah dibatalkan. Tanpa ini pembatalan bersifat permanen — barisnya jadi tombstone dan penjadwalan ulang biasa tak bisa menghidupkannya.",
    inputSchema: obj({ properties: { item: str("Id baris antrean.") }, required: ["item"] }),
    mode: "write", capability: "settings:write",
    samplePath: "/scheduler/queue/q1/requeue", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: `/scheduler/queue/${enc(String(a.item))}/requeue` }),
    shape: (raw) => raw,
  },
];
