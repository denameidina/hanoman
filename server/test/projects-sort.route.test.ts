// ADR-0212 · `GET /projects?sort=attention&attention=1` mengurutkan & menyaring di SERVER, lintas
// seluruh hasil. Tes ini memeriksa lintas HALAMAN: gabungan semua halaman harus sama persis dengan
// urutan penuh, tanpa duplikat dan tanpa yang hilang.
import { describe, it, expect, beforeAll } from "vitest";
import { buildApp } from "../src/app";
import { resetDb, makeProject, makeTempRepo } from "./factory";

const app = buildApp({ requireAuth: false });

// Dokumen: 2 dari 2 kategori ter-link → 100% (ok); 2 dari 3 → 67% (drift); 1 dari 2 → 50% (broken).
const OK_DIR = () => makeTempRepo({
  "internal/docs/README.md": "- [prd](product/prd.md)",
  "internal/docs/product/prd.md": "# prd",
});
const DRIFT_DIR = () => makeTempRepo({
  "internal/docs/README.md": "- [prd](product/prd.md)\n- [stack](architecture/stack.md)",
  "internal/docs/product/prd.md": "# prd",
  "internal/docs/architecture/stack.md": "# stack",
  "internal/docs/loose/orphan.md": "# orphan",
});
const BROKEN_HALF_DIR = () => makeTempRepo({
  "internal/docs/README.md": "- [prd](product/prd.md)",
  "internal/docs/product/prd.md": "# prd",
  "internal/docs/loose/orphan.md": "# orphan",
});

// Urutan yang DIHARAPKAN: rusak (0) → drift (1) → ok (2); dalam satu rank, nama huruf kecil; seri nama → id.
const EXPECTED_SORTED = [
  "sa-br-a",    // "broken a"  · 50% → rusak
  "sa-br-b",    // "broken b"  · tanpa repo → 0% → rusak
  "sa-same-1",  // "sama" (id lebih kecil dulu)
  "sa-same-2",  // "sama"
  "sa-dr",      // "drift one" · 67% → drift
  "sa-ok-a",    // "alfa" · ok
  "sa-ok-z",    // "zeta" · ok
];
const EXPECTED_ATTENTION = EXPECTED_SORTED.slice(0, 5);

const ids = (items: { id: string }[]) => items.map((p) => p.id);

async function allPages(url: string, limit: number): Promise<string[]> {
  const first = (await app.inject({ url: `${url}&page=1&limit=${limit}` })).json();
  const out: string[] = [...ids(first.items)];
  for (let page = 2; page <= Math.ceil(first.total / limit); page++) {
    out.push(...ids((await app.inject({ url: `${url}&page=${page}&limit=${limit}` })).json().items));
  }
  return out;
}

beforeAll(async () => {
  await resetDb();
  // Urutan pembuatan sengaja diacak terhadap urutan hasil, supaya urutan default tak kebetulan benar.
  await makeProject({ id: "sa-ok-z", name: "Zeta", repoDir: OK_DIR() });
  await makeProject({ id: "sa-same-2", name: "Sama", repoDir: null });
  await makeProject({ id: "sa-dr", name: "Drift one", repoDir: DRIFT_DIR() });
  await makeProject({ id: "sa-br-b", name: "Broken B", repoDir: null });
  await makeProject({ id: "sa-ok-a", name: "alfa", repoDir: OK_DIR() });
  await makeProject({ id: "sa-same-1", name: "sama", repoDir: null });
  await makeProject({ id: "sa-br-a", name: "broken a", repoDir: BROKEN_HALF_DIR() });
});

describe("GET /projects · sort=attention (ADR-0212)", () => {
  it("mengurutkan seluruh hasil di server: rusak → drift → ok, lalu nama, lalu id", async () => {
    const body = (await app.inject({ url: "/api/projects?sort=attention&limit=100" })).json();
    expect(body.total).toBe(7);
    expect(ids(body.items)).toEqual(EXPECTED_SORTED);
  });

  it("gabungan semua halaman sama dengan urutan penuh (tanpa duplikat, tanpa hilang)", async () => {
    for (const limit of [1, 2, 3, 4]) {
      const merged = await allPages("/api/projects?sort=attention", limit);
      expect(merged, `limit=${limit}`).toEqual(EXPECTED_SORTED);
    }
  });

  it("halaman pertama tidak lagi berisi 'ok' sementara ada yang rusak (urutan global, bukan per halaman)", async () => {
    const page1 = (await app.inject({ url: "/api/projects?sort=attention&page=1&limit=2" })).json();
    expect(ids(page1.items)).toEqual(["sa-br-a", "sa-br-b"]);
    const last = (await app.inject({ url: "/api/projects?sort=attention&page=4&limit=2" })).json();
    expect(ids(last.items)).toEqual(["sa-ok-z"]);
  });

  it("attention=1 menyaring ke rusak + drift, lintas halaman, tetap terurut", async () => {
    const body = (await app.inject({ url: "/api/projects?sort=attention&attention=1&limit=100" })).json();
    expect(body.total).toBe(5);
    expect(ids(body.items)).toEqual(EXPECTED_ATTENTION);
    expect(await allPages("/api/projects?sort=attention&attention=1", 2)).toEqual(EXPECTED_ATTENTION);
  });

  it("attention=true juga diterima (klien yang mengirim boolean)", async () => {
    const body = (await app.inject({ url: "/api/projects?sort=attention&attention=true&limit=100" })).json();
    expect(ids(body.items)).toEqual(EXPECTED_ATTENTION);
  });

  it("tanpa param, balasan tetap envelope yang sama dan memuat seluruh project (backward compatible)", async () => {
    const body = (await app.inject({ url: "/api/projects?limit=100" })).json();
    expect(body.total).toBe(7);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(100);
    expect([...ids(body.items)].sort()).toEqual([...EXPECTED_SORTED].sort());
  });

  it("attention=0 sama dengan tanpa param penyaring", async () => {
    const body = (await app.inject({ url: "/api/projects?attention=0&limit=100" })).json();
    expect(body.total).toBe(7);
  });

  it("q menyaring dulu, lalu urutan perhatian berlaku pada hasilnya", async () => {
    const body = (await app.inject({ url: "/api/projects?q=sama&sort=attention" })).json();
    expect(body.total).toBe(2);
    expect(ids(body.items)).toEqual(["sa-same-1", "sa-same-2"]);
  });

  it("nilai sort yang tak dikenal → 400, bukan diabaikan diam-diam", async () => {
    const res = await app.inject({ url: "/api/projects?sort=name" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/sort/);
  });

  it("attention dengan nilai di luar 0/1/true/false → 400", async () => {
    const res = await app.inject({ url: "/api/projects?attention=yes" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/attention/);
  });
});
