import { describe, it, expect } from "vitest";
import { sessionEventDir, sessionEventEnv } from "../src/services/pty";
import { sessionEventToken } from "../src/services/session-event-token";
import { loadIngressPolicy, controlHost } from "../src/services/ingress-policy";

describe("env event sesi", () => {
  it("selalu loopback dan http — tanpa DNS, tanpa TLS", () => {
    const e = sessionEventEnv("spec-909", { PORT: "9911" });
    expect(e.HANOMAN_EVENT_URL).toBe("http://127.0.0.1:9911/api/session-events");
    expect(e.HANOMAN_SESSION_ID).toBe("spec-909");
    expect(e.HANOMAN_EVENT_TOKEN).toBe(sessionEventToken("spec-909"));
    expect(e.HANOMAN_EVENT_DIR).toBe(sessionEventDir("spec-909", { PORT: "9911" }));
  });

  it("tanpa PORT jatuh ke 8787, cermin server.ts", () => {
    expect(sessionEventEnv("spec-909", {}).HANOMAN_EVENT_URL)
      .toBe("http://127.0.0.1:8787/api/session-events");
  });
  it("spool mengikuti HANOMAN_HOME efektif yang sama dengan server pemilik", () => {
    expect(sessionEventEnv("spec-909", { HANOMAN_HOME: "/tmp/hanoman-env-test" }).HANOMAN_EVENT_DIR)
      .toBe("/tmp/hanoman-env-test/session-events/spec-909");
  });

  it("tanpa split origin, header Host tak dikirim", () => {
    expect(sessionEventEnv("spec-909", {}).HANOMAN_EVENT_HOST).toBeUndefined();
  });

  it("dengan split origin, membawa host control — gerbang ingress menolak Host loopback", () => {
    const e = sessionEventEnv("spec-909", {
      HANOMAN_CONTROL_ORIGINS: "https://hm.example.com",
      HANOMAN_PUBLIC_ORIGINS: "https://pub.example.com",
    });
    expect(e.HANOMAN_EVENT_HOST).toBe("hm.example.com");
  });

  it("controlHost mengembalikan null saat gerbang ingress mati", () => {
    expect(controlHost(loadIngressPolicy({}))).toBeNull();
  });
});
