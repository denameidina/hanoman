import React from "react";
import { Badge, Button, Callout, Card, Icon } from "../ds";
import {
  WEBHOOK_BACKOFF_SEC, WEBHOOK_ENTITIES, WEBHOOK_EVENTS, WEBHOOK_FAIL_LIMIT, WEBHOOK_HEADERS,
  WEBHOOK_MAX_ATTEMPTS, WEBHOOK_MAX_BYTES, WEBHOOK_QUEUE_CAP, WEBHOOK_SPEC_VERSION,
  WEBHOOK_TOLERANCE_SEC, sampleEnvelope,
} from "@hanoman/shared";

// SPEC-481 · ADR-0100 · dokumentasi webhook DI DALAM aplikasi, dibangun dari katalog yang sama
// dengan pengirimnya. Tak ada daftar jenis peristiwa yang ditulis tangan di berkas ini — brief
// mensyaratkan dokumentasi yang tak bisa basi saat peristiwa baru ditambahkan.

const prose: React.CSSProperties = { fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 };
const code: React.CSSProperties = {
  fontFamily: "var(--font-mono)", fontSize: 12, whiteSpace: "pre", overflowX: "auto",
  background: "var(--bone-200)", border: "1px solid var(--border-hair)",
  borderRadius: "var(--radius-sm)", padding: 12, margin: 0,
};

function Copyable({ text, label = "Salin" }: { text: string; label?: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <div style={{ position: "relative" }}>
      <pre style={code}>{text}</pre>
      <div style={{ marginTop: 6 }}>
        <Button size="sm" variant="ghost" onClick={() => {
          void navigator.clipboard?.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }}>{done ? "Tersalin" : label}</Button>
      </div>
    </div>
  );
}

const NODE_SNIPPET = `// Node.js (Express) — verifikasi tanda tangan webhook hanoman
import express from "express";
import { createHmac, timingSafeEqual } from "node:crypto";

const app = express();
const SECRET = process.env.HANOMAN_WEBHOOK_SECRET;
const TOLERANCE_SEC = ${WEBHOOK_TOLERANCE_SEC};

app.post("/hanoman", express.raw({ type: "application/json" }), (req, res) => {
  const ts = Number(req.get("${WEBHOOK_HEADERS.timestamp}"));
  const got = req.get("${WEBHOOK_HEADERS.signature}") || "";
  if (!ts || Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SEC) return res.sendStatus(400);

  const want = "v1=" + createHmac("sha256", SECRET).update(\`\${ts}.\${req.body}\`).digest("hex");
  const a = Buffer.from(want), b = Buffer.from(got);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return res.sendStatus(401);

  const event = JSON.parse(req.body.toString("utf8"));
  // Idempoten: retry mengirim event.id yang SAMA.
  if (alreadyHandled(event.id)) return res.sendStatus(200);
  handle(event);
  res.sendStatus(200);        // balas 2xx dulu, kerjakan yang berat di latar
});`;

const PY_SNIPPET = `# Python (Flask) — verifikasi tanda tangan webhook hanoman
import hmac, hashlib, os, time
from flask import Flask, request, abort

app = Flask(__name__)
SECRET = os.environ["HANOMAN_WEBHOOK_SECRET"].encode()
TOLERANCE_SEC = ${WEBHOOK_TOLERANCE_SEC}

@app.post("/hanoman")
def hanoman():
    ts = request.headers.get("${WEBHOOK_HEADERS.timestamp}", "")
    got = request.headers.get("${WEBHOOK_HEADERS.signature}", "")
    if not ts.isdigit() or abs(time.time() - int(ts)) > TOLERANCE_SEC:
        abort(400)
    body = request.get_data()
    want = "v1=" + hmac.new(SECRET, f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(want, got):
        abort(401)
    event = request.get_json()
    if already_handled(event["id"]):   # retry membawa id yang sama
        return "", 200
    handle(event)
    return "", 200`;

const ENVELOPE_FIELDS: [string, string][] = [
  ["specVersion", `Versi skema amplop. Hari ini selalu "${WEBHOOK_SPEC_VERSION}". Penerima sebaiknya menolak versi yang tak dikenalnya.`],
  ["id", "Id peristiwa, unik & STABIL lintas percobaan. Inilah kunci idempotensi Anda."],
  ["type", "Jenis peristiwa, mis. spec.stage_changed. Daftar lengkapnya di atas."],
  ["createdAt", "Waktu peristiwa terjadi di hanoman (ISO 8601 UTC) — bukan waktu pengiriman."],
  ["project", "{ id, name } project terkait, atau null untuk peristiwa lintas-project."],
  ["actor", "Siapa yang memicu: user (email), agent (nama token), lead, scheduler, atau system."],
  ["data.entity", "Jenis objek yang berubah: spec, project, session, ticket, dan seterusnya."],
  ["data.id", "Id baris yang berubah."],
  ["data.action", "created | updated | deleted."],
  ["data.changed", "Daftar nama field yang benar-benar berubah. Kosong untuk created/deleted."],
  ["data.before", "Keadaan SEBELUM perubahan; null untuk created (atau bila dipangkas)."],
  ["data.after", "Keadaan SESUDAH perubahan; null untuk deleted."],
  ["data.cascade", "Hanya pada project.deleted: jumlah anak yang ikut terhapus."],
  ["truncated", "true bila amplop dipangkas karena melewati batas ukuran."],
  ["truncatedFields", "Nama field yang dipangkas, mis. after.objective."],
];

export function WebhookDocs({ onBack }: { onBack?: () => void } = {}) {
  const byEntity = WEBHOOK_ENTITIES.map((d) => ({
    label: d.label,
    events: WEBHOOK_EVENTS.filter((e) => e.entity === d.entity),
  })).concat([{
    label: "Webhook",
    events: WEBHOOK_EVENTS.filter((e) => e.entity === "webhook"),
  }]);

  return (
    <>
      <Card eyebrow="dokumentasi" title="Dokumentasi webhook">
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <Button size="sm" variant="ghost" onClick={onBack}>
            <Icon name="arrow-left" size={14} /> Kembali ke daftar endpoint
          </Button>
        </div>
        <div style={prose}>
          Setiap kali sesuatu berubah di hanoman, kami mengirim satu <b>HTTP POST</b> ke URL yang
          Anda daftarkan. Kanal ini <b>satu arah</b> — hanoman tak pernah membaca apa pun dari
          penerima selain kode status HTTP-nya. Badan permintaan selalu berbentuk amplop seragam
          ber-versi <code>{WEBHOOK_SPEC_VERSION}</code>, jadi penerima yang ditulis hari ini tetap
          bekerja saat jenis peristiwa baru ditambahkan.
        </div>
      </Card>

      <Card eyebrow="katalog" title="Jenis peristiwa dan kapan terpicu">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {byEntity.map((g) => (
            <div key={g.label}>
              <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 8 }}>{g.label}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {g.events.map((e) => (
                  <div key={e.type} style={{ paddingLeft: 10, borderLeft: "2px solid var(--border-hair)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <code style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600 }}>{e.type}</code>
                      <Badge tone="brass" size="sm">{e.entityLabel}</Badge>
                      <span style={{ fontSize: 12.5 }}>{e.label}</span>
                    </div>
                    <div style={{ ...prose, marginTop: 4 }}>{e.when}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <Callout tone="info" title="Satu perubahan = satu peristiwa" style={{ marginTop: 14 }}>
          <div style={prose}>
            Peristiwa turunan <b>menggantikan</b>, bukan menambah: perubahan stage backlog dikirim
            sebagai <code>spec.stage_changed</code> dan <b>tidak</b> juga sebagai
            {" "}<code>spec.updated</code>. Berlangganan <code>spec.*</code> tetap menerima keduanya.
            Menghapus project memancarkan <code>project.deleted</code> saja — anak-anaknya dihapus
            oleh database, di luar jangkauan pengirim; jumlahnya ada di <code>data.cascade</code>.
          </div>
        </Callout>
      </Card>

      <Card eyebrow="amplop" title="Anatomi amplop">
        <div className="hn-local-overflow" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <tbody>
              {ENVELOPE_FIELDS.map(([k, v]) => (
                <tr key={k} style={{ borderTop: "1px solid var(--border-hair)" }}>
                  <td style={{ padding: "6px 8px", fontFamily: "var(--font-mono)", whiteSpace: "nowrap", verticalAlign: "top" }}>{k}</td>
                  <td style={{ padding: "6px 8px", color: "var(--text-muted)" }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card eyebrow="contoh" title="Contoh payload per jenis">
        <div style={{ ...prose, marginBottom: 10 }}>
          Contoh di bawah dibangun dari katalog yang sama dengan pengirimnya — bukan salinan yang
          bisa basi. Salin salah satunya sebagai fixture test penerima Anda.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {WEBHOOK_EVENTS.map((e) => (
            <div key={e.type}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <code style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600 }}>{e.type}</code>
              </div>
              <Copyable text={JSON.stringify(sampleEnvelope(e.type), null, 2)}
                label={`Salin contoh ${e.type}`} />
            </div>
          ))}
        </div>
      </Card>

      <Card eyebrow="keamanan" title="Header dan verifikasi tanda tangan">
        <div style={prose}>
          Setiap permintaan membawa header berikut:
        </div>
        <ul style={{ ...prose, paddingLeft: 20 }}>
          {Object.values(WEBHOOK_HEADERS).map((h) => (
            <li key={h}><code style={{ fontFamily: "var(--font-mono)" }}>{h}</code></li>
          ))}
        </ul>
        <div style={prose}>
          Tanda tangannya <code>v1=</code> diikuti HMAC-SHA256 heksadesimal atas string
          {" "}<code>{"<timestamp>.<raw body>"}</code> memakai secret endpoint. <b>Verifikasi atas
          byte mentah</b>, bukan hasil <code>JSON.parse</code> lalu <code>stringify</code> —
          serialisasi ulang mengubah byte dan tanda tangannya tak akan pernah cocok. Bandingkan
          dengan perbandingan waktu-tetap, dan tolak permintaan yang timestamp-nya menyimpang lebih
          dari <b>{WEBHOOK_TOLERANCE_SEC} detik</b> supaya kiriman lama tak bisa diputar ulang.
        </div>
        <div style={{ marginTop: 12 }}><Copyable text={NODE_SNIPPET} label="Salin contoh Node.js" /></div>
        <div style={{ marginTop: 12 }}><Copyable text={PY_SNIPPET} label="Salin contoh Python" /></div>
      </Card>

      <Card eyebrow="pengiriman" title="Retry, pengiriman ganda, dan idempotensi">
        <div style={prose}>
          Pengiriman berjalan lewat antrean, jadi penerima yang lambat tak pernah memperlambat
          hanoman. Pengiriman gagal diulang sampai <b>{WEBHOOK_MAX_ATTEMPTS} percobaan</b> dengan
          jeda berikut:
        </div>
        <div className="hn-local-overflow" style={{ overflowX: "auto", marginTop: 8 }}>
          <table style={{ borderCollapse: "collapse", fontSize: 12.5 }}>
            <tbody>
              <tr>
                <td style={{ padding: "4px 10px", color: "var(--text-muted)" }}>Percobaan</td>
                {WEBHOOK_BACKOFF_SEC.map((_, i) => (
                  <td key={i} style={{ padding: "4px 10px", fontFamily: "var(--font-mono)" }}>{i + 1}</td>
                ))}
              </tr>
              <tr style={{ borderTop: "1px solid var(--border-hair)" }}>
                <td style={{ padding: "4px 10px", color: "var(--text-muted)" }}>Jeda sebelumnya</td>
                {WEBHOOK_BACKOFF_SEC.map((s, i) => (
                  <td key={i} style={{ padding: "4px 10px", fontFamily: "var(--font-mono)" }}>
                    {s === 0 ? "—" : s < 60 ? `${s} dtk` : s < 3600 ? `${s / 60} mnt` : `${s / 3600} jam`}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <Callout tone="warn" title="Penerima WAJIB idempoten" style={{ marginTop: 12 }}>
          <div style={prose}>
            Kontraknya <b>at-least-once</b>: satu peristiwa bisa tiba lebih dari sekali — retry
            setelah jaringan putus di tengah, atau setelah hanoman di-restart saat pengiriman sedang
            berjalan. Retry mengirim <b>byte yang persis sama</b>, jadi <code>id</code> peristiwanya
            tetap. Simpan <code>id</code> yang sudah Anda proses dan abaikan kembarannya. Urutan
            kedatangan juga tak dijamin — jangan menyimpulkan urutan dari urutan tiba; pakai
            {" "}<code>createdAt</code>.
          </div>
        </Callout>
        <div style={{ ...prose, marginTop: 10 }}>
          Balas <b>2xx</b> secepat mungkin lalu kerjakan yang berat di latar; hanoman menutup
          koneksi setelah 10 detik dan menghitungnya sebagai gagal. Balasan <b>410 Gone</b>
          {" "}menonaktifkan endpoint seketika — pakai itu bila penerima memang pensiun.
          {" "}<b>{WEBHOOK_FAIL_LIMIT} pengiriman gagal beruntun</b> (yakni yang sudah kehabisan
          seluruh percobaannya) menonaktifkan endpoint otomatis, dan operator diberi notifikasi.
        </div>
      </Card>

      <Card eyebrow="batas" title="Batas ukuran, laju, dan antrean">
        <div style={prose}>
          Amplop dibatasi <b>{Math.round(WEBHOOK_MAX_BYTES / 1024)} KiB</b>. Yang melewatinya
          dipangkas bertahap — field teks panjang dipotong lebih dulu, lalu <code>data.before</code>
          {" "}dibuang seluruhnya — dan hasilnya ditandai <code>truncated: true</code> dengan daftar
          {" "}<code>truncatedFields</code>. Amplop <b>tak pernah</b> dikirim utuh melebihi batas itu,
          jadi jangan menganggap <code>after</code> selalu lengkap; ambil ulang lewat API bila butuh
          isi penuh. Tiap endpoint juga punya batas laju per menit, dan antrean per endpoint
          dibatasi <b>{WEBHOOK_QUEUE_CAP}</b> kiriman menunggu — kelebihannya tercatat sebagai
          {" "}<code>dropped</code> di riwayat, bukan hilang diam-diam.
        </div>
      </Card>

      <Card eyebrow="keamanan" title="Yang kami jaga, dan yang tetap jadi tanggung jawab Anda">
        <div style={prose}>
          Secret setiap endpoint disimpan terenkripsi dan <b>tak pernah</b> dikembalikan utuh oleh
          API — ia ditampilkan sekali saat dibuat atau dirotasi. Payload hanya memuat field yang
          didaftarkan katalog, jadi token, kredensial, dan isi rahasia tak pernah ikut. URL tujuan
          wajib <code>http</code>/<code>https</code> tanpa kredensial di dalamnya, dan alamat
          internal/loopback ditolak kecuali Anda mengizinkannya secara eksplisit per endpoint.
        </div>
        <Callout tone="warn" title="Batas yang jujur" style={{ marginTop: 10 }}>
          <div style={prose}>
            Pemeriksaan alamat dijalankan ulang pada <b>setiap</b> percobaan kirim, tapi selalu ada
            jeda antara memeriksa DNS dan menyambung — DNS rebinding karena itu dipersempit,
            <b> tidak ditutup</b>. Jangan mendaftarkan penerima di jaringan yang tak Anda percayai,
            dan jangan menyalakan "izinkan alamat internal" kecuali penerimanya memang milik Anda.
          </div>
        </Callout>
      </Card>

      <Card eyebrow="panduan" title="Membuat penerima webhook pertama Anda">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Langkah 1 — jalankan penerima</div>
            <div style={prose}>
              Salin potongan Node.js atau Python di atas ke berkas baru, isi
              {" "}<code>HANOMAN_WEBHOOK_SECRET</code> dengan nilai apa pun untuk sementara, lalu
              jalankan. Cukup satu route yang membalas 2xx.
            </div>
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Langkah 2 — buat URL-nya bisa dijangkau</div>
            <div style={prose}>
              Kalau penerima berjalan di mesin yang sama dengan hanoman, pakai
              {" "}<code>http://127.0.0.1:&lt;port&gt;</code> dan nyalakan
              {" "}<b>Izinkan alamat internal</b> pada endpoint. Kalau di tempat lain, pastikan
              URL-nya dapat diakses dari mesin ini lewat http/https.
            </div>
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Langkah 3 — daftarkan endpoint</div>
            <div style={prose}>
              Kembali ke daftar endpoint → <b>Tambah endpoint</b>. Isi nama dan URL, pilih peristiwa
              (mulailah dengan <b>Semua peristiwa</b>), simpan. <b>Salin secret yang muncul</b> —
              ia tak ditampilkan lagi — lalu pasang sebagai <code>HANOMAN_WEBHOOK_SECRET</code> di
              penerima Anda dan jalankan ulang.
            </div>
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Langkah 4 — tekan Test, lalu buktikan</div>
            <div style={prose}>
              Tombol <b>Test</b> mengirim satu <code>webhook.ping</code>. Yang benar: penerima
              memverifikasi tanda tangan dan hanoman menampilkan <code>HTTP 200</code>. Bila gagal,
              pesannya ditampilkan apa adanya. Sesudah itu ubah sesuatu di backlog dan buka
              {" "}<b>Riwayat</b> — peristiwa sungguhan pertama Anda ada di sana, lengkap dengan
              status, kode HTTP, dan galatnya bila ada.
            </div>
          </div>
        </div>
      </Card>
    </>
  );
}
