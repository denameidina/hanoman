import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { capabilityForRoute } from "../src/services/agent-capabilities";
import {
  capturePane, createSession, interruptPane, killAll, killSession, sessionKind,
} from "../src/services/pty";

const app = buildApp({ requireAuth: false });
const ids: string[] = [];

const waitFor = async (predicate: () => boolean, ms = 5_000) => {
  const end = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > end) throw new Error("timeout menunggu pane");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

function rawEchoSession(id: string) {
  ids.push(id);
  return createSession("telegram:42", process.cwd(), {
    id,
    command: [process.execPath, "-e", [
      "process.stdin.setRawMode?.(true);",
      "process.stdin.resume();",
      "console.log('READY');",
      "process.stdin.on('data', b => console.log('HEX:' + b.toString('hex')));",
      "setInterval(() => {}, 1000);",
    ].join("")],
  });
}

beforeAll(async () => {
  killAll();
  await app.ready();
});
afterAll(async () => {
  for (const id of ids) killSession(id);
  await app.close();
});

describe("Telegram terminal controls (SPEC-476)", () => {
  it("classifies telegram operator sessions separately and never as restartable terminal", () => {
    expect(sessionKind({ id: "telegram-42" }, "telegram:42", "/tmp/operator")).toBe("telegram");
  });

  it("maps steer and interrupt endpoints to sessions:write", () => {
    expect(capabilityForRoute("POST", "/api/terminal/sessions/s-1/steer")).toBe("sessions:write");
    expect(capabilityForRoute("POST", "/api/terminal/sessions/s-1/interrupt")).toBe("sessions:write");
  });

  it("steers a live pane with validated text and does not accept blank input", async () => {
    const s = rawEchoSession("tg-steer");
    await waitFor(() => capturePane(s.id).includes("READY"));
    const ok = await app.inject({
      method: "POST", url: `/api/terminal/sessions/${s.id}/steer`, payload: { text: "cek migration" },
    });
    expect(ok.statusCode).toBe(202);
    await waitFor(() => capturePane(s.id).includes(Buffer.from("cek migration").toString("hex")));
    expect((await app.inject({
      method: "POST", url: `/api/terminal/sessions/${s.id}/steer`, payload: { text: "   " },
    })).statusCode).toBe(400);
  });

  it("interrupts only the addressed live pane with Escape", async () => {
    const s = rawEchoSession("tg-interrupt");
    await waitFor(() => capturePane(s.id).includes("READY"));
    expect(await interruptPane("missing-pane")).toBe(false);
    const result = await app.inject({ method: "POST", url: `/api/terminal/sessions/${s.id}/interrupt` });
    expect(result.statusCode).toBe(202);
    await waitFor(() => capturePane(s.id).includes("HEX:1b"));
  });

  it("PATCH rename: menyimpan nama kustom, menghapusnya bila kosong, 400 body cacat, 404 sesi tak ada", async () => {
    const s = rawEchoSession("tg-rename");
    await waitFor(() => capturePane(s.id).includes("READY"));
    expect(capabilityForRoute("PATCH", `/api/terminal/sessions/${s.id}`)).toBe("sessions:write");

    const ok = await app.inject({ method: "PATCH", url: `/api/terminal/sessions/${s.id}`, payload: { name: " Perbaiki login " } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ id: s.id, name: "Perbaiki login" });
    const list = await app.inject({ method: "GET", url: "/api/terminal/sessions" });
    expect((list.json() as Array<{ id: string; name?: string }>).find((x) => x.id === s.id)?.name).toBe("Perbaiki login");

    const cleared = await app.inject({ method: "PATCH", url: `/api/terminal/sessions/${s.id}`, payload: { name: "" } });
    expect(cleared.json()).toEqual({ id: s.id, name: null });

    expect((await app.inject({ method: "PATCH", url: `/api/terminal/sessions/${s.id}`, payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: "/api/terminal/sessions/tak-ada", payload: { name: "x" } })).statusCode).toBe(404);
  });
});
