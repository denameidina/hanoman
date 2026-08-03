// SPEC-523 · satu penurunan `skip`/`take` untuk kedua daftar lead. Ditaruh di berkas sendiri
// karena `trail.ts` dan `flow.ts` sama-sama memakainya, dan menyalinnya ke dua tempat adalah
// kelas bug yang sudah menggigit repo ini (SPEC-431 `baseSha`, SPEC-448 `rootBypassEnv`,
// SPEC-475 `headSha`): dua salinan yang tak sepakat.
//
// `page`/`limit` MENANG atas `take`/`skip` bila keduanya dikirim — bentuk baru adalah kontrak
// yang dituju; `take`/`skip` bertahan hanya sebagai kompatibilitas pemanggil lama.
export const LEAD_MAX_TAKE = 200;
export const LEAD_DEFAULT_TAKE = 50;

export function leadWindow(f: { take?: number; skip?: number; page?: number; limit?: number }):
  { skip: number; take: number; page: number; pageSize: number } {
  if (f.limit !== undefined || f.page !== undefined) {
    const pageSize = Math.min(Math.max(1, Math.floor(f.limit ?? LEAD_DEFAULT_TAKE) || 1), LEAD_MAX_TAKE);
    const page = Math.max(1, Math.floor(f.page ?? 1) || 1);
    return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
  }
  const take = Math.min(f.take ?? LEAD_DEFAULT_TAKE, LEAD_MAX_TAKE);
  const skip = f.skip ?? 0;
  return { skip, take, page: Math.floor(skip / Math.max(1, take)) + 1, pageSize: take };
}
