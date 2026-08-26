// ADR-0099 · ADR-0155 · katalog tool domain `ide`: pohon berkas, isi berkas, status git, graf
// commit, dan operasi git. DUA capability, bukan satu:
//   `ide:read|write` — membaca & menulis berkas working tree;
//   `ide:git`        — merge/rebase/pull/drop, hapus branch, hapus worktree (ADR-0155).
// Keduanya dipisah karena yang kedua mengubah SEJARAH atau menghapus pekerjaan yang tak dipegang
// berkas mana pun, sementara yang pertama hanya menulis isi.
//
// Satu asimetri yang disengaja dan mudah "diperbaiki" keliru: `hanoman_ide_branches_unused`
// menuntut `projects:read`, bukan `ide:read`. `branches` sengaja BUKAN anggota `IDE_SUBS`
// (SPEC-360) — daftar branch adalah permukaan project, dan hanya `branches/delete` yang pindah ke
// `ide:git`. Menaikkannya ke `ide:read` akan MEMBUAT uji kontrak merah, bukan memperbaikinya.
import { bool, enumStr, int, obj, str, strArray, type IfThen } from "../mcp-schema";
import { enc, n, query, s } from "./helpers";
import type { McpToolDef } from "./types";

const PROJECT = str("Id project, mis. `hanoman`. Dapatkan dari hanoman_projects_list.");
const p = (id: unknown) => `/projects/${enc(String(id))}`;

/** Body yang hanya memuat field milik `op` terpilih. Meneruskan sisa argumen apa adanya akan
 *  ditolak validator server sebagai field asing, dan 400-nya membingungkan agen. */
const pick = (a: Record<string, unknown>, keys: string[]) => {
  const o: Record<string, unknown> = {};
  for (const k of keys) if (a[k] !== undefined) o[k] = a[k];
  return o;
};

// GitOp adalah union 20 varian (server/src/services/git-ide.ts). Field wajib per-op ditegakkan
// DI KLIEN lewat allOf: validator SDK menolak pasangan yang salah sebelum permintaan lahir, jadi
// agen dibimbing ke panggilan yang sah alih-alih menemukannya lewat 400 (ADR-0099 gotcha #2).
const GIT_OPS: Record<string, string[]> = {
  checkout: ["ref"], branch: ["name"], merge: ["ref"], "cherry-pick": ["sha"], revert: ["sha"],
  "delete-branch": ["name"], reset: ["sha", "mode"], tag: ["name"], "delete-tag": ["name"],
  "push-tag": ["name"], "reset-worktree": ["mode"], clean: [], stash: [],
  "stash-apply": ["ref"], "stash-pop": ["ref"], "stash-drop": ["ref"],
  "stash-branch": ["ref", "name"], "rename-branch": ["from", "to"], "push-branch": ["name"],
  fetch: [],
};
const GIT_OP_FIELDS: Record<string, string[]> = {
  checkout: ["ref", "force"], branch: ["name", "at", "checkout"],
  merge: ["ref", "ff", "deleteBranch"], "cherry-pick": ["sha"], revert: ["sha"],
  "delete-branch": ["name", "force", "local", "remote"], reset: ["sha", "mode"],
  tag: ["name", "message", "at", "push"], "delete-tag": ["name", "remote"], "push-tag": ["name"],
  "reset-worktree": ["mode"], clean: ["directories", "ignored"],
  stash: ["message", "includeUntracked"], "stash-apply": ["ref", "index"],
  "stash-pop": ["ref", "index"], "stash-drop": ["ref"], "stash-branch": ["ref", "name"],
  "rename-branch": ["from", "to"], "push-branch": ["name", "setUpstream", "force"],
  fetch: ["prune", "pruneTags"],
};
const GIT_ALL_OF: IfThen[] = Object.entries(GIT_OPS)
  .filter(([, req]) => req.length > 0)
  .map(([op, req]) => ({
    if: { properties: { op: { const: op } }, required: ["op"] },
    then: { required: req },
  }));

export const IDE_TOOLS: readonly McpToolDef[] = [
  {
    name: "hanoman_ide_tree",
    title: "Pohon berkas repo project",
    description:
      "Daftar berkas repo project pada sebuah ref. Tanpa `ref` ia membaca working tree apa adanya, termasuk perubahan yang belum di-commit. `hidden` ikut menyertakan yang .gitignore sembunyikan — direktori yang seluruhnya diabaikan (mis. `node_modules`) diruntuhkan jadi satu entri di `dirs`; buka isinya dengan `under`, satu tingkat per panggilan.",
    inputSchema: obj({
      properties: {
        project: PROJECT,
        ref: str("Ref git (branch/tag/sha). Kosongkan untuk working tree."),
        hidden: bool("Sertakan berkas & direktori yang diabaikan .gitignore. Tak berlaku bersama `ref`."),
        under: str("Jalur direktori; balasannya berisi SATU tingkat isinya. Dipakai untuk membuka direktori terabaikan yang diruntuhkan."),
      },
      required: ["project"],
    }),
    mode: "read", capability: "ide:read",
    samplePath: "/projects/hanoman/tree", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `${p(a.project)}/tree`,
      query: query({ ref: s(a.ref), hidden: a.hidden ? "1" : "", under: s(a.under) }) }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_ide_file_read",
    title: "Baca berkas repo project",
    description:
      "Isi satu berkas repo. Berkas biner dijawab dengan `binary: true` dan TANPA `content` — jangan menebak isinya. Tanpa `ref` ia membaca working tree.",
    inputSchema: obj({
      properties: {
        project: PROJECT,
        path: str("Jalur relatif berkas dari akar repo, mis. `server/src/app.ts`."),
        ref: str("Ref git. Kosongkan untuk working tree."),
      },
      required: ["project", "path"],
    }),
    mode: "read", capability: "ide:read",
    samplePath: "/projects/hanoman/file", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `${p(a.project)}/file`, query: query({ path: s(a.path), ref: s(a.ref) }) }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_ide_working_status",
    title: "Status working tree",
    description:
      "Berkas yang staged & unstaged di working tree utama project. Pakai ini sebelum operasi git untuk tahu apakah ada perubahan yang belum di-commit.",
    inputSchema: obj({ properties: { project: PROJECT }, required: ["project"] }),
    mode: "read", capability: "ide:read",
    samplePath: "/projects/hanoman/working-status", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `${p(a.project)}/working-status` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_ide_file_diff",
    title: "Diff satu berkas working tree",
    description:
      "Diff satu berkas. `staged: false` (default) membandingkan working tree dengan index; `staged: true` membandingkan index dengan HEAD.",
    inputSchema: obj({
      properties: {
        project: PROJECT,
        path: str("Jalur relatif berkas dari akar repo."),
        staged: bool("true = index vs HEAD. false/kosong = working tree vs index."),
      },
      required: ["project", "path"],
    }),
    mode: "read", capability: "ide:read",
    samplePath: "/projects/hanoman/file-diff", sampleMethod: "GET",
    build: (a) => ({
      method: "GET", path: `${p(a.project)}/file-diff`,
      // Server membaca `staged` sebagai STRING "1"/"true"; boolean false dihilangkan alih-alih
      // dikirim sebagai "false" yang akan diabaikan senyap (kelas jebakan `startable`).
      query: query({ path: s(a.path), staged: a.staged === true ? "1" : undefined }),
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_ide_file_write",
    title: "Tulis berkas repo project",
    description:
      "Menimpa (atau membuat) satu berkas di working tree utama project. Isi lama TIDAK digabung — kirim berkas utuh. Ini bukan operasi git: tak ada commit, dan HEAD tak bergerak.",
    inputSchema: obj({
      properties: {
        project: PROJECT,
        path: str("Jalur relatif berkas dari akar repo."),
        content: str("Isi berkas UTUH. Yang lama ditimpa seluruhnya."),
      },
      required: ["project", "path", "content"],
    }),
    mode: "write", capability: "ide:write",
    samplePath: "/projects/hanoman/file", sampleMethod: "PUT",
    build: (a) => ({ method: "PUT", path: `${p(a.project)}/file`, body: { path: String(a.path), content: String(a.content) } }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_ide_entry_create",
    title: "Buat berkas atau folder",
    description: "Membuat berkas kosong atau folder baru di working tree project. Gagal bila jalurnya sudah ada.",
    inputSchema: obj({
      properties: {
        project: PROJECT,
        path: str("Jalur relatif yang akan dibuat."),
        kind: enumStr(["file", "dir"], "Jenis entri yang dibuat."),
      },
      required: ["project", "path", "kind"],
    }),
    mode: "write", capability: "ide:write",
    samplePath: "/projects/hanoman/entry", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: `${p(a.project)}/entry`, body: { path: String(a.path), kind: String(a.kind) } }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_ide_entry_rename",
    title: "Pindahkan atau ganti nama entri",
    description: "Memindahkan berkas/folder di working tree project. Memindahkan folder ikut memindahkan seluruh isinya.",
    inputSchema: obj({
      properties: { project: PROJECT, from: str("Jalur relatif asal."), to: str("Jalur relatif tujuan.") },
      required: ["project", "from", "to"],
    }),
    mode: "write", capability: "ide:write",
    samplePath: "/projects/hanoman/entry", sampleMethod: "PATCH",
    build: (a) => ({ method: "PATCH", path: `${p(a.project)}/entry`, body: { from: String(a.from), to: String(a.to) } }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_ide_entry_delete",
    title: "Hapus berkas atau folder (BERBAHAYA)",
    description:
      "BERBAHAYA — menghapus berkas atau folder dari working tree project. Menghapus folder ikut menghapus SELURUH isinya. Perubahan yang belum di-commit hilang tanpa jalan pulang. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: { project: PROJECT, path: str("Jalur relatif yang akan dihapus.") },
      required: ["project", "path"],
    }),
    mode: "danger", capability: "ide:write",
    samplePath: "/projects/hanoman/entry", sampleMethod: "DELETE",
    build: (a) => ({ method: "DELETE", path: `${p(a.project)}/entry`, query: query({ path: s(a.path) }) }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_ide_graph",
    title: "Graf commit project",
    description:
      "Graf commit project. Mengisi `q` mengalihkannya ke PENCARIAN commit lintas semua ref, yang mengembalikan daftar sha saja dan mengabaikan `limit`/`branches` — dua cabang berbeda, bukan penyaring atas graf yang sama.",
    inputSchema: obj({
      properties: {
        project: PROJECT,
        q: str("Kata kunci pencarian commit. Mengisinya mengalihkan ke mode pencarian."),
        by: enumStr(["all", "message", "author", "hash"], "Ruang pencarian saat `q` diisi. Default `all`."),
        limit: int("Mode graf: jumlah commit. Default 200.", { minimum: 1, maximum: 2000 }),
        branches: str("Mode graf: nama branch dipisah koma. Kosongkan untuk semua."),
      },
      required: ["project"],
    }),
    mode: "read", capability: "ide:read",
    samplePath: "/projects/hanoman/graph", sampleMethod: "GET",
    build: (a) => {
      const q = s(a.q);
      if (q) return { method: "GET", path: `${p(a.project)}/graph/search`, query: { q, by: s(a.by) ?? "all" } };
      return {
        method: "GET", path: `${p(a.project)}/graph`,
        query: query({ limit: n(a.limit)?.toString(), branches: s(a.branches) }),
      };
    },
    shape: (raw) => raw,
  },
  {
    name: "hanoman_ide_git_status",
    title: "Status repo untuk graf",
    description: "Ringkasan perubahan yang belum di-commit, dalam bentuk yang dipakai baris 'uncommitted' di graf commit.",
    inputSchema: obj({ properties: { project: PROJECT }, required: ["project"] }),
    mode: "read", capability: "ide:read",
    samplePath: "/projects/hanoman/status", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `${p(a.project)}/status` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_ide_stashes",
    title: "Daftar stash",
    description:
      "Daftar stash repo project. Ingat: tumpukan stash milik REPO, bukan worktree — stash yang dibuat satu sesi terlihat oleh semua sesi di repo yang sama.",
    inputSchema: obj({ properties: { project: PROJECT }, required: ["project"] }),
    mode: "read", capability: "ide:read",
    samplePath: "/projects/hanoman/stashes", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `${p(a.project)}/stashes` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_ide_remotes_list",
    title: "Daftar remote git",
    description: "Remote git project beserta URL fetch & push-nya.",
    inputSchema: obj({ properties: { project: PROJECT }, required: ["project"] }),
    mode: "read", capability: "ide:read",
    samplePath: "/projects/hanoman/remotes", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `${p(a.project)}/remotes` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_ide_remote_add",
    title: "Tambah remote git",
    description: "Menambah remote baru. Menjawab 409 bila namanya sudah ada — pakai hanoman_ide_remote_update untuk mengubah yang sudah ada.",
    inputSchema: obj({
      properties: { project: PROJECT, name: str("Nama remote, mis. `origin`."), url: str("URL remote.") },
      required: ["project", "name", "url"],
    }),
    mode: "write", capability: "ide:write",
    samplePath: "/projects/hanoman/remotes", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: `${p(a.project)}/remotes`, body: { name: String(a.name), url: String(a.url) } }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_ide_remote_update",
    title: "Ubah URL remote git",
    description: "Mengubah URL sebuah remote yang sudah ada.",
    inputSchema: obj({
      properties: { project: PROJECT, name: str("Nama remote yang diubah."), url: str("URL baru.") },
      required: ["project", "name", "url"],
    }),
    mode: "write", capability: "ide:write",
    samplePath: "/projects/hanoman/remotes/origin", sampleMethod: "PATCH",
    build: (a) => ({ method: "PATCH", path: `${p(a.project)}/remotes/${enc(String(a.name))}`, body: { url: String(a.url) } }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_ide_remote_delete",
    title: "Hapus remote git",
    description: "Menghapus sebuah remote dari konfigurasi git project. Tak menyentuh commit maupun branch.",
    inputSchema: obj({
      properties: { project: PROJECT, name: str("Nama remote yang dihapus.") },
      required: ["project", "name"],
    }),
    mode: "write", capability: "ide:write",
    samplePath: "/projects/hanoman/remotes/origin", sampleMethod: "DELETE",
    build: (a) => ({ method: "DELETE", path: `${p(a.project)}/remotes/${enc(String(a.name))}` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_ide_pr_url",
    title: "URL buat Pull Request",
    description:
      "URL 'Create Pull Request' yang diturunkan dari remote `origin`. Menjawab `{url: null}` bila project tak punya origin — itu jawaban sah, bukan galat.",
    inputSchema: obj({
      properties: {
        project: PROJECT,
        branch: str("Branch sumber PR."),
        base: str("Branch tujuan. Default `main`."),
      },
      required: ["project", "branch"],
    }),
    mode: "read", capability: "ide:read",
    samplePath: "/projects/hanoman/pr-url", sampleMethod: "GET",
    build: (a) => ({ method: "GET", path: `${p(a.project)}/pr-url`, query: query({ branch: s(a.branch), base: s(a.base) }) }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_ide_commit",
    title: "Detail commit",
    description:
      "Detail sebuah commit. Mengisi `path` mengalihkannya ke diff SATU berkas di commit itu (vs induknya) alih-alih ringkasan commit.",
    inputSchema: obj({
      properties: {
        project: PROJECT,
        sha: str("Sha commit."),
        path: str("Jalur berkas. Mengisinya menghasilkan diff berkas itu, bukan ringkasan commit."),
      },
      required: ["project", "sha"],
    }),
    mode: "read", capability: "ide:read",
    samplePath: "/projects/hanoman/commit/abc123", sampleMethod: "GET",
    build: (a) => {
      const path = s(a.path);
      const base = `${p(a.project)}/commit/${enc(String(a.sha))}`;
      return path ? { method: "GET", path: `${base}/file`, query: { path } } : { method: "GET", path: base };
    },
    shape: (raw) => raw,
  },
  {
    name: "hanoman_ide_compare",
    title: "Bandingkan dua commit",
    description:
      "Berkas yang berbeda antara dua commit. Mengisi `path` mengalihkannya ke diff SATU berkas antara keduanya.",
    inputSchema: obj({
      properties: {
        project: PROJECT,
        from: str("Sha/ref awal."),
        to: str("Sha/ref akhir."),
        path: str("Jalur berkas. Mengisinya menghasilkan diff berkas itu, bukan daftar berkas."),
      },
      required: ["project", "from", "to"],
    }),
    mode: "read", capability: "ide:read",
    samplePath: "/projects/hanoman/compare", sampleMethod: "GET",
    build: (a) => {
      const path = s(a.path);
      const q = { from: String(a.from), to: String(a.to) };
      return path
        ? { method: "GET", path: `${p(a.project)}/compare/file`, query: { ...q, path } }
        : { method: "GET", path: `${p(a.project)}/compare`, query: q };
    },
    shape: (raw) => raw,
  },
  {
    name: "hanoman_ide_branches_unused",
    title: "Branch yang tak terpakai",
    description:
      "Branch yang sudah ter-merge ke base, beserta alasan kunci per branch (worktree hidup, sesi berjalan). `include: \"all\"` ikut memuat branch yang BELUM ter-merge. Menuntut capability `projects:read`, bukan `ide:read` — daftar branch adalah permukaan project.",
    inputSchema: obj({
      properties: {
        project: PROJECT,
        base: str("Branch pembanding. Kosongkan untuk default project."),
        include: enumStr(["merged", "all"], "`merged` (default) hanya yang sudah ter-merge; `all` ikut yang belum."),
      },
      required: ["project"],
    }),
    // BUKAN `ide:read`. Lihat komentar kepala berkas ini.
    mode: "read", capability: "projects:read",
    samplePath: "/projects/hanoman/branches/unused", sampleMethod: "GET",
    build: (a) => ({
      method: "GET", path: `${p(a.project)}/branches/unused`,
      query: query({ base: s(a.base), include: s(a.include) }),
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_ide_worktrees_list",
    title: "Worktree yang hidup",
    description:
      "Worktree git yang masih hidup di project. Mengisi `name` mengalihkannya ke SINYAL MAHAL untuk satu worktree (ukuran disk, isi kotor, commit yatim) — sengaja terpisah supaya daftar tak menunggu `du`.",
    inputSchema: obj({
      properties: {
        project: PROJECT,
        name: str("Nama worktree. Mengisinya menghasilkan statistik satu worktree, bukan daftar."),
      },
      required: ["project"],
    }),
    mode: "read", capability: "ide:read",
    samplePath: "/projects/hanoman/worktrees", sampleMethod: "GET",
    build: (a) => {
      const name = s(a.name);
      return name
        ? { method: "GET", path: `${p(a.project)}/worktrees/stats`, query: { name } }
        : { method: "GET", path: `${p(a.project)}/worktrees` };
    },
    shape: (raw) => raw,
  },
  {
    name: "hanoman_ide_git_run",
    title: "Operasi git (BERBAHAYA)",
    description:
      "BERBAHAYA — menjalankan satu operasi git di repo project: checkout, branch, reset, tag, stash, clean, push, fetch, dan lainnya. Sebagian menyentuh working tree dan ditolak 409 bila ada sesi aktif, kecuali `force: true`. `reset --hard` dan `clean` MENGHAPUS pekerjaan yang belum di-commit. Menuntut capability `ide:git`; `ide:write` tidak cukup. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: {
        project: PROJECT,
        op: enumStr(Object.keys(GIT_OPS), "Operasi git. Field yang WAJIB menyertainya ditentukan nilai ini."),
        ref: str("Ref git. Dipakai op checkout, merge, stash-apply, stash-pop, stash-drop, stash-branch."),
        name: str("Nama branch/tag/worktree. Dipakai op branch, delete-branch, tag, delete-tag, push-tag, stash-branch, push-branch."),
        sha: str("Sha commit. Dipakai op cherry-pick, revert, reset."),
        from: str("Nama asal. Dipakai op rename-branch."),
        to: str("Nama tujuan. Dipakai op rename-branch."),
        at: str("Titik commit. Dipakai op branch & tag."),
        mode: enumStr(["soft", "mixed", "hard"], "Mode reset. `hard` MENGHAPUS perubahan working tree."),
        message: str("Pesan. Dipakai op tag (annotated) & stash."),
        ff: enumStr(["no-ff", "ff-only"], "Kebijakan fast-forward untuk op merge."),
        deleteBranch: str("Branch yang dihapus sesudah merge berhasil."),
        force: bool("Lewati gerbang sesi aktif, dan tambahkan -f/-D pada op yang mendukungnya."),
        local: bool("op delete-branch: hapus branch lokal. Default true."),
        remote: bool("op delete-branch/delete-tag: hapus juga di origin."),
        checkout: bool("op branch: langsung checkout sesudah dibuat."),
        push: bool("op tag: dorong tag ke origin sesudah dibuat."),
        index: bool("op stash-apply/stash-pop: pulihkan juga index."),
        includeUntracked: bool("op stash: ikut menyimpan berkas untracked."),
        directories: bool("op clean: ikut menghapus direktori."),
        ignored: bool("op clean: ikut menghapus berkas yang di-ignore."),
        setUpstream: bool("op push-branch: setel upstream."),
        prune: bool("op fetch: buang ref remote yang sudah tak ada."),
        pruneTags: bool("op fetch: buang tag yang sudah tak ada."),
      },
      required: ["project", "op"],
      allOf: GIT_ALL_OF,
    }),
    mode: "danger", capability: "ide:git",
    samplePath: "/projects/hanoman/git", sampleMethod: "POST",
    build: (a) => ({
      method: "POST", path: `${p(a.project)}/git`,
      body: { op: String(a.op), ...pick(a, [...(GIT_OP_FIELDS[String(a.op)] ?? []), "force"]) },
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_ide_git_merge",
    title: "Merge branch (BERBAHAYA)",
    description:
      "BERBAHAYA — merge sebuah branch ke branch yang sedang aktif. Dijalankan di worktree terisolasi sehingga working tree utama tak dirusak, TAPI konflik akan MEMBUKA SESI AGEN untuk menyelesaikannya. Menuntut capability `ide:git`; `ide:write` tidak cukup. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: {
        project: PROJECT,
        source: str("Branch yang di-merge MASUK ke branch aktif."),
        ff: enumStr(["no-ff", "ff-only"], "`ff-only` gagal alih-alih membuat commit merge; `no-ff` selalu membuat commit merge."),
        deleteBranch: str("Branch yang dihapus sesudah merge berhasil. Kosongkan untuk tak menghapus apa pun."),
      },
      required: ["project", "source"],
    }),
    mode: "danger", capability: "ide:git",
    samplePath: "/projects/hanoman/git/merge", sampleMethod: "POST",
    build: (a) => ({
      method: "POST", path: `${p(a.project)}/git/merge`,
      body: { source: String(a.source), ...pick(a, ["ff", "deleteBranch"]) },
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_ide_git_rebase",
    title: "Rebase branch aktif (BERBAHAYA)",
    description:
      "BERBAHAYA — me-rebase branch yang sedang aktif ke commit/branch lain. MENULIS ULANG SEJARAH: sha commit berubah, dan branch yang sudah didorong akan menyimpang dari remote-nya. Konflik membuka sesi agen. Menuntut `ide:git`. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: { project: PROJECT, onto: str("Commit/branch tujuan rebase.") },
      required: ["project", "onto"],
    }),
    mode: "danger", capability: "ide:git",
    samplePath: "/projects/hanoman/git/rebase", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: `${p(a.project)}/git/rebase`, body: { onto: String(a.onto) } }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_ide_git_pull",
    title: "Pull ke branch aktif (BERBAHAYA)",
    description:
      "BERBAHAYA — fetch lalu merge sebuah branch remote ke branch aktif. Konflik membuka sesi agen. Menuntut `ide:git`. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: {
        project: PROJECT,
        source: str("Branch remote yang ditarik, mis. `origin/main`."),
        ff: enumStr(["no-ff", "ff-only"], "Kebijakan fast-forward."),
      },
      required: ["project", "source"],
    }),
    mode: "danger", capability: "ide:git",
    samplePath: "/projects/hanoman/git/pull", sampleMethod: "POST",
    build: (a) => ({
      method: "POST", path: `${p(a.project)}/git/pull`,
      body: { source: String(a.source), ...pick(a, ["ff"]) },
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_ide_git_drop",
    title: "Buang satu commit (BERBAHAYA)",
    description:
      "BERBAHAYA — membuang satu commit dari branch aktif. MENULIS ULANG SEJARAH: seluruh commit sesudahnya berganti sha. Konflik membuka sesi agen. Menuntut `ide:git`. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: { project: PROJECT, sha: str("Sha commit yang dibuang.") },
      required: ["project", "sha"],
    }),
    mode: "danger", capability: "ide:git",
    samplePath: "/projects/hanoman/git/drop", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: `${p(a.project)}/git/drop`, body: { sha: String(a.sha) } }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_ide_branch_delete",
    title: "Hapus branch (BERBAHAYA)",
    description:
      "BERBAHAYA — menghapus beberapa branch sekaligus, lokal dan/atau di origin. `allowUnmerged: true` ikut menghapus branch yang BELUM ter-merge, dan commit di dalamnya menjadi yatim. Selalu menjawab 200 bila body sah: kegagalan per-branch hidup di `results`, jadi PERIKSA baris itu — status 200 bukan berarti semuanya berhasil. Menuntut `ide:git`. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: {
        project: PROJECT,
        names: strArray("Nama branch yang dihapus. Dapatkan dari hanoman_ide_branches_unused."),
        scope: enumStr(["local", "remote", "both"], "Di mana branch dihapus. Default `both`."),
        base: str("Branch pembanding untuk menilai ter-merge atau belum."),
        allowUnmerged: bool("true = ikut menghapus branch yang belum ter-merge. Commit di dalamnya jadi yatim."),
      },
      required: ["project", "names"],
    }),
    mode: "danger", capability: "ide:git",
    samplePath: "/projects/hanoman/branches/delete", sampleMethod: "POST",
    build: (a) => ({
      method: "POST", path: `${p(a.project)}/branches/delete`,
      body: { names: a.names, ...pick(a, ["scope", "base", "allowUnmerged"]) },
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_ide_worktree_delete",
    title: "Hapus worktree (BERBAHAYA)",
    description:
      "BERBAHAYA — menghapus beberapa worktree sekaligus. Perubahan yang belum di-commit di dalamnya HILANG, dan sesi yang sedang berjalan di worktree itu ditutup. `deleteBranch: true` ikut menghapus branch-nya. Selalu menjawab 200 bila body sah: kegagalan per-worktree hidup di `results`. Menuntut `ide:git`. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({
      properties: {
        project: PROJECT,
        names: strArray("Nama worktree yang dihapus. Dapatkan dari hanoman_ide_worktrees_list."),
        deleteBranch: bool("true = hapus juga branch milik tiap worktree."),
      },
      required: ["project", "names"],
    }),
    mode: "danger", capability: "ide:git",
    samplePath: "/projects/hanoman/worktrees/delete", sampleMethod: "POST",
    build: (a) => ({
      method: "POST", path: `${p(a.project)}/worktrees/delete`,
      body: { names: a.names, ...pick(a, ["deleteBranch"]) },
    }),
    shape: (raw) => raw,
  },
];
