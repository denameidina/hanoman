import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSessions, listSessionsAsync } from "../src/services/pty";

describe("tmux tidak terbaca bukan daftar sesi kosong (SPEC-1109)", () => {
  it.each([
    ["error connecting to /tmp/socket (Permission denied)", false],
    ["error connecting to /tmp/socket (Too many open files)", false],
    ["error connecting to /tmp/socket (No such file or directory)", true],
    ["error connecting to /tmp/socket (Connection refused)", true],
    ["no server running on /tmp/socket", true],
  ])("%s", async (message, empty) => {
    const dir = mkdtempSync(join(tmpdir(), "spec-1109-tmux-"));
    writeFileSync(join(dir, "tmux"), `#!/bin/sh\nprintf '%s\\n' '${message}' >&2\nexit 1\n`, { mode: 0o755 });
    const previous = process.env.PATH;
    process.env.PATH = dir;
    try {
      if (empty) {
        expect(listSessions()).toEqual([]);
        expect(await listSessionsAsync()).toEqual([]);
      } else {
        expect(() => listSessions()).toThrow(message);
        await expect(listSessionsAsync()).rejects.toThrow(message);
      }
    } finally {
      process.env.PATH = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
