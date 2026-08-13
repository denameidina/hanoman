// SPEC-739 · ADR-0114 — laporan kesiapan metode, DITURUNKAN dari disk tiap kali diminta.
// Tanpa tabel, tanpa kolom, tanpa cache: status instalasi akan basi persis pada saat ia paling
// menyesatkan — sesudah operator memasang skill yang kurang (cermin coverage docs ADR-0011/0018).
import {
  zAgent, METHODS, METHOD_IDS, methodStatus,
  type MethodStatusResponse, type MethodDef, type Agent,
} from "@hanoman/shared";
import { scanAgentSkills } from "@hanoman/runner";
import { shellBin } from "./pty";

export function methodStatusReport(env: NodeJS.ProcessEnv = process.env): MethodStatusResponse {
  const scans = zAgent.options.map((a) => scanAgentSkills(a, env));
  return {
    agents: scans.map((s) => ({ agent: s.agent, home: s.home, roots: s.roots, skills: s.skills.length })),
    methods: scans.flatMap((s) => {
      const installed = { skills: s.skills.map((k) => k.id), packages: s.packages };
      return METHOD_IDS.map((id) => methodStatus(METHODS[id]!, s.agent, installed));
    }),
  };
}

/**
 * Argv shell yang MENJALANKAN perintah pemasangan lalu menyerahkan pane ke operator. `exec` di
 * ujung disengaja: pemasangan yang gagal harus meninggalkan shell hidup di tempat kejadian, bukan
 * pane mati yang harus dilahirkan ulang untuk dibaca — dan `npx skills add` (jalur mattpocock di
 * codex) memang interaktif. Server tak menjalankan apa pun dari sini; ia hanya menyusun argv
 * untuk pane tmux (ADR-0056; ADR-0037 & ADR-0087/0088 utuh).
 */
export function installCommand(m: MethodDef, agent: Agent, shell = shellBin()): string[] {
  return [shell, "-lc", `${m.install[agent].join(" && ")}; exec '${shell}' -l`];
}
