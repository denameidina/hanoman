// Dialog bantuan shortcut (tombol `?`). Isinya dari shortcuts.ts, jadi daftar di sini tak bisa
// menyimpang dari yang benar-benar bekerja.
import React from "react";
import { Modal } from "../ds/kit";
import { closeShortcutHelp, usePaletteUi } from "./ui-store";
import { isMacPlatform, shortcutSections } from "./shortcuts";

export function ShortcutHelp({ nav }: { nav: readonly { key: string; label: string }[] }) {
  const { help } = usePaletteUi();
  const sections = React.useMemo(() => shortcutSections(isMacPlatform(), nav), [nav]);
  return (
    <Modal open={help} onClose={closeShortcutHelp} title="Shortcut keyboard" width={560}>
      <div className="hn-shortcut-help">
        {sections.map((s) => (
          <section key={s.title} className="hn-shortcut-section">
            <h3 className="hn-shortcut-title">{s.title}</h3>
            <dl className="hn-shortcut-list">
              {s.rows.map((r) => (
                <div key={r.label} className="hn-shortcut-row">
                  <dt>{r.keys.map((k) => <kbd key={k}>{k}</kbd>)}</dt>
                  <dd>{r.label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
