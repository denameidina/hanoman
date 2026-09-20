export const HIDDEN_RING_CAP = 256 * 1024;

// SPEC-1267 · pane tersembunyi tak mem-parse keluaran: chunk ditahan di ring berbatas. Yang lebih
// tua dibuang saat melewati `cap` dan `overflowed` menandai bahwa replay tak lagi lengkap — pemanggil
// harus meminta layar penuh dari server sebagai gantinya.
export function createHiddenRing(cap = HIDDEN_RING_CAP) {
  let chunks: string[] = [];
  let bytes = 0;
  let overflowed = false;
  return {
    push(chunk: string): void {
      chunks.push(chunk);
      bytes += chunk.length;
      while (bytes > cap && chunks.length > 0) {
        bytes -= chunks.shift()!.length;
        overflowed = true;
      }
    },
    drain(): { chunks: string[]; overflowed: boolean } {
      const out = { chunks, overflowed };
      chunks = [];
      bytes = 0;
      overflowed = false;
      return out;
    },
    size: () => bytes,
  };
}
