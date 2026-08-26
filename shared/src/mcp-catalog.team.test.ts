// ADR-0157 · katalog domain `team` (papan Tim) + tool `GLOBAL_READ` (`system`). Yang diuji di sini
// bukan "tool-nya ada" — gerbang cakupan di server sudah menjaga itu — melainkan sifat yang hanya
// bisa salah DI KATALOG: bentuk permintaan yang dirakit `build()`, dan janji yang ditulis deskripsi.
import { describe, expect, it } from "vitest";
import { MCP_TOOLS, mcpToolsFor } from "./mcp";

const byName = (n: string) => MCP_TOOLS.find((t) => t.name === n)!;

describe("katalog papan Tim", () => {
  it("kesepuluh tool ada, dan dua penghapusan hanya muncul di tingkat danger", () => {
    const team = MCP_TOOLS.filter((t) => t.capability?.startsWith("team:"));
    expect(team.map((t) => t.name).sort()).toEqual([
      "hanoman_member_create", "hanoman_member_delete", "hanoman_member_update",
      "hanoman_members_list", "hanoman_task_create", "hanoman_task_delete",
      "hanoman_task_escalate", "hanoman_task_unlink", "hanoman_task_update",
      "hanoman_tasks_list",
    ]);
    const def = new Set(mcpToolsFor("default").map((t) => t.name));
    expect(def.has("hanoman_task_delete")).toBe(false);
    expect(def.has("hanoman_member_delete")).toBe(false);
    expect(def.has("hanoman_task_update")).toBe(true);
    const ro = new Set(mcpToolsFor("read-only").map((t) => t.name));
    expect([...ro].filter((n) => n.startsWith("hanoman_task") || n.startsWith("hanoman_member")).sort())
      .toEqual(["hanoman_members_list", "hanoman_tasks_list"]);
  });

  // Jebakan yang ditutup: `undefined` (jangan sentuh) vs `null` (kosongkan) adalah dua hal berbeda
  // di Prisma, dan tool yang meruntuhkannya jadi satu membuat "hapus tanggal jatuh tempo" mustahil
  // lewat MCP — persis kelas bug PATCH {status} yang diam-diam menghapus tanggal (routes/tasks.ts).
  it("field yang tak disebut TAK ADA di body; string kosong mengirim null", () => {
    const t = byName("hanoman_task_update");
    const only = t.build({ task: "t1", status: "doing" })!.body as Record<string, unknown>;
    expect(only).toEqual({ status: "doing" });
    expect("dueDate" in only).toBe(false);

    const cleared = t.build({ task: "t1", dueDate: "", member: "" })!.body as Record<string, unknown>;
    expect(cleared).toEqual({ dueDate: null, memberId: null });
  });

  it("nama argumen tool ≠ nama kolom server — pemetaannya dirakit build(), bukan diharapkan cocok", () => {
    const body = byName("hanoman_task_create").build({
      task: "x", title: "Desain landing", project: "hanoman", member: "a@b.id",
    })!.body as Record<string, unknown>;
    expect(body).toEqual({ title: "Desain landing", projectId: "hanoman", memberId: "a@b.id" });
  });

  it("daftar kartu memetakan filter ke query server, dan halaman ikut", () => {
    const r = byName("hanoman_tasks_list").build({ project: "hanoman", member: "a@b.id", page: 2, limit: 5 })!;
    expect(r.query).toEqual({ projectId: "hanoman", memberId: "a@b.id", page: "2", limit: "5" });
    expect(byName("hanoman_tasks_list").build({})!.query).toEqual({});
  });

  it("activeOnly=false MENGHILANGKAN parameternya — jebakan `active=false` yang diabaikan senyap", () => {
    const t = byName("hanoman_members_list");
    expect(t.build({ activeOnly: true })!.query).toEqual({ active: "true" });
    expect(t.build({ activeOnly: false })!.query?.active).toBeUndefined();
  });

  it("eskalasi memakai method+path yang benar dan menghormati default server", () => {
    const t = byName("hanoman_task_escalate");
    expect(t.build({ task: "t1" })).toMatchObject({ method: "POST", path: "/tasks/t1/escalate", body: {} });
    expect(t.build({ task: "t1", source: "qa", project: "hanoman" })!.body)
      .toEqual({ source: "qa", projectId: "hanoman" });
  });

  it("unlink dan hapus kartu berbagi id tapi BUKAN endpoint yang sama", () => {
    expect(byName("hanoman_task_unlink").build({ task: "t1" }))
      .toEqual({ method: "DELETE", path: "/tasks/t1/escalate" });
    expect(byName("hanoman_task_delete").build({ task: "t1" }))
      .toEqual({ method: "DELETE", path: "/tasks/t1" });
  });

  it("id anggota di-encode — email berisi karakter yang tak boleh mentah di path", () => {
    expect(byName("hanoman_member_update").build({ member: "a+b@x.id", name: "D" })!.path)
      .toBe("/members/a%2Bb%40x.id");
  });

  it("email tak bisa diubah lewat tool — parameternya memang tak ada", () => {
    expect(byName("hanoman_member_update").inputSchema.properties.email).toBeUndefined();
    expect(byName("hanoman_member_update").description).toMatch(/email/i);
  });

  // ADR-0150 keputusan 5: tautan backlog lahir HANYA dari eskalasi. Bila `specId` suatu saat bocor
  // ke skema create/update, kartu bisa mengaku tertaut pada Spec yang tak pernah menyetujuinya.
  it("specId tak pernah bisa dikarang lewat CRUD kartu", () => {
    for (const n of ["hanoman_task_create", "hanoman_task_update"]) {
      expect(Object.keys(byName(n).inputSchema.properties)).not.toContain("specId");
      expect(Object.keys(byName(n).inputSchema.properties)).not.toContain("spec");
    }
  });

  it("deskripsi menyebut bahwa status kartu BUKAN stage backlog", () => {
    expect(byName("hanoman_tasks_list").description).toMatch(/manusia/i);
    expect(byName("hanoman_task_update").inputSchema.properties.status?.description)
      .toMatch(/bukan `stage` backlog/i);
  });
});

describe("katalog GLOBAL_READ", () => {
  it("keempat tool ada, semuanya baca, dan tak satu pun menuntut capability", () => {
    const names = ["hanoman_limits", "hanoman_limits_codex", "hanoman_update_status", "hanoman_fs_browse"];
    for (const n of names) {
      const t = byName(n);
      expect(t.mode, n).toBe("read");
      expect(t.capability, n).toBeNull();
    }
    const ro = new Set(mcpToolsFor("read-only").map((t) => t.name));
    for (const n of names) expect(ro.has(n), n).toBe(true);
  });

  it("fs_browse tanpa path tak mengirim query kosong `path=`", () => {
    const t = byName("hanoman_fs_browse");
    expect(t.build({})).toEqual({ method: "GET", path: "/fs/browse" });
    expect(t.build({ path: "" })).toEqual({ method: "GET", path: "/fs/browse" });
    expect(t.build({ path: "/Users/x/code" })!.query).toEqual({ path: "/Users/x/code" });
  });

  // SPEC-405 · ADR-0088 · `/update` baca terjangkau siapa pun, `POST /update/apply` me-restart
  // instance. Tak boleh ada tool untuk yang kedua, di tingkat mana pun — termasuk `--danger`.
  it("tak ada tool yang memasang pembaruan", () => {
    expect(MCP_TOOLS.filter((t) => t.samplePath.startsWith("/update") && t.sampleMethod !== "GET"))
      .toHaveLength(0);
  });
});
