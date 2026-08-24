import { describe, it, expect, afterEach } from "vitest";
import { attach, detach, __reset } from "../src/services/events";
import type { Client } from "../src/services/pty";

/* SPEC-919 · ADR-0147 · `presence` memaparkan peta pekerjaan lintas mesin, dan
   `capabilityForRoute` menyatakannya COOKIE_ONLY. Kanal `/events/ws` sendiri dipetakan
   GLOBAL_READ bagi agent token, jadi tanpa gerbang grup ini pernyataan itu bocor lewat pintu
   kedua. Yang menahannya hari ini — `POST /ws-tickets` jatuh ke default cookie-only — adalah
   KETIADAAN entri di sebuah peta, bukan keputusan; test ini mengikat keputusannya. */

function fakeClient(): Client & { frames: { t: string }[] } {
  const frames: { t: string }[] = [];
  return {
    frames,
    send: (m: string) => { frames.push(JSON.parse(m)); },
    close: () => {},
  } as Client & { frames: { t: string }[] };
}

afterEach(() => { __reset(); });

describe("gerbang grup presence di /events/ws", () => {
  it("principal cookie menerima snapshot presence", async () => {
    const c = fakeClient();
    await attach(c);
    expect(c.frames.some((f) => f.t === "presence")).toBe(true);
    detach(c);
  });

  it("principal yang tak boleh berlangganan TIDAK menerima presence, tapi tetap menerima grup lain", async () => {
    const c = fakeClient();
    await attach(c, { maySubscribe: false });
    expect(c.frames.some((f) => f.t === "presence")).toBe(false);
    expect(c.frames.some((f) => f.t === "sessions")).toBe(true);
    detach(c);
  });
});
