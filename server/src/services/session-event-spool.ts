import { tmpdir } from "node:os";
import { join } from "node:path";

export const sessionEventSpoolRoot = (): string => join(tmpdir(), "hanoman-session-events");
export const sessionEventDir = (sessionId: string): string =>
  join(sessionEventSpoolRoot(), sessionId);
