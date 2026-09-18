/* SPEC-1217 AC-S9 · ADR-0166 §7 · beban ingest sintetis terhadap POST /api/sync/logs, mengukur
   dampaknya pada p95 GET /api/specs (proxy "dashboard tetap responsif").

   Default produksi: 10 device × batch 500 entri / 15 dtk selama 10 menit. Lulus: p95 naik ≤ 20%,
   nol `P1008` (SQLite lock timeout) di log server selama pengukuran.

   Semua parameter bisa dioverride lewat env var untuk menjalankan skala kecil (mis. smoke lokal):
     DEVICES=3 ENTRIES_PER_BATCH=200 INTERVAL_MS=3000 DURATION_MS=60000 \
     HANOMAN_BASE=http://127.0.0.1:4601 HANOMAN_COOKIE="hanoman_session=..." \
     node --import tsx server/scripts/log-ingest-benchmark.ts

   Dijalankan manual, bukan test suite — lihat Task 21 di
   docs/superpowers/plans/2026-09-18-spec-1217-log-terpusat-turunan-d-plan.md. */
import { gzipSync } from "node:zlib";

const BASE = process.env.HANOMAN_BASE ?? "http://127.0.0.1:4600";
const COOKIE = process.env.HANOMAN_COOKIE ?? "";
const DEVICES = Number(process.env.DEVICES ?? 10);
const ENTRIES_PER_BATCH = Number(process.env.ENTRIES_PER_BATCH ?? 500);
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 15_000);
const DURATION_MS = Number(process.env.DURATION_MS ?? 10 * 60_000);

async function measureSpecsLatency(n: number): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = Date.now();
    const res = await fetch(`${BASE}/api/specs`, { headers: { cookie: COOKIE } });
    await res.text();
    out.push(Date.now() - t0);
  }
  return out;
}

function p95(arr: number[]): number {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length * 0.95)] ?? 0;
}

async function issueDeviceToken(name: string): Promise<string> {
  const res = await fetch(`${BASE}/api/device-tokens`, {
    method: "POST",
    headers: { cookie: COOKIE, "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`gagal membuat device token '${name}': ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { token: string };
  return body.token;
}

async function sendBatch(token: string, seqStart: number): Promise<{ status: number }> {
  const entries = Array.from({ length: ENTRIES_PER_BATCH }, (_, i) => ({
    seq: String(seqStart + i), ts: new Date().toISOString(), level: "info", kind: "bench",
    msg: `entri ${seqStart + i}`,
  }));
  const body = gzipSync(Buffer.from(JSON.stringify({ lane: "event", entries })));
  const res = await fetch(`${BASE}/api/sync/logs`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "content-encoding": "gzip" },
    body,
  });
  await res.text().catch(() => undefined);
  return { status: res.status };
}

async function main() {
  console.log(
    `konfigurasi: DEVICES=${DEVICES} ENTRIES_PER_BATCH=${ENTRIES_PER_BATCH} ` +
    `INTERVAL_MS=${INTERVAL_MS} DURATION_MS=${DURATION_MS}`,
  );
  console.log("baseline (nol ingest, 20 sampel)…");
  const baseline = p95(await measureSpecsLatency(20));
  console.log(`baseline p95 = ${baseline} ms`);

  const tokens = await Promise.all(
    Array.from({ length: DEVICES }, (_, i) => issueDeviceToken(`bench-${Date.now()}-${i}`)),
  );
  const seqs = tokens.map(() => 1);
  let sent = 0;
  let nonOk = 0;
  const start = Date.now();
  const during: number[] = [];
  const timer = setInterval(() => {
    void Promise.all(tokens.map(async (t, i) => {
      const seqStart = seqs[i]!;
      seqs[i] = seqStart + ENTRIES_PER_BATCH;
      const { status } = await sendBatch(t, seqStart);
      sent++;
      if (status < 200 || status >= 300) nonOk++;
    }));
  }, INTERVAL_MS);
  while (Date.now() - start < DURATION_MS) {
    during.push(...(await measureSpecsLatency(2)));
    await new Promise((r) => setTimeout(r, 5000));
  }
  clearInterval(timer);
  await new Promise((r) => setTimeout(r, INTERVAL_MS + 1000)); // biarkan batch terakhir tuntas

  const underLoad = p95(during);
  const pct = baseline > 0 ? ((underLoad - baseline) / baseline) * 100 : 0;
  console.log(`batch terkirim = ${sent} (non-2xx: ${nonOk})`);
  console.log(`p95 di bawah beban = ${underLoad} ms (naik ${pct.toFixed(1)}%)`);
  console.log(pct <= 20 ? "LULUS AC-S9" : "GAGAL AC-S9 — amandemen ADR-0166 diperlukan");
}

main().catch((e) => { console.error(e); process.exit(1); });
