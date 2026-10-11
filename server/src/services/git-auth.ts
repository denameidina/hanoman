import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname } from "node:path";

// ADR-0203 · skrip askpass token. Sekamar dengan askpass-deny sesi (pty.ts) dan, seperti itu, TAK
// memuat rahasia: token datang dari env proses git anak (`HANOMAN_GIT_TOKEN`), jadi tak pernah
// menyentuh disk, argv, URL remote, maupun `.git/config`.
export const gitAskpassPath = (): string => `${tmpdir()}/hanoman-askpass/token.sh`;

const ASKPASS_TOKEN = `#!/bin/sh
case "$1" in
  Username*) printf '%s\\n' "x-access-token" ;;
  *) printf '%s\\n' "$HANOMAN_GIT_TOKEN" ;;
esac
`;

/** Remote SSH GitHub → HTTPS (hanya untuk operasi git hanoman); remote lain apa adanya. */
export function httpsRemote(remote: string): string {
  const scp = /^[\w.-]+@github\.com:(.+)$/.exec(remote);
  if (scp) return `https://github.com/${scp[1]}`;
  const ssh = /^ssh:\/\/(?:[\w.-]+@)?github\.com(?::\d+)?\/(.+)$/.exec(remote);
  if (ssh) return `https://github.com/${ssh[1]}`;
  return remote;
}

/** Token hanya boleh dipakai untuk GitHub lewat HTTPS — askpass menjawab host MANA PUN yang bertanya. */
export const isGithubHttps = (remote: string): boolean => /^https:\/\/github\.com\//.test(remote);

export function gitAuthEnv(token: string): Record<string, string> {
  const path = gitAskpassPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, ASKPASS_TOKEN, { mode: 0o700 });
  chmodSync(path, 0o700);
  return { GIT_ASKPASS: path, GIT_TERMINAL_PROMPT: "0", HANOMAN_GIT_TOKEN: token };
}
