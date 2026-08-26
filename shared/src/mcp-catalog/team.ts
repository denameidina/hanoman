// ADR-0157 · katalog tool domain `team` — papan Tim (`/api/tasks`) dan direktori orangnya
// (`/api/members`). Satu berkas untuk dua permukaan REST karena keduanya satu capability: kartu
// tanpa nama penanggung jawab hanyalah judul.
//
// Dua sifat papan ini yang WAJIB terbaca agen di deskripsi, karena keduanya jebakan yang sudah
// terukur di kode servernya:
//   1. `status` kartu milik MANUSIA dan bebas dipindah — ia BUKAN `Spec.stage`, yang diturunkan
//      dari fase sesi (ADR-0008/0024). Kartu `done` tak berarti backlognya selesai, dan sebaliknya.
//   2. Tautan ke backlog lahir HANYA dari eskalasi (ADR-0150 keputusan 5). Tak ada `specId` di
//      create/update — bukan kelalaian skema, melainkan gerbang: kartu tak boleh mengaku tertaut
//      pada Spec yang tak pernah menyetujuinya.
import { ESCALATE_SOURCE_ENUM, PAGE_PARAMS, PRIORITY, TASK_STATUS_ENUM, bool, enumStr, obj, str } from "../mcp-schema";
import { shapeMember, shapeTask } from "../mcp-shape";
import { enc, n, query, reshapePage, s } from "./helpers";
import type { Args, McpToolDef } from "./types";

const TASK_ID = str("Id kartu papan Tim, seperti muncul di hanoman_tasks_list.");
const MEMBER_ID = str("Id anggota — email ternormalisasi (huruf kecil), seperti muncul di hanoman_members_list.");

/**
 * Tiga keadaan, bukan dua. `undefined` = jangan sentuh, `null` = kosongkan, string = isi.
 * Server membedakan keduanya (Prisma `undefined` ≠ `null`), jadi tool yang meruntuhkannya jadi
 * dua keadaan membuat "kosongkan tanggal jatuh tempo" mustahil lewat MCP. String KOSONG dipilih
 * sebagai isyarat kosongkan karena JSON Schema `type: "string"` tak punya null yang bisa dikirim
 * model dengan andal.
 */
const nullable = (v: unknown): string | null | undefined => {
  if (typeof v !== "string") return undefined;
  return v === "" ? null : v;
};

const CLEAR = " Kirim string KOSONG untuk mengosongkannya; tak menyebutnya sama sekali berarti biarkan apa adanya.";

const TASK_FIELDS = {
  title: str("Judul kartu, satu baris."),
  detail: str("Isi kartu. Markdown bebas." + CLEAR),
  project: str("Id project pemilik kartu. Kartu BOLEH tanpa project — papan Tim tak mensyaratkannya." + CLEAR),
  status: enumStr(TASK_STATUS_ENUM, "Kolom papan. Milik MANUSIA dan bebas dipindah — ini BUKAN `stage` backlog, yang diturunkan dari fase sesi."),
  priority: PRIORITY,
  member: str("Id anggota yang ditugaskan (email huruf kecil), dari hanoman_members_list." + CLEAR),
  startDate: str("Tanggal mulai, ISO 8601 berzona mis. `2026-09-01T00:00:00.000Z`. `besok` ditolak." + CLEAR),
  dueDate: str("Tanggal jatuh tempo, ISO 8601 berzona. Ini tanggal KARTU, bukan estimasi backlog." + CLEAR),
};

const taskBody = (a: Args): Record<string, unknown> => {
  const body: Record<string, unknown> = {};
  if (s(a.title)) body.title = s(a.title);
  if (s(a.status)) body.status = s(a.status);
  if (s(a.priority)) body.priority = s(a.priority);
  if (n(a.order) !== undefined) body.order = n(a.order);
  for (const [key, arg] of [
    ["detail", a.detail], ["projectId", a.project], ["memberId", a.member],
    ["startDate", a.startDate], ["dueDate", a.dueDate],
  ] as const) {
    const v = nullable(arg);
    if (v !== undefined) body[key] = v;
  }
  return body;
};

const TASKS: readonly McpToolDef[] = [
  {
    name: "hanoman_tasks_list",
    title: "Kartu papan Tim",
    description:
      "Kartu kerja MANUSIA di papan Tim, terurut sesuai posisinya di kolom. Empat kolom: `backlog`, `doing`, `review`, `done` — milik manusia, tak diturunkan dari sesi agen. `specId`/`spec` terisi hanya untuk kartu yang sudah dieskalasi jadi backlog item; `specId` terisi sementara `spec` null berarti tautannya PUTUS (backlognya sudah dihapus), bukan belum dieskalasi.",
    inputSchema: obj({
      properties: {
        project: str("Id project. Tanpa ini, seluruh project — termasuk kartu tanpa project."),
        status: enumStr(TASK_STATUS_ENUM, "Kolom papan."),
        member: MEMBER_ID,
        q: str("Cari substring pada judul + detail, tak peka huruf besar-kecil. Disaring SEBELUM paginasi, jadi hasilnya tak buta terhadap kartu di luar halaman pertama."),
        ...PAGE_PARAMS,
      },
    }),
    mode: "read", capability: "team:read", samplePath: "/tasks", sampleMethod: "GET",
    build: (a) => ({
      method: "GET", path: "/tasks",
      query: query({
        projectId: s(a.project), status: s(a.status), memberId: s(a.member), q: s(a.q),
        page: n(a.page) === undefined ? undefined : String(n(a.page)),
        limit: n(a.limit) === undefined ? undefined : String(n(a.limit)),
      }),
    }),
    shape: (raw) => reshapePage(raw, shapeTask),
  },
  {
    name: "hanoman_task_create",
    title: "Buat kartu papan Tim",
    description:
      "Membuat kartu kerja manusia di papan Tim. Kartu BARU tak pernah tertaut backlog — tautan itu lahir dari hanoman_task_escalate, bukan dari field. Untuk pekerjaan yang akan dikerjakan AGEN, pakai hanoman_backlog_create: papan ini bukan antrean sesi.",
    inputSchema: obj({ properties: { ...TASK_FIELDS }, required: ["title"] }),
    mode: "write", capability: "team:write", samplePath: "/tasks", sampleMethod: "POST",
    build: (a) => ({ method: "POST", path: "/tasks", body: taskBody(a) }),
    shape: (raw) => shapeTask(raw as Record<string, unknown>),
  },
  {
    name: "hanoman_task_update",
    title: "Ubah kartu papan Tim",
    description:
      "Mengubah kartu papan Tim. Hanya field yang disebut yang ditulis. Kartu yang SUDAH tertaut backlog menolak pindah project dengan 400 — lepas tautannya dulu lewat hanoman_task_unlink. `specId` sengaja tak bisa diisi di sini.",
    inputSchema: obj({ properties: { task: TASK_ID, ...TASK_FIELDS }, required: ["task"] }),
    mode: "write", capability: "team:write", samplePath: "/tasks/t1", sampleMethod: "PATCH",
    build: (a) => ({ method: "PATCH", path: `/tasks/${enc(String(a.task))}`, body: taskBody(a) }),
    shape: (raw) => shapeTask(raw as Record<string, unknown>),
  },
  {
    name: "hanoman_task_escalate",
    title: "Eskalasi kartu jadi backlog item",
    description:
      "Melahirkan backlog item dari sebuah kartu papan Tim, lalu menautkan keduanya. IDEMPOTEN: kartu yang sudah tertaut menjawab 200 dengan `created: false` dan spec yang sama, bukan membuat backlog kedua. Kartu TANPA project ditolak 400 — id backlog diturunkan dari repo milik project, jadi sebutkan `project` lebih dulu. Ini TIDAK membuka sesi agen; peluncurannya tetap tindakan terpisah, dan Spec-nya lahir tanpa persetujuan peluncuran bila token pemanggil tak memegang `sessions:write`.",
    inputSchema: obj({
      properties: {
        task: TASK_ID,
        source: enumStr(ESCALATE_SOURCE_ENUM, "Bentuk backlog yang dilahirkan. Default `brief`. `goal`/`no_effort`/`help` sengaja tak tersedia: dua yang pertama menuntut kalimat yang hanya operator bisa tulis, yang terakhir milik tiket Help Center."),
        priority: PRIORITY,
        project: str("Id project tujuan. HANYA dipakai bila kartunya belum punya project — menyebut project LAIN dari milik kartu ditolak 400."),
      },
      required: ["task"],
    }),
    mode: "write", capability: "team:write",
    samplePath: "/tasks/t1/escalate", sampleMethod: "POST",
    build: (a) => ({
      method: "POST", path: `/tasks/${enc(String(a.task))}/escalate`,
      body: query({ source: s(a.source), priority: s(a.priority), projectId: s(a.project) }),
    }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_task_unlink",
    title: "Lepas tautan kartu dari backlog",
    description:
      "Melepas tautan kartu papan Tim dari backlog item-nya. NON-DESTRUKTIF: backlog item-nya dibiarkan hidup — hapus manual lewat hanoman_backlog_delete bila memang salah eskalasi. Idempoten: kartu yang memang tak tertaut menjawab 200 apa adanya.",
    inputSchema: obj({ properties: { task: TASK_ID }, required: ["task"] }),
    mode: "write", capability: "team:write",
    samplePath: "/tasks/t1/escalate", sampleMethod: "DELETE",
    build: (a) => ({ method: "DELETE", path: `/tasks/${enc(String(a.task))}/escalate` }),
    shape: (raw) => shapeTask(raw as Record<string, unknown>),
  },
];

const MEMBERS: readonly McpToolDef[] = [
  {
    name: "hanoman_members_list",
    title: "Anggota tim",
    description:
      "Direktori orang untuk papan Tim. GLOBAL, bukan per project — kartu boleh tanpa project. Anggota nonaktif TETAP terdaftar (di bawah): kartu lama yang ditugaskan padanya harus tetap punya nama. `id` = email ternormalisasi, dan itu yang dipakai sebagai `member` di tool kartu.",
    inputSchema: obj({ properties: { activeOnly: bool("Hanya anggota aktif. Default: semua, nonaktif di urutan bawah."), ...PAGE_PARAMS } }),
    mode: "read", capability: "team:read", samplePath: "/members", sampleMethod: "GET",
    build: (a) => ({
      method: "GET", path: "/members",
      query: query({
        active: a.activeOnly === true ? "true" : undefined,
        page: n(a.page) === undefined ? undefined : String(n(a.page)),
        limit: n(a.limit) === undefined ? undefined : String(n(a.limit)),
      }),
    }),
    shape: (raw) => reshapePage(raw, shapeMember),
  },
  {
    name: "hanoman_member_create",
    title: "Tambah anggota tim",
    description:
      "Menambah orang ke direktori papan Tim. `id` DITURUNKAN dari email (dipangkas + huruf kecil), bukan diacak — email yang sudah terdaftar menjawab 409 berikut id-nya, bukan membuat baris kedua.",
    inputSchema: obj({
      properties: {
        name: str("Nama yang ditampilkan di kartu."),
        email: str("Email. Menjadi id anggota sesudah dipangkas & dihurufkecilkan — dan id itu TAK BISA diubah kemudian."),
        role: str("Peran, mis. `desainer`. Bebas teks."),
      },
      required: ["name", "email"],
    }),
    mode: "write", capability: "team:write", samplePath: "/members", sampleMethod: "POST",
    build: (a) => ({
      method: "POST", path: "/members",
      body: { name: String(a.name), email: String(a.email), ...(s(a.role) ? { role: s(a.role) } : {}) },
    }),
    shape: (raw) => shapeMember(raw as Record<string, unknown>),
  },
  {
    name: "hanoman_member_update",
    title: "Ubah anggota tim",
    description:
      "Mengubah nama, peran, atau status aktif seorang anggota. `email` TIDAK bisa diubah dan ditolak eksplisit 400: id diturunkan darinya dan sync tak punya operasi rename, jadi id yang berubah meninggalkan baris yatim di setiap mesin lain. Ganti email = hapus lalu buat baru. Menonaktifkan TIDAK melepas kartu-kartunya.",
    inputSchema: obj({
      properties: {
        member: MEMBER_ID,
        name: str("Nama baru."),
        role: str("Peran baru." + CLEAR),
        active: bool("false = nonaktif: tetap terdaftar dan tetap memegang kartunya, hanya turun di daftar."),
      },
      required: ["member"],
    }),
    mode: "write", capability: "team:write", samplePath: "/members/a@b.id", sampleMethod: "PATCH",
    build: (a) => {
      const body: Record<string, unknown> = {};
      if (s(a.name)) body.name = s(a.name);
      if (typeof a.active === "boolean") body.active = a.active;
      const role = nullable(a.role);
      if (role !== undefined) body.role = role;
      return { method: "PATCH", path: `/members/${enc(String(a.member))}`, body };
    },
    shape: (raw) => shapeMember(raw as Record<string, unknown>),
  },
];

// ADR-0157 · dua penghapusan. Keduanya destruktif tanpa jalan pulang, tapi capability-nya tetap
// `team:write`: domain ini tak punya pecahan `danger`, jadi mode `danger`-nya murni ergonomi —
// mencegah salah pilih tool, bukan gerbang (daftar `DESTRUCTIVE_BUT_WRITE`, ADR-0155).
const DESTRUCTIVE: readonly McpToolDef[] = [
  {
    name: "hanoman_task_delete",
    title: "Hapus kartu papan Tim (BERBAHAYA)",
    description:
      "BERBAHAYA — menghapus kartu papan Tim secara permanen di SELURUH mesin yang tersync. Backlog item yang tertaut TIDAK ikut terhapus. Untuk sekadar mengarsipkan, pindahkan kartunya ke kolom `done` lewat hanoman_task_update. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({ properties: { task: TASK_ID }, required: ["task"] }),
    mode: "danger", capability: "team:write", samplePath: "/tasks/t1", sampleMethod: "DELETE",
    build: (a) => ({ method: "DELETE", path: `/tasks/${enc(String(a.task))}` }),
    shape: (raw) => raw,
  },
  {
    name: "hanoman_member_delete",
    title: "Hapus anggota tim (BERBAHAYA)",
    description:
      "BERBAHAYA — menghapus anggota secara permanen di SELURUH mesin yang tersync. Kartu-kartunya TIDAK ikut terhapus: penugasannya dikosongkan (`memberId` jadi null), dan tak ada jejak siapa pemegangnya sebelum itu. Untuk orang yang sekadar berhenti aktif, pakai hanoman_member_update dengan `active: false` — ia tetap terdaftar dan kartunya tetap bernama. Hanya muncul saat tingkat `--danger` menyala.",
    inputSchema: obj({ properties: { member: MEMBER_ID }, required: ["member"] }),
    mode: "danger", capability: "team:write", samplePath: "/members/a@b.id", sampleMethod: "DELETE",
    build: (a) => ({ method: "DELETE", path: `/members/${enc(String(a.member))}` }),
    shape: (raw) => raw,
  },
];

export const TEAM_TOOLS: readonly McpToolDef[] = [...TASKS, ...MEMBERS, ...DESTRUCTIVE];
