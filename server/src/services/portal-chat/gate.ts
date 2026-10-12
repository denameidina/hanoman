// ADR-0211 · SATU definisi gerbang chat klien. Dipakai route chat (`routes/portal-chat.ts`) untuk
// memutuskan 404, dan proyeksi daftar project (`routes/portal.ts`) untuk flag `chatEnabled`.
// Dua tempat yang tak boleh berselisih soal "chat menyala untuk akun ini di project ini".
// Master switch (`Setting.portalChat.enabled`) ∧ akses project (`ClientProjectAccess`).
export const chatOpen = (masterOn: boolean, projectAccess: boolean): boolean =>
  masterOn && projectAccess;
