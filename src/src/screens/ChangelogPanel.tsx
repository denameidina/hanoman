/* ChangelogPanel (SPEC-516 · ADR-0105 · letak & jangkauan: SPEC-519) — generator changelog naratif
   per project lewat tiga mode. Panggilan agen bisa puluhan detik, jadi statusnya eksplisit: tombol
   berubah teks dan nonaktif, bukan spinner bisu.

   Sejak SPEC-519 panel ini generator MURNI: hasilnya diserahkan lewat `onGenerated` dan dirender
   ChangelogScreen di kartu detail yang sama dengan rilis lama. Satu jalur render untuk semua rilis
   — kalau panel ikut merender, hasil yang sama muncul dua kali begitu ia dipilih dari daftar. */
import React from "react";
import { Card, Button, Input, Select, Field, Callout } from "../ds";
import { api } from "../api/client";
import type { ChangelogView, ChangelogSources, ChangelogRequest } from "@hanoman/shared";
import type { ProjectVM } from "./types";

type Mode = "backlog" | "commit" | "version";
const MODE_TABS: Array<{ mode: Mode; label: string; hint: string }> = [
  { mode: "backlog", label: "Rentang tanggal", hint: "backlog yang selesai di rentang itu" },
  { mode: "commit", label: "Rentang commit", hint: "perubahan repo antara dua revisi" },
  { mode: "version", label: "Versi rilis", hint: "perubahan yang masuk ke sebuah versi" },
];

export function ChangelogPanel({ p, onToast, onGenerated }:
  { p: ProjectVM; onToast: (msg: string, kind?: string, icon?: string) => void;
    onGenerated?: (v: ChangelogView) => void }) {
  const [mode, setMode] = React.useState<Mode>("backlog");
  const [src, setSrc] = React.useState<ChangelogSources | null>(null);
  const [from, setFrom] = React.useState(""); const [to, setTo] = React.useState("");
  const [fromSha, setFromSha] = React.useState(""); const [toSha, setToSha] = React.useState("");
  const [fromTag, setFromTag] = React.useState(""); const [toTag, setToTag] = React.useState("");
  const [busy, setBusy] = React.useState(false);

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
    return () => { alive = false; };
  }, [p.id]);

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
      onToast(r.generator === "agent" ? "Changelog dibangkitkan" : "Changelog dibangkitkan (draf ringkas)",
        r.generator === "agent" ? "ok" : "warn", "file-text");
      onGenerated?.(r);
    } catch (e) {
      onToast((e as Error).message || "Gagal membangkitkan changelog", "err", "x-circle");
    } finally { setBusy(false); }
  }

  const tagsMissing = mode === "version" && src !== null && src.tags.length === 0;
  const repoMissing = mode === "commit" && src !== null && !!src.reason && src.tags.length === 0;

  return (
    <Card eyebrow="changelog" title="Ringkasan perubahan untuk pemakai">
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
    </Card>
  );
}
