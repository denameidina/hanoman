import { describe, it, expect } from "vitest";
import { memberId, zCreateMember, zPatchMember, zCreateTask, zPatchTask, zEscalateTask, TASK_STATUSES } from "./team";

describe("SPEC-945 · memberId deterministik", () => {
  it("menormalkan kapitalisasi & spasi tepi", () => {
    expect(memberId("  Dena@Nafanesia.ID ")).toBe("dena@nafanesia.id");
  });
  it("dua ejaan email yang sama menghasilkan id yang sama", () => {
    expect(memberId("A@B.id")).toBe(memberId("a@b.id "));
  });
});

describe("zCreateMember", () => {
  it("menerima nama, email, role opsional", () => {
    const r = zCreateMember.safeParse({ name: "Dena", email: " Dena@X.id " });
    expect(r.success).toBe(true);
    expect(r.success && r.data.email).toBe("Dena@X.id");   // trim, TANPA lowercase — id yang menormalkan
  });
  it("menolak email cacat", () => {
    expect(zCreateMember.safeParse({ name: "D", email: "bukan-email" }).success).toBe(false);
  });
  it("menolak nama kosong", () => {
    expect(zCreateMember.safeParse({ name: "  ", email: "a@b.id" }).success).toBe(false);
  });
});

describe("zPatchMember", () => {
  // ADR-0094 keputusan 2 · id diturunkan dari email; rename yang mengubah id meninggalkan baris
  // yatim di setiap mesin lain. Lapis kedua (penolakan eksplisit di route) diuji di route test.
  it("TIDAK punya field email — ganti email = hapus + buat baru", () => {
    const r = zPatchMember.safeParse({ email: "baru@x.id" });
    expect(r.success).toBe(true);
    expect(r.success && "email" in r.data).toBe(false);
  });
  it("semua field opsional", () => {
    expect(zPatchMember.safeParse({}).success).toBe(true);
    expect(zPatchMember.safeParse({ name: "D", role: null, active: false }).success).toBe(true);
  });
});

describe("zCreateTask", () => {
  it("hanya title yang wajib; status default backlog", () => {
    const r = zCreateTask.safeParse({ title: "Desain landing" });
    expect(r.success).toBe(true);
    expect(r.success && r.data.status).toBe("backlog");
    expect(r.success && r.data.priority).toBe("sedang");
  });
  it("empat kolom papan, tak lebih", () => {
    expect(TASK_STATUSES).toEqual(["backlog", "doing", "review", "done"]);
    expect(zCreateTask.safeParse({ title: "x", status: "executing" }).success).toBe(false);
  });
  it("tanggal diterima sebagai ISO string", () => {
    expect(zCreateTask.safeParse({ title: "x", startDate: "2026-09-01T00:00:00.000Z" }).success).toBe(true);
  });
  it("menolak tanggal yang bukan tanggal", () => {
    expect(zCreateTask.safeParse({ title: "x", dueDate: "besok" }).success).toBe(false);
  });
  // specId TIDAK bisa diset lewat CRUD: tautan itu lahir dari eskalasi, bukan ketikan.
  it("specId bukan field yang bisa ditulis", () => {
    const r = zCreateTask.safeParse({ title: "x", specId: "SPEC-1" });
    expect(r.success && "specId" in r.data).toBe(false);
  });
});

describe("zPatchTask", () => {
  it("semua field opsional, termasuk status & order untuk drop kanban", () => {
    expect(zPatchTask.safeParse({ status: "doing", order: 1.5 }).success).toBe(true);
    expect(zPatchTask.safeParse({}).success).toBe(true);
  });
  it("TIDAK menyuntikkan default — field yang tak dikirim tetap absen", () => {
    const r = zPatchTask.safeParse({ title: "x" });
    expect(r.success && r.data.status).toBeUndefined();
    expect(r.success && r.data.priority).toBeUndefined();
  });
  it("memberId & projectId boleh dikosongkan eksplisit", () => {
    expect(zPatchTask.safeParse({ memberId: null, projectId: null }).success).toBe(true);
  });
});

describe("zEscalateTask", () => {
  it("default brief + sedang; body kosong sah", () => {
    const r = zEscalateTask.safeParse({});
    expect(r.success).toBe(true);
    expect(r.success && r.data).toMatchObject({ source: "brief", priority: "sedang" });
  });

  // Enum EKSPLISIT tiga: `goal`/`no_effort` butuh bentuk payload `goal` (goal + done) yang hanya
  // operator bisa tulis, dan `help` menjanjikan asal-usul Help Center yang bukan ini.
  it("menolak source di luar tiga", () => {
    for (const s of ["goal", "no_effort", "help", "apa saja"])
      expect(zEscalateTask.safeParse({ source: s }).success).toBe(false);
  });

  it("menerima ketiga source yang sah", () => {
    for (const s of ["brief", "qa", "audit"])
      expect(zEscalateTask.safeParse({ source: s }).success).toBe(true);
  });

  it("menolak prioritas di luar kosakata zPriority", () => {
    expect(zEscalateTask.safeParse({ priority: "normal" }).success).toBe(false);
  });

  it("projectId opsional", () => {
    expect(zEscalateTask.safeParse({ projectId: "hanoman" }).success).toBe(true);
    expect(zEscalateTask.safeParse({}).success).toBe(true);
  });
});
