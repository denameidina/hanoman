// SPEC-626 · pemetaan keadaan → status `StatusPill` untuk portal klien. Fungsi murni supaya
// warnanya bisa dites langsung: nol test render bisa menangkap warna yang salah selama labelnya
// benar — persis jebakan yang membuat badge tiket abu-abu seragam lolos sampai 0.1.24.
//
// Keduanya TOTAL lewat tabel + fallback: nilai tak dikenal mendarat di `idle` yang netral, bukan
// di warna yang percaya diri tentang keadaan yang tak diketahui. Nol warna baru — hanya status
// yang sudah ada di `ds/components/feedback.tsx`.

// Domainnya adalah kosakata KLIEN (`publicStatus()`, SPEC-293), bukan `Ticket.status` mentah:
// `toPortalTicket()` sudah memetakannya sebelum dikirim, jadi inilah yang sampai ke layar.
const TICKET: Record<string, string> = {
  "Sedang ditinjau": "queued",     // wind — masuk antrean, belum ditriase
  "Diterima": "awaiting",          // amber — diterima, menunggu giliran kerja
  "Sedang dikerjakan": "running",  // brass — sesi berjalan
  "Selesai": "done",               // leaf
  "Ditutup": "failed",             // clay — tidak dilanjutkan
};

const STAGE: Record<string, string> = {
  brainstorming: "queued", objective: "queued", "spec-ready": "queued", planned: "queued",
  executing: "running", done: "done",
};

export const ticketPill = (status: string): string => TICKET[status] ?? "idle";
export const stagePill = (stage: string): string => STAGE[stage] ?? "idle";
