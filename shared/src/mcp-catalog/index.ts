// ADR-0099 · ADR-0155 · perakitan katalog. Urutan domain di sini = urutan tool di `tools/list`,
// dan itu urutan yang dibaca model di seberang: yang paling sering dipakai lebih dulu.
export * from "./types";
export * from "./helpers";

import { ABOUT_TOOLS } from "./about";
import { PROJECTS_TOOLS } from "./projects";
import { BACKLOG_TOOLS } from "./backlog";
import { SESSIONS_TOOLS } from "./sessions";
import { NOTIFICATIONS_TOOLS } from "./notifications";
import { SUPPORT_TOOLS } from "./support";
import { LEAD_TOOLS } from "./lead";
import type { McpToolDef } from "./types";

export const MCP_TOOLS: readonly McpToolDef[] = [
  ...ABOUT_TOOLS,
  ...PROJECTS_TOOLS,
  ...BACKLOG_TOOLS,
  ...SESSIONS_TOOLS,
  ...NOTIFICATIONS_TOOLS,
  ...SUPPORT_TOOLS,
  ...LEAD_TOOLS,
];
