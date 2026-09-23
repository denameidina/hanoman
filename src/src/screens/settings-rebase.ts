// S5 · audit orkestrasi. `PUT /settings` MENGGANTI blok penuh, dan server menandai `user` (provenance
// `builtinRuntimeDefaults`) setiap model/effort/sel orkestrasi yang berbeda dari DB. Tab Settings
// yang terbuka melewati update/seed lalu mengirim snapshot mount-nya membalik nilai seed baru ke id
// lama dan menguncinya `user` — tanpa satu klik pun yang mengatakannya.
//
// Rebase tiga arah: `base` = snapshot yang sedang ditampilkan tab, `edited` = snapshot + perubahan
// operator, `fresh` = DB saat ini (GET tepat sebelum PUT). Hasilnya `fresh` dengan HANYA bagian
// yang benar-benar diubah operator. Objek biasa direkursi per kunci; array & skalar atomik.

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (isPlain(a) && isPlain(b)) {
    const ka = Object.keys(a).filter((k) => a[k] !== undefined);
    const kb = Object.keys(b).filter((k) => b[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => same(a[k], b[k]));
  }
  return false;
};

export function rebaseEdits<T>(base: unknown, edited: T, fresh: unknown): T {
  if (same(edited, base) && fresh !== undefined) return fresh as T;
  if (!isPlain(base) || !isPlain(edited) || !isPlain(fresh)) return edited;
  const out: Plain = { ...fresh };
  for (const key of Object.keys(edited)) out[key] = rebaseEdits(base[key], edited[key], fresh[key]);
  return out as T;
}
