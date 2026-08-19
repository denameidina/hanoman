// SPEC-847 · ADR-0125 · konfirmasi destruktif dengan bentuk pemanggilan seharga `window.confirm`:
// satu baris di tengah fungsi async, alur kontrol call site utuh. `dialog` dirender PEMANGGILNYA
// sendiri — bukan Provider di akar App — karena layar di repo ini dirender berdiri sendiri di
// test, dan Provider berarti nilai default yang diam-diam menjawab "batal" atau "ya".
import React from "react";
import { ConfirmDialog } from "./ConfirmDialog";

export type ConfirmOptions = {
  title: React.ReactNode;
  message?: React.ReactNode;
  impact?: React.ReactNode[];
  eyebrow?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  icon?: string;
  requireText?: string;
  // Bila diberikan, dialog TETAP terbuka dan `busy` sampai promise ini selesai — itulah yang
  // menahan submit ganda selama mutasi berjalan. Lemparannya diteruskan ke pemanggil supaya
  // `try/catch` call site berperilaku persis seperti saat mutasi ditulis inline.
  run?: () => Promise<unknown>;
};

type Pending = {
  options: ConfirmOptions;
  settle: (ok: boolean) => void;
  fail: (err: unknown) => void;
};

export function useConfirm() {
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [busy, setBusy] = React.useState(false);
  // Sumber kebenaran "masih boleh dijawab?" adalah ref, bukan state: klik kedua pada tombol
  // konfirmasi tiba sebelum React sempat me-render ulang dengan tombol yang sudah mati.
  const live = React.useRef<Pending | null>(null);

  const confirm = React.useCallback((options: ConfirmOptions) =>
    new Promise<boolean>((resolve, reject) => {
      // Dialog yang belum terjawab saat dialog lain diminta = pembatalan, bukan promise
      // yang menggantung selamanya.
      live.current?.settle(false);
      const next: Pending = { options, settle: resolve, fail: reject };
      live.current = next;
      setBusy(false);
      setPending(next);
    }), []);

  const cancel = React.useCallback(() => {
    const p = live.current;
    if (!p) return;
    live.current = null;
    setPending(null); setBusy(false);
    p.settle(false);
  }, []);

  const accept = React.useCallback(async () => {
    const p = live.current;
    if (!p) return;
    live.current = null;                       // klik berikutnya tak menemukan apa pun untuk dijalankan
    if (!p.options.run) { setPending(null); p.settle(true); return; }
    setBusy(true);
    try { await p.options.run(); setPending(null); setBusy(false); p.settle(true); }
    catch (e) { setPending(null); setBusy(false); p.fail(e); }
  }, []);

  const o = pending?.options;
  const dialog = (
    <ConfirmDialog
      open={!!pending} busy={busy}
      title={o?.title ?? ""} message={o?.message} impact={o?.impact} eyebrow={o?.eyebrow}
      confirmLabel={o?.confirmLabel} cancelLabel={o?.cancelLabel}
      tone={o?.tone} icon={o?.icon} requireText={o?.requireText}
      onConfirm={() => { void accept(); }} onCancel={cancel} />
  );

  return { confirm, dialog };
}
