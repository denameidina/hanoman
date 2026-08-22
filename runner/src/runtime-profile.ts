// SPEC-884 · ADR-0138 · dua nilai eksplisit menggantikan `NODE_ENV` sebagai penentu hardening.
//
// Sebelum ini `NODE_ENV=production` merangkap TIGA peran: runtime terpaket (`web-dir.ts`), cookie
// `Secure` (`auth.ts`), dan seluruh gerbang ADR-0117. Akibatnya `npm i -g hanoman` polos — yang
// TAK PERNAH menyetel satu pun env hardening — menolak boot di device siapa pun. Sesudah ini
// `NODE_ENV` hanya berarti "terpaket"; yang keras hanya yang meminta dirinya dikeraskan.
type Env = Record<string, string | undefined>;

export type Deployment = "local" | "public";

const filled = (v: string | undefined): boolean => !!v && v.trim() !== "";

/**
 * Satu-satunya gerbang ADR-0117. Tiga syarat terakhir adalah KOMPATIBILITAS MUNDUR dan ia yang
 * menjaga hub produksi: instance yang env-nya sudah memuat penanda ADR-0117 sudah menyatakan
 * niatnya secara sadar (systemd `EnvironmentFile`), jadi ia tetap keras setelah upgrade. Tanpa
 * klausa ini `hanoman.nafanesia.id` kehilangan seluruh hardening-nya pada `npm i -g` berikutnya.
 */
export function resolveHardening(env: Env): boolean {
  if (env.HANOMAN_HARDENING === "1") return true;
  return env.HANOMAN_SESSION_SANDBOX === "podman"
    || filled(env.HANOMAN_PUBLIC_ORIGINS)
    || filled(env.HANOMAN_TRUST_PROXY);
}

/**
 * Peruntukan instance. TIDAK memaksa apa pun — ia hanya mengubah default wizard, peringatan, dan
 * penanda permanen. Hardening yang menyala selalu berarti publik; kebalikannya tidak berlaku.
 */
export function resolveDeployment(env: Env): Deployment {
  if (resolveHardening(env)) return "public";
  return env.HANOMAN_DEPLOYMENT === "public" ? "public" : "local";
}
