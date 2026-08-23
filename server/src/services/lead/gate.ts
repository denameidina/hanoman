// SPEC-479 (QA) · gerbang penerimaan hanoman-lead — satu-satunya tempat yang tahu berapa putusan
// boleh disusun sekaligus.
//
// Sebelum ini jawabannya tak pernah dinyatakan di mana pun, jadi ia jatuh ke BENTUK KODE masing-
// masing pintu: **1** di pintu deteksi (kebetulan `for`+`await`, terukur `maxInFlight = 1` dengan
// tangga tunggu linier 0/204/407/614/832/1035 ms untuk 6 sesi) dan **tak hingga** di pintu kontrak
// (kebetulan Fastify konkuren, terukur 12 permintaan → 12 proses agen). Dua kelakuan berlawanan,
// dua-duanya kebetulan, dua-duanya salah. Modul ini memberi jawaban itu satu rumah.
//
// FIFO, bukan "siapa cepat". Itu bukan detail gaya: `liveDecisions()` → `tmux list-panes -a`
// menyodorkan urutan yang SAMA tiap putaran, jadi gerbang tanpa urutan kedatangan akan melaparkan
// ekor daftar persis seperti loop serial yang digantikannya — kelaparan yang bisa direproduksi,
// bukan antrean yang kebetulan lambat.
//
// In-process (ADR-0024 utuh: tanpa message queue, worker terpisah, atau cron eksternal), cermin
// governor scheduler. Single-process, jadi Set/array biasa sudah cukup.

/**
 * Slot tak didapat sebelum deadline penerimaan habis.
 *
 * Ini BUKAN kegagalan lead: agennya belum sempat dipanggil, jadi tak ada percobaan yang gagal.
 * Bedanya penting karena keduanya punya arti berlawanan bagi operator — `gagal` berarti "lead
 * mencoba dan tak sanggup" (dan menghitung ke pagar SPEC-472), sementara ini berarti "lead sedang
 * penuh, coba lagi". Menyamakannya adalah cacat C di audit SPEC-479: batas waktu akibat beban
 * dicatat sebagai sebab permanen, lalu `failCapped` menutup sesi itu selamanya.
 */
export class LeadBusyError extends Error {
  constructor(readonly waitedMs: number, readonly queued: number) {
    super(`lead penuh: tak dapat slot sesudah antre ${waitedMs} ms (${queued} lagi menunggu)`);
    this.name = "LeadBusyError";
  }
}

export type LeadGateStats = { inFlight: number; queued: number };

type Waiter = { grant: () => void; deny: (e: LeadBusyError) => void; timer: NodeJS.Timeout };

let inFlight = 0;
let capacity = 1;
const queue: Waiter[] = [];

export function leadGateStats(): LeadGateStats {
  return { inFlight, queued: queue.length };
}

export function __resetLeadGate(): void {
  for (const w of queue) clearTimeout(w.timer);
  queue.length = 0;
  inFlight = 0;
  capacity = 1;
}

/** Serahkan slot yang bebas ke KEPALA antrean, selama masih ada slot. */
function pump(): void {
  while (queue.length && inFlight < capacity) {
    const w = queue.shift()!;
    clearTimeout(w.timer);
    inFlight++;
    w.grant();
  }
}

/**
 * Kunci FIFO ada di `!queue.length`: selama masih ada yang mengantre, pendatang baru IKUT
 * mengantre walau slotnya kebetulan bebas. Tanpa syarat itu pendatang bisa menyalip dan gerbangnya
 * kembali menjadi "siapa cepat" — yaitu kelaparan yang sama, hanya dengan antrean di sebelahnya.
 */
function acquire(cap: number, waitMs: number): Promise<void> {
  capacity = Math.max(1, cap);
  pump();                       // kapasitas mungkin baru saja dinaikkan operator
  if (!queue.length && inFlight < capacity) { inFlight++; return Promise.resolve(); }

  const startedAt = Date.now();
  return new Promise<void>((resolve, reject) => {
    const w: Waiter = {
      grant: resolve,
      deny: reject,
      timer: setTimeout(() => {
        const i = queue.indexOf(w);
        if (i >= 0) queue.splice(i, 1);   // keluar dari antrean; slot berikutnya bukan miliknya lagi
        reject(new LeadBusyError(Date.now() - startedAt, queue.length));
      }, waitMs),
    };
    queue.push(w);
  });
}

/**
 * Jalankan `fn` di dalam satu slot. Melempar `LeadBusyError` bila slot tak didapat dalam `waitMs`.
 *
 * Slot dilepas di `finally`: pekerjaan yang melempar tetap mengembalikan slotnya — kalau tidak,
 * satu kegagalan agen akan mengecilkan kapasitas gerbang selamanya.
 */
export async function runGated<T>(o: { capacity: number; waitMs: number }, fn: () => Promise<T>): Promise<T> {
  await acquire(o.capacity, o.waitMs);
  try { return await fn(); }
  finally { inFlight--; pump(); }
}
