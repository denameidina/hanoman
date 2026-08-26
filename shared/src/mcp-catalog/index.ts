// ADR-0099 · ADR-0155 · perakitan katalog. Urutan domain di sini = urutan tool di `tools/list`,
// dan itu urutan yang dibaca model di seberang: yang paling sering dipakai lebih dulu.
export * from "./types";
export * from "./helpers";

import { ABOUT_TOOLS } from "./about";
import { PROJECTS_TOOLS } from "./projects";
import { BACKLOG_TOOLS } from "./backlog";
import { DOCS_TOOLS } from "./docs";
import { IDE_TOOLS } from "./ide";
import { SETTINGS_TOOLS } from "./settings";
import { AGENTS_TOOLS } from "./agents";
import { TELEGRAM_TOOLS } from "./telegram";
import { VPS_TOOLS } from "./vps";
import { SESSIONS_TOOLS } from "./sessions";
import { NOTIFICATIONS_TOOLS } from "./notifications";
import { SUPPORT_TOOLS } from "./support";
import { LEAD_TOOLS } from "./lead";
import { TEAM_TOOLS } from "./team";
import { SYSTEM_TOOLS } from "./system";
import type { McpToolDef } from "./types";

export const MCP_TOOLS: readonly McpToolDef[] = [
  ...ABOUT_TOOLS,
  ...PROJECTS_TOOLS,
  ...BACKLOG_TOOLS,
  ...DOCS_TOOLS,
  ...IDE_TOOLS,
  ...SETTINGS_TOOLS,
  ...AGENTS_TOOLS,
  ...TELEGRAM_TOOLS,
  ...VPS_TOOLS,
  ...SESSIONS_TOOLS,
  ...NOTIFICATIONS_TOOLS,
  ...SUPPORT_TOOLS,
  ...LEAD_TOOLS,
  // ADR-0157 · papan Tim (kerja manusia) lalu status instance. Keduanya di ekor daftar dengan
  // sengaja: urutan di sini = urutan yang dibaca model, dan pekerjaan sehari-hari agen tetap
  // backlog/sesi/IDE — bukan kartu orang lain.
  ...TEAM_TOOLS,
  ...SYSTEM_TOOLS,
];
