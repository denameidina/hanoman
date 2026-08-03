import type { Changelog, Prisma } from "@prisma/client";
import { type ChangelogRequest, defaultRange } from "@hanoman/shared";
import { prisma } from "../../db";
import { resolveRepoDir } from "../local-binding";
import { think, type ThinkOpts } from "../lead/brain";
import { changelogAgentDefaults } from "./config";
import { collectBacklog, collectCommits, collectVersions, type CollectResult } from "./collect";
import { changelogPrompt, fallbackMarkdown } from "./render";
import { scrubOutput } from "./scrub";

// SPEC-516 · ADR-0105 · orkestrasi: collect → prompt → agen → scrub → simpan.
//
// `think()` DIIMPOR dari `services/lead/brain.ts`, bukan disalin. Itu bukan kenyamanan melainkan
// inti keputusannya: hanoman punya DUA titik spawn agen (`pty.ts` dan `lead/brain.ts`), dan titik
// ketiga akan mengulang SPEC-448 — di sana `rootBypassEnv` ada di `pty.ts` tapi tak pernah
// menyeberang ke `brain.ts`, dan lead gagal 100 % di setiap instance yang servernya jalan sebagai
// root (`User=root` adalah konfigurasi deploy RESMI). `think()` sudah membawa gerbang root,
// `stdin.end()` (SPEC-448), `maxBuffer` 16 MiB, dan `leadFailureReason()` yang membaca KEDUA stream.
export type ThinkFn = (prompt: string, o: ThinkOpts) => Promise<string>;

/** Anggaran waktu satu pembangkitan. Disebutkan DI DALAM prompt (SPEC-432): agen yang tak tahu
 *  batasnya tak bisa menyesuaikan kedalamannya. */
export const CHANGELOG_TIMEOUT_MS = 180_000;

export type GenerateResult = { ok: true; row: Changelog } | { ok: false; reason: string };

async function collect(projectId: string, req: ChangelogRequest): Promise<CollectResult> {
  if (req.mode === "backlog") {
    const d = defaultRange(new Date());
    return collectBacklog(projectId, req.from ?? d.from, req.to ?? d.to);
  }
  const repoDir = await resolveRepoDir(projectId);
  return req.mode === "commit"
    ? collectCommits(repoDir, req.fromSha, req.toSha)
    : collectVersions(repoDir, req.fromTag, req.toTag);
}

export async function generateChangelog(
  projectId: string, req: ChangelogRequest, deps: { think?: ThinkFn } = {},
): Promise<GenerateResult> {
  const got = await collect(projectId, req);
  if (!got.ok) return got;
  const input = got.input;

  const prompt = changelogPrompt(input, CHANGELOG_TIMEOUT_MS);
  // SPEC-518 · runtime/model/effort punya setelan SENDIRI (opt-in; mati = mewarisi). Sebelumnya
  // baris ini `sessionAgentDefaults()`, yang berarti menulis prosa rilis pendek selalu memakai
  // model sesi kerja. Ini SATU-SATUNYA tempat changelog men-spawn agen — tak ada call site kedua
  // untuk didivergensikan (kelas bug SPEC-431/448/475/481 tak berlaku di sini).
  const { agent, model, effort } = await changelogAgentDefaults();
  const run = deps.think ?? think;

  let body = "";
  let generator: "agent" | "fallback" = "agent";
  const warnings = [...input.notes];
  try {
    const raw = await run(prompt, { agent, model, effort, timeoutMs: CHANGELOG_TIMEOUT_MS });
    body = scrubOutput(raw ?? "");
    // Agen yang menjawab kosong sama saja dengan agen yang gagal — jangan menyimpan halaman hampa.
    if (!body.trim()) throw new Error("agen tak memulangkan teks apa pun");
  } catch (e) {
    generator = "fallback";
    body = fallbackMarkdown(input);
    warnings.push(`Narasi otomatis tak tersedia — ${(e as Error).message}. Yang tampil adalah draf ringkas.`);
  }

  const row = await prisma.changelog.create({
    data: {
      projectId, mode: input.mode, title: input.title,
      params: req as unknown as Prisma.InputJsonValue,
      body, generator, itemCount: input.items.length,
      warning: warnings.length ? warnings.join(" ") : null,
    },
  });
  return { ok: true, row };
}
