import {
  periodKeyOf, nextResetOf, type PortalChat, type PortalChatQuotaView, type PortalChatType,
} from "@hanoman/shared";
import { prisma } from "../../db";

// SPEC-854 · ADR-0130 · kuota chat portal.
//
// Tiga keputusan yang menutup tiga cara menembusnya, ketiganya disebut brief:
//
// 1. **Embernya (project × tipe × periode), bukan (akun × …).** Beberapa akun klien di project
//    yang sama karena itu berbagi satu jatah — kalau tidak, mengundang satu akun lagi adalah
//    penggandaan jatah gratis.
// 2. **Yang menghabiskan jatah adalah sesi yang LAHIR, bukan pesan yang terkirim.** Membuka
//    banyak tab atau memuat ulang halaman tak melahirkan sesi, jadi tak menambah apa pun.
// 3. **`periodKey` dibekukan di baris sesi saat lahir.** Menghitungnya ulang saat dibaca membuat
//    perilaku sesudah reset bergantung jam mesin dan mustahil diuji tanpa memalsukannya.
//
// Baris sesi ITU SENDIRI adalah buku besarnya — tak ada tabel penghitung kedua yang bisa
// menyimpang dari kenyataan.

const jatahOf = (cfg: PortalChat, type: PortalChatType): number =>
  type === "brainstorm" ? cfg.brainstormPerMonth : cfg.askPerMonth;

export async function quotaView(
  projectId: string, cfg: PortalChat, now: Date = new Date(),
): Promise<PortalChatQuotaView> {
  const periodKey = periodKeyOf(now);
  const hitung = async (type: PortalChatType) => {
    const terpakai = await prisma.portalChatSession.count({ where: { projectId, type, periodKey } });
    const jatah = jatahOf(cfg, type);
    // `sisa` dijepit di nol: operator boleh menurunkan jatah di tengah periode, dan angka minus
    // di layar klien akan terbaca sebagai utang, bukan sebagai habis.
    return { terpakai, jatah, sisa: Math.max(0, jatah - terpakai) };
  };
  return {
    enabled: cfg.enabled,
    brainstorm: await hitung("brainstorm"),
    tanya: await hitung("tanya"),
    resetPada: nextResetOf(periodKey).toISOString(),
  };
}

export type StartedSession = {
  id: string; type: string; summary: string; prdReadyAt: Date | null;
  createdAt: Date; updatedAt: Date;
};

/**
 * Lahirkan sesi bila jatahnya masih ada. Hitung + tulis dalam SATU transaksi: SQLite
 * menyerialkan tulisan dan server single-process, jadi ini cukup untuk menutup dua permintaan
 * yang tiba bersamaan (asumsi yang sama dengan `help-ratelimit`; ganti ke penghitung bersama
 * kalau nanti multi-instance).
 */
export async function startSessionWithQuota(o: {
  projectId: string; userId: string; type: PortalChatType; cfg: PortalChat; now?: Date;
}): Promise<{ session: StartedSession } | { error: "kuota" }> {
  const periodKey = periodKeyOf(o.now ?? new Date());
  const jatah = jatahOf(o.cfg, o.type);
  return prisma.$transaction(async (tx) => {
    const terpakai = await tx.portalChatSession.count({
      where: { projectId: o.projectId, type: o.type, periodKey } });
    if (terpakai >= jatah) return { error: "kuota" as const };
    const session = await tx.portalChatSession.create({ data: {
      projectId: o.projectId, userId: o.userId, type: o.type, periodKey } });
    return { session };
  });
}
