/* SPEC-1217 · nilai yang diketahui PROSES (bukan pola generik) — dipakai sebagai argumen `known`
   redactText/redactValue. Sengaja di server, bukan shared: shared tak boleh membaca process.env. */

const SECRET_NAME_RE = /TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE|CREDENTIAL|COOKIE|DSN|AUTH/;

export function knownSecrets(): string[] {
  const out: string[] = [];
  for (const [name, value] of Object.entries(process.env)) {
    if (!value || value.length < 8) continue;
    if (SECRET_NAME_RE.test(name)) out.push(value);
  }
  return out;
}
