/* Ported from .prototype/app/AppUI.jsx — interaction primitives.
   ESM + typed; window global removed. No visual change. */
import React from "react";
import { Icon } from "./icon";
import { FieldLinkContext, ariaInvalid, useFieldLink, type FieldLinkValue } from "./components/forms";
// Kelas Toast, Modal, Field, dan Pager (dan App/PetAnswer). Diimpor di sini: setelah app.css (main.tsx).
import "../styles/app-shell.css";
// Varian danger Field (`.hn-field[data-tone]`) hidup di forms.css bersama Radio.
import "./components/forms.css";

const modalStack: symbol[] = [];

// Audit UI/UX 2026-10 · Fase 2B · latar modal inert. Saat modal terbuka, setiap saudara (sibling)
// dari leluhur panelnya — sampai anak `body` — diberi `inert`: fokus, klik, dan pembaca layar tak
// bisa masuk ke belakang modal. Hitungan per elemen menjaga modal bertumpuk: latar baru dilepas
// bila modal terakhir yang menandainya sudah tutup. Toast (`data-hn-toast-host`) dikecualikan agar
// tetap diumumkan dan bisa diurungkan selagi modal terbuka.
const inertCount = new Map<Element, number>();
function inertBackground(from: Element): () => void {
  const marked: Element[] = [];
  let node: Element = from;
  while (node !== document.body && node.parentElement) {
    for (const sib of Array.from(node.parentElement.children)) {
      if (sib === node || sib.hasAttribute("data-hn-toast-host")) continue;
      const n = inertCount.get(sib) ?? 0;
      inertCount.set(sib, n + 1);
      if (n === 0) sib.setAttribute("inert", "");
      marked.push(sib);
    }
    node = node.parentElement;
  }
  return () => {
    for (const el of marked) {
      const n = (inertCount.get(el) ?? 1) - 1;
      if (n > 0) { inertCount.set(el, n); continue; }
      inertCount.delete(el);
      el.removeAttribute("inert");
    }
  };
}

// ── Toast · antrean (Audit UI/UX 2026-10 · Fase 2B) ─────────────────────────────────────
// Maksimal TOAST_VISIBLE terlihat sekaligus; sisanya menunggu dan baru tampil ketika ada slot.
// Tiap toast punya timernya sendiri yang mulai saat ia terlihat dan berhenti selama kursor atau
// fokus ada di dalamnya. Toast ber-aksi ("Urungkan") bertahan lebih lama. Wadah live region
// (`role="status"`) selalu ada di DOM; toast bernada `err` membawa `role="alert"` sendiri.
export const TOAST_VISIBLE = 3;
const TOAST_MS = 2600;
const TOAST_ACTION_MS = 7000;

export type ToastAction = { label: string; onAction: () => void };
export type ToastOptions = { action?: ToastAction; duration?: number };
export type ToastData = { message: React.ReactNode; tone?: string; icon?: string; k: number;
  action?: ToastAction; duration?: number };
/** Keadaan antrean yang dikembalikan `useToast()` dan dirender `ToastHost` / `Toast`. */
export type ToastQueue = { items: ToastData[]; dismiss: (k: number) => void };
export type ShowToast = (message: React.ReactNode, tone?: string, icon?: string, opts?: ToastOptions) => void;

export function useToast(): [ToastQueue, ShowToast] {
  const [items, setItems] = React.useState<ToastData[]>([]);
  const seq = React.useRef(0);
  const show = React.useCallback<ShowToast>((message, tone = "ok", icon, opts) => {
    const k = ++seq.current;
    setItems((prev) => [...prev, { k, message, tone, icon, action: opts?.action, duration: opts?.duration }]);
  }, []);
  const dismiss = React.useCallback((k: number) => setItems((prev) => prev.filter((t) => t.k !== k)), []);
  const queue = React.useMemo<ToastQueue>(() => ({ items, dismiss }), [items, dismiss]);
  return [queue, show];
}

function ToastItem({ toast, onDone }: { toast: ToastData; onDone?: (k: number) => void }) {
  const tone = toast.tone || "ok";
  const err = tone === "err";
  const color = err ? "var(--clay-500)" : tone === "warn" ? "var(--amber-500)"
    : tone === "info" ? "var(--wind-600)" : "var(--leaf-500)";
  const icon = toast.icon || (err ? "x-circle" : tone === "warn" ? "alert-triangle"
    : tone === "info" ? "info" : "check-circle-2");
  const action = toast.action;
  const duration = toast.duration ?? (action ? TOAST_ACTION_MS : TOAST_MS);
  const [hover, setHover] = React.useState(false);
  const [focus, setFocus] = React.useState(false);
  const [gone, setGone] = React.useState(false);
  const paused = hover || focus;
  const left = React.useRef(duration);
  const since = React.useRef(0);
  const doneRef = React.useRef(onDone);
  doneRef.current = onDone;
  const k = toast.k;
  const dismiss = () => { if (doneRef.current) doneRef.current(k); else setGone(true); };

  // Timer berjalan hanya saat tidak dijeda. Saat dijeda, sisa waktu dikurangi dengan yang sudah
  // berlalu — jadi toast yang disorot tak hilang di tengah dibaca.
  React.useEffect(() => {
    if (paused) return;
    since.current = Date.now();
    const timer = setTimeout(() => {
      if (doneRef.current) doneRef.current(k); else setGone(true);
    }, left.current);
    return () => {
      clearTimeout(timer);
      left.current = Math.max(0, left.current - (Date.now() - since.current));
    };
  }, [paused, k]);

  if (gone) return null;
  return (
    <div className={action ? "hn-toast hn-toast--action" : "hn-toast"} role={err ? "alert" : undefined} aria-live={err ? "assertive" : undefined}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false); }}>
      <Icon name={icon} size={16} color={color} />
      <span className="hn-toast-msg">{toast.message}</span>
      {action && (
        <button type="button" onClick={() => { action.onAction(); dismiss(); }} className="hn-toast-action">{action.label}</button>
      )}
    </div>
  );
}

/** Wadah live region toast. Selalu dirender — pembaca layar menangkap toast yang masuk walau
 *  wadahnya kosong saat itu. Tiap toast bernada `err` diumumkan assertive lewat `role="alert"`. */
export function ToastHost({ toast }: { toast?: ToastQueue | ToastData | null }) {
  const queue = toast && "items" in toast ? toast : null;
  const single = toast && !("items" in toast) ? toast : null;
  const items = queue ? queue.items : single ? [single] : [];
  const dismiss = queue ? queue.dismiss : undefined;
  const visible = items.slice(0, TOAST_VISIBLE);
  return (
    <div data-hn-toast-host="" role="status" aria-live="polite" className="hn-toast-host">
      {visible.map((t) => <ToastItem key={t.k} toast={t} onDone={dismiss} />)}
    </div>
  );
}

/** Nama lama. Tetap dipakai pemanggil lama tanpa perubahan — kini merender antrean lewat `ToastHost`. */
export function Toast({ toast }: { toast?: ToastQueue | ToastData | null }) {
  return <ToastHost toast={toast} />;
}

// Audit UI/UX 2026-10 · Fase 2B · `dismissible=false` mematikan Escape, klik latar, dan tombol ×
// (dipakai ConfirmDialog selama mutasi berjalan). Judul adalah <h2> yang dirujuk aria-labelledby.
export function Modal({ open, title, eyebrow, icon, onClose, footer, width = 560, closeOnEscape = true, dismissible = true, fillHeight = false, children }:
  { open: boolean; title?: React.ReactNode; eyebrow?: React.ReactNode; icon?: string;
    onClose?: () => void; footer?: React.ReactNode; width?: number; closeOnEscape?: boolean;
    dismissible?: boolean; fillHeight?: boolean; children?: React.ReactNode }) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const stackId = React.useRef(Symbol("modal"));
  const titleId = React.useId();
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  const dismissRef = React.useRef(dismissible);
  dismissRef.current = dismissible;
  const canDismiss = dismissible && !!onClose;

  React.useLayoutEffect(() => {
    if (!open || !panelRef.current) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const id = stackId.current;
    modalStack.push(id);
    const releaseBackground = inertBackground(panel);
    const controls = () => Array.from(panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ));
    // Fokus awal: `data-initial-focus` (mis. "Batal" pada konfirmasi destruktif) lebih dulu, lalu
    // isian pertama, lalu tombol pertama.
    const initial = panel.querySelector<HTMLElement>("[data-initial-focus]:not([disabled])")
      ?? panel.querySelector<HTMLElement>("[autofocus]")
      ?? panel.querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled]), select:not([disabled])')
      ?? panel.querySelector<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])');
    initial?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (modalStack.at(-1) !== id) return;
      if (event.key === "Escape" && closeOnEscape) {
        if (!dismissRef.current) return;
        event.preventDefault();
        closeRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = controls();
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        event.preventDefault();
        panel.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      const index = modalStack.lastIndexOf(id);
      if (index >= 0) modalStack.splice(index, 1);
      releaseBackground();
      previous?.focus();
    };
  }, [closeOnEscape, open]);

  if (!open) return null;
  return (
    <div className="hn-modal-overlay hn-modal-scrim" onMouseDown={(e) => { if (canDismiss && e.target === e.currentTarget) onClose?.(); }}>
      {/* SPEC-363 · `fillHeight` untuk modal yang MEMBACA dokumen: tanpa tinggi pasti di panel,
          isinya cuma bisa memakai tinggi tetap (dulu `62vh`) dan membuang 18–23% ruang di tiap
          layar. Opt-in supaya 20-an modal lain tetap setinggi isinya. */}
      <div
        ref={panelRef}
        data-testid="modal-panel"
        className={fillHeight ? "hn-modal-panel hn-modal-sheet hn-modal-panel--fill" : "hn-modal-panel hn-modal-sheet"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        style={{ width }}>
        <div className="hn-modal-header">
          {icon && (
            <span className="hn-modal-icon">
              <Icon name={icon} size={17} />
            </span>
          )}
          <div className="hn-grow-min">
            {eyebrow && <div className="hn-eyebrow hn-modal-eyebrow">{eyebrow}</div>}
            {title && (
              <h2 id={titleId} className="hn-modal-title">{title}</h2>
            )}
          </div>
          <button type="button" onClick={() => { if (canDismiss) onClose?.(); }} disabled={!canDismiss} aria-label="Tutup" className="hn-modal-close"><Icon name="x" size={18} /></button>
        </div>
        <div data-testid="modal-body" className={fillHeight ? "hn-modal-body hn-modal-body--fill" : "hn-modal-body"}>{children}</div>
        {footer && (
          <div className="hn-modal-footer">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

// Audit UI/UX 2026-10 · Fase 2B · label dan hint dipisah. Label adalah <label htmlFor> ke kontrol
// pemilik (kontrol pertama di dalamnya); hint dan error ditautkan lewat aria-describedby; error
// tampil dengan role="alert" dan menyalakan aria-invalid pada kontrol. Pembungkus tak lagi
// memuat seluruh isi di dalam <label>.
// `tone="danger"` menyalakan keadaan invalid TANPA pesan: label berwarna galat dan kontrol di dalamnya
// mendapat border `--status-err` + aria-invalid, persis seperti `invalid` (Input). Pesan tetap lewat `error`.
export function Field({ label, hint, error, tone = "default", children }: {
  label?: React.ReactNode; hint?: React.ReactNode; error?: React.ReactNode; tone?: "default" | "danger";
  children?: React.ReactNode;
}) {
  const uid = React.useId();
  const hintId = hint ? `${uid}-hint` : undefined;
  const errorId = error ? `${uid}-error` : undefined;
  const [claims, setClaims] = React.useState<{ token: string; id: string }[]>([]);
  const register = React.useCallback((token: string, explicitId?: string) => {
    const id = explicitId ?? `${uid}-control`;
    setClaims((prev) => {
      const at = prev.findIndex((c) => c.token === token);
      if (at < 0) return [...prev, { token, id }];
      return prev[at]!.id === id ? prev : prev.map((c, i) => (i === at ? { token, id } : c));
    });
  }, [uid]);
  const unregister = React.useCallback((token: string) => {
    setClaims((prev) => prev.filter((c) => c.token !== token));
  }, []);
  const owner = claims[0] ?? null;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  const invalid = !!error || tone === "danger";
  const link = React.useMemo<FieldLinkValue>(() => ({
    owner, describedBy, invalid, register, unregister,
  }), [owner, describedBy, invalid, register, unregister]);
  return (
    <FieldLinkContext.Provider value={link}>
      <div className="hn-field" data-tone={tone}>
        {label && (
          <label htmlFor={owner?.id} className="hn-field-label">{label}</label>
        )}
        {children}
        {hint && <div id={hintId} className="hn-field-hint">{hint}</div>}
        {error && <div id={errorId} role="alert" className="hn-field-error">{error}</div>}
      </div>
    </FieldLinkContext.Provider>
  );
}

// SPEC-407 · `...rest` diteruskan ke <textarea> supaya atribut aksesibilitas (`aria-label`,
// `id`, `data-testid`) bisa dipasang dari call site — `Input` sudah lama begitu, dan tanpa ini
// textarea di modal tak punya nama yang bisa dipegang pembaca layar maupun test.
// Fase 2B: `onFocus`/`onBlur` pemanggil DIGABUNG (dulu ditimpa), dan `invalid`/`aria-invalid` menyalakan
// border error. Kelas `hn-textarea-core` mematikan outline bawaan agar fokus hanya tergambar sekali.
export function HnTextarea({ value, onChange, rows = 3, placeholder, mono = false, invalid = false, onFocus, onBlur, ...rest }:
  { value?: string; onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void; rows?: number; placeholder?: string; mono?: boolean; invalid?: boolean }
  & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "rows" | "placeholder" | "style">) {
  const [focus, setFocus] = React.useState(false);
  const link = useFieldLink({ id: rest.id, describedBy: rest["aria-describedby"], invalid: invalid || ariaInvalid(rest["aria-invalid"]) });
  const bad = link.invalid;
  return (
    <textarea {...rest} id={link.id} aria-describedby={link.describedBy} aria-invalid={bad ? true : rest["aria-invalid"]}
      className="hn-textarea-core" value={value} onChange={onChange} rows={rows} placeholder={placeholder}
      onFocus={(e) => { setFocus(true); onFocus?.(e); }}
      onBlur={(e) => { setFocus(false); onBlur?.(e); }} style={{
        display: "block", width: "100%", boxSizing: "border-box", resize: "vertical",
        fontFamily: mono ? "var(--font-mono)" : "var(--font-ui)", fontSize: 13,
        color: "var(--text-strong)", background: "var(--surface-card)",
        border: `1px solid ${bad ? "var(--status-err)" : focus ? "var(--border-focus)" : "var(--border-strong)"}`,
        borderRadius: "var(--radius-sm)", padding: "9px 11px", lineHeight: 1.5,
        boxShadow: focus ? "var(--ring)" : bad ? "none" : "var(--shadow-inset)", outline: "none",
      }} />
  );
}

/* Area baris sebuah daftar: menyerap SEMUA sisa tinggi dan menggulir di dalamnya,
   sehingga Pager tetap di bawah tanpa jatuh ke luar layar.

   Dulu ini `maxHeight: calc(100vh - 340px)`. 340 itu tebakan tinggi topbar + chrome
   card + pager, dan tebakan itu salah di tiap layar dengan takaran berbeda — layar
   yang filter bar-nya lebih tinggi menyisakan lubang di bawah, yang lebih pendek
   memotong daftarnya. Rantai flex sudah tahu tinggi sebenarnya sejak `#root` (100vh):
   `min-height: 0` melepas batas min-content flex item, `flex: 1` menyuruhnya isi sisa.
   Tak ada angka yang perlu dijaga tetap sinkron dengan CSS di tempat lain.

   Pemakaiannya berpasangan: root layar memakai LIST_SCREEN_STYLE, saudara yang
   tingginya tetap (header, legend, pager) memakai FIXED_ROW_STYLE. */
export const LIST_SCROLL_STYLE: React.CSSProperties = { flex: "1 1 auto", minHeight: 0, overflowY: "auto" };
export const LIST_SCREEN_STYLE: React.CSSProperties = { display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 };
export const FIXED_ROW_STYLE: React.CSSProperties = { flex: "0 0 auto" };

// SPEC-198 · paginasi server-driven: total datang dari envelope API, komponen cuma perlu
// menghitung metadata Pager (bukan memotong array — server sudah memotong).
export function serverPage(total: number, page: number, pageSize: number) {
  const pageCount = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const p = Math.min(Math.max(1, page), pageCount);
  const from = total === 0 ? 0 : (p - 1) * pageSize + 1;
  const to = Math.min(total, p * pageSize);
  return { page: p, pageCount, from, to };
}


function PagerBtn({ children, onClick, disabled, active, aria }:
  { children?: React.ReactNode; onClick?: () => void; disabled?: boolean; active?: boolean; aria?: string }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button className="hn-touch-target" onClick={disabled ? undefined : onClick} disabled={disabled} aria-label={aria}
      aria-current={active ? "page" : undefined}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        minWidth: 28, height: 28, padding: "0 7px", borderRadius: "var(--radius-sm)",
        border: `1px solid ${active ? "var(--brass-400)" : "var(--border-hair)"}`,
        background: active ? "var(--brass-100)" : (hover && !disabled ? "var(--bone-200)" : "var(--surface-card)"),
        color: disabled ? "var(--text-subtle)" : active ? "var(--brass-700)" : "var(--text-body)",
        fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: active ? 600 : 400,
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
      }}>
      {children}
    </button>
  );
}

function pageWindow(page: number, pageCount: number): (number | string)[] {
  const out: (number | string)[] = [];
  const near = (n: number) => n === 1 || n === pageCount || Math.abs(n - page) <= 1;
  let last = 0;
  for (let n = 1; n <= pageCount; n++) {
    if (near(n)) { if (last && n - last > 1) out.push("…"); out.push(n); last = n; }
  }
  return out;
}

export function Pager({ page, pageCount, total, from, to, onPage, unit = "item" }:
  { page: number; pageCount: number; total: number; from: number; to: number; onPage: (n: number) => void; unit?: string }) {
  if (total === 0) return null;
  return (
    <div className="hn-pager">
      <span className="hn-pager-count">
        {from}–{to} dari {total} {unit}
      </span>
      <div className="hn-pager-btns">
        <PagerBtn onClick={() => onPage(page - 1)} disabled={page <= 1} aria="Sebelumnya">
          <Icon name="chevron-left" size={15} />
        </PagerBtn>
        {pageWindow(page, pageCount).map((n, i) => n === "…"
          ? <span key={"e" + i} className="hn-pager-gap">…</span>
          : <PagerBtn key={n} onClick={() => onPage(n as number)} active={n === page} aria={"Halaman " + n}>{n}</PagerBtn>)}
        <PagerBtn onClick={() => onPage(page + 1)} disabled={page >= pageCount} aria="Berikutnya">
          <Icon name="chevron-right" size={15} />
        </PagerBtn>
      </div>
    </div>
  );
}
