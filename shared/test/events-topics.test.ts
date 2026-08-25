import { describe, it, expect } from "vitest";
import { subKey, zTopicParams, zEventsClientMsg, MAX_SUBS, type EventTopic } from "../src/dto";

// SPEC-908 · kontrak langganan berparameter di /events/ws. `subKey` dihitung fungsi yang SAMA di
// server dan klien — kalau keduanya berselisih, frame terkirim tetapi tak pernah mendarat.

describe("SPEC-908 · kunci langganan", () => {
  it("stabil terhadap urutan kunci — dua tab berparameter sama harus berbagi satu entri", () => {
    const a = subKey("tickets", { page: 2, limit: 20, q: "bug" });
    const b = subKey("tickets", { q: "bug", limit: 20, page: 2 });
    expect(a).toBe(b);
  });

  it("membuang `undefined` — filter kosong dan filter absen adalah langganan yang SAMA", () => {
    expect(subKey("tickets", { page: 1, limit: 20, project: undefined }))
      .toBe(subKey("tickets", { page: 1, limit: 20 }));
  });

  it("beda parameter = beda kunci, dan beda topik = beda kunci", () => {
    expect(subKey("tickets", { page: 1 })).not.toBe(subKey("tickets", { page: 2 }));
    expect(subKey("tickets", { page: 1 })).not.toBe(subKey("lead", { page: 1 }));
  });
});

describe("SPEC-908 · skema parameter topik", () => {
  it("menolak kunci asing — `.strict()`, bukan diabaikan", () => {
    const r = zTopicParams.schedulerQueue.safeParse({ status: "queued", page: 1, limit: 10, evil: 1 });
    expect(r.success).toBe(false);
  });

  it("menjepit plafon: limit di atas batas ditolak (ADR-0107)", () => {
    expect(zTopicParams.tickets.safeParse({ page: 1, limit: 5000 }).success).toBe(false);
    expect(zTopicParams.tickets.safeParse({ page: 1, limit: 20 }).success).toBe(true);
  });

  it("git wajib punya projectId dan flag boolean yang eksplisit", () => {
    expect(zTopicParams.git.safeParse({ limit: 200, branch: "", showRemote: true, showTags: true }).success).toBe(false);
    expect(zTopicParams.git.safeParse({
      projectId: "p1", limit: 200, branch: "", showRemote: true, showTags: true,
    }).success).toBe(true);
  });

  it("menolak string yang terlalu panjang (permukaan masuk berbatas)", () => {
    expect(zTopicParams.tickets.safeParse({ page: 1, limit: 20, q: "x".repeat(201) }).success).toBe(false);
  });
});

describe("SPEC-908 · frame masuk", () => {
  it("menerima frame `sub` yang sah", () => {
    const r = zEventsClientMsg.safeParse({ t: "sub", subs: [{ topic: "tickets", params: { page: 1, limit: 20 } }] });
    expect(r.success).toBe(true);
  });

  it("menolak `subs` lebih dari MAX_SUBS", () => {
    const subs = Array.from({ length: MAX_SUBS + 1 }, () => ({ topic: "tickets", params: {} }));
    expect(zEventsClientMsg.safeParse({ t: "sub", subs }).success).toBe(false);
  });

  it("menolak frame dengan `t` lain — ini satu-satunya frame masuk yang ada", () => {
    expect(zEventsClientMsg.safeParse({ t: "write", d: "rm -rf /" }).success).toBe(false);
  });

  it("topik tak dikenal LOLOS parse — penyaringannya per-entri di server (ADR-0087)", () => {
    const r = zEventsClientMsg.safeParse({ t: "sub", subs: [{ topic: "masaDepan", params: {} }] });
    expect(r.success).toBe(true);
  });
});

describe("SPEC-908 · setiap topik punya skema", () => {
  it("kunci zTopicParams menutupi seluruh EventTopic", () => {
    // SPEC-945 · ADR-0150 · `tasks` = papan tim, topik berparameter (bukan grup global).
    const topics: EventTopic[] = ["schedulerState", "schedulerQueue", "tickets", "lead", "git", "tasks"];
    expect(Object.keys(zTopicParams).sort()).toEqual([...topics].sort());
  });
});
