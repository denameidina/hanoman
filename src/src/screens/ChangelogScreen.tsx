/* ChangelogScreen (SPEC-519) — halaman changelog satu project: generator (SPEC-516), daftar rilis
   yang bisa digulir & dicari, dan badan rilis terpilih. Mesin changelog & logika git tag tak
   disentuh; layar ini hanya memberi mereka tempat yang bisa dijangkau (entri sidebar + deep-link).

   Daftar memakai tinggi BERBATAS, bukan rantai flex `LIST_SCROLL_STYLE`: `Card` menyisipkan
   pembungkus `display:block` di sekitar `children` kecuali prop `fill` dipasang, dan rantai yang
   menembusnya putus (audit SPEC-393). Kartu ini duduk di antara dua kartu lain di kolom yang
   menggulir bersama <main>, jadi tinggi tetap memang bentuk yang benar di sini. */
import React from "react";
import { Card, Button, Badge, Input, StateBlock, MarkdownView, Callout, Pager, serverPage, useConfirm } from "../ds";
import { api } from "../api/client";
import { paths } from "@hanoman/shared";
import type { ChangelogView } from "@hanoman/shared";
import type { ProjectVM } from "./types";
import { ChangelogPanel } from "./ChangelogPanel";
import { changelogDeepLink } from "./deeplink";
import { usePersistedState, scoped, isStr, isNum, nullableStr } from "../ui-state";

const PAGE_SIZE = 12;
const MODE_LABEL: Record<string, string> = {
  backlog: "rentang tanggal", commit: "rentang commit", version: "versi rilis",
};
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });

function ReleaseRow({ c, active, onOpen }:
  { c: ChangelogView; active: boolean; onOpen: () => void }) {
  return (
    <div role="button" tabIndex={0} onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", cursor: "pointer",
        borderRadius: "var(--radius-sm)", borderBottom: "1px solid var(--border-hair)",
        background: active ? "var(--brass-100)" : "transparent",
      }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: "var(--text-strong)" }}>{c.title}</div>
        <div style={{ fontSize: 11.5, color: "var(--text-subtle)", marginTop: 2 }}>
          {MODE_LABEL[c.mode] ?? c.mode} · {fmtDate(c.createdAt)} · {c.itemCount} perubahan
        </div>
      </div>
      <Badge tone={c.generator === "agent" ? "ok" : "warn"} size="sm">
        {c.generator === "agent" ? "naratif" : "draf ringkas"}
      </Badge>
    </div>
  );
}

export function ChangelogScreen({ p, onToast, initialChangelogId }:
  { p: ProjectVM; onToast: (msg: string, kind?: string, icon?: string) => void;
    initialChangelogId?: string | null }) {
  const [items, setItems] = React.useState<ChangelogView[]>([]);
  const [total, setTotal] = React.useState(0);
  // SPEC-740 · ADR-0115 · ber-scope project: pencarian & halaman project A tak boleh
  // muncul saat project B dibuka.
  const ui = scoped("changelog", p.id);
  const [page, setPage] = usePersistedState(ui, "page", 1, isNum);
  const [q, setQ] = usePersistedState(ui, "q", "", isStr);
  const [loading, setLoading] = React.useState(true);
  const [selectedId, setSelectedId] = usePersistedState<string | null>(ui, "selectedId", null, nullableStr);
  // Rilis terpilih bisa berada DI LUAR halaman yang termuat — deep-link `&cl=` dan hasil
  // generator mengambilnya per-id. Barisnya dicache di sini supaya `selected` tetap terisi;
  // yang persisten cuma id-nya.
  const [offPage, setOffPage] = React.useState<ChangelogView | null>(null);
  const selected = React.useMemo(
    () => items.find((c) => c.id === selectedId) ?? (offPage?.id === selectedId ? offPage : null),
    [items, selectedId, offPage]);
  const setSelected = React.useCallback((c: ChangelogView | null) => {
    setSelectedId(c ? c.id : null);
    setOffPage(c);
  }, [setSelectedId]);
  const [reloadKey, setReloadKey] = React.useState(0);

  // Debounce ketikan: kotak cari memanggil server, bukan menyaring halaman yang kebetulan termuat
  // (kalau menyaring di klien, rilis di halaman lain tak akan pernah ketemu — bug yang sedang
  // diperbaiki, dalam bentuk baru).
  React.useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      setLoading(true);
      api.listChangelogs(p.id, { q, page, limit: PAGE_SIZE })
        .then((r) => { if (!alive) return; setItems(r.items); setTotal(r.total); })
        .catch(() => { if (alive) { setItems([]); setTotal(0); } })
        .finally(() => { if (alive) setLoading(false); });
    }, q ? 220 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [p.id, q, page, reloadKey]);

  // Deep-link `&cl=<id>` diambil PER-ID: rilis yang ditunjuk belum tentu ada di halaman pertama.
  React.useEffect(() => {
    if (!initialChangelogId) return;
    let alive = true;
    api.getChangelog(p.id, initialChangelogId)
      .then((c) => { if (alive) setSelected(c); })
      .catch(() => { if (alive) onToast("Rilis yang ditautkan tak ditemukan", "warn", "link-2-off"); });
    return () => { alive = false; };
  }, [p.id, initialChangelogId, onToast]);

  const pg = serverPage(total, page, PAGE_SIZE);
  // SPEC-847 · ADR-0127 · konfirmasi hapus rilis memakai dialog aplikasi.
  const { confirm, dialog } = useConfirm();

  async function remove(c: ChangelogView) {
    try {
      if (!await confirm({
        title: `Hapus changelog "${c.title}"?`,
        message: "Rilis ini hilang dari riwayat project.",
        confirmLabel: "Hapus rilis",
        run: () => api.deleteChangelog(p.id, c.id),
      })) return;
      if (selectedId === c.id) setSelected(null);
      setReloadKey((v) => v + 1);
      onToast("Changelog dihapus", "ok", "trash-2");
    } catch { onToast("Gagal menghapus changelog", "err", "x-circle"); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <ChangelogPanel p={p} onToast={onToast}
        onGenerated={(c) => { setSelected(c); setPage(1); setReloadKey((v) => v + 1); }} />

      <Card eyebrow="rilis" title="Riwayat changelog"
        actions={<span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-subtle)" }}>
          {total} rilis
        </span>}>
        <Input aria-label="Cari rilis" leftIcon="search" placeholder="cari judul atau isi rilis…"
          value={q} style={{ width: "100%" }}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setPage(1); setQ(e.target.value); }} />

        <div data-testid="changelog-list"
          style={{ maxHeight: 340, overflowY: "auto", marginTop: 10 }}>
          {loading && items.length === 0 && <StateBlock kind="loading" compact />}
          {!loading && items.length === 0 && (q.trim()
            ? <StateBlock kind="empty" icon="search" compact title="Tak ada rilis yang cocok"
                hint={`Tak ada rilis yang memuat “${q.trim()}”.`}
                action={() => setQ("")} actionLabel="Bersihkan pencarian" actionIcon="x" />
            : <StateBlock kind="empty" icon="megaphone" compact title="Belum ada rilis"
                hint="Bangkitkan changelog pertama project ini lewat kartu di atas." />)}
          {items.map((c) => (
            <ReleaseRow key={c.id} c={c} active={selected?.id === c.id} onOpen={() => setSelected(c)} />
          ))}
        </div>

        <Pager page={pg.page} pageCount={pg.pageCount} total={total} from={pg.from} to={pg.to}
          onPage={setPage} unit="rilis" />
      </Card>

      {selected && (
        <Card eyebrow={`rilis · ${MODE_LABEL[selected.mode] ?? selected.mode}`} title={selected.title}
          actions={
            <div className="hn-row-actions" style={{ display: "flex", gap: 6 }}>
              <Button size="sm" variant="ghost" leftIcon="copy" onClick={() => {
                void navigator.clipboard?.writeText(selected.body); onToast("Changelog disalin", "ok", "copy");
              }}>Salin</Button>
              <Button as="a" size="sm" variant="ghost" leftIcon="download" download
                href={`${paths.changelogItem(p.id, selected.id)}?download=md`}
                aria-label="Unduh .md">Unduh .md</Button>
              <Button size="sm" variant="ghost" leftIcon="link" onClick={() => {
                void navigator.clipboard?.writeText(changelogDeepLink(p.id, selected.id));
                onToast("Link changelog disalin", "ok", "link");
              }}>Salin link</Button>
              <Button size="sm" variant="ghost" leftIcon="trash-2" aria-label={`Hapus ${selected.title}`}
                onClick={() => void remove(selected)} />
            </div>}>
          {selected.warning && <Callout tone="warn">{selected.warning}</Callout>}
          <MarkdownView text={selected.body} name="changelog.md" />
        </Card>
      )}
      {dialog}
    </div>
  );
}
