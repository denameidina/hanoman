// ADR-0099 · ADR-0155 · katalog tool domain `vps`. DUA capability:
//   `vps:read|write` — mengelola daftar VPS & checklist kepatuhan;
//   `vps:exec`       — MENJALANKAN perintah di mesin remote (ADR-0155).
//
// ADR-0099 §4 dulu menolak SELURUH domain ini dari MCP. ADR-0155 membalikkannya dengan alasan yang
// ditulis di sana: route-route ini SUDAH terjangkau agent token lewat REST, jadi tidak
// membungkusnya tak menutup apa pun — ia hanya memaksa agen memakai curl tanpa skema dan tanpa
// redaksi. Yang menahan sungguhan adalah `vps:exec`, capability yang tak diimplikasikan `:write`.
//
// `password` SENGAJA tak ada di skema mana pun di berkas ini. Ia kredensial transien yang dipakai
// memasang key lalu dibuang, dan ADR-0097 sudah menetapkan permukaan kredensial bukan wilayah
// agent token (preseden `/telegram/credentials`). Agen memakai `keyPath`; bootstrap dengan password
// tetap pekerjaan manusia lewat cookie.
//
// Hampir seluruh tool `vps:exec` menjawab 409 `keyMissing: true` bila key VPS tak ada di MESIN INI.
// Itu keadaan normal pada instance yang bukan pemegang key — bukan galat, dan bukan tanda VPS-nya
// bermasalah.
import { bool, enumStr, int, obj, str, strArray } from "../mcp-schema";
import { enc, n, s } from "./helpers";
import type { McpToolDef } from "./types";

const VPS = str("Id VPS, dari hanoman_vps_list.");
const p = (id: unknown) => `/vps/${enc(String(id))}`;
const COMPONENTS = ["base", "node", "hanoman", "caddy", "podman", "agent-image", "claude", "codex", "gh"];

export const VPS_TOOLS: readonly McpToolDef[] = [
  {
    name: "hanoman_vps_list",
    title: "Daftar VPS",
    description: "Seluruh VPS yang terdaftar di instance ini, urut waktu dibuat. Jalur key TIDAK ikut menyeberang sync.",
    inputSchema: obj({ properties: {} }),
    mode: "read", capability: "vps:read",
    samplePath: "/vps", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/vps" }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_vps_components",
    title: "Katalog komponen provisioning",
    description:
      "Komponen yang bisa di-provision beserta ketergantungannya. Panggil ini sebelum hanoman_vps_provision — komponen di luar katalog ditolak 400.",
    inputSchema: obj({ properties: {} }),
    mode: "read", capability: "vps:read",
    samplePath: "/vps/components", sampleMethod: "GET",
    build: () => ({ method: "GET", path: "/vps/components" }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_vps_checklist",
    title: "Checklist kepatuhan VPS",
    description:
      "Checklist kepatuhan sebuah VPS beserta status per item dan skor per seksi. Ini membaca hasil audit TERSIMPAN — untuk menyegarkannya, jalankan hanoman_vps_audit (yang menyentuh mesin remote).",
    inputSchema: obj({ properties: { vps: VPS }, required: ["vps"] }),
    mode: "read", capability: "vps:read",
    samplePath: "/vps/v1/checklist", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `${p(a.vps)}/checklist` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_vps_create",
    title: "Daftarkan VPS",
    description:
      "Mendaftarkan VPS baru dengan akses key-only. Bootstrap memakai PASSWORD tidak tersedia lewat MCP — itu permukaan kredensial dan tetap pekerjaan manusia lewat dashboard; sebutkan `keyPath` yang sudah terpasang.",
    inputSchema: obj({
      properties: {
        name: str("Nama tampilan VPS."),
        host: str("Hostname atau alamat IP."),
        user: str("User SSH."),
        port: int("Port SSH. Default 22.", { minimum: 1, maximum: 65535 }),
        keyPath: str("Jalur private key di mesin ini. Kosongkan untuk memakai key default server."),
      },
      required: ["name", "host", "user"],
    }),
    mode: "write", capability: "vps:write",
    samplePath: "/vps", sampleMethod: "POST",
    build: (a) => {
      const body: Record<string, unknown> = { name: String(a.name), host: String(a.host), user: String(a.user) };
      if (n(a.port) !== undefined) body.port = n(a.port);
      if (s(a.keyPath)) body.keyPath = s(a.keyPath);
      return { method: "POST", path: "/vps", body };
    },
    shape: (raw) => raw,
  },
  {
    name: "hanoman_vps_update",
    title: "Ubah VPS",
    description:
      "Mengubah data VPS. MENAMBAL — hanya field yang dikirim yang berubah, dan `port` yang tak disebut TIDAK kembali ke 22. Bootstrap ulang dengan password tidak tersedia lewat MCP.",
    inputSchema: obj({
      properties: {
        vps: VPS,
        name: str("Nama tampilan baru."),
        host: str("Hostname/IP baru."),
        user: str("User SSH baru."),
        port: int("Port SSH baru.", { minimum: 1, maximum: 65535 }),
        keyPath: str("Jalur private key baru."),
      },
      required: ["vps"],
    }),
    mode: "write", capability: "vps:write",
    samplePath: "/vps/v1", sampleMethod: "PATCH",
    build: (a) => {
      const body: Record<string, unknown> = {};
      for (const k of ["name", "host", "user", "keyPath"]) if (s(a[k]) !== undefined) body[k] = s(a[k]);
      if (n(a.port) !== undefined) body.port = n(a.port);
      return { method: "PATCH", path: p(a.vps), body };
    },
    shape: (raw) => raw,
  },
  {
    name: "hanoman_vps_delete",
    title: "Hapus VPS dari daftar",
    description:
      "Menghapus baris VPS dari hanoman. TIDAK menyentuh mesinnya — server remote tetap berjalan apa adanya; yang hilang hanya catatan & checklist-nya di sini. Penghapusan ini menyeberang sync.",
    inputSchema: obj({ properties: { vps: VPS }, required: ["vps"] }),
    mode: "write", capability: "vps:write",
    samplePath: "/vps/v1", sampleMethod: "DELETE",
    build: (a) => ({ method: "DELETE", path: p(a.vps) }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_vps_item_na",
    title: "Tandai item checklist N/A",
    description:
      "Menandai (atau melepas tanda) item checklist sebagai tidak berlaku, sehingga ia keluar dari denominator skor. Mengisi `items` menandai banyak sekaligus (maks 64); mengisi `item` menandai satu.",
    inputSchema: obj({
      properties: {
        vps: VPS,
        item: str("Id satu item checklist."),
        items: strArray("Id banyak item sekaligus (maks 64). Menang atas `item`."),
        na: bool("true = tandai N/A; false = lepas tandanya."),
        reason: str("Alasan (maks 500 karakter), tersimpan bersama jejak pelakunya."),
      },
      required: ["vps", "na"],
    }),
    mode: "write", capability: "vps:write",
    samplePath: "/vps/v1/items/i1/na", sampleMethod: "POST",
    build: (a) => {
      const body: Record<string, unknown> = { na: a.na === true };
      if (s(a.reason)) body.reason = s(a.reason);
      if (Array.isArray(a.items) && a.items.length)
        return { method: "POST", path: `${p(a.vps)}/items/na-bulk`, body: { ...body, itemIds: a.items } };
      return { method: "POST", path: `${p(a.vps)}/items/${enc(String(a.item))}/na`, body };
    },
    shape: (raw) => raw,
  },
  {
    name: "hanoman_vps_item_attest",
    title: "Attest item checklist INFO",
    description:
      "Menyatakan sebuah item checklist bertipe INFO sudah diperiksa manusia. HANYA item INFO yang bisa di-attest; yang lain ditolak 400.",
    inputSchema: obj({
      properties: { vps: VPS, item: str("Id item checklist bertipe INFO."), note: str("Catatan (maks 500 karakter).") },
      required: ["vps", "item"],
    }),
    mode: "write", capability: "vps:write",
    samplePath: "/vps/v1/items/i1/attest", sampleMethod: "POST",
    build: (a) => ({
      method: "POST", path: `${p(a.vps)}/items/${enc(String(a.item))}/attest`,
      body: s(a.note) ? { note: s(a.note) } : {},
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_vps_test",
    title: "Uji koneksi SSH (BERBAHAYA)",
    description:
      "BERBAHAYA — membuka koneksi SSH ke VPS untuk memastikan akses key-only berhasil. Paling ringan di antara tool `vps:exec`, tapi ia tetap MENYENTUH MESIN REMOTE. Kegagalan koneksi dijawab 200 dengan `ok: false` beserta transcript — itu hasil, bukan galat. Menuntut `vps:exec`. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({ properties: { vps: VPS }, required: ["vps"] }),
    mode: "danger", capability: "vps:exec",
    samplePath: "/vps/v1/test", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: `${p(a.vps)}/test` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_vps_probe",
    title: "Periksa komponen terpasang (BERBAHAYA)",
    description:
      "BERBAHAYA — menjalankan probe di VPS untuk mendeteksi komponen mana yang sudah terpasang, lalu menyimpan hasilnya. Membaca saja, tapi lewat SSH ke mesin produksi. Menuntut `vps:exec`. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({ properties: { vps: VPS }, required: ["vps"] }),
    mode: "danger", capability: "vps:exec",
    samplePath: "/vps/v1/probe", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: `${p(a.vps)}/probe` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_vps_audit",
    title: "Audit kepatuhan (BERBAHAYA)",
    description:
      "BERBAHAYA — menjalankan audit kepatuhan lewat SSH ke VPS dan menyimpan hasilnya. Namanya terdengar pasif, tapi ia MENJALANKAN pemeriksaan di mesin remote, bukan membaca cache — untuk membaca hasil tersimpan pakai hanoman_vps_checklist. Menuntut `vps:exec`. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({ properties: { vps: VPS }, required: ["vps"] }),
    mode: "danger", capability: "vps:exec",
    samplePath: "/vps/v1/audit", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: `${p(a.vps)}/audit` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_vps_remediate_preview",
    title: "Pratinjau remediasi (BERBAHAYA)",
    description:
      "BERBAHAYA — dry-run remediasi: menghitung langkah yang AKAN dijalankan tanpa mengubah VPS. Tetap membuka SSH. Item yang bukan AUTO/remediable ditolak 400 dengan menyebut item mana. Menuntut `vps:exec`. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: { vps: VPS, items: strArray("Id item checklist yang diremediasi (1–64). Harus AUTO/remediable.") },
      required: ["vps", "items"],
    }),
    mode: "danger", capability: "vps:exec",
    samplePath: "/vps/v1/remediate/preview", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: `${p(a.vps)}/remediate/preview`, body: { items: a.items } }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_vps_remediate",
    title: "Jalankan remediasi (BERBAHAYA)",
    description:
      "BERBAHAYA — MENGUBAH konfigurasi VPS produksi untuk memperbaiki item checklist. Jalankan hanoman_vps_remediate_preview lebih dulu dan baca langkahnya. Sesudah remediasi server memverifikasi ulang koneksi SSH; kegagalan verifikasi itu dijawab 502 dan berarti kamu bisa TERKUNCI KELUAR — periksa akses manual segera. Menuntut `vps:exec`. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: { vps: VPS, items: strArray("Id item checklist yang diremediasi (1–64).") },
      required: ["vps", "items"],
    }),
    mode: "danger", capability: "vps:exec",
    samplePath: "/vps/v1/remediate", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: `${p(a.vps)}/remediate`, body: { items: a.items } }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_vps_provision_preview",
    title: "Pratinjau provisioning (BERBAHAYA)",
    description:
      "BERBAHAYA — dry-run provisioning: menghitung komponen & langkah yang AKAN dipasang, tanpa mengubah VPS. Tetap membuka SSH. Menuntut `vps:exec`. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: {
        vps: VPS,
        items: strArray("Komponen yang dipasang (1–16). Harus ada di hanoman_vps_components."),
        profile: enumStr(["lab", "production"], "Profil provisioning."),
        domain: str("Domain yang dipakai komponen yang membutuhkannya."),
      },
      required: ["vps", "items", "profile"],
    }),
    mode: "danger", capability: "vps:exec",
    samplePath: "/vps/v1/provision/preview", sampleMethod: "POST",
    build: (a) => ({
      method: "POST", path: `${p(a.vps)}/provision/preview`,
      body: { items: a.items, profile: String(a.profile), ...(s(a.domain) ? { domain: s(a.domain) } : {}) },
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_vps_provision",
    title: "Provision komponen (BERBAHAYA)",
    description:
      "BERBAHAYA — MEMASANG komponen di VPS produksi: paket, layanan, reverse proxy, image container. Jalankan hanoman_vps_provision_preview lebih dulu. Profil `production` memasang konfigurasi yang berbeda dari `lab` dan tak bisa ditukar sesudahnya tanpa provisioning ulang. Menuntut `vps:exec`. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: {
        vps: VPS,
        items: strArray("Komponen yang dipasang (1–16)."),
        profile: enumStr(["lab", "production"], "Profil provisioning."),
        domain: str("Domain yang dipakai komponen yang membutuhkannya."),
        confirm: bool("Konfirmasi menjalankan, bukan sekadar menghitung."),
        force: bool("Paksa memasang ulang komponen yang sudah ada."),
      },
      required: ["vps", "items", "profile"],
    }),
    mode: "danger", capability: "vps:exec",
    samplePath: "/vps/v1/provision", sampleMethod: "POST",
    build: (a) => {
      const body: Record<string, unknown> = { items: a.items, profile: String(a.profile) };
      if (s(a.domain)) body.domain = s(a.domain);
      for (const k of ["confirm", "force"]) if (typeof a[k] === "boolean") body[k] = a[k];
      return { method: "POST", path: `${p(a.vps)}/provision`, body };
    },
    shape: (raw) => raw,
  },
  {
    name: "hanoman_vps_harden",
    title: "Harden VPS (BERBAHAYA)",
    description:
      "BERBAHAYA — menjalankan skrip hardening di VPS produksi: ia mengubah konfigurasi SSH, termasuk kebijakan login root. Sesudahnya server memverifikasi ulang koneksi; kegagalan verifikasi dijawab 502 dan berarti kamu bisa TERKUNCI KELUAR dari mesin itu — periksa akses manual segera. Menuntut `vps:exec`. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({ properties: { vps: VPS }, required: ["vps"] }),
    mode: "danger", capability: "vps:exec",
    samplePath: "/vps/v1/harden", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: `${p(a.vps)}/harden` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_vps_console",
    title: "Buka konsol SSH (BERBAHAYA)",
    description:
      "BERBAHAYA — membuka sesi SHELL SSH MENTAH ke VPS produksi di dalam tmux hanoman. Tak ada sandbox dan tak ada penyaring: apa pun yang diketik ke pane itu berjalan sebagai user remote. Id sesinya deterministik, jadi memanggilnya dua kali menyambung ke sesi yang sama alih-alih menumpuk. Menuntut `vps:exec`. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({ properties: { vps: VPS }, required: ["vps"] }),
    mode: "danger", capability: "vps:exec",
    samplePath: "/vps/v1/console", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: `${p(a.vps)}/console` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_vps_session",
    title: "Buka sesi agen untuk VPS (BERBAHAYA)",
    description:
      "BERBAHAYA — membuka sesi AGEN interaktif yang memegang akses SSH ke VPS produksi, dengan hasil audit terakhir sebagai konteks. Ini menggabungkan dua hal paling tajam sekaligus: agen dengan izin penuh, dan shell di mesin produksi. Pakai hanya untuk kasus yang skrip remediasi/provisioning tak tangani. Menuntut `vps:exec`. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({ properties: { vps: VPS }, required: ["vps"] }),
    mode: "danger", capability: "vps:exec",
    samplePath: "/vps/v1/session", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: `${p(a.vps)}/session` }),
    shape: (raw) => raw,
  },
];
