/* ChangelogPanel (SPEC-516 · ADR-0105) — bangkitkan changelog naratif per project lewat tiga
   mode. Panggilan agen bisa puluhan detik, jadi statusnya eksplisit: tombol berubah teks dan
   nonaktif, bukan spinner bisu. */
import React from "react";
import { Card, Button, Badge, Input, Select, Field, MarkdownView, Callout } from "../ds";
import { api } from "../api/client";
import { paths } from "@hanoman/shared";
import type { ChangelogView, ChangelogSources, ChangelogRequest } from "@hanoman/shared";
import type { ProjectVM } from "./types";

type Mode = "backlog" | "commit" | "version";
const MODE_TABS: Array<{ mode: Mode; label: string; hint: string }> = [
  { mode: "backlog", label: "Rentang tanggal", hint: "backlog yang selesai di rentang itu" },
  { mode: "commit", label: "Rentang commit", hint: "perubahan repo antara dua revisi" },
  { mode: "version", label: "Versi rilis", hint: "perubahan yang masuk ke sebuah versi" },
];

export function ChangelogPanel({ p, onToast }:
  { p: ProjectVM; onToast: (msg: string, kind?: string, icon?: string) => void }) {
  const [mode, setMode] = React.useState<Mode>("backlog");
  const [src, setSrc] = React.useState<ChangelogSources | null>(null);
  const [from, setFrom] = React.useState(""); const [to, setTo] = React.useState("");
  const [fromSha, setFromSha] = React.useState(""); const [toSha, setToSha] = React.useState("");
  const [fromTag, setFromTag] = React.useState(""); const [toTag, setToTag] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<ChangelogView | null>(null);
  const [saved, setSaved] = React.useState<ChangelogView[]>([]);

  const reloadSaved = React.useCallback(async () => {
    try { setSaved((await api.listChangelogs(p.id, { limit: 10 })).items); } catch { /* daftar opsional */ }
  }, [p.id]);

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const s = await api.changelogSources(p.id);
        if (!alive) return;
        setSrc(s);
        setFrom(s.defaultRange.from); setTo(s.defaultRange.to);
        if (s.tags[0]) setToTag(s.tags[0]);
        if (s.head) setToSha(s.head);
      } catch { /* form tetap bisa diisi manual */ }
    })();
    void reloadSaved();
    return () => { alive = false; };
  }, [p.id, reloadSaved]);

  const request = (): ChangelogRequest =>
    mode === "backlog" ? { mode, from: from || undefined, to: to || undefined }
      : mode === "commit" ? { mode, fromSha, toSha }
        : { mode, fromTag: fromTag || undefined, toTag };

  const ready = mode === "backlog" ? true
    : mode === "commit" ? fromSha.trim().length >= 4 && toSha.trim().length >= 4
      : toTag.trim().length > 0;

  async function generate() {
    setBusy(true);
    try {
      const r = await api.generateChangelog(p.id, request());
      setResult(r);
      onToast(r.generator === "agent" ? "Changelog dibangkitkan" : "Changelog dibangkitkan (draf ringkas)",
        r.generator === "agent" ? "ok" : "warn", "file-text");
      await reloadSaved();
    } catch (e) {
      onToast((e as Error).message || "Gagal membangkitkan changelog", "err", "x-circle");
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!window.confirm("Hapus changelog ini?")) return;
    try {
      await api.deleteChangelog(p.id, id);
      if (result?.id === id) setResult(null);
      await reloadSaved();
      onToast("Changelog dihapus", "ok", "trash-2");
    } catch { onToast("Gagal menghapus changelog", "err", "x-circle"); }
  }

  const tagsMissing = mode === "version" && src !== null && src.tags.length === 0;
  const repoMissing = mode === "commit" && src !== null && !!src.reason && src.tags.length === 0;

  return (
    <Card eyebrow="changelog" title="Ringkasan perubahan untuk pemakai"
      actions={result && (
        <div style={{ display: "flex", gap: 6 }}>
          <Button size="sm" variant="ghost" leftIcon="copy" onClick={() => {
            void navigator.clipboard?.writeText(result.body); onToast("Changelog disalin", "ok", "copy");
          }}>Salin</Button>
          <Button as="a" size="sm" variant="ghost" leftIcon="download" download
            href={`${paths.changelogItem(p.id, result.id)}?download=md`}
            aria-label="Unduh .md">Unduh .md</Button>
        </div>
      )}>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
        Teks pendek berorientasi pemakai — apa yang berubah bagi mereka, bukan apa yang disentuh di dalam kode.
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {MODE_TABS.map((t) => (
          <Button key={t.mode} size="sm" variant={mode === t.mode ? "primary" : "ghost"}
            onClick={() => setMode(t.mode)} title={t.hint}>{t.label}</Button>
        ))}
      </div>

      {/* `Input`/`Select` design system TAK punya prop `label` — keduanya menyebar `...rest` ke
          elemen native, jadi nama aksesibilitasnya dipasang lewat `aria-label` dan label yang
          TERLIHAT lewat `Field`. `Select` juga menerima `options`, bukan `children` <option>:
          anak JSX akan diabaikan senyap. */}
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 12 }}>
        {mode === "backlog" && (
          <>
            <Field label="Dari tanggal">
              <Input aria-label="Dari tanggal" type="date" value={from} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFrom(e.target.value)} />
            </Field>
            <Field label="Sampai tanggal">
              <Input aria-label="Sampai tanggal" type="date" value={to} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTo(e.target.value)} />
            </Field>
          </>
        )}
        {mode === "commit" && (
          <>
            <Field label="Dari revisi">
              <Input aria-label="Dari revisi" mono placeholder="mis. v1.0.0 atau 4f2a1c9" value={fromSha}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFromSha(e.target.value)} />
            </Field>
            <Field label="Sampai revisi">
              <Input aria-label="Sampai revisi" mono placeholder="mis. HEAD atau 9d3b77e" value={toSha}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setToSha(e.target.value)} />
            </Field>
          </>
        )}
        {mode === "version" && (
          <>
            <Field label="Sejak versi">
              <Select aria-label="Sejak versi" value={fromTag} onChange={(e) => setFromTag(e.target.value)}
                options={[{ value: "", label: "versi sebelumnya" }, ...(src?.tags ?? []).map((t) => ({ value: t, label: t }))]} />
            </Field>
            <Field label="Versi">
              <Select aria-label="Versi" value={toTag} onChange={(e) => setToTag(e.target.value)}
                options={(src?.tags ?? []).map((t) => ({ value: t, label: t }))} />
            </Field>
          </>
        )}
        <Button leftIcon="sparkles" onClick={() => void generate()} disabled={busy || !ready || tagsMissing || repoMissing}>
          {busy ? "Membangkitkan…" : "Bangkitkan"}
        </Button>
      </div>

      {(tagsMissing || repoMissing) && <Callout tone="warn">{src?.reason}</Callout>}

      {result && (
        <div style={{ marginTop: 8 }}>
          {result.warning && <Callout tone="warn">{result.warning}</Callout>}
          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0" }}>
            <Badge tone={result.generator === "agent" ? "ok" : "warn"} size="sm">
              {result.generator === "agent" ? "naratif" : "draf ringkas"}
            </Badge>
            <span style={{ fontSize: 11.5, color: "var(--text-subtle)" }}>{result.itemCount} perubahan</span>
          </div>
          <MarkdownView text={result.body} name="changelog.md" />
        </div>
      )}

      {saved.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="hn-eyebrow" style={{ marginBottom: 6 }}>Tersimpan</div>
          {saved.map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
              <Button size="sm" variant="ghost" onClick={() => setResult(c)}>{c.title}</Button>
              <span style={{ fontSize: 11.5, color: "var(--text-subtle)" }}>{c.mode}</span>
              <div style={{ flex: 1 }} />
              <Button size="sm" variant="ghost" leftIcon="trash-2" aria-label={`Hapus ${c.title}`}
                onClick={() => void remove(c.id)} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
