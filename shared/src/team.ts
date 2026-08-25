import { z } from "zod";
import { zPriority } from "./enums";

// SPEC-945 · ADR-0150 · kontrak murni papan tim. Nol I/O: dipakai server (validasi route +
// serialisasi), topik siar, dan UI (bentuk form) dari satu sumber.

/**
 * Empat kolom papan, tetap. Milik MANUSIA — beda dari `Spec.stage` yang diturunkan dari fase sesi
 * (ADR-0008/0024) dan karena itu hampir seluruhnya menolak drag.
 */
export const TASK_STATUSES = ["backlog", "doing", "review", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const zTaskStatus = z.enum(TASK_STATUSES);

/**
 * ADR-0094 · id deterministik dari email ternormalisasi. Dengan id acak, dua mesin yang sama-sama
 * membuat orang yang sama melahirkan dua baris yang keduanya menyeberang changefeed, dan salah
 * satunya lenyap tanpa jejak begitu papan menyaring per-assignee.
 */
export const memberId = (email: string): string => email.trim().toLowerCase();

const zEmail = z.string().trim().min(3).max(200).email();
const zName = z.string().trim().min(1).max(120);
/** ISO 8601 yang benar-benar tanggal. `z.coerce.date()` menerima "besok" sebagai Invalid Date. */
const zIso = z.string().datetime({ offset: true });

export const zCreateMember = z.object({
  name: zName,
  email: zEmail,
  role: z.string().trim().max(60).nullable().optional(),
});
export type CreateMember = z.infer<typeof zCreateMember>;

// `email` sengaja DI LUAR skema patch: id diturunkan darinya, dan changefeed sync tak punya
// operasi rename — id yang berubah meninggalkan baris yatim di setiap mesin lain (ADR-0094
// keputusan 2). Ditolak EKSPLISIT di route juga; `.omit()` sendirian membuangnya senyap.
export const zPatchMember = zCreateMember.omit({ email: true }).partial().extend({
  active: z.boolean().optional(),
});
export type PatchMember = z.infer<typeof zPatchMember>;

export type MemberView = {
  id: string; name: string; email: string; role: string | null; active: boolean;
  createdAt: string; updatedAt: string;
};

export const zCreateTask = z.object({
  title: z.string().trim().min(1).max(300),
  detail: z.string().max(20_000).nullable().optional(),
  projectId: z.string().max(120).nullable().optional(),
  status: zTaskStatus.default("backlog"),
  priority: zPriority.default("sedang"),
  memberId: z.string().max(200).nullable().optional(),
  startDate: zIso.nullable().optional(),
  dueDate: zIso.nullable().optional(),
  order: z.number().finite().optional(),
});
export type CreateTask = z.infer<typeof zCreateTask>;

// `specId` TIDAK ada di sini maupun di patch: tautan ke backlog lahir dari eskalasi, bukan dari
// ketikan operator. CRUD yang bisa mengarangnya berarti kartu bisa mengaku tertaut pada Spec yang
// tak pernah menyetujuinya.
//
// `.partial()` juga MEMATIKAN default `status`/`priority` — dan itu yang diinginkan: PATCH yang tak
// menyebut sebuah field harus meninggalkannya utuh, bukan menulis ulang nilai bawaan di atasnya.
export const zPatchTask = zCreateTask.partial();
export type PatchTask = z.infer<typeof zPatchTask>;

/**
 * Cermin backlog, BACA-SAJA — dihitung saat baca lewat join `specId`, tak pernah ditulis balik.
 *
 * `stage` & `priority` sengaja `string`, bukan `zStage`/`zPriority`: keduanya kolom TEXT yang
 * menyeberang sync dari mesin yang boleh lebih baru (ADR-0087), jadi menyempitkannya di sini hanya
 * bisa dilakukan lewat cast — dan cast itu berbohong tentang nilai yang tak bisa kita buktikan
 * (pelajaran `runtimeOf`, ADR-0101). Ini muatan untuk dirender, bukan untuk dicabangi.
 */
export type TaskSpecMirror = { id: string; stage: string; priority: string };

export type TaskView = {
  id: string; projectId: string | null; title: string; detail: string | null;
  status: TaskStatus; priority: string; memberId: string | null;
  startDate: string | null; dueDate: string | null; order: number;
  /** Tetap terisi meski `spec` null — bedanya itulah yang membuat UI bisa merender "tautan putus". */
  specId: string | null;
  spec: TaskSpecMirror | null;
  createdAt: string; updatedAt: string;
};

// Tipe MASUKAN zod — bentuk yang dikirim pemanggil, bukan bentuk sesudah `.default()` diterapkan.
// Klien memakainya supaya `status`/`priority` tetap opsional dan tak ada cermin bentuk keempat;
// tipe-saja, jadi zod tak ikut terbundel ke frontend.
export type CreateTaskInput = z.input<typeof zCreateTask>;
export type PatchTaskInput = z.input<typeof zPatchTask>;
export type CreateMemberInput = z.input<typeof zCreateMember>;
export type PatchMemberInput = z.input<typeof zPatchMember>;
