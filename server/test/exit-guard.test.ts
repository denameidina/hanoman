import { describe, it, expect, vi } from "vitest";
import { spawn } from "node:child_process";
import { EXIT_INTENT_FILE, parseExitIntent } from "@hanoman/shared";
import { exitGuarded, launchWatchdog, watchdogScript } from "../src/services/exit-guard";

// ADR-0227 · server 0.9.30 yang hidup 8 jam memanggil process.exit(0) lalu diam selamanya di
// uv__threadpool_cleanup → pthread_join. Timer JS tak bisa menolong; hanya SIGKILL dari luar.
describe("exitGuarded", () => {
  it("menulis maksud keluar dan menitipkan watchdog SEBELUM exit", () => {
    const order: string[] = [];
    let intentPath = "", intentText = "", script = "";
    exitGuarded(75, {
      pid: 4242, home: "/h",
      writeIntent: (p, t) => { order.push("intent"); intentPath = p; intentText = t; },
      launch: (s) => { order.push("watchdog"); script = s; },
      exit: (c) => { order.push(`exit ${c}`); },
    });
    expect(order).toEqual(["intent", "watchdog", "exit 75"]);
    expect(intentPath).toBe(`/h/${EXIT_INTENT_FILE}`);
    expect(parseExitIntent(intentText)).toEqual({ pid: 4242, code: 75 });
    expect(script).toContain("kill -9 4242");
  });

  it("menulis maksud gagal / spawn gagal: tetap exit", () => {
    const exit = vi.fn();
    exitGuarded(0, {
      pid: 1, home: "/h",
      writeIntent: () => { throw new Error("EACCES"); },
      launch: () => { throw new Error("EAGAIN"); },
      exit,
    });
    expect(exit).toHaveBeenCalledWith(0);
  });

  // Di bawah vitest process.exit dicegat dan tak pernah mengakhiri worker — watchdog sungguhan
  // akan meng-SIGKILL worker vitest beberapa detik kemudian.
  it("launcher bawaan menolak jalan di bawah vitest", () => {
    expect(launchWatchdog("exit 0", { VITEST: "true" })).toBe(false);
  });
});

describe("watchdogScript", () => {
  const runSh = (script: string) => new Promise<number | null>((res) => {
    spawn("/bin/sh", ["-c", script], { stdio: "ignore" }).on("exit", (code) => res(code));
  });

  it("proses yang macet dibunuh SIGKILL sesudah tenggat", async () => {
    // `while(true){}` meniru proses yang tak pernah keluar sendiri, termasuk mengabaikan SIGTERM.
    const hung = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{}); while(true){}"], { stdio: "ignore" });
    const died = new Promise<NodeJS.Signals | null>((res) => hung.on("exit", (_c, sig) => res(sig)));
    const t0 = Date.now();
    await runSh(watchdogScript(hung.pid!, 1_000));
    expect(await died).toBe("SIGKILL");
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
  }, 15_000);

  it("proses yang sudah keluar normal: tak membunuh apa pun", async () => {
    const quick = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 100)"], { stdio: "ignore" });
    const exited = new Promise<number | null>((res) => quick.on("exit", (c) => res(c)));
    const watchdog = runSh(watchdogScript(quick.pid!, 1_000));
    expect(await exited).toBe(0);
    // Status non-nol = cabang `kill` tak pernah dijalankan (pemeriksaan waktu-mulai gagal).
    expect(await watchdog).not.toBe(0);
  }, 15_000);
});
