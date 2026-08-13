import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { prisma } from "../src/db";
import { startSpecSession, LaunchError, sessionIdForSpec } from "../src/services/session-launch";
import { killAll, killSession } from "../src/services/pty";
import { DEFAULT_SETTING } from "../src/services/settings";
import { resolveGoalCondition } from "@hanoman/runner";

const clean = async () => {
  killAll();
  await prisma.setting.deleteMany();
  await prisma.spec.deleteMany(); await prisma.project.deleteMany(); await prisma.localBinding.deleteMany();
};
beforeEach(clean); afterAll(clean);

describe("session-launch", () => {
  it("sessionIdForSpec sanitizes to tmux-safe id", () => {
    expect(sessionIdForSpec("SPEC-12")).toBe("spec-12");
  });
  it("throws LaunchError needs-bind when the project has no local checkout", async () => {
    await prisma.project.create({ data: { id: "p1", name: "P1", desc: "", kind: "existing" } }); // repoDir null
    const spec = await prisma.spec.create({ data: { id: "SPEC-1", projectId: "p1", title: "t", source: "brief", stage: "planned", author: "a", priority: "sedang", objective: "" } });
    await expect(startSpecSession(spec, { flow: "feature" })).rejects.toMatchObject({ kind: "needs-bind" });
    expect((await prisma.spec.findUnique({ where: { id: "SPEC-1" } }))!.baseSha).toBeNull(); // tak menyentuh baseSha
  });

  // SPEC-332 · ADR-0073 · resolusi mode goal: override per sesi → template global → default bawaan.
  // Bukti diambil dari argv pane tmux — di situlah `--settings` (berisi hook Stop) benar-benar ada.
  async function seedRepo(id: string) {
    const dir = mkdtempSync(join(tmpdir(), "hanoman-goal-"));
    const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
    execFileSync("git", ["init", "-q", dir]);
    execFileSync("git", ["-C", dir, "commit", "-q", "--allow-empty", "-m", "root"], { env });
    await prisma.project.upsert({
      where: { id: "pg" },
      update: { repoDir: dir },
      create: { id: "pg", name: "PG", desc: "", kind: "existing", repoDir: dir },
    });
    return prisma.spec.create({ data: { id, projectId: "pg", title: "t", source: "brief", stage: "planned", author: "a", priority: "sedang", objective: "o" } });
  }
  // `#{pane_start_command}` DIPOTONG tmux ("…") untuk argv panjang — kondisi goal bawaan jauh
  // melewatinya. Baca layar pane-nya saja: HANOMAN_CLAUDE_BIN=/bin/echo mencetak argv utuh, dan
  // `remain-on-exit` menahan pane mati tetap terbaca (pola yang sama dipakai pty.attach).
  const argvOf = async (id: string): Promise<string> => {
    const read = () => execFileSync("tmux", ["-L", process.env.HANOMAN_TMUX_SOCKET ?? "hanoman",
      "-f", "/dev/null", "capture-pane", "-p", "-J", "-S", "-2000", "-t", "hanoman-" + id],
      { encoding: "utf8" }).replace(/\s+/g, " ").trim();
    for (let i = 0; i < 100 && !read(); i++) await new Promise((r) => setTimeout(r, 20));
    return read();
  };
  // Baris Setting harus LENGKAP: `zSetting` mewajibkan autoDefault/autoScaffold/notifyFail (tanpa
  // .default()), jadi objek parsial gagal parse dan getSetting diam-diam jatuh ke DEFAULT_SETTING.
  const setGoal = (goal: { enabled: boolean; condition: string }) => {
    const data = { ...DEFAULT_SETTING, goal } as unknown as object;
    return prisma.setting.upsert({ where: { id: 1 }, update: { data }, create: { id: 1, data } });
  };

  // SPEC-408 · ADR-0090 · "dikerjakan" = sesi pertama lahir. Titiknya sama dengan baseSha:
  // satu tulisan, satu makna. Bukti diambil dari DB, bukan dari bentuk respons.
  it("sesi pertama menulis startedAt bersama baseSha (SPEC-408)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const spec = await seedRepo("SPEC-408A");
    expect(spec.startedAt).toBeNull();
    const before = Date.now();
    const r = await startSpecSession(spec, { flow: "feature" });
    const row = await prisma.spec.findUnique({ where: { id: "SPEC-408A" } });
    expect(row!.baseSha).toBeTruthy();
    expect(row!.startedAt).toBeInstanceOf(Date);
    expect(row!.startedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    killSession(r.id);
  });

  it("Setting.goal mati & tanpa override → sesi lahir tanpa hook Stop", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const spec = await seedRepo("SPEC-G1");
    const r = await startSpecSession(spec, { flow: "feature" });
    expect(await argvOf(r.id)).not.toContain('"type":"prompt"');
    killSession(r.id);
  });

  it("goal:true memakai template global; goalCondition per sesi menang atasnya", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    await setGoal({ enabled: false, condition: "TEMPLATE-GLOBAL" });
    const spec = await seedRepo("SPEC-G2");
    const r = await startSpecSession(spec, { flow: "feature", goal: true });
    expect(await argvOf(r.id)).toContain("TEMPLATE-GLOBAL");
    killSession(r.id);

    const spec2 = await seedRepo("SPEC-G3");
    const r2 = await startSpecSession(spec2, { flow: "feature", goal: true, goalCondition: "KONDISI-SESI" });
    const argv = await argvOf(r2.id);
    expect(argv).toContain("KONDISI-SESI");
    expect(argv).not.toContain("TEMPLATE-GLOBAL");
    killSession(r2.id);
  });

  it("Setting.goal menyala → sesi tanpa override tetap membawa hook Stop (jalur scheduler)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    await setGoal({ enabled: true, condition: "" });
    const spec = await seedRepo("SPEC-G5");
    const r = await startSpecSession(spec, { flow: "feature" });   // governor memanggil persis begini
    const argv = await argvOf(r.id);
    expect(argv).toContain('"type":"prompt"');
    expect(argv).toContain("Sesi backlog hanoman SPEC-G5");         // kondisi DoD bawaan
    killSession(r.id);
  });

  it("goal:false mengalahkan Setting global yang menyala", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    await setGoal({ enabled: true, condition: "" });
    const spec = await seedRepo("SPEC-G4");
    const r = await startSpecSession(spec, { flow: "feature", goal: false });
    expect(await argvOf(r.id)).not.toContain('"type":"prompt"');
    killSession(r.id);
  });

  it("kondisi default menyebut branch sesi", () => {
    expect(resolveGoalCondition({ flow: "feature", specId: "SPEC-G6", branchTo: "hanoman/spec-g6" }))
      .toContain("hanoman/spec-g6");
  });

  // SPEC-338 · ADR-0074 · agen per sesi & default global. Bukti dari argv pane, sama seperti
  // mode goal di atas — di situlah pilihan agen benar-benar mewujud.
  const setSetting = (patch: object) => {
    const data = { ...DEFAULT_SETTING, ...patch } as unknown as object;
    return prisma.setting.upsert({ where: { id: 1 }, update: { data }, create: { id: 1, data } });
  };

  it("opts.agent codex melahirkan sesi codex dengan flag codex", async () => {
    process.env.HANOMAN_CODEX_BIN = "/bin/echo";
    // SPEC-339 · slug dari katalog yang masih hidup: `gpt-5.4` kini diremap ke gpt-5.5 saat dibaca.
    await setSetting({ codex: { model: "gpt-5.6-terra", effort: "high" } });
    const spec = await seedRepo("SPEC-A1");
    const r = await startSpecSession(spec, { flow: "feature", agent: "codex" });
    const argv = await argvOf(r.id);
    expect(argv).toContain("-m gpt-5.6-terra");
    expect(argv).toContain('model_reasoning_effort="high"');
    expect(argv).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(argv).not.toContain("--dangerously-skip-permissions");
    killSession(r.id);
  });

  it("tanpa opts.agent memakai Setting.agent (jalur scheduler)", async () => {
    process.env.HANOMAN_CODEX_BIN = "/bin/echo";
    await setSetting({ agent: "codex" });
    const spec = await seedRepo("SPEC-A2");
    const r = await startSpecSession(spec, { flow: "feature" });   // governor memanggil persis begini
    expect(await argvOf(r.id)).toContain("--dangerously-bypass-approvals-and-sandbox");
    killSession(r.id);
  });

  it("override model per sesi menang atas default agen", async () => {
    process.env.HANOMAN_CODEX_BIN = "/bin/echo";
    await setSetting({ agent: "codex" });
    const spec = await seedRepo("SPEC-A3");
    const r = await startSpecSession(spec, { flow: "feature", model: "gpt-5.4-mini" });
    expect(await argvOf(r.id)).toContain("-m gpt-5.4-mini");
    killSession(r.id);
  });

  // SPEC-376 · ADR-0080 · scope verifikasi. Env sesi dipasang sebagai PREFIX shell di depan argv
  // (`K=V … claude …`), jadi ia TIDAK ikut tercetak oleh /bin/echo yang hanya melihat argv-nya
  // sendiri. Satu-satunya bukti jujur adalah membacanya dari DALAM proses — itulah gunanya
  // fixtures/fake-agent-env.sh (pola SPEC-337 untuk kunci audit lintas).
  it("sesi lahir membawa env HANOMAN_BASE_SHA & HANOMAN_VERIFY_SCOPE, default changed", async () => {
    process.env.HANOMAN_CLAUDE_BIN = resolve(import.meta.dirname, "fixtures/fake-agent-env.sh");
    const spec = await seedRepo("SPEC-V1");
    const r = await startSpecSession(spec, { flow: "feature" });
    const pane = await argvOf(r.id);
    const row = await prisma.spec.findUnique({ where: { id: "SPEC-V1" } });
    expect(row!.baseSha).toBeTruthy();
    expect(pane).toContain("Scope verifikasi");                     // klausa masuk ke prompt
    expect(pane).toContain(`HANOMAN_BASE_SHA=${row!.baseSha}`);     // = commit lahirnya worktree
    expect(pane).toContain("HANOMAN_VERIFY_SCOPE=changed");         // default global
    killSession(r.id);
  });

  it("Setting.verifyScope full → sesi tanpa override tak membawa klausa (jalur scheduler)", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    await setSetting({ verifyScope: "full" });
    const spec = await seedRepo("SPEC-V2");
    const r = await startSpecSession(spec, { flow: "feature" });   // governor memanggil persis begini
    expect(await argvOf(r.id)).not.toContain("Scope verifikasi");
    killSession(r.id);
  });

  it("override per sesi menang atas Setting global", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    await setSetting({ verifyScope: "full" });
    const spec = await seedRepo("SPEC-V3");
    const r = await startSpecSession(spec, { flow: "feature", verifyScope: "changed" });
    expect(await argvOf(r.id)).toContain("Scope verifikasi");
    killSession(r.id);
  });

  // SPEC-734 · ADR-0113 · metode workflow. Bukti dari argv pane, sama seperti mode goal & agen —
  // di situlah prompt benar-benar mewujud. `argvOf` meratakan whitespace, jadi cocokkan potongan
  // yang memang berspasi tunggal.
  const withPayload = async (id: string, payload: object) => {
    const spec = await seedRepo(id);
    return prisma.spec.update({ where: { id: spec.id }, data: { payload } });
  };

  // AC-2 · tanpa method eksplisit, sesi memakai Setting.method.
  it("AC-2 · sesi lahir memakai Setting.method", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    await setSetting({ method: "matt" });
    const spec = await seedRepo("SPEC-800");
    const r = await startSpecSession(spec, { flow: "feature" });
    expect(await argvOf(r.id)).toContain("mattpocock-skills:grilling");
    killSession(r.id);
  });

  // Baris Setting yang belum punya kunci itu → "superpowers" (bukan undefined).
  it("AC-2 · tanpa baris Setting sama sekali → superpowers", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    const spec = await seedRepo("SPEC-801");
    const r = await startSpecSession(spec, { flow: "feature" });
    expect(await argvOf(r.id)).toContain("superpowers:brainstorming");
    killSession(r.id);
  });

  // AC-5 · metode sesi PERTAMA dicatat di payload, tanpa merusak field payload lain.
  it("AC-5 · metode dicatat di Spec.payload.method saat sesi pertama lahir", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    await setSetting({ method: "matt" });
    const spec = await withPayload("SPEC-802", { context: "c", outcome: "o" });
    const r = await startSpecSession(spec, { flow: "feature" });
    const after = await prisma.spec.findUnique({ where: { id: "SPEC-802" } });
    const p = after!.payload as Record<string, unknown>;
    expect(p.method).toBe("matt");
    expect(p.context).toBe("c");
    expect(p.outcome).toBe("o");
    killSession(r.id);
  });

  // …dan nilai tercatat itu MENANG atas Setting yang sudah berubah sesudahnya.
  it("AC-5 · peluncuran berikutnya memakai metode tercatat, bukan Setting yang baru", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    await setSetting({ method: "superpowers" });
    const spec = await withPayload("SPEC-803", { method: "matt", context: "c", outcome: "o" });
    const r = await startSpecSession(spec, { flow: "feature" });
    expect(await argvOf(r.id)).toContain("mattpocock-skills:grilling");
    killSession(r.id);
  });

  it("opts.method menang atas payload maupun Setting", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    await setSetting({ method: "matt" });
    const spec = await withPayload("SPEC-804", { method: "matt", context: "c", outcome: "o" });
    const r = await startSpecSession(spec, { flow: "feature", method: "superpowers" });
    expect(await argvOf(r.id)).toContain("superpowers:brainstorming");
    killSession(r.id);
  });

  // AC-9 · id yang tak dikenal tak boleh melempar; ia jatuh ke default.
  it("AC-9 · Setting.method tak dikenal jatuh ke superpowers tanpa melempar", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    await setSetting({ method: "tak-ada-metode-ini" });
    const spec = await seedRepo("SPEC-805");
    const r = await startSpecSession(spec, { flow: "feature" });
    expect(await argvOf(r.id)).toContain("superpowers:brainstorming");
    killSession(r.id);
  });

  it("Setting.agent codex tak menyeret sesi claude eksplisit", async () => {
    process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
    await setSetting({ agent: "codex" });
    const spec = await seedRepo("SPEC-A4");
    const r = await startSpecSession(spec, { flow: "feature", agent: "claude" });
    const argv = await argvOf(r.id);
    expect(argv).toContain("--dangerously-skip-permissions");
    expect(argv).toContain("--model claude-opus-5");   // kembali ke blok model claude
    killSession(r.id);
  });

  // SPEC-407 · ADR-0089 · backlog goal SELALU bermode goal — itulah yang membedakan source ini dari
  // brief. Bukti diambil dari argv pane tmux, tempat `--settings` (berisi hook Stop) benar-benar ada.
  describe("session-launch · flow goal (SPEC-407)", () => {
    const goalPayload = { goal: "p95 < 200 ms", done: "output benchmark < 200 ms", constraints: "", priority: "tinggi" };

    const seedRepoGoal = async (id: string) => {
      const spec = await seedRepo(id);
      return prisma.spec.update({
        where: { id: spec.id },
        data: { source: "goal", payload: goalPayload, objective: goalPayload.goal },
      });
    };

    it("mode goal menyala walau opts.goal false dan Setting global mati", async () => {
      process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
      await setGoal({ enabled: false, condition: "" });
      const spec = await seedRepoGoal("SPEC-GG1");
      const r = await startSpecSession(spec, { flow: "goal", goal: false });
      const argv = await argvOf(r.id);
      expect(argv).toContain('"type":"prompt"');
      expect(argv).toContain("p95 < 200 ms");
      killSession(r.id);
    });

    it("template global TIDAK menimpa goal item", async () => {
      process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
      await setGoal({ enabled: true, condition: "TEMPLATE-GLOBAL" });
      const spec = await seedRepoGoal("SPEC-GG2");
      const r = await startSpecSession(spec, { flow: "goal" });
      const argv = await argvOf(r.id);
      expect(argv).not.toContain("TEMPLATE-GLOBAL");
      expect(argv).toContain("output benchmark < 200 ms");
      killSession(r.id);
    });

    it("override per-sesi tetap menang", async () => {
      process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
      await setGoal({ enabled: false, condition: "" });
      const spec = await seedRepoGoal("SPEC-GG3");
      const r = await startSpecSession(spec, { flow: "goal", goalCondition: "KONDISI-SESI" });
      expect(await argvOf(r.id)).toContain("KONDISI-SESI");
      killSession(r.id);
    });

    it("prompt-nya prompt goal, bukan pipeline perencanaan", async () => {
      process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
      await setGoal({ enabled: false, condition: "" });
      const spec = await seedRepoGoal("SPEC-GG4");
      const r = await startSpecSession(spec, { flow: "goal" });
      const argv = await argvOf(r.id);
      expect(argv).toContain("Kerjakan fase berurutan: Goal → Verifikasi");
      expect(argv).not.toContain("Kerjakan fase berurutan: Brainstorm");
      killSession(r.id);
    });
  });
  // SPEC-447 · ADR-0093 · titik cekik peluncuran adalah tempat gerbang dependency berdiri:
  // route manual DAN governor scheduler sama-sama lewat sini.
  describe("gerbang dependency (SPEC-447)", () => {
    it("menolak meluncurkan selagi dependency belum selesai — worktree tak pernah dibuat", async () => {
      process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
      await seedRepo("SPEC-447A");                        // dependency, stage planned
      await seedRepo("SPEC-447B");
      await prisma.spec.update({ where: { id: "SPEC-447B" }, data: { dependsOn: ["SPEC-447A"] } });
      const spec = (await prisma.spec.findUnique({ where: { id: "SPEC-447B" } }))!;
      await expect(startSpecSession(spec, { flow: "feature" })).rejects.toMatchObject({ kind: "blocked" });
      const row = (await prisma.spec.findUnique({ where: { id: "SPEC-447B" } }))!;
      expect(row.baseSha).toBeNull();                     // tak menyentuh worktree/stempel
      expect(row.startedAt).toBeNull();
    });

    it("membawa daftar pemblokir di error, bukan hanya pesan", async () => {
      process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
      await seedRepo("SPEC-447C");
      await seedRepo("SPEC-447D");
      await prisma.spec.update({ where: { id: "SPEC-447D" }, data: { dependsOn: ["SPEC-447C"] } });
      const spec = (await prisma.spec.findUnique({ where: { id: "SPEC-447D" } }))!;
      const err = await startSpecSession(spec, { flow: "feature" }).catch((e) => e as LaunchError);
      expect((err as LaunchError).blockers).toEqual([{ id: "SPEC-447C", reason: "unfinished" }]);
    });

    it("force melewati gerbang — manusia yang terakhir memutuskan", async () => {
      process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
      await seedRepo("SPEC-447E");
      await seedRepo("SPEC-447F");
      await prisma.spec.update({ where: { id: "SPEC-447F" }, data: { dependsOn: ["SPEC-447E"] } });
      const spec = (await prisma.spec.findUnique({ where: { id: "SPEC-447F" } }))!;
      const r = await startSpecSession(spec, { flow: "feature", force: true });
      expect(r.id).toBe("spec-447f");
      killSession(r.id);
    });

    it("dependency done tanpa headSha tak memblokir apa pun", async () => {
      process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
      await seedRepo("SPEC-447G");
      await prisma.spec.update({ where: { id: "SPEC-447G" }, data: { stage: "done" } });
      await seedRepo("SPEC-447H");
      await prisma.spec.update({ where: { id: "SPEC-447H" }, data: { dependsOn: ["SPEC-447G"] } });
      const spec = (await prisma.spec.findUnique({ where: { id: "SPEC-447H" } }))!;
      const r = await startSpecSession(spec, { flow: "feature" });
      expect(r.id).toBe("spec-447h");
      killSession(r.id);
    });
  });

  // SPEC-543 · ADR-0108 · klausa gaya kode. Bukti diambil dari PANE, bukan dari builder prompt:
  // yang dikhawatirkan spec ini justru call site yang LUPA memanggil builder-nya, dan assertion
  // atas `startPrompt()` tak bisa melihat itu. Prompt sesi diserahkan sebagai argumen positional
  // agen (SPEC-223), jadi `/bin/echo` sebagai biner agen mencetak seluruh prompt apa adanya.
  describe("klausa gaya kode sampai ke proses agen (SPEC-543)", () => {
    const MARK = "Gaya kode";

    it("sesi backlog claude membawanya di argv", async () => {
      process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
      const spec = await seedRepo("SPEC-543A");
      const r = await startSpecSession(spec, { flow: "feature" });
      const pane = await argvOf(r.id);
      expect(pane).toContain(MARK);
      expect(pane).toContain("mengulang");            // butir "jangan mengulang apa yang sudah dinyatakan kode"
      killSession(r.id);
    });

    it("sesi backlog codex membawanya juga (klausa netral-agen)", async () => {
      process.env.HANOMAN_CODEX_BIN = "/bin/echo";
      await setSetting({ agent: "codex" });
      const spec = await seedRepo("SPEC-543B");
      const r = await startSpecSession(spec, { flow: "feature" });
      expect(await argvOf(r.id)).toContain(MARK);
      killSession(r.id);
    });

    // Tak ber-knob (ADR-0108 keputusan 4): `verifyScope: "full"` mematikan klausa scope, bukan ini.
    it("verifyScope full tetap membawanya", async () => {
      process.env.HANOMAN_CLAUDE_BIN = "/bin/echo";
      await setSetting({ verifyScope: "full" });
      const spec = await seedRepo("SPEC-543C");
      const r = await startSpecSession(spec, { flow: "feature" });
      const pane = await argvOf(r.id);
      expect(pane).not.toContain("Scope verifikasi");
      expect(pane).toContain(MARK);
      killSession(r.id);
    });
  });
});
