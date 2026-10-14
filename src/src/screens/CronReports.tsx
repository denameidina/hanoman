/* CronReports — laporan hasil run cron (ADR-0222), panel di tab Cron hub Otonom.

   Daftar dimuat per project (bukan per cron): cron milik mesin lain tak ada di daftar cron lokal,
   tetapi laporannya tersync dan harus tetap terbaca. Isi satu laporan dimuat HANYA saat pengguna
   membukanya (daftar tak membawa `body`), dan data tiba lewat sync — tak ada polling (ADR-0039). */
import React from "react";
import { Badge, Button, DenseRow, Pager, RowList, SkeletonList, MarkdownView, serverPage } from "../ds";
import { api } from "../api/client";
import type { CronReportDetail, CronReportView } from "@hanoman/shared";
import { failureMessage } from "../lib/report-error";
import { InlineError } from "./sched-lead-shared";

const PAGE = 10;

const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KiB`);

/** Unduh `.md` apa adanya (hanya markdown, tanpa format lain). */
function download(r: CronReportDetail): void {
  const url = URL.createObjectURL(new Blob([r.body], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = r.filename; a.click();
  URL.revokeObjectURL(url);
}

function ReportBody({ id }: { id: string }) {
  const [r, setR] = React.useState<CronReportDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const load = React.useCallback(() => {
    let alive = true;
    api.getCronReport(id)
      .then((x) => { if (alive) { setR(x); setError(null); } })
      .catch((e) => { if (alive) setError(failureMessage("memuat laporan", e)); });
    return () => { alive = false; };
  }, [id]);
  React.useEffect(() => load(), [load]);
  if (error) return <InlineError message={error} onRetry={() => { load(); }} />;
  if (!r) return <SkeletonList rows={2} label="Memuat laporan…" />;
  return (
    <div className="hn-sched-report-body">
      <div className="hn-sched-report-actions">
        <span className="hn-sched-row-meta">{r.filename}</span>
        <Button size="sm" variant="ghost" leftIcon="download" onClick={() => download(r)}>Unduh .md</Button>
      </div>
      <MarkdownView text={r.body} name={r.filename} />
    </div>
  );
}

export function CronReports({ projectId, projectName }: { projectId?: string; projectName?: (id: string) => string }) {
  const [items, setItems] = React.useState<CronReportView[]>([]);
  const [total, setTotal] = React.useState(0);
  const [page, setPage] = React.useState(1);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    let alive = true;
    api.listCronReports({ projectId, page, limit: PAGE })
      .then((r) => { if (alive) { setItems(r.items); setTotal(r.total); setLoaded(true); setError(null); } })
      .catch((e) => { if (alive) { setError(failureMessage("memuat laporan cron", e)); setLoaded(true); } });
    return () => { alive = false; };
  }, [projectId, page]);
  React.useEffect(() => { setPage(1); setOpen(null); }, [projectId]);
  React.useEffect(() => { setLoaded(false); return load(); }, [load]);

  if (error) return <InlineError message={error} onRetry={() => { load(); }} />;
  if (!loaded) return <SkeletonList rows={2} label="Memuat laporan cron…" />;
  if (total === 0) return <p className="hn-sched-empty">Belum ada laporan. Laporan tersimpan otomatis dari pesan akhir tiap run cron.</p>;
  const sp = serverPage(total, page, PAGE);
  // Mode "Semua project": kelompokkan per project dalam halaman yang tampil (urutan kemunculan,
  // terbaru dulu), dengan judul project di atas tiap kelompok.
  const grouped = !projectId && projectName;
  const shown = grouped
    ? [...items].sort((a, b) => items.findIndex((x) => x.projectId === a.projectId) - items.findIndex((x) => x.projectId === b.projectId))
    : items;
  return (
    <>
      <RowList label="Laporan run cron">
        {shown.map((r, i) => (
          <React.Fragment key={r.id}>
          {grouped && r.projectId !== shown[i - 1]?.projectId && (
            <h4 className="hn-sched-group-title hn-sched-group-sub">{projectName(r.projectId)}</h4>
          )}
          <DenseRow>
            <span className="hn-sched-row-text">
              <span className="hn-sched-row-head">
                <span className="hn-sched-row-title">{r.cronName}</span>
                <Badge tone="neutral" size="sm">{r.runDate}</Badge>
                <Button size="sm" variant="ghost" aria-expanded={open === r.id}
                  onClick={() => setOpen(open === r.id ? null : r.id)}>
                  {open === r.id ? "Sembunyikan" : "Baca"}
                </Button>
              </span>
              <span className="hn-sched-row-meta">{fmtBytes(r.bytes)} · {r.filename}</span>
              {open === r.id && <ReportBody id={r.id} />}
            </span>
          </DenseRow>
          </React.Fragment>
        ))}
      </RowList>
      <Pager page={sp.page} pageCount={sp.pageCount} total={total} from={sp.from} to={sp.to} onPage={setPage} unit="laporan" />
    </>
  );
}
