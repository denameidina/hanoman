// State layout grid terminal — murni, tanpa React/DOM, agar teruji langsung.
// cells baris-mayor: idx = r*cols + c, panjang selalu rows*cols.
// colSizes/rowSizes: bobot `fr` relatif per track, undefined = semua track sama besar (1fr) —
// field opsional supaya workspace lama tanpa keduanya tetap valid tanpa migrasi (SPEC drag-resize).
export type Layout = {
  rows: number; cols: number; cells: (string | null)[];
  colSizes?: number[]; rowSizes?: number[];
};

export const emptyLayout = (): Layout => ({ rows: 1, cols: 1, cells: [null] });

const removeIndex = (sizes: number[], i: number): number[] =>
  [...sizes.slice(0, i), ...sizes.slice(i + 1)];

// + Baris: append satu baris (cols sel kosong). Index sel lama TAK bergeser.
export const addRow = (l: Layout): Layout => ({
  ...l, rows: l.rows + 1, cells: [...l.cells, ...Array<string | null>(l.cols).fill(null)],
  ...(l.rowSizes ? { rowSizes: [...l.rowSizes, 1] } : {}),
});

// + Kolom: idx = r*cols + c BERGESER saat cols berubah — jadi cells di-rebuild, bukan di-append.
// Menyamakannya dengan addRow (append) akan mengacak isi sel; itu sebabnya keduanya diuji terpisah.
export function addColumn(l: Layout): Layout {
  const cols = l.cols + 1;
  const cells: (string | null)[] = [];
  for (let r = 0; r < l.rows; r++)
    for (let c = 0; c < cols; c++)
      cells.push(c < l.cols ? (l.cells[r * l.cols + c] ?? null) : null);
  return { ...l, cols, cells, ...(l.colSizes ? { colSizes: [...l.colSizes, 1] } : {}) };
}

// − Baris: buang baris r. rows===1 → no-op (grid tak boleh nol baris).
// Index baris-mayor tak bergeser saat rows berubah, jadi cukup potong satu slice sepanjang cols.
export function removeRow(l: Layout, r: number): Layout {
  if (l.rows === 1 || r < 0 || r >= l.rows) return l;
  const cells = [...l.cells];
  cells.splice(r * l.cols, l.cols);
  return { ...l, rows: l.rows - 1, cells, ...(l.rowSizes ? { rowSizes: removeIndex(l.rowSizes, r) } : {}) };
}

// − Kolom: idx = r*cols + c BERGESER saat cols berubah — cells di-rebuild, alasan yang sama
// dengan addColumn. cols===1 → no-op.
export function removeColumn(l: Layout, c: number): Layout {
  if (l.cols === 1 || c < 0 || c >= l.cols) return l;
  const cols = l.cols - 1;
  const cells: (string | null)[] = [];
  for (let r = 0; r < l.rows; r++)
    for (let cc = 0; cc < l.cols; cc++)
      if (cc !== c) cells.push(l.cells[r * l.cols + cc] ?? null);
  return { ...l, cols, cells, ...(l.colSizes ? { colSizes: removeIndex(l.colSizes, c) } : {}) };
}

// Ambang minimum tiap track: 30% dari rata-rata track di axis itu, bukan 30% dari total — grid
// 12 kolom default (masing-masing 1fr, rata-rata 1) tak pernah dianggap melanggar ambangnya sendiri.
// Untuk grid 2 track ini setara ~15% dari total lebar (mandat audit); untuk grid banyak track
// ambangnya menyusut proporsional, jadi default merata selalu di atas ambang.
export const MIN_TRACK_RATIO = 0.3;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

// Menggeser batas antara track[index] & track[index+1] sejauh `delta` (satuan fr), mempertahankan
// jumlah keduanya (total axis tak berubah) dan menegakkan MIN_TRACK_RATIO pada keduanya. Referensi
// array dipertahankan (tak clone) bila hasilnya sama persis — dipakai pemanggil untuk mendeteksi no-op.
export function resizeTracks(sizes: number[], index: number, delta: number): number[] {
  if (index < 0 || index + 1 >= sizes.length || delta === 0) return sizes;
  const total = sizes.reduce((a, b) => a + b, 0);
  const min = (total / sizes.length) * MIN_TRACK_RATIO;
  const pairSum = sizes[index]! + sizes[index + 1]!;
  const first = clamp(sizes[index]! + delta, min, pairSum - min);
  if (first === sizes[index]) return sizes;
  const next = [...sizes];
  next[index] = first;
  next[index + 1] = pairSum - first;
  return next;
}

export function resizeCol(l: Layout, index: number, delta: number): Layout {
  const base = l.colSizes ?? Array(l.cols).fill(1);
  const sizes = resizeTracks(base, index, delta);
  return sizes === base ? l : { ...l, colSizes: sizes };
}

export function resizeRow(l: Layout, index: number, delta: number): Layout {
  const base = l.rowSizes ?? Array(l.rows).fill(1);
  const sizes = resizeTracks(base, index, delta);
  return sizes === base ? l : { ...l, rowSizes: sizes };
}

export const RESIZE_STEP = 0.05;       // panah: 5% dari total axis
export const RESIZE_STEP_BIG = 0.15;   // Shift+panah: langkah lebih besar

const stepDelta = (sizes: number[], big: boolean): number =>
  sizes.reduce((a, b) => a + b, 0) * (big ? RESIZE_STEP_BIG : RESIZE_STEP);

export function stepResizeCol(l: Layout, index: number, direction: 1 | -1, big = false): Layout {
  const sizes = l.colSizes ?? Array(l.cols).fill(1);
  return resizeCol(l, index, direction * stepDelta(sizes, big));
}

export function stepResizeRow(l: Layout, index: number, direction: 1 | -1, big = false): Layout {
  const sizes = l.rowSizes ?? Array(l.rows).fill(1);
  return resizeRow(l, index, direction * stepDelta(sizes, big));
}

export function resetColSizes(l: Layout): Layout {
  if (!l.colSizes) return l;
  const { colSizes: _drop, ...rest } = l;
  return rest;
}

export function resetRowSizes(l: Layout): Layout {
  if (!l.rowSizes) return l;
  const { rowSizes: _drop, ...rest } = l;
  return rest;
}

// Posisi & batas divider dalam persen, untuk atribut aria-valuenow/min/max — dihitung dari
// pasangan track yang sama dengan resizeTracks, supaya batasnya selalu konsisten dengan clamp asli.
export function trackPercent(sizes: number[], index: number): { now: number; min: number; max: number } {
  const total = sizes.reduce((a, b) => a + b, 0);
  const floor = (total / sizes.length) * MIN_TRACK_RATIO;
  const pairSum = sizes[index]! + sizes[index + 1]!;
  const min = Math.round((floor / pairSum) * 100);
  return { now: Math.round((sizes[index]! / pairSum) * 100), min, max: 100 - min };
}

// Taruh sesi di sel idx; kosongkan sel lain yang memegang id sama (satu sesi ≤ satu sel).
// id null = kosongkan idx saja. idx di luar rentang → layout apa adanya (mis. detach id tak tertempat).
export function setCell(l: Layout, idx: number, id: string | null): Layout {
  if (idx < 0 || idx >= l.cells.length) return l;
  const cells = l.cells.map((c) => (id !== null && c === id ? null : c));
  cells[idx] = id;
  return { ...l, cells };
}

// Taruh di sel kosong pertama; penuh → layout apa adanya (sesi tinggal di tray).
export function placeFirstEmpty(l: Layout, id: string): Layout {
  const idx = l.cells.indexOf(null);
  return idx === -1 ? l : setCell(l, idx, id);
}

// Sesi yang lenyap dari server (di-kill) dikosongkan. Sesi `exited` TETAP di liveIds
// (listSessions memuat pane mati), jadi ia tetap terikat dan tampil "berakhir".
export const reconcile = (l: Layout, liveIds: Set<string>): Layout =>
  ({ ...l, cells: l.cells.map((c) => (c && liveIds.has(c) ? c : null)) });
