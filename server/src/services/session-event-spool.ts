import { join } from "node:path";
import { resolveHome } from "@hanoman/runner";

// A relay signs and consumes every event it finds. Sharing tmpdir across installations lets a
// temporary server steal another installation's events even when its DB and secret are isolated.
export const sessionEventSpoolRoot = (env: NodeJS.ProcessEnv = process.env): string =>
  join(resolveHome(env), "session-events");
export const sessionEventDir = (sessionId: string, env: NodeJS.ProcessEnv = process.env): string =>
  join(sessionEventSpoolRoot(env), sessionId);
