/* SPEC-1215 §S4.9 · AC-D5/D10 · pencarian log terpusat: penyaring, kursor (tanpa total), transkrip,
   blok retensi. Pola dense-row + StateBlock mengikuti ClientsScreen.tsx. */
import React from "react";
import { logs, logRetention, logTranscript, putLogRetention, type LogSearchQueryInput } from "../api/client";
import type { LogEntryView, LogRetention } from "@hanoman/shared";
import { StateBlock } from "../ds";
import "./styles/panels.css";

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 24 * 3600_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function LogsPanel() {
  const [query, setQuery] = React.useState<LogSearchQueryInput>(defaultRange());
  const [items, setItems] = React.useState<LogEntryView[]>([]);
  const [nextCursor, setNextCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [openTranscript, setOpenTranscript] = React.useState<{ id: number; text: string } | null>(null);
  const [retention, setRetention] = React.useState<LogRetention | null>(null);

  async function load(cursor?: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await logs({ ...query, cursor });
      setItems((prev) => (cursor ? [...prev, ...res.items] : res.items));
      setNextCursor(res.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void load();
    void logRetention().then(setRetention).catch(() => { /* server lama: blok retensi tak muncul */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.from, query.to, query.deviceId, query.projectId, query.specId, query.lane, query.level, query.kind, query.q]);

  async function openRow(row: LogEntryView) {
    if (!row.hasTranscript) return;
    const text = await logTranscript(row.id);
    setOpenTranscript({ id: row.id, text });
  }

  async function saveRetention(r: LogRetention) {
    const saved = await putLogRetention(r);
    setRetention(saved);
  }

  if (error) {
    return (
      <StateBlock kind="error" title="Gagal memuat log" hint={error}
        action={() => void load()} actionLabel="Coba lagi" />
    );
  }

  return (
    <div className="hn-logs-panel">
      <form onSubmit={(e) => { e.preventDefault(); void load(); }} className="hn-logs-filter">
        <input type="datetime-local" aria-label="Dari" value={query.from.slice(0, 16)}
          onChange={(e) => setQuery((q) => ({ ...q, from: new Date(e.target.value).toISOString() }))} />
        <input type="datetime-local" aria-label="Sampai" value={query.to.slice(0, 16)}
          onChange={(e) => setQuery((q) => ({ ...q, to: new Date(e.target.value).toISOString() }))} />
        <input type="text" aria-label="Device" placeholder="deviceId" value={query.deviceId ?? ""}
          onChange={(e) => setQuery((q) => ({ ...q, deviceId: e.target.value || undefined }))} />
        <input type="text" aria-label="Project" placeholder="projectId" value={query.projectId ?? ""}
          onChange={(e) => setQuery((q) => ({ ...q, projectId: e.target.value || undefined }))} />
        <input type="text" aria-label="Spec" placeholder="specId" value={query.specId ?? ""}
          onChange={(e) => setQuery((q) => ({ ...q, specId: e.target.value || undefined }))} />
        <select aria-label="Lajur" value={query.lane ?? ""}
          onChange={(e) => setQuery((q) => ({ ...q, lane: e.target.value || undefined }))}>
          <option value="">semua lajur</option>
          <option value="event">event</option>
          <option value="server">server</option>
          <option value="transcript">transcript</option>
        </select>
        <select aria-label="Level" value={query.level ?? ""}
          onChange={(e) => setQuery((q) => ({ ...q, level: e.target.value || undefined }))}>
          <option value="">semua level</option>
          <option value="debug">debug</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
        </select>
        <input type="text" aria-label="kind" placeholder="mis. launch.rejected" value={query.kind ?? ""}
          onChange={(e) => setQuery((q) => ({ ...q, kind: e.target.value || undefined }))} />
        <input type="search" aria-label="Cari" placeholder="mis. celah log" value={query.q ?? ""}
          onChange={(e) => setQuery((q) => ({ ...q, q: e.target.value || undefined }))} />
        <button type="submit">Cari</button>
      </form>

      {loading && items.length === 0
        ? <StateBlock kind="loading" title="Memuat log…" compact />
        : items.length === 0
          ? <StateBlock kind="empty" title="Tidak ada log pada rentang/penyaring ini" compact />
          : (
            <ul className="hn-logs-list">
              {items.map((row) => (
                <li key={row.id}
                  className={`hn-dense-row hn-logs-row${row.hasTranscript ? " hn-logs-row--open" : ""}`}
                  role={row.hasTranscript ? "button" : undefined}
                  tabIndex={row.hasTranscript ? 0 : undefined}
                  onClick={() => void openRow(row)}>
                  <span className="hn-logs-ts">
                    {row.ts}
                  </span>
                  <span className="hn-logs-meta">{row.lane}</span>
                  <span className="hn-logs-meta">{row.level}</span>
                  <span className="hn-logs-meta">{row.kind}</span>
                  <span className="hn-logs-msg">{row.msg}</span>
                </li>
              ))}
            </ul>
          )}

      {nextCursor && (
        <button type="button" onClick={() => void load(nextCursor)}>Muat lagi</button>
      )}

      {openTranscript && (
        <section>
          <button type="button" onClick={() => setOpenTranscript(null)}>Tutup transkrip</button>
          <pre className="hn-logs-transcript">{openTranscript.text}</pre>
        </section>
      )}

      {retention && (
        <section className="hn-logs-retention">
          <h3 className="hn-logs-h3">Retensi</h3>
          <div className="hn-logs-filter">
            <label>
              event (hari)
              <input type="number" placeholder="mis. 90" value={retention.eventDays}
                onChange={(e) => setRetention({ ...retention, eventDays: Number(e.target.value) })} />
            </label>
            <label>
              server (hari)
              <input type="number" placeholder="mis. 7" value={retention.serverDays}
                onChange={(e) => setRetention({ ...retention, serverDays: Number(e.target.value) })} />
            </label>
            <label>
              transcript (hari)
              <input type="number" placeholder="mis. 30" value={retention.transcriptDays}
                onChange={(e) => setRetention({ ...retention, transcriptDays: Number(e.target.value) })} />
            </label>
            <label>
              maxBytes
              <input type="number" placeholder="mis. 268435456" value={retention.maxBytes}
                onChange={(e) => setRetention({ ...retention, maxBytes: Number(e.target.value) })} />
            </label>
          </div>
          <button type="button" onClick={() => void saveRetention(retention)}>Simpan</button>
        </section>
      )}
    </div>
  );
}
