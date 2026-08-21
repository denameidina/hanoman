// SPEC-867 · turunan murni dari URL git remote. Tanpa dependensi (termasuk ke api/client) supaya
// bisa diuji langsung — bentuk galatnya dibaca secara struktural, cermin cabang reverse-docs di App.tsx.

/** `https://github.com/org/repo.git` / `git@github.com:org/repo.git` → `repo`. */
export function repoBasename(remote: string): string {
  return remote.trim().replace(/\.git$/, "").split(/[/:]/).filter(Boolean).pop() || "repo";
}

// FolderPicker memulangkan folder yang SUDAH ada, sementara `git clone` menolak folder tak kosong —
// folder pilihan karena itu diperlakukan sebagai INDUK dan targetnya sub-folder bernama repo.
// Tanpa komposisi ini setiap percobaan pertama gagal dengan "destination path already exists".
export function cloneTargetInto(parent: string, remote: string): string {
  return `${parent.trim().replace(/\/+$/, "")}/${repoBasename(remote)}`;
}

// POST /projects/:id/clone membalas `{ error, detail }` dengan `detail` = stderr git. `ApiError.message`
// sendiri hanya "POST /api/… → 409" — tak bisa ditindaklanjuti operator.
export function cloneErrorText(e: unknown): { error: string; stderr: string } {
  const d = (e as { detail?: { error?: string; detail?: string } | null } | null)?.detail ?? null;
  return {
    error: d?.error?.trim() || (e as { message?: string } | null)?.message || "clone gagal",
    stderr: d?.detail?.trim() || "",
  };
}
