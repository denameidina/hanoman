import { ASK_DECISIONS_TOOL, ASK_ESCALATION_TOOL, ASK_ROUTE, DECIDER } from "./prompt";
import { ASK_RELAY_TOOL } from "./custom-agents";

// ADR-0231 · cara bertanya sesi claude dikunci saat lahir: `tool` = AskUserQuestion (manusia memutuskan,
// atau lead lewat hook PreToolUse), `text` = teks biasa di terminal (lead membacanya dari hook Stop).
// Codex & antigravity selalu bertanya lewat teks dan tak memakai nilai ini.
export type AskVia = "tool" | "text";

const NO_TOOL = "JANGAN memakai AskUserQuestion (juga bila sebuah skill menyuruhnya)";

export const TEXT_ASK_ROUTE =
  `${NO_TOOL}: tanyakan di terminal ini sekaligus dalam satu pesan, tiap pertanyaan bernomor dan diakhiri `
  + "`?` beserta opsi, rekomendasi dan alasannya, lalu berhenti dan tunggu jawabannya. Tak ada batas "
  + "jumlah pertanyaan: selama masih ambigu dan akan mempengaruhi hasil, tanyakan. Yang menjawab "
  + `ditentukan hanoman — ${DECIDER}; jangan menjawabnya sendiri.`;

// Urutan = frasa terpanjang lebih dulu; tak ada frasa yang menjadi bagian frasa lain.
const SWAPS: readonly (readonly [string, string])[] = [
  [ASK_ROUTE, TEXT_ASK_ROUTE],
  [ASK_DECISIONS_TOOL,
    `di terminal ini sekaligus dalam satu pesan (${NO_TOOL}), tiap pertanyaan bernomor dan diakhiri \`?\` `
    + "beserta opsi, rekomendasi dan alasannya, lalu berhenti dan tunggu jawaban"],
  [ASK_RELAY_TOOL,
    `ajukan semuanya di terminal ini (${NO_TOOL}; bernomor, tiap pertanyaan diakhiri \`?\`), lalu teruskan `
    + "jawabannya lewat SendMessage ke agent ID yang sama"],
  [ASK_ESCALATION_TOOL, `tanyakan di terminal ini (${NO_TOOL}) lalu berhenti dan tunggu jawaban`],
];

/** ADR-0231 · tukar setiap rute-tanya AskUserQuestion milik claude dengan padanan teks. Idempoten. */
export function textAsk(s: string): string {
  let out = s;
  for (const [tool, text] of SWAPS) out = out.split(tool).join(text);
  return out;
}
