import { afterEach, describe, expect, it } from "vitest";
import { cookieOpts } from "../src/services/auth";

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

const req = (o: { protocol?: string; xfp?: string }) => ({
  protocol: o.protocol ?? "http",
  headers: o.xfp === undefined ? {} : { "x-forwarded-proto": o.xfp },
});

describe("cookie Secure (SPEC-884)", () => {
  it("http polos: tanpa Secure — login dari HP di LAN berhenti gagal senyap", () => {
    delete process.env.HANOMAN_HARDENING;
    expect(cookieOpts(req({})).secure).toBe(false);
  });

  it("https langsung: Secure", () => {
    expect(cookieOpts(req({ protocol: "https" })).secure).toBe(true);
  });

  // Cloudflare Tunnel / reverse proxy TANPA HANOMAN_TRUST_PROXY: Fastify tak memercayai header
  // ini, jadi `req.protocol` tetap "http". Kalau kita ikut `req.protocol` saja, instance yang HARI
  // INI dapat Secure dari NODE_ENV akan kehilangannya — regresi. Header dibaca langsung.
  it("x-forwarded-proto dipercaya walau trustProxy kosong", () => {
    expect(cookieOpts(req({ xfp: "https" })).secure).toBe(true);
    expect(cookieOpts(req({ xfp: "https,http" })).secure).toBe(true);
    expect(cookieOpts(req({ xfp: "http" })).secure).toBe(false);
  });

  it("hardening memaksa Secure apa pun skema request-nya", () => {
    process.env.HANOMAN_HARDENING = "1";
    expect(cookieOpts(req({})).secure).toBe(true);
  });

  it("atribut lain tak berubah", () => {
    expect(cookieOpts(req({}))).toMatchObject({ httpOnly: true, sameSite: "strict", path: "/" });
  });
});
