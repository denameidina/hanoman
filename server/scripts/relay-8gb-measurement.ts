/* SPEC-1218 AC-C10 · ADR-0165 §10 · pengukuran CPU/RSS/bufferedAmount untuk N stream relay
   (Terminal via `openStream`) berjalan bersamaan, dengan RTT hub↔device disimulasikan, untuk
   memeriksa apakah plafon S0b (6 stream/4 inflight/256 KiB kredit/64 KiB refill/1 MiB
   bufferedAmount/32 KiB per frame/12.000 frame-menit) bertahan pada beban nyata.

   Metode simulasi RTT: bukan `tc`/proxy TCP eksternal — device sisi hub adalah `RelaySocket` palsu
   (pola sama dengan `server/test/devices-relay.wshandler.test.ts`) yang membungkus setiap frame
   hub→device DAN device→hub dengan `setTimeout(rtt/2)` sebelum diproses, jadi satu putaran
   permintaan/balasan (mis. "open" → "opened", atau kredit habis → frame "credit" → kredit terisi)
   benar memakan `--rtt` milidetik, bukan cuma satu arah. Stream browser-nya NYATA: `app.injectWS`
   ke server Fastify yang benar-benar di-boot (bukan mock `WebSocket`), lewat tiket
   `relay:<deviceId>:terminal:<n>` yang sama seperti dipakai `TerminalPane` sungguhan (AC-C1-C9).
   Device tetap mendorong frame "data" berkelanjutan mengikuti kredit lokal yang disimulasikan
   sendiri (turun tiap kirim, naik saat menerima "credit" dari hub) — bukan mengabaikan backpressure.

   Dijalankan manual, bukan test suite:
     node --import tsx server/scripts/relay-8gb-measurement.ts --duration 60 --streams 4 --rtt 200
   HANOMAN_HOME/DATABASE_URL harus menunjuk DB terisolasi (lihat hasil pengukuran Task 17). */
import { appendFileSync, writeFileSync } from "node:fs";
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

const DURATION_S = argNum("--duration", 60);
const STREAMS = argNum("--streams", 4);
const RTT_MS = argNum("--rtt", 200);
const FRAME_BYTES = 512; // ukuran "output tmux" sintetis per frame, jauh di bawah plafon 32 KiB
const PRODUCER_INTERVAL_MS = 20; // laju dorong device, dibatasi kredit lokal — bukan pengabaian backpressure

const OUT = process.argv.includes("--out")
  ? process.argv[process.argv.indexOf("--out") + 1]!
  : `server/scripts/relay-8gb-measurement.${Date.now()}.csv`;

type DeviceStream = { sid: string; credit: number; frames: number; stopped: boolean };

function halfRttDelay<T extends unknown[]>(fn: (...a: T) => void): (...a: T) => void {
  return (...a: T) => { setTimeout(() => fn(...a), RTT_MS / 2); };
}

async function main() {
  console.log(`konfigurasi: DURATION_S=${DURATION_S} STREAMS=${STREAMS} RTT_MS=${RTT_MS} OUT=${OUT}`);
  writeFileSync(OUT, "t,stream,cpuUserMs,cpuSysMs,rssMB,bufferedAmount,framesSent\n");

  // Sesi agen ini punya HANOMAN_CONTROL_ORIGINS ambient (dipasang supervisor untuk instance
  // produksi yang menjalankan sesi ini) yang membuat `classifyIngress` menolak Host inject
  // ("localhost") sebagai "denied" 404 — bukan bug app.ts, murni kebocoran env host. Skrip ini
  // SENGAJA membangun app dengan origin split kosong supaya jalan identik di mesin manapun.
  const scriptEnv = { ...process.env, HANOMAN_CONTROL_ORIGINS: "", HANOMAN_PUBLIC_ORIGINS: "" };
  const app = buildApp({ env: scriptEnv });
  __resetRelayHub();
  __resetDeviceSockets();

  const setup = await app.inject({ method: "POST", url: "/api/auth/setup", payload: { email: `bench-${Date.now()}@d.co`, password: "password1234" } });
  if (setup.statusCode >= 400) throw new Error(`setup gagal: ${setup.statusCode} ${setup.body}`);
  const cookie = (setup.headers["set-cookie"] as string).split(";")[0]!;
  const user = await prisma.user.findFirstOrThrow();
  const device = await issueDeviceToken(user.id, `bench-8gb-${Date.now()}`);

  // Sisi HUB: socket device palsu, setiap arah dijeda RTT/2 (lihat komentar berkas).
  const deviceStreams = new Map<string, DeviceStream>();
  const relayHandle = attachRelaySocket(device.id, {
    readyState: 1,
    close: () => {},
    send: halfRttDelay((raw: string) => {
      const f = JSON.parse(raw) as { t: string; sid?: string; n?: number };
      if (f.t === "open" && f.sid) {
        const s: DeviceStream = { sid: f.sid, credit: RELAY_CREDIT_INITIAL, frames: 0, stopped: false };
        deviceStreams.set(f.sid, s);
        halfRttDelay(() => relayHandle.onMessage(JSON.stringify({ t: "opened", sid: f.sid })))();
        pump(s);
      } else if (f.t === "credit" && f.sid) {
        const s = deviceStreams.get(f.sid);
        if (s) s.credit = Math.min(RELAY_CREDIT_INITIAL, s.credit + (f.n ?? 0));
      } else if (f.t === "close" && f.sid) {
        const s = deviceStreams.get(f.sid);
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

  // Sisi BROWSER: koneksi WS nyata lewat injectWS, satu per stream, tiket target
  // `relay:<deviceId>:terminal:<n>` — sama seperti TerminalPane mode=remote sungguhan.
  const sockets: Array<{ bufferedAmount?: number }> = [];
  for (let i = 0; i < STREAMS; i++) {
    const ticketRes = await app.inject({ method: "POST", url: "/api/ws-tickets", headers: { cookie }, payload: { target: `relay:${device.id}:terminal:${i}` } });
    const ticket = (ticketRes.json() as { ticket: string }).ticket;
    const ws = await app.injectWS(`/api/devices/${device.id}/relay/terminal/sessions/${i}/ws`, {
      headers: { origin: "http://localhost", host: "localhost", cookie, "sec-websocket-protocol": `hanoman-ticket.${ticket}` },
    } as any);
    ws.on("message", () => { /* dibaca supaya buffer socket internal ws lib tak menumpuk */ });
    sockets.push(ws as unknown as { bufferedAmount?: number });
  }

  await new Promise((r) => setTimeout(r, RTT_MS + 50)); // biarkan "open"→"opened" tuntas per stream
  const sids = [...deviceStreams.keys()];
  console.log(`stream terbuka: ${sids.length}/${STREAMS}`);

  const cpuBase = process.cpuUsage();
  for (let t = 1; t <= DURATION_S; t++) {
    await new Promise((r) => setTimeout(r, 1000));
    const cpu = process.cpuUsage(cpuBase);
    const rssMB = process.memoryUsage().rss / (1024 * 1024);
    for (let i = 0; i < sockets.length; i++) {
      const s = deviceStreams.get(sids[i] ?? "");
      const line = `${t},${i},${(cpu.user / 1000).toFixed(1)},${(cpu.system / 1000).toFixed(1)},${rssMB.toFixed(1)},${sockets[i]?.bufferedAmount ?? 0},${s?.frames ?? 0}\n`;
      appendFileSync(OUT, line);
    }
    if (t % 10 === 0) console.log(`t=${t}s rss=${rssMB.toFixed(1)}MB cpuUser=${(cpu.user / 1000).toFixed(1)}ms`);
  }

  for (const ws of sockets) (ws as unknown as { terminate(): void }).terminate();
  await app.close();
  console.log(`selesai, CSV di ${OUT}`);
  console.log(`kredit awal per stream=${RELAY_CREDIT_INITIAL}, ambang refill=${RELAY_CREDIT_REFILL_BELOW}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
