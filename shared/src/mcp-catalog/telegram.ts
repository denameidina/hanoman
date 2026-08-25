// ADR-0099 · ADR-0155 · katalog tool domain `telegram`: status gateway, context & memory per chat,
// reply, dan audit.
//
// EMPAT route permukaan KREDENSIAL (`/telegram/{settings,test,credentials}`) sengaja tak ada di
// sini dan tak bisa ada: `capabilityForRoute` memberinya COOKIE_ONLY karena ia menyimpan bot token
// dan AgentToken — termasuk milik gateway itu sendiri, yang wajib memegang `settings:write`
// (ADR-0097). Agen yang bisa membacanya bisa mencuri kredensialnya sendiri.
import { enumStr, int, obj, str, strArray } from "../mcp-schema";
import { enc, n, query, s } from "./helpers";
import type { McpToolDef } from "./types";

const CHAT = str("Id chat Telegram.");

export const TELEGRAM_TOOLS: readonly McpToolDef[] = [
  {
    name: "hanoman_telegram_status",
    title: "Status gateway Telegram",
    description:
      "Apakah gateway Telegram sedang berjalan, dan kesiapannya. Panggil ini sebelum hanoman_telegram_reply_send — gateway yang mati berarti pesanmu mengantre tanpa terkirim.",
    inputSchema: obj({ properties: {} }),
    mode: "read", capability: "telegram:read",
    samplePath: "/telegram/status", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/telegram/status" }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_telegram_audit",
    title: "Audit kanal Telegram",
    description: "Jejak audit kanal Telegram, bisa disaring menurut chat dan update. Terbaru dulu.",
    inputSchema: obj({
      properties: {
        chat: str("Saring menurut id chat."),
        update: int("Saring menurut id update Telegram.", { minimum: 0 }),
        take: int("Jumlah baris (1–100). Default 50.", { minimum: 1, maximum: 100 }),
        skip: int("Lewati N baris pertama.", { minimum: 0 }),
      },
    }),
    mode: "read", capability: "telegram:read",
    samplePath: "/telegram/audit", sampleMethod: "GET",
    build: (a) => ({
      method: "GET", path: "/telegram/audit",
      query: query({
        chatId: s(a.chat), updateId: n(a.update)?.toString(),
        take: n(a.take)?.toString(), skip: n(a.skip)?.toString(),
      }),
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_telegram_context_get",
    title: "Context chat Telegram",
    description:
      "Context sebuah chat: project & sesi aktifnya, persona, dan ringkasan percakapan. Chat yang tak dikenal menjawab 404.",
    inputSchema: obj({ properties: { chat: CHAT }, required: ["chat"] }),
    mode: "read", capability: "telegram:read",
    samplePath: "/telegram/chats/123/context", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `/telegram/chats/${enc(String(a.chat))}/context` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_telegram_context_set",
    title: "Ubah context chat Telegram",
    description:
      "Mengubah context sebuah chat. MENAMBAL — hanya field yang kamu kirim yang berubah. Minimal satu field wajib; body kosong ditolak 400. Kirim `null` untuk mengosongkan sebuah field.",
    inputSchema: obj({
      properties: {
        chat: CHAT,
        activeProject: str("Id project aktif untuk chat ini."),
        activeSession: str("Id sesi aktif untuk chat ini."),
        personalityAgent: str("Id custom agent yang jadi persona balasan."),
        summary: str("Ringkasan percakapan (maks 4000 karakter)."),
      },
      required: ["chat"],
    }),
    mode: "write", capability: "telegram:write",
    samplePath: "/telegram/chats/123/context", sampleMethod: "PATCH",
    build: (a) => {
      const body: Record<string, unknown> = {};
      const map: Record<string, string> = {
        activeProject: "activeProjectId", activeSession: "activeSessionId",
        personalityAgent: "personalityAgentId", summary: "summary",
      };
      for (const [arg, field] of Object.entries(map)) if (s(a[arg]) !== undefined) body[field] = s(a[arg]);
      return { method: "PATCH", path: `/telegram/chats/${enc(String(a.chat))}/context`, body };
    },
    shape: (raw) => raw,
  },
  {
    name: "hanoman_telegram_memory_add",
    title: "Tambah memory chat Telegram",
    description:
      "Menambah satu catatan yang diingat gateway untuk chat ini (maks 1000 karakter). Chat yang tak dikenal menjawab 404.",
    inputSchema: obj({
      properties: { chat: CHAT, content: str("Isi catatan (1–1000 karakter).") },
      required: ["chat", "content"],
    }),
    mode: "write", capability: "telegram:write",
    samplePath: "/telegram/chats/123/memories", sampleMethod: "POST",
    build: (a) => ({
      method: "POST", path: `/telegram/chats/${enc(String(a.chat))}/memories`,
      body: { content: String(a.content) },
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_telegram_memory_delete",
    title: "Hapus satu memory chat",
    description: "Menghapus SATU catatan memory chat menurut id-nya.",
    inputSchema: obj({
      properties: { chat: CHAT, memory: str("Id memory yang dihapus.") },
      required: ["chat", "memory"],
    }),
    mode: "write", capability: "telegram:write",
    samplePath: "/telegram/chats/123/memories/m1", sampleMethod: "DELETE",
    build: (a) => ({ method: "DELETE", path: `/telegram/chats/${enc(String(a.chat))}/memories/${enc(String(a.memory))}` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_telegram_memories_clear",
    title: "Hapus SELURUH memory chat",
    description:
      "Menghapus SELURUH catatan memory sebuah chat sekaligus. Untuk menghapus satu saja, pakai hanoman_telegram_memory_delete — tool ini sengaja terpisah supaya penghapusan menyeluruh tak terjadi karena salah pilih.",
    inputSchema: obj({ properties: { chat: CHAT }, required: ["chat"] }),
    mode: "write", capability: "telegram:write",
    samplePath: "/telegram/chats/123/memories", sampleMethod: "DELETE",
    build: (a) => ({ method: "DELETE", path: `/telegram/chats/${enc(String(a.chat))}/memories` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_telegram_reply_send",
    title: "Kirim balasan Telegram (BERBAHAYA)",
    description:
      "BERBAHAYA — mengantre pesan ke chat Telegram operator. Pesannya dibaca MANUSIA di luar hanoman dan TAK BISA ditarik kembali. Menuntut korelasi `update` yang sah: pesan hanya boleh menjawab update yang benar-benar sedang ditangani, dan korelasi yang tak cocok ditolak 409. `kind: \"confirmation\"` WAJIB disertai blok konfirmasi, dan kind lain WAJIB tanpa itu. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: {
        chat: CHAT,
        update: int("Id update Telegram yang sedang dijawab. Harus sedang ditangani gateway.", { minimum: 0 }),
        kind: str("Jenis balasan. `confirmation` mewajibkan blok `confirmation`."),
        text: str("Isi pesan (1–12.000 karakter)."),
        summary: str("Ringkasan percakapan yang ikut disimpan (maks 4000 karakter)."),
        remember: strArray("Catatan yang ikut disimpan sebagai memory chat (maks 20)."),
        confirmation: obj({
          properties: {
            description: str("Kalimat yang dibaca manusia sebelum menyetujui (maks 500 karakter)."),
            method: enumStr(["POST", "PATCH", "PUT", "DELETE"], "Method yang akan dijalankan bila disetujui."),
            path: str("Path API yang akan dipanggil bila disetujui. WAJIB berawalan `/api/`."),
          },
          required: ["description", "method", "path"],
        }),
      },
      required: ["chat", "update", "kind", "text"],
      allOf: [
        { if: { properties: { kind: { const: "confirmation" } }, required: ["kind"] },
          then: { required: ["confirmation"] } },
      ],
    }),
    mode: "danger", capability: "telegram:write",
    samplePath: "/telegram/replies", sampleMethod: "POST",
    build: (a) => {
      const body: Record<string, unknown> = {
        chatId: String(a.chat), updateId: n(a.update), kind: String(a.kind), text: String(a.text),
      };
      if (s(a.summary)) body.summary = s(a.summary);
      if (Array.isArray(a.remember)) body.remember = a.remember;
      if (a.kind === "confirmation" && a.confirmation) body.confirmation = a.confirmation;
      return { method: "POST", path: "/telegram/replies", body };
    },
    shape: (raw) => raw,
  },
];
