import { describe, it, expect, afterEach } from "vitest";
import { attach, detach, __reset, __tick } from "../src/services/events";
import { recordPresence, __resetPresence } from "../src/services/presence/registry";
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

afterEach(() => { __reset(); __resetPresence(); });

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

  /* Gerbangnya dibaca di DUA tempat — snapshot `attach` dan siar 3-detik — dan yang kedua justru
     yang terus mengalir sepanjang koneksi hidup. Menguji `attach` saja meninggalkan jalur utamanya
     tanpa satu pun pengunci. */
  it("siar berkala juga tak mengalir ke principal non-cookie", async () => {
    const cookie = fakeClient();
    const agen = fakeClient();
    await attach(cookie);
    await attach(agen, { maySubscribe: false });
    const sesudahAttach = { cookie: cookie.frames.length, agen: agen.frames.length };

    // Ubah isi registry supaya signature grup `presence` berubah → frame siar lahir.
    recordPresence("dev-siar", [{
      sessionId: "spec-919", projectId: "hanoman", agent: "claude",
      status: "working", startedAt: "2026-08-24T00:00:00.000Z",
    }]);
    for (let i = 0; i < 3; i++) await __tick();

    const baruCookie = cookie.frames.slice(sesudahAttach.cookie);
    const baruAgen = agen.frames.slice(sesudahAttach.agen);
    expect(baruCookie.some((f) => f.t === "presence")).toBe(true);
    expect(baruAgen.some((f) => f.t === "presence")).toBe(false);
    detach(cookie); detach(agen);
  });
});
