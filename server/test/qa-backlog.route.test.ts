import { beforeEach, describe, expect, it } from "vitest";
import { zQaPayload } from "@hanoman/shared";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { readUpload } from "../src/services/uploads";
import { makeProject, resetDb } from "./factory";

const app = buildApp({ requireAuth: false });
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const tick = () => new Promise((r) => setTimeout(r, 5));
const R = (tail = "") => `/api/projects/p1/qa/reports${tail}`;
const call = (method: "POST" | "PATCH" | "DELETE" | "GET", url: string, payload?: unknown) =>
  app.inject({ method, url, ...(payload === undefined ? {} : { payload: payload as object }) });

function multipart(name: string, type: string, body: Buffer) {
  const b = "----qabacklog";
  return {
    payload: Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="files"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`), body, Buffer.from(`\r\n--${b}--\r\n`)]),
    headers: { "content-type": `multipart/form-data; boundary=${b}` },
  };
}

let rid = ""; let fid = "";
async function seed(findingBody: Record<string, unknown> = {}) {
  rid = (await call("POST", R(), { title: "Smoke 0.9", buildVersion: "0.9.12", environment: { os: "macOS", browser: "Chrome" } })).json().id;
  const c = (await call("POST", R(`/${rid}/cases`), { title: "Bayar" })).json().cases[0];
  const d = (await call("POST", R(`/${rid}/findings`), {
    title: "Tombol bayar mati", caseId: c.id, severity: "blocker", priority: "P1", area: "checkout",
    steps: ["buka keranjang", "klik bayar"], expected: "form bayar", actual: "tidak ada reaksi", ...findingBody,
  })).json();
  fid = d.findings[0].id;
}

beforeEach(async () => { await resetDb(); await makeProject({ id: "p1" }); await seed(); });

describe("POST /findings/:fid/backlog", () => {
  it("membuat backlog source qa dengan payload valid, pemetaan severity/prioritas, dan konteks QA", async () => {
    const res = await call("POST", R(`/${rid}/findings/${fid}/backlog`), {});
    expect(res.statusCode).toBe(201);
    const j = res.json();
    expect(j).toMatchObject({ created: true, spec: { stage: "brainstorming", priority: "tinggi" } });
    const spec = await prisma.spec.findUniqueOrThrow({ where: { id: j.spec.id } });
    expect(spec).toMatchObject({ source: "qa", projectId: "p1", title: "Tombol bayar mati", priority: "tinggi" });
    expect(spec.author).toMatch(/^QA · /);
    expect(spec.launchApprovedAt).toBeNull();                       // tanpa principal sessions:write
    const payload = zQaPayload.parse(spec.payload);                  // bentuknya sah untuk source qa
    expect(payload.severity).toBe("critical");                       // blocker → critical (lossy)
    expect(payload.steps).toBe("1. buka keranjang\n2. klik bayar");
    expect(payload.expected).toBe("form bayar");
    expect(payload.actual).toContain("tidak ada reaksi");
    expect(payload.actual).toMatch(/F-01/);                          // asal-usul
    expect(payload.actual).toMatch(/QA-001/);
    expect(payload.actual).toMatch(/blocker/);                       // severity QA asli tak hilang
    expect(payload.actual).toMatch(/P1/);
    expect(payload.actual).toMatch(/checkout/);
    expect(payload.actual).toMatch(/TC-01/);
    expect(payload.env).toContain("0.9.12");
    expect(payload.env).toContain("os=macOS");
    expect(spec.objective).toMatch(/Tombol bayar mati/);
    expect(spec.objective).toMatch(/QA-001/);
  });

  it("menandai temuan sent + backlogId; detail memuat cermin spec", async () => {
    const j = (await call("POST", R(`/${rid}/findings/${fid}/backlog`), {})).json();
    const f = j.report.findings[0];
    expect(f).toMatchObject({ status: "sent", backlogId: j.spec.id, spec: { id: j.spec.id, stage: "brainstorming" } });
    const again = (await call("GET", R(`/${rid}`))).json().findings[0];
    expect(again.spec.id).toBe(j.spec.id);
  });

  it("idempoten: panggilan kedua 200 created:false, tanpa backlog kedua", async () => {
    const a = await call("POST", R(`/${rid}/findings/${fid}/backlog`), {});
    const b = await call("POST", R(`/${rid}/findings/${fid}/backlog`), {});
    expect(b.statusCode).toBe(200);
    expect(b.json()).toMatchObject({ created: false, spec: { id: a.json().spec.id } });
    expect(await prisma.spec.count()).toBe(1);
  });

  it("tautan putus (backlog dihapus): spec dibuat ulang; cermin null saat putus", async () => {
    const a = (await call("POST", R(`/${rid}/findings/${fid}/backlog`), {})).json();
    await prisma.spec.delete({ where: { id: a.spec.id } });
    const broken = (await call("GET", R(`/${rid}`))).json().findings[0];
    expect(broken).toMatchObject({ backlogId: a.spec.id, spec: null });
    const b = await call("POST", R(`/${rid}/findings/${fid}/backlog`), {});
    expect(b.statusCode).toBe(201);
    expect(b.json().created).toBe(true);
    expect(b.json().report.findings[0].spec).not.toBeNull();
  });

  it("priority dapat ditimpa; P3 → rendah", async () => {
    expect((await call("POST", R(`/${rid}/findings/${fid}/backlog`), { priority: "rendah" })).json().spec.priority).toBe("rendah");
  });

  it("lampiran temuan DISALIN (storageKey baru) sebagai lampiran backlog; hapus sisi QA tak merusak sisi backlog", async () => {
    await app.inject({ method: "POST", url: R(`/${rid}/attachments?ownerType=finding&ownerId=${fid}`), ...multipart("layar.png", "image/png", PNG) });
    await app.inject({ method: "POST", url: R(`/${rid}/attachments?ownerType=report&ownerId=${rid}`), ...multipart("laporan.png", "image/png", PNG) });
    const j = (await call("POST", R(`/${rid}/findings/${fid}/backlog`), {})).json();
    expect(j.attachments).toEqual({ saved: 1, rejected: [] });      // hanya milik temuan, bukan milik laporan
    const sa = await prisma.specAttachment.findMany({ where: { specId: j.spec.id } });
    const qa = await prisma.qaAttachment.findFirstOrThrow({ where: { ownerType: "finding" } });
    expect(sa).toHaveLength(1);
    expect(sa[0]).toMatchObject({ filename: "layar.png", mimeType: "image/png", projectId: "p1" });
    expect(sa[0]!.storageKey).not.toBe(qa.storageKey);
    expect((await readUpload(sa[0]!.storageKey)).equals(await readUpload(qa.storageKey))).toBe(true);
    await call("DELETE", R(`/${rid}/attachments/${qa.id}`));
    expect((await readUpload(sa[0]!.storageKey)).length).toBeGreaterThan(0);
  });

  it("lampiran melebihi batas backlog ditolak per berkas, backlog tetap dibuat", async () => {
    for (let i = 0; i < 11; i++)
      await app.inject({ method: "POST", url: R(`/${rid}/attachments?ownerType=finding&ownerId=${fid}`), ...multipart(`l${i}.png`, "image/png", PNG) });
    const j = (await call("POST", R(`/${rid}/findings/${fid}/backlog`), {})).json();
    expect(j.created).toBe(true);
    expect(j.attachments.saved).toBe(10);
    expect(j.attachments.rejected).toEqual([{ filename: "l10.png", reason: "count" }]);
  });

  it("laporan closed TETAP boleh (pengecualian: hanya tautan yang berubah)", async () => {
    await call("PATCH", R(`/${rid}`), { status: "closed", verdict: "no-go" });
    const res = await call("POST", R(`/${rid}/findings/${fid}/backlog`), {});
    expect(res.statusCode).toBe(201);
    expect(res.json().report.status).toBe("closed");
    expect((await call("POST", R(`/${rid}/cases`), { title: "x" })).statusCode).toBe(409);   // sisanya tetap terkunci
  });

  it("404 temuan/laporan lain; 400 priority liar", async () => {
    expect((await call("POST", R(`/${rid}/findings/hantu/backlog`), {})).statusCode).toBe(404);
    expect((await call("POST", "/api/projects/p1/qa/reports/hantu/findings/x/backlog", {})).statusCode).toBe(404);
    expect((await call("POST", R(`/${rid}/findings/${fid}/backlog`), { priority: "urgent" })).statusCode).toBe(400);
  });
});

describe("POST /reports/:rid/backlog (massal)", () => {
  it("mengirim hanya temuan open; wontfix & yang sudah sent dilewati; hasil per temuan", async () => {
    await tick();
    const f2 = (await call("POST", R(`/${rid}/findings`), { title: "Kedua", severity: "minor", priority: "P3" })).json().findings[1].id;
    await tick();
    const f3 = (await call("POST", R(`/${rid}/findings`), { title: "Ketiga", status: "wontfix" })).json().findings[2].id;
    await call("POST", R(`/${rid}/findings/${fid}/backlog`), {});     // temuan pertama sudah sent
    const res = await call("POST", R(`/${rid}/backlog`), {});
    expect(res.statusCode).toBe(200);
    const j = res.json();
    expect(j.results.map((r: { findingId: string }) => r.findingId)).toEqual([f2]);
    expect(j.results[0]).toMatchObject({ code: "F-02", created: true, spec: { priority: "rendah" } });
    expect(j.sent).toBe(1);
    expect(await prisma.spec.count()).toBe(2);
    const states = Object.fromEntries(j.report.findings.map((f: { id: string; status: string }) => [f.id, f.status]));
    expect(states).toEqual({ [fid]: "sent", [f2]: "sent", [f3]: "wontfix" });
  });

  it("tanpa temuan open → results kosong, sent 0", async () => {
    await call("POST", R(`/${rid}/findings/${fid}/backlog`), {});
    expect(await call("POST", R(`/${rid}/backlog`), {}).then((r) => r.json())).toMatchObject({ results: [], sent: 0 });
  });
});
