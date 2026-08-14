import { registerSchedulerSource } from "../registry";

// SPEC-761 mengamandemen source triase SPEC-297: input publik tidak boleh melintasi boundary
// approval sebagai efek denyut scheduler. Registrasi id dipertahankan untuk kompatibilitas katalog,
// tetapi checker tidak mempromosikan atau mengantrekan tiket.
export async function checkTriase(): Promise<void> {
  // Tiket publik sudah menghasilkan notifikasi saat intake. Checker sengaja inert: promosi adalah
  // trust-boundary yang hanya boleh dilewati aksi accept operator, bukan denyut scheduler.
}

export function registerTriaseSource(): void {
  registerSchedulerSource({ id: "triase", check: checkTriase });
}
