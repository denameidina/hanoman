import { describe, expect, it } from "vitest";
import { BUILTIN_AGENTS } from "@hanoman/shared";
import { readOnlyDecision } from "../src/agent-readonly";

// Audit custom agent 2026-09-25 · koreksi 2026-09-25 · EMPAT auditor read-only yang BERTAHAN di
// `builtin-domain-agents.ts` (shared) sesudah koreksi "agen pengerja domain" — lima agen lain di
// berkas itu sekarang PENGERJA `isolated-worktree` (frontend/backend/database/cloudflare/vps-engineer)
// dan tidak lewat hook read-only sama sekali, jadi tidak diuji di sini. `shared` tidak mengimpor
// `runner`, jadi pengikatan instruksi prosa ke validator read-only NYATA hidup di sini, bukan di
// shared/test.
//
// Setiap perintah dalam backtick yang instruksinya klaim DIJALANKAN AGEN SENDIRI harus lolos
// `readOnlyDecision` persis seperti hook produksi akan menilainya. Perintah yang teksnya secara
// eksplisit diserahkan ke parent (wrangler, sshd -T, nginx -t, systemctl, ufw, caddy validate) HARUS
// ditolak validator — itulah alasan teksnya menandainya "UNTUK PARENT" alih-alih menyuruh agen
// menjalankannya sendiri (P: bug yang diperbaiki sintesis §3 "Prosedur riset yang menjalankan
// `wrangler …`, `ssh …`, atau `sshd -T` dari agen read-only").

const DOMAIN_AGENT_NAMES = [
  "a11y-auditor",
  "api-contract-auditor",
  "schema-migration-auditor",
  "cloudflare-config-auditor",
] as const;

const domainAgent = (name: string) => {
  const a = BUILTIN_AGENTS.find((entry) => entry.name === name);
  if (!a) throw new Error(`agen domain hilang dari katalog: ${name}`);
  return a;
};

const payload = (command: string) => ({
  hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command },
});

const allow = (command: string) => {
  const decision = readOnlyDecision(payload(command));
  expect(decision.allowed, command).toBe(true);
};

const deny = (command: string) => {
  const decision = readOnlyDecision(payload(command));
  expect(decision.allowed, command).toBe(false);
};

describe("agen domain: perintah Bash sendiri lolos validator read-only", () => {
  it.each(DOMAIN_AGENT_NAMES)("%s: setiap agen domain ada di katalog", (name) => {
    expect(domainAgent(name)).toBeDefined();
  });

  // Kedua perintah ini adalah SATU-SATUNYA bentuk backtick yang teksnya menyuruh agen domain
  // menjalankan sendiri (bukan menyerahkan ke parent) — diverifikasi lewat grep manual atas
  // `shared/src/builtin-domain-agents.ts`. Nilai placeholder diganti sha literal 40-hex sungguhan.
  it("`git diff --no-ext-diff --no-textconv <baseSha>` lolos", () => {
    allow("git diff --no-ext-diff --no-textconv 0123456789abcdef0123456789abcdef01234567");
  });

  it("`git status --porcelain` lolos", () => {
    allow("git status --porcelain");
  });

  for (const name of DOMAIN_AGENT_NAMES) {
    it(`${name}: instruksi hanya memuat dua pola Bash mandiri di atas`, () => {
      const instructions = domainAgent(name).instructions;
      // Beberapa perintah dalam backtick dipotong lintas baris array sumber (lebar baris ~100
      // kolom, gaya repo); "\s+" di sana adalah artefak line-wrap, bukan operator baru, jadi
      // dinormalkan ke satu spasi sebelum diperiksa isinya maupun sebelum dikirim ke validator.
      for (const [, raw] of instructions.matchAll(/`([^`]*)`/g)) {
        const cmd = (raw ?? "").replace(/\s+/g, " ").trim();
        const looksLikeSelfRunShell = /^(git|wrangler|sshd|systemctl|ufw|nginx|caddy)\b/.test(cmd);
        if (!looksLikeSelfRunShell) continue;
        const isKnownSelfRun = cmd.startsWith("git diff --no-ext-diff --no-textconv <baseSha>")
          || cmd.startsWith("git status");
        if (isKnownSelfRun) continue;
        // Semua yang lain (wrangler/sshd/systemctl/ufw/nginx/caddy) HARUS berada dalam kalimat yang
        // menandainya untuk parent — dan harus benar-benar ditolak validator kalau agen mencoba
        // menjalankannya sendiri, membuktikan kenapa penandaan itu wajib.
        const rawText = raw ?? "";
        const idx = instructions.indexOf("`" + rawText + "`");
        const context = instructions.slice(Math.max(0, idx - 300), idx + rawText.length + 300);
        expect(context, `${name}: ${cmd}`).toMatch(/PARENT|parent/);
        deny(cmd);
      }
    });
  }

  // Perintah yang diserahkan ke parent memang mustahil dijalankan agen sendiri — buktikan
  // eksplisit untuk perintah yang paling sering keliru dianggap "aman" (§3, temuan yang dibuang).
  it.each([
    "wrangler d1 migrations list mydb --remote",
    "wrangler secret list --env production",
    "wrangler deploy --dry-run --env production",
    "sshd -T",
    "systemctl is-enabled nginx",
    "ufw status verbose",
    "nginx -t",
    "caddy validate",
  ])("perintah operator '%s' ditolak validator read-only", (command) => {
    deny(command);
  });
});
