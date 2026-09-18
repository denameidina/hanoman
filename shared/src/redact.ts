/* SPEC-1215 §K9-K10/§S9 AC-D4 · ADR-0166 §5 · murni, idempoten, gagal-tertutup di sisi pemanggil.
   Urutan pola TETAP — pemanggil membungkus dengan try/catch dan mengganti hasil `log.gap
   reason:"redaction-failed"` bila fungsi ini melempar. */

const LABELED_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: "bearer", re: /\bBearer\s+[A-Za-z0-9._-]{8,}/gi },
  { label: "hanoman-token", re: /\bhnm_agt_[A-Za-z0-9]{8,}/g },
  { label: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9-]{8,}/g },
  { label: "github-token", re: /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{8,}/g },
  { label: "aws-key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: "slack-token", re: /\bxox[abprs]-[A-Za-z0-9-]{8,}/g },
  { label: "pem", re: /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g },
  { label: "jwt", re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g },
  { label: "env", re: /\b(?=[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE|CREDENTIAL|COOKIE|DSN|AUTH))[A-Z][A-Z0-9_]*\s*=\s*\S+/g },
];

function maskLabeled(text: string): string {
  let out = text;
  for (const { label, re } of LABELED_PATTERNS) {
    re.lastIndex = 0;
    out = out.replace(re, (m) => {
      if (label === "env") {
        const eq = m.indexOf("=");
        return `${m.slice(0, eq + 1)}«redacted:env»`;
      }
      return `«redacted:${label}»`;
    });
  }
  return out;
}

function maskKnown(text: string, known: readonly string[]): string {
  if (known.length === 0) return text;
  // Substring literal, terpanjang dulu — supaya nilai pendek tak memotong sisa nilai panjang.
  const sorted = [...known].filter((k) => k.length >= 8).sort((a, b) => b.length - a.length);
  let out = text;
  for (const k of sorted) {
    if (!k) continue;
    out = out.split(k).join("«redacted:known»");
  }
  return out;
}

export function redactText(text: string, known?: readonly string[]): string {
  return maskKnown(maskLabeled(text), known ?? []);
}

export function redactValue<T>(value: T, known?: readonly string[]): T {
  if (typeof value === "string") return redactText(value, known) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, known)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactValue(v, known);
    return out as T;
  }
  return value;
}
