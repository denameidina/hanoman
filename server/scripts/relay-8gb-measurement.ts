/* SPEC-1218 AC-C10 · ADR-0165 §10 · pengukuran CPU/RSS/bufferedAmount untuk N stream relay
   (Terminal via `openStream`) berjalan bersamaan, dengan RTT hub<->device disimulasikan, untuk
   memeriksa apakah plafon S0b (6 stream/4 inflight/256 KiB kredit/64 KiB refill/1 MiB
   bufferedAmount/32 KiB per frame/12.000 frame-menit) bertahan pada beban nyata.

   Metode simulasi RTT: bukan `tc`/proxy TCP eksternal — device sisi hub adalah `RelaySocket` palsu
   (pola sama dengan `server/test/devices-relay.wshandler.test.ts`) yang membungkus setiap frame
   hub->device DAN device->hub dengan `setTimeout(rtt/2)` sebelum diproses, jadi satu putaran
   permintaan/balasan (mis. "open" -> "opened", atau kredit habis -> frame "credit" -> kredit terisi)
   benar memakan `--rtt` milidetik, bukan cuma satu arah.

   v2 (Task 17 Step 4, run penuh): berbeda dari run verifikasi 60 dtk (yang memakai `app.injectWS`
   in-process, lihat hasil pengukuran berkas markdown untuk catatan v1), skrip ini membuka server
   Fastify NYATA lewat `app.listen()` di loopback dan menyambung tiap stream browser lewat socket
   TCP NYATA (`ws` npm, sama seperti `TerminalPane`), supaya `bufferedAmount` benar mengukur backlog
   kernel, bukan 0 konstan seperti pada harness in-process. Temuan run v1: hub menutup socket
   browser dengan 4009 "resync" pada REFILL PERTAMA (bukan periodik lima detik seperti dikira
   semula — `lastResyncAt` bermula 0 sehingga syarat `Date.now()-0 >= RELAY_RESYNC_MIN_MS` langsung
   terpenuhi), dan device (skrip) berhenti mendorong data sesudahnya karena hub tak pernah
   memberitahu device untuk berhenti pada cabang ini. Ini BUKAN pelanggaran plafon, melainkan
   mekanisme resync yang memang dirancang §10 — klien produksi (`TerminalPane`) menyambung ulang
   lewat `onclose` (lihat `RECONNECT_BACKOFF_MS`). Skrip v2 ini MENIRU perilaku itu: setiap stream
   yang ditutup (kode berapa pun) langsung mencoba menyambung ulang (tiket baru + koneksi TCP baru)
   dengan jeda tetap kecil, supaya beban 10 menit benar sinambung, bukan berhenti sesudah ~19 detik
   pertama seperti v1.

   Dijalankan manual, bukan test suite:
     server/node_modules/.bin/tsx server/scripts/relay-8gb-measurement.ts --duration 600 --streams 4 --rtt 200
   HANOMAN_HOME/DATABASE_URL harus menunjuk DB terisolasi (lihat hasil pengukuran Task 17). */
import { appendFileSync, writeFileSync } from "node:fs";
import { WebSocket } from "ws";
import { buildApp } from "../src/app";
import { prisma } from "../src/db";
import { issueDeviceToken } from "../src/services/device-token";
import { attachRelaySocket, __resetRelayHub } from "../src/services/relay/hub";
import { __resetDeviceSockets } from "../src/services/device-sockets";
import { RELAY_PROTOCOL, RELAY_CREDIT_INITIAL, RELAY_CREDIT_REFILL_BELOW } from "@hanoman/shared";

function argNum(flag: string, fallback: number): number {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : Number(process.argv[i + 1]);
}
function argBool(flag: string, fallback: boolean): boolean {
  const i = process.argv.indexOf(flag);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v === "true" || v === "1";
}

const DURATION_S = argNum("--duration", 60);
const STREAMS = argNum("--streams", 4);
const RTT_MS = argNum("--rtt", 200);
const RECONNECT = argBool("--reconnect", true);
const DEBUG = argBool("--debug", false);
const FRAME_BYTES = 512; // ukuran "output tmux" sintetis per frame, jauh di bawah plafon 32 KiB
const PRODUCER_INTERVAL_MS = 20; // laju dorong device, dibatasi kredit lokal — bukan pengabaian backpressure
const RECONNECT_DELAY_MS = 300; // jeda tetap kecil — bukan backoff eksponensial TerminalPane (di luar skop di sini)

const OUT = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]!
  : `server/scripts/relay-8gb-measurement.${Date.now()}.csv`;
const SUMMARY_OUT = `${OUT}.summary.json`;

type DeviceStream = { sid: string; credit: number; frames: number; stopped: boolean; index: number };

function halfRttDelay<T extends unknown[]>(fn: (...a: T) => void): (...a: T) => void {
  return (...a: T) => { setTimeout(() => fn(...a), RTT_MS / 2); };
}

async function main() {
  console.log(`konfigurasi: DURATION_S=${DURATION_S} STREAMS=${STREAMS} RTT_MS=${RTT_MS} RECONNECT=${RECONNECT} OUT=${OUT}`);
  writeFileSync(OUT, "t,stream,cpuUserMs,cpuSysMs,rssMB,bufferedAmount,framesSentCumulative,streamOpen,resyncCloses\n");

  // Sesi agen ini punya HANOMAN_CONTROL_ORIGINS ambient (dipasang supervisor untuk instance
  // produksi yang menjalankan sesi ini) yang membuat `classifyIngress` menolak Host inject
  // ("localhost") sebagai "denied" 404 — bukan bug app.ts, murni kebocoran env host. Skrip ini
  // SENGAJA membangun app dengan origin split kosong DAN NODE_ENV bukan "production" supaya
  // `wsAllowlistFor` jatuh ke same-origin (lihat ws-admission.ts) dan jalan identik di mesin manapun.
  const scriptEnv = { ...process.env, HANOMAN_CONTROL_ORIGINS: "", HANOMAN_PUBLIC_ORIGINS: "", NODE_ENV: "development" };
  const app = buildApp({ env: scriptEnv });
  __resetRelayHub();
  __resetDeviceSockets();

  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw new Error("app.listen tak memulangkan alamat TCP");
  const base = `http://127.0.0.1:${addr.port}`;
  const wsBase = `ws://127.0.0.1:${addr.port}`;
  const hostHeader = `127.0.0.1:${addr.port}`;
  console.log(`server nyata mendengarkan di ${base}`);

  const setup = await fetch(`${base}/api/auth/setup`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `bench-${Date.now()}@d.co`, password: "password1234" }),
  });
  if (setup.status >= 400) throw new Error(`setup gagal: ${setup.status} ${await setup.text()}`);
  const setCookie = setup.headers.get("set-cookie");
  if (!setCookie) throw new Error("setup tak memulangkan set-cookie");
  const cookie = setCookie.split(";")[0]!;
  const user = await prisma.user.findFirstOrThrow();
  const device = await issueDeviceToken(user.id, `bench-8gb-${Date.now()}`);

  // Sisi HUB: socket device palsu, setiap arah dijeda RTT/2 (lihat komentar berkas). deviceStreams
  // kini dikunci per INDEX stream (bukan sid) karena reconnect melahirkan sid baru tiap siklus —
  // path frame "open" ("/api/terminal/sessions/<index>/ws") membawa index-nya.
  const deviceStreams = new Map<number, DeviceStream>();
  let totalResyncCloses = 0;
  const relayHandle = attachRelaySocket(device.id, {
    readyState: 1,
    close: () => {},
    send: halfRttDelay((raw: string) => {
      const f = JSON.parse(raw) as { t: string; sid?: string; n?: number; path?: string };
      if (f.t === "open" && f.sid && f.path) {
        const m = f.path.match(/\/sessions\/(\d+)\/ws$/);
        const index = m ? Number(m[1]) : -1;
        const s: DeviceStream = { sid: f.sid, credit: RELAY_CREDIT_INITIAL, frames: deviceStreams.get(index)?.frames ?? 0, stopped: false, index };
        deviceStreams.set(index, s);
        halfRttDelay(() => relayHandle.onMessage(JSON.stringify({ t: "opened", sid: f.sid })))();
        pump(s);
      } else if (f.t === "credit" && f.sid) {
        const s = [...deviceStreams.values()].find((x) => x.sid === f.sid);
        if (s) s.credit = Math.min(RELAY_CREDIT_INITIAL, s.credit + (f.n ?? 0));
      } else if (f.t === "close" && f.sid) {
        const s = [...deviceStreams.values()].find((x) => x.sid === f.sid);
        if (s) s.stopped = true;
      }
    }),
  });
  halfRttDelay(() => relayHandle.onMessage(JSON.stringify({ t: "hello", v: 1, protocol: RELAY_PROTOCOL, version: "0.0.0-bench", capabilities: ["sessions:read"] })))();
  await new Promise((r) => setTimeout(r, RTT_MS + 50)); // biarkan handshake "hello"/"welcome" tuntas

  function pump(s: DeviceStream): void {
    if (s.stopped) return;
    if (s.credit >= FRAME_BYTES) {
      s.credit -= FRAME_BYTES;
      s.frames += 1;
      const d = "x".repeat(FRAME_BYTES);
      halfRttDelay(() => relayHandle.onMessage(JSON.stringify({ t: "data", sid: s.sid, d })))();
    }
    setTimeout(() => pump(s), PRODUCER_INTERVAL_MS);
  }

  // Sisi BROWSER: koneksi WS TCP NYATA (bukan injectWS) per stream, ticket target
  // `relay:<deviceId>:terminal:<n>` — sama seperti TerminalPane mode=remote sungguhan. Reconnect
  // meniru `TerminalPane`'s `socket.onclose -> retry()`: kode berapa pun (kecuali proses sedang
  // berhenti) memicu tiket baru + koneksi baru sesudah jeda tetap kecil.
  const sockets: Array<WebSocket | undefined> = new Array(STREAMS).fill(undefined);
  const framesAtOpen: number[] = new Array(STREAMS).fill(0);
  let stopping = false;

  async function openStreamAt(i: number): Promise<void> {
    if (stopping) return;
    const ticketRes = await fetch(`${base}/api/ws-tickets`, {
      method: "POST", headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ target: `relay:${device.id}:terminal:${i}` }),
    });
    if (ticketRes.status >= 400) { console.error(`stream ${i}: tiket gagal ${ticketRes.status}, coba lagi`); if (!stopping) setTimeout(() => void openStreamAt(i), RECONNECT_DELAY_MS); return; }
    const { ticket } = (await ticketRes.json()) as { ticket: string };
    const ws = new WebSocket(
      `${wsBase}/api/devices/${device.id}/relay/terminal/sessions/${i}/ws`,
      [`hanoman-ticket.${ticket}`],
      { headers: { origin: base, host: hostHeader, cookie } },
    );
    sockets[i] = ws;
    ws.on("message", () => { /* dibaca supaya buffer socket internal tak menumpuk, tak dianalisis isinya */ });
    ws.on("close", (code, reason) => {
      if (code === 4009) totalResyncCloses += 1;
      if (DEBUG) console.log(`stream ${i} close code=${code} reason=${reason?.toString()}`);
      sockets[i] = undefined;
      if (stopping || !RECONNECT) return;
      setTimeout(() => void openStreamAt(i), RECONNECT_DELAY_MS);
    });
    ws.on("error", (err) => { if (DEBUG) console.log(`stream ${i} error: ${(err as Error).message}`); });
    ws.on("unexpected-response", (_req, res) => { if (DEBUG) console.log(`stream ${i} unexpected-response status=${res.statusCode}`); });
  }

  for (let i = 0; i < STREAMS; i++) await openStreamAt(i);

  await new Promise((r) => setTimeout(r, RTT_MS + 200)); // biarkan "open"->"opened" tuntas per stream
  const openCount = [...deviceStreams.values()].filter((s) => !s.stopped).length;
  console.log(`stream terbuka pada t=0: ${openCount}/${STREAMS}`);

  const cpuBase = process.cpuUsage();
  let peakRssMB = 0;
  let peakBufferedAmount = 0;
  let peakCpuUserMsPerS = 0;
  let lastCpuUserMs = 0;
  for (let t = 1; t <= DURATION_S; t++) {
    await new Promise((r) => setTimeout(r, 1000));
    const cpu = process.cpuUsage(cpuBase);
    const rssMB = process.memoryUsage().rss / (1024 * 1024);
    peakRssMB = Math.max(peakRssMB, rssMB);
    const cpuUserMs = cpu.user / 1000;
    peakCpuUserMsPerS = Math.max(peakCpuUserMsPerS, cpuUserMs - lastCpuUserMs);
    lastCpuUserMs = cpuUserMs;
    for (let i = 0; i < STREAMS; i++) {
      const ws = sockets[i];
      const buffered = ws?.bufferedAmount ?? 0;
      peakBufferedAmount = Math.max(peakBufferedAmount, buffered);
      const s = deviceStreams.get(i);
      const framesCumulative = s?.frames ?? 0;
      const line = `${t},${i},${cpuUserMs.toFixed(1)},${(cpu.system / 1000).toFixed(1)},${rssMB.toFixed(1)},${buffered},${framesCumulative},${ws && ws.readyState === WebSocket.OPEN ? 1 : 0},${totalResyncCloses}\n`;
      appendFileSync(OUT, line);
    }
    if (t % 30 === 0 || t === DURATION_S) {
      console.log(`t=${t}s rss=${rssMB.toFixed(1)}MB cpuUser=${cpuUserMs.toFixed(1)}ms resyncCloses=${totalResyncCloses} bufferedPeak=${peakBufferedAmount}`);
    }
  }

  stopping = true;
  for (const ws of sockets) ws?.terminate();
  await app.close();

  const summary = {
    durationS: DURATION_S, streams: STREAMS, rttMs: RTT_MS, reconnect: RECONNECT,
    peakRssMB: Number(peakRssMB.toFixed(1)),
    finalRssMB: Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(1)),
    peakCpuUserMsPerSecond: Number(peakCpuUserMsPerS.toFixed(1)),
    totalCpuUserMs: Number(lastCpuUserMs.toFixed(1)),
    peakBufferedAmountBytes: peakBufferedAmount,
    totalResyncCloses,
    framesSentPerStream: [...deviceStreams.values()].map((s) => ({ index: s.index, frames: s.frames })),
    creditInitial: RELAY_CREDIT_INITIAL, creditRefillBelow: RELAY_CREDIT_REFILL_BELOW,
  };
  writeFileSync(SUMMARY_OUT, JSON.stringify(summary, null, 2));
  console.log(`selesai, CSV di ${OUT}, ringkasan di ${SUMMARY_OUT}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
