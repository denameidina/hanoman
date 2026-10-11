import type { RemoteCapability } from "@hanoman/shared";

/* Audit UI/UX 2026-10 · Fase 3G · pemetaan tingkat akses ↔ grant kendali jarak jauh.

   Layar Klien memajang SATU selektor "Lihat / Kerja / Tulis" sebagai pengganti lima switch grant.
   API tetap menerima daftar grant (`capabilities`); berkas ini satu-satunya tempat yang menerjemahkan
   keduanya, dan ia murni supaya tiap cabangnya bisa diuji tanpa merender layar.

   Tingkatnya bertingkat: setiap tingkat memuat semua grant tingkat di bawahnya.
   Daftar grant yang tak persis cocok dengan satu tingkat (mis. `sessions:write` tanpa `sessions:spawn`)
   bukan tingkat sah — ia tampil sebagai "Khusus" dengan rincian yang bisa dilipat. */

export type AccessTier = "lihat" | "kerja" | "tulis";
export const ACCESS_TIERS: readonly AccessTier[] = ["lihat", "kerja", "tulis"];

const READ: RemoteCapability[] = ["sessions:read", "backlog:read", "ide:read"];
const WORK: RemoteCapability[] = [...READ, "backlog:write", "sessions:spawn"];
const WRITE: RemoteCapability[] = [...WORK, "sessions:write"];

export const TIER_GRANTS: Readonly<Record<AccessTier, readonly RemoteCapability[]>> = {
  lihat: READ, kerja: WORK, tulis: WRITE,
};

export const TIER_LABEL: Readonly<Record<AccessTier, string>> = { lihat: "Lihat", kerja: "Kerja", tulis: "Tulis" };

export const TIER_DESC: Readonly<Record<AccessTier, string>> = {
  lihat: "Melihat sesi, backlog, dan IDE. Hanya baca.",
  kerja: "Lihat, ditambah memulai sesi agen dan menandai item selesai.",
  tulis: "Kerja, ditambah mengetik ke terminal, menghentikan sesi, dan menjawab dialog agen.",
};

/** Tingkat yang bisa menggerakkan sesi atau mengubah backlog. Naik ke sini selalu lewat konfirmasi. */
export const isRiskyTier = (t: AccessTier): boolean => t !== "lihat";

/** Grant yang bisa mengubah sesi atau backlog. Menambahkannya selalu lewat konfirmasi. */
export const RISKY_GRANTS: readonly RemoteCapability[] = ["backlog:write", "sessions:spawn", "sessions:write"];

export const GRANT_LABEL: Readonly<Record<RemoteCapability, string>> = {
  "sessions:read": "Lihat sesi",
  "backlog:read": "Lihat backlog",
  "ide:read": "Lihat IDE",
  "backlog:write": "Tandai item selesai",
  "sessions:spawn": "Mulai sesi agen",
  "sessions:write": "Tulis ke terminal",
};

/** Kalimat dampak per grant, dipakai di dialog konfirmasi. Ditulis dari sisi server pusat. */
export const GRANT_IMPACT: Readonly<Record<RemoteCapability, string>> = {
  "sessions:read": "Server pusat dapat melihat daftar sesi, fase, dan dialog agen.",
  "backlog:read": "Server pusat dapat melihat backlog perangkat ini.",
  "ide:read": "Server pusat dapat melihat IDE dan isi project perangkat ini.",
  "backlog:write": "Server pusat boleh menandai item backlog selesai. Penyuntingan item lain tetap tertutup.",
  "sessions:spawn": "Server pusat boleh membuka sesi agen baru di perangkat ini. Gerbang beban perangkat tetap berlaku.",
  "sessions:write": "Server pusat boleh mengetik ke terminal, menghentikan sesi, dan menjawab dialog agen.",
};

/** Tingkat yang tampil di selektor. `khusus` = grant yang tak terwakili tingkat mana pun; `kosong` = tanpa grant. */
export type TierState = AccessTier | "khusus" | "kosong";

const sameSet = (a: readonly RemoteCapability[], b: readonly RemoteCapability[]): boolean => {
  const sa = new Set(a);
  return sa.size === new Set(b).size && b.every((c) => sa.has(c));
};

/** Tingkat yang sedang berlaku untuk daftar grant. Urutan dicek dari yang terbesar agar persis satu cocok. */
export function tierOf(caps: readonly RemoteCapability[]): TierState {
  if (caps.length === 0) return "kosong";
  for (const t of [...ACCESS_TIERS].reverse()) {
    if (sameSet(caps, TIER_GRANTS[t])) return t;
  }
  return "khusus";
}

/** Grant yang tampil di rincian "Khusus", dalam bahasa biasa, urut sesuai katalog. */
export function customGrantLabels(caps: readonly RemoteCapability[]): string[] {
  const order = Object.keys(GRANT_LABEL) as RemoteCapability[];
  return order.filter((c) => caps.includes(c)).map((c) => GRANT_LABEL[c]);
}

/** Selisih grant dari `current` ke `next`. Dipakai untuk dialog (apa yang diizinkan / dicabut). */
export function grantDiff(current: readonly RemoteCapability[], next: readonly RemoteCapability[]):
  { added: RemoteCapability[]; removed: RemoteCapability[] } {
  return {
    added: next.filter((c) => !current.includes(c)),
    removed: current.filter((c) => !next.includes(c)),
  };
}

/** Naik ke tingkat berisiko (atau menambah grant berisiko) harus dikonfirmasi. */
export function needsConfirm(diff: { added: RemoteCapability[]; removed: RemoteCapability[] }): boolean {
  return diff.removed.length > 0 || diff.added.some((c) => RISKY_GRANTS.includes(c));
}
