// Palet perintah ⌘K (Audit UI/UX 2026-10 · Fase 2C). Dialog memakai Modal DS: role="dialog",
// aria-modal, focus masuk ke kotak kueri, Esc menutup, fokus kembali ke pemicunya.
// Kotak kueri adalah combobox, daftar hasilnya listbox; panah mengganti opsi aktif lewat
// aria-activedescendant sehingga fokus tetap di kotak kueri.
import React from "react";
import { Modal } from "../ds/kit";
import { Icon } from "../ds/icon";
import { usePersistedState } from "../ui-state/hooks";
import { strList, uiKey, writeUiState } from "../ui-state/store";
import { closePalette, usePaletteUi } from "./ui-store";
import {
  flattenResults, pushRecent, searchCommands, type PaletteCommand,
} from "./commands";

export function CommandPalette({ commands }: { commands: readonly PaletteCommand[] }) {
  const { palette } = usePaletteUi();
  return (
    <Modal open={palette} onClose={closePalette} title="Palet perintah" width={600}>
      <PaletteBody commands={commands} />
    </Modal>
  );
}

function PaletteBody({ commands }: { commands: readonly PaletteCommand[] }) {
  const uid = React.useId();
  const listId = `${uid}-list`;
  const optionId = (i: number) => `${uid}-opt-${i}`;
  const [query, setQuery] = React.useState("");
  // `pick` = opsi yang dipilih pengguna (panah/hover). null = opsi aktif pertama yang tak nonaktif.
  const [pick, setPick] = React.useState<number | null>(null);
  const [recent] = usePersistedState<string[]>("palette", "recent", [], strList);

  const results = React.useMemo(() => searchCommands(commands, query, recent), [commands, query, recent]);
  // Indeks per BARIS, bukan per id: satu perintah bisa tampil dua kali (Riwayat + grupnya).
  const rows = React.useMemo(() => {
    let n = 0;
    return results.map((g, gi) => ({
      group: g.group,
      gi,
      items: g.items.map(({ cmd }) => ({ cmd, index: n++ })),
    }));
  }, [results]);
  const flat = React.useMemo(() => flattenResults(results), [results]);
  const firstEnabled = flat.findIndex((c) => !c.disabled);
  const active = pick !== null && flat[pick] ? pick : firstEnabled;
  const activeCmd = flat[active];

  React.useEffect(() => {
    if (active >= 0) document.getElementById(optionId(active))?.scrollIntoView?.({ block: "nearest" });
    // optionId hanya bergantung pada uid, yang stabil per instance.
  }, [active, uid]);

  const run = (cmd: PaletteCommand) => {
    if (cmd.disabled) return;
    if (cmd.prefill !== undefined) {
      setQuery(cmd.prefill);
      setPick(null);
      return;
    }
    // Riwayat ditulis langsung ke storage: komponen ini unmount di baris berikutnya (closePalette),
    // jadi state usePersistedState tak sempat tersimpan.
    writeUiState(uiKey("palette", "recent"), pushRecent(recent, cmd.id));
    closePalette();
    cmd.run();
  };

  // Panah melewati perintah nonaktif dan membungkus; tanpa opsi yang bisa dipilih, tak terjadi apa-apa.
  const move = (delta: number) => {
    const n = flat.length;
    if (n === 0 || active < 0) return;
    for (let step = 1; step <= n; step++) {
      const next = (active + delta * step + n * step) % n;
      if (!flat[next]!.disabled) { setPick(next); return; }
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (activeCmd) run(activeCmd);
    }
  };

  return (
    <>
      <div className="hn-palette">
        <div className="hn-palette-search">
          <Icon name="search" size={16} color="var(--text-subtle)" />
          <input
            role="combobox"
            aria-label="Cari perintah, halaman, atau backlog"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeCmd ? optionId(active) : undefined}
            autoComplete="off"
            spellCheck={false}
            placeholder="mis. backlog atau buat project"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPick(null); }}
            onKeyDown={onKeyDown}
            className="hn-palette-input"
          />
        </div>

        <div id={listId} role="listbox" aria-label="Hasil perintah" className="hn-palette-list">
          {rows.length === 0 ? (
            <div role="status" className="hn-palette-empty">Tidak ada yang cocok dengan “{query.trim()}”.</div>
          ) : rows.map((g) => {
            // Id dari indeks grup: nama grup mengandung spasi ("Pindah ke") dan aria-labelledby memecahnya.
            const labelId = `${uid}-g-${g.gi}`;
            return (
              <div key={g.group} role="group" aria-labelledby={labelId} className="hn-palette-group">
                <div id={labelId} className="hn-palette-group-label">{g.group}</div>
                {g.items.map(({ cmd, index }) => {
                  const on = index === active;
                  return (
                    <div
                      key={`${g.group}:${cmd.id}`}
                      id={optionId(index)}
                      role="option"
                      aria-selected={on}
                      aria-disabled={cmd.disabled ? true : undefined}
                      className={`hn-palette-option${on ? " is-active" : ""}${cmd.disabled ? " is-disabled" : ""}`}
                      onMouseMove={() => { if (!cmd.disabled) setPick(index); }}
                      onClick={() => run(cmd)}
                    >
                      <span className="hn-palette-option-label">{cmd.label}</span>
                      {cmd.hint && <span className="hn-palette-option-hint">{cmd.hint}</span>}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <div className="hn-palette-foot" aria-hidden="true">
        <span><kbd>↑</kbd> <kbd>↓</kbd> pilih</span>
        <span><kbd>Enter</kbd> jalankan</span>
        <span><kbd>Esc</kbd> tutup</span>
      </div>
    </>
  );
}
