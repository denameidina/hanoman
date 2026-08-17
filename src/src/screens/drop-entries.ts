// ADR-0121 · membaca hasil drop jadi daftar { path relatif, File }. `webkitGetAsEntry` BUKAN
// standar — sebagian browser tak punya, karena itu daftar berkas datar (dt.files) adalah
// jalur mundurnya dan drop BERKAS selalu bekerja meski drop FOLDER tidak.
type Entry = {
  isFile: boolean; isDirectory: boolean; name: string;
  file?: (cb: (f: File) => void, err?: (e: unknown) => void) => void;
  createReader?: () => { readEntries: (cb: (e: Entry[]) => void, err?: (e: unknown) => void) => void };
};

const fileOf = (e: Entry) => new Promise<File | null>((res) => {
  if (!e.file) return res(null);
  e.file((f) => res(f), () => res(null));
});

// readEntries memancarkan maksimal ~100 entri per panggilan; ia harus dipanggil sampai kosong.
const kidsOf = (e: Entry) => new Promise<Entry[]>((res) => {
  const reader = e.createReader?.();
  if (!reader) return res([]);
  const out: Entry[] = [];
  const baca = () => reader.readEntries((batch) => {
    if (!batch.length) return res(out);
    out.push(...batch);
    baca();
  }, () => res(out));
  baca();
});

async function walk(entry: Entry, prefix: string, out: { path: string; file: File }[]): Promise<void> {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const f = await fileOf(entry);
    if (f) out.push({ path, file: f });
    return;
  }
  if (!entry.isDirectory) return;
  for (const kid of await kidsOf(entry)) await walk(kid, path, out);
}

export async function readDroppedEntries(dt: DataTransfer): Promise<{ path: string; file: File }[]> {
  const items = dt.items ? Array.from(dt.items as unknown as ArrayLike<DataTransferItem>) : [];
  // Cast lewat `unknown`: lib.dom mendeklarasikan `webkitGetAsEntry(): FileSystemEntry | null`,
  // dan tipe itu tak memuat `file`/`createReader` yang justru kita pakai.
  const entries = items
    .map((i) => i.webkitGetAsEntry?.() as unknown as Entry | null | undefined)
    .filter((e): e is Entry => !!e);
  if (!entries.length) return Array.from(dt.files ?? []).map((f) => ({ path: f.name, file: f }));
  const out: { path: string; file: File }[] = [];
  for (const e of entries) await walk(e, "", out);
  return out;
}
