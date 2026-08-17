// xterm.js merender seleksi sendiri (canvas), bukan seleksi native browser — jadi Cmd/Ctrl+C
// tidak menyalin apa pun kecuali app menyalinnya manual lewat `getSelection()` (per docs xterm).
// Helper murni ini memutuskan intent dari sebuah keydown; efek (clipboard read/write, kirim ke
// PTY) dilakukan pemanggil. Dipisah agar teruji tanpa canvas/jsdom.
export type ClipboardIntent = "copy" | "paste" | null;

type KeyLike = Pick<KeyboardEvent, "type" | "key" | "metaKey" | "ctrlKey" | "shiftKey">;

export function clipboardIntent(e: KeyLike, hasSelection: boolean): ClipboardIntent {
  if (e.type !== "keydown") return null;
  const k = e.key.toLowerCase();
  // Combo salin/tempel: Cmd (macOS) atau Ctrl+Shift (Windows/Linux). Ctrl polos SENGAJA
  // dilewatkan — Ctrl+C = SIGINT, Ctrl+V = literal — itu milik TUI, bukan clipboard.
  const combo = e.metaKey || (e.ctrlKey && e.shiftKey);
  if (!combo) return null;
  if (k === "c") return hasSelection ? "copy" : null;
  if (k === "v") return "paste";
  return null;
}

// SPEC-816 · allowlist ini CERMIN `ATTACHMENT_MIME` di routes/terminal.ts dan kunci `EXT` di
// services/uploads.ts. `image/gif` sengaja di luar: `extFor` memetakannya ke `.bin`.
export const ATTACHABLE_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

export function imageFilesFrom<T extends { type: string }>(
  dt: { files?: ArrayLike<T> | null } | null | undefined,
): T[] {
  const files = dt?.files ? Array.from(dt.files) : [];
  return files.filter((f) => ATTACHABLE_MIME.has(f.type));
}

// `dataTransfer.files` KOSONG selama `dragover` — isinya baru terbit saat `drop`. Jadi keputusan
// "seret ini membawa berkas" dibaca dari `types`, dan tanpa preventDefault di dragover browser
// menolak drop-nya sama sekali.
export function hasImageDrag(dt: { types?: ArrayLike<string> | null } | null | undefined): boolean {
  return dt?.types ? Array.from(dt.types).includes("Files") : false;
}
