import React from "react";
import type { Notification, Setting } from "@hanoman/shared";
import type { ShowToast } from "../ds/kit";
import { api } from "../api/client";
import { subscribe } from "../api/events";
import { playNotifySound, unlockNotifySound, type NotifySound } from "./sound";

export function maxAt(items: Notification[]): string {
  return items.reduce((m, n) => (n.createdAt > m ? n.createdAt : m), "");
}
export function newSince(items: Notification[], baseline: string): Notification[] {
  return items.filter((n) => n.createdAt > baseline);
}

export type NotifyPrefs = Pick<Setting, "notifyDone" | "notifySound" | "notifyDecision" | "notifyDecisionSound">;
export type ToastPlan = { msg: string; tone: "ok" | "warn" | "err"; icon: string; sound: NotifySound; enabled: boolean };

// SPEC-184 · satu tempat memutuskan bunyi/tampilan toast per tipe notifikasi.
export function toastFor(n: Notification, p: NotifyPrefs): ToastPlan {
  if (n.type === "decision")
    return { msg: `${n.specId ?? n.sessionId} · butuh keputusan`, tone: "warn", icon: "git-merge",
             sound: p.notifyDecisionSound as NotifySound, enabled: p.notifyDecision };
  // SPEC-253 · keluhan Help Center baru masuk (setiap tiket baru).
  if (n.type === "ticket")
    return { msg: n.title, tone: "warn", icon: "inbox",
             sound: p.notifyDecisionSound as NotifySound, enabled: true };
  return { msg: `${n.specId} · "${n.title}" selesai`, tone: "ok", icon: "check-circle-2",
           sound: p.notifySound as NotifySound, enabled: p.notifyDone };
}

// SPEC-196 · toast in-app hanya terlihat di tab yang fokus. Web Notifications API (native)
// muncul di level OS lepas dari tab mana yang aktif — supaya notifikasi tetap sampai saat user
// pindah tab. Hanya menembak saat document.hidden (tab fokus sudah dilayani toast → hindari
// double) dan izin granted. tag = id → OS mendedup bila poll mengulang notif yang sama.
function notifyOS(msg: string, n: Notification, onOpen?: (n: Notification) => void): void {
  if (!("Notification" in window) || window.Notification.permission !== "granted" || !document.hidden) return;
  try {
    const notif = new window.Notification(msg, { tag: n.id });
    notif.onclick = () => { window.focus(); onOpen?.(n); notif.close(); };
  } catch { /* sebagian browser melempar bila dipanggil tanpa service worker; abaikan */ }
}

type Ctx = { items: Notification[]; unread: number; total: number; markAllRead: () => void; clear: () => void; onOpen?: (n: Notification) => void };
// Nilai default aman: komponen yang merender <Shell> tanpa provider (mis. test) tak error.
// Di-export agar test bell bisa membungkus dengan value palsu (Task 6).
export const NotificationsContext = React.createContext<Ctx>({ items: [], unread: 0, total: 0, markAllRead: () => { }, clear: () => { } });
export const useNotifications = () => React.useContext(NotificationsContext);

export function NotificationsProvider({ showToast, onOpen, children }: { showToast: ShowToast; onOpen?: (n: Notification) => void; children: React.ReactNode }) {
  const [items, setItems] = React.useState<Notification[]>([]);
  const [unread, setUnread] = React.useState(0);
  // SPEC-523 · jumlah SELURUH notifikasi. Bell menampilkan 50 teratas; tanpa angka ini 50 itu
  // terbaca sebagai "semuanya" — persis salah baca yang melahirkan SPEC-523.
  const [total, setTotal] = React.useState(0);
  // baseline = createdAt terbesar yang sudah "dilihat". undefined = belum di-seed (mount pertama
  // TIDAK men-toast riwayat lama). Ref, bukan state: tak perlu memicu render.
  const baseline = React.useRef<string | undefined>(undefined);
  const prefs = React.useRef<NotifyPrefs>({ notifyDone: true, notifySound: "short", notifyDecision: true, notifyDecisionSound: "alert" });
  // SPEC-197 · onOpen berubah tiap render App (dep [sessions]); simpan di ref supaya `tick` stabil
  // dan efek poll tak teardown/rebuild tiap 3s (badai request selama sesi aktif).
  const onOpenRef = React.useRef(onOpen);
  onOpenRef.current = onOpen;

  // Settings nyaris tak pernah berubah: fetch sekali saat mount, bukan tiap tick (SPEC-197).
  const loadPrefs = React.useCallback(async () => {
    try {
      const s: Setting = await api.getSettings();
      prefs.current = { notifyDone: s.notifyDone, notifySound: s.notifySound, notifyDecision: s.notifyDecision, notifyDecisionSound: s.notifyDecisionSound };
    } catch { /* biarkan nilai lama */ }
  }, []);

  // SPEC-199 · data notif didorong lewat WS siar (grup "notifications"), bukan poll 10s.
  // Argumen = payload frame yang sudah di-fetch server.
  const handle = React.useCallback((data: { items: Notification[]; unread: number; total?: number }) => {
    setItems(data.items); setUnread(data.unread); setTotal(data.total ?? data.items.length);
    if (baseline.current === undefined) { baseline.current = maxAt(data.items); return; } // seed, no toast
    const fresh = newSince(data.items, baseline.current);
    const top = maxAt(data.items);
    if (top > baseline.current) baseline.current = top;
    const latest = fresh[0]; // items terbaru dulu (server orderBy desc)
    if (latest) {
      const t = toastFor(latest, prefs.current);
      if (t.enabled) { showToast(t.msg, t.tone, t.icon); playNotifySound(t.sound); notifyOS(t.msg, latest, onOpenRef.current); }
    }
  }, [showToast]);

  React.useEffect(() => {
    void loadPrefs();
    const unsub = subscribe((m) => { if (m.t === "notifications") handle({ items: m.items, unread: m.unread, total: m.total }); });
    // SPEC-192 · autoplay diblokir sampai user berinteraksi; unlock audio pada gestur pertama.
    const unlock = () => {
      unlockNotifySound();
      // SPEC-196 · requestPermission butuh gestur user; bonceng gestur unlock audio yang sama.
      if ("Notification" in window && window.Notification.permission === "default") void window.Notification.requestPermission();
      window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => { unsub(); window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
  }, [handle, loadPrefs]);

  const markAllRead = React.useCallback(() => {
    setUnread(0);
    api.markNotificationsRead().catch(() => { });
  }, []);
  const clear = React.useCallback(() => {
    setItems([]); setUnread(0); setTotal(0);
    api.clearNotifications().catch(() => { });
  }, []);

  return (
    <NotificationsContext.Provider value={{ items, unread, total, markAllRead, clear, onOpen }}>
      {children}
    </NotificationsContext.Provider>
  );
}
