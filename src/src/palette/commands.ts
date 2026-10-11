// Sumber perintah palet (⌘K) — MURNI: tanpa React, tanpa router, tanpa DOM. App yang menyuntikkan
// fungsi navigasi/aksinya lewat `PaletteSource`; modul ini hanya menyusun daftar dan mencarinya,
// sehingga seluruh isinya bisa diuji langsung (lihat commands.test.ts).
//
// Tak ada endpoint baru: "cari backlog/SPEC" memakai `backlog` yang sudah ada di App (frame `specs`),
// "jawab sesi" memakai `waitingSessions` dari pet-state, dan riwayat disimpan di ui-state.
import { fuzzyScore } from "./fuzzy";

export type PaletteGroup = "Riwayat" | "Menunggu kamu" | "Aksi" | "Pindah ke" | "Backlog" | "Project";

const GROUP_ORDER: readonly PaletteGroup[] = ["Riwayat", "Menunggu kamu", "Aksi", "Pindah ke", "Backlog", "Project"];
/**
 * Grup yang tampil saat kueri kosong. Backlog dan Project hanya muncul bila diketik: daftar seluruh
 * spec di pembuka palet tak menolong siapa pun, dan itu yang membuat palet terasa seperti tabel.
 */
const BROWSE_GROUPS: ReadonlySet<PaletteGroup> = new Set<PaletteGroup>(["Menunggu kamu", "Aksi", "Pindah ke"]);

export const RECENT_LIMIT = 5;
/** Batas hasil per grup pencarian untuk daftar panjang (spec, project). */
export const SEARCH_CAP = 8;

export type PaletteCommand = {
  /** Kunci stabil; juga dipakai sebagai kunci riwayat. */
  id: string;
  group: PaletteGroup;
  label: string;
  hint?: string;
  /** Kata kunci tambahan untuk pencarian (tak ditampilkan). */
  keywords?: string;
  /** Ditampilkan tapi tak bisa dijalankan. */
  disabled?: boolean;
  /** Bila ada: memilih perintah ini MENGISI kueri dengan nilai ini dan palet tetap terbuka. */
  prefill?: string;
  run: () => void;
};

export type PaletteSource = {
  /** `HN_NAV` dari ds/shell (terurut, dengan `gate` opsional). */
  nav: readonly { key: string; label: string; gate?: string }[];
  /** Gerbang nav yang aktif, mis. `{ clients: true }`. */
  gates: Readonly<Record<string, boolean>>;
  projects: readonly { id: string; name: string }[];
  /** Spec di backlog (state App). */
  specs: readonly { id: string; title: string; projectId?: string }[];
  /** Sesi yang menunggu jawaban manusia, sudah diberi label siap tampil. */
  waiting: readonly { id: string; label: string }[];
  /** `projectFilter` aktif: "all" = semua project. */
  scope: string;
  go: (key: string) => void;
  openSpec: (specId: string) => void;
  openSession: (sessionId: string) => void;
  newSpec: () => void;
  newProject: () => void;
  setScope: (projectId: string) => void;
};

export function buildPaletteCommands(src: PaletteSource): PaletteCommand[] {
  const out: PaletteCommand[] = [];
  const waitingCount = src.waiting.length;
  const scopeName = src.scope === "all"
    ? "Semua project"
    : (src.projects.find((p) => p.id === src.scope)?.name ?? src.scope);

  out.push(
    { id: "action:new-spec", group: "Aksi", label: "Buat backlog baru", hint: "brief → spec",
      keywords: "tambah baru spec brief tugas", run: src.newSpec },
    { id: "action:new-project", group: "Aksi", label: "Project baru",
      keywords: "tambah repo codebase", run: src.newProject },
    { id: "action:answer", group: "Aksi", label: "Jawab sesi yang menunggu",
      hint: waitingCount > 0 ? `${waitingCount} sesi` : "tidak ada sesi yang menunggu",
      keywords: "jawab menunggu keputusan sesi terminal", disabled: waitingCount === 0,
      run: () => { const first = src.waiting[0]; if (first) src.openSession(first.id); } },
    { id: "action:settings", group: "Aksi", label: "Buka pengaturan",
      keywords: "settings akun preferensi konfigurasi", run: () => src.go("settings") },
    { id: "action:scope", group: "Aksi", label: "Ganti project aktif", hint: scopeName,
      keywords: "project scope filter", prefill: "project ", run: () => undefined },
  );

  for (const n of src.nav) {
    if (n.gate && !src.gates[n.gate]) continue;
    out.push({ id: `nav:${n.key}`, group: "Pindah ke", label: n.label, hint: "halaman",
      keywords: n.key, run: () => src.go(n.key) });
  }

  for (const w of src.waiting) {
    out.push({ id: `wait:${w.id}`, group: "Menunggu kamu", label: `Jawab · ${w.label}`, hint: "Terminal",
      keywords: "jawab sesi menunggu terminal", run: () => src.openSession(w.id) });
  }

  for (const s of src.specs) {
    out.push({ id: `spec:${s.id}`, group: "Backlog", label: `${s.id} · ${s.title}`,
      keywords: `${s.id} spec backlog`, run: () => src.openSpec(s.id) });
  }

  out.push({ id: "scope:all", group: "Project", label: "Ganti project ke Semua project",
    keywords: "project semua all scope", disabled: src.scope === "all",
    run: () => src.setScope("all") });
  for (const p of src.projects) {
    const active = src.scope === p.id;
    out.push({ id: `scope:${p.id}`, group: "Project", label: `Ganti project ke ${p.name}`,
      hint: active ? "sedang aktif" : undefined, keywords: `project ${p.name} ${p.id} scope`,
      disabled: active, run: () => src.setScope(p.id) });
  }

  return out;
}

export type PaletteResultGroup = {
  group: PaletteGroup;
  items: { cmd: PaletteCommand; score: number }[];
};

/**
 * Hasil yang ditampilkan untuk `query` + riwayat. Kueri kosong: Riwayat, lalu grup pembuka.
 * Kueri terisi: semua perintah yang cocok, diurutkan skor per grup, dipangkas `SEARCH_CAP` untuk
 * grup daftar panjang. Grup selalu muncul dalam `GROUP_ORDER`; grup kosong dibuang.
 */
export function searchCommands(
  cmds: readonly PaletteCommand[],
  query: string,
  recentIds: readonly string[] = [],
): PaletteResultGroup[] {
  const q = query.trim();
  const buckets = new Map<PaletteGroup, { cmd: PaletteCommand; score: number }[]>();
  const push = (cmd: PaletteCommand, score: number) => {
    const list = buckets.get(cmd.group) ?? [];
    list.push({ cmd, score });
    buckets.set(cmd.group, list);
  };

  if (!q) {
    const byId = new Map(cmds.map((c) => [c.id, c] as const));
    for (const id of recentIds.slice(0, RECENT_LIMIT)) {
      const cmd = byId.get(id);
      if (cmd) push({ ...cmd, group: "Riwayat" }, 0);
    }
    for (const cmd of cmds) if (BROWSE_GROUPS.has(cmd.group)) push(cmd, 0);
  } else {
    for (const cmd of cmds) {
      const score = fuzzyScore(q, `${cmd.label} ${cmd.keywords ?? ""}`);
      if (score !== null) push(cmd, score);
    }
    for (const [group, items] of buckets) {
      items.sort((a, b) => b.score - a.score);
      if (group === "Backlog" || group === "Project") items.splice(SEARCH_CAP);
    }
  }

  return GROUP_ORDER.flatMap((group) => {
    const items = buckets.get(group);
    return items && items.length > 0 ? [{ group, items }] : [];
  });
}

/** Urutan tampil yang sama dengan hasil — dipakai untuk navigasi panah. */
export function flattenResults(results: readonly PaletteResultGroup[]): PaletteCommand[] {
  return results.flatMap((r) => r.items.map((i) => i.cmd));
}

/** Riwayat terbaru di depan, tanpa duplikat, dibatasi `RECENT_LIMIT`. */
export function pushRecent(recent: readonly string[], id: string): string[] {
  return [id, ...recent.filter((x) => x !== id)].slice(0, RECENT_LIMIT);
}
