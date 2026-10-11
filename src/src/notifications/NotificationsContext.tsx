import React from "react";
import type { Notification, Setting } from "@hanoman/shared";
import type { ShowToast } from "../ds/kit";
import { api } from "../api/client";
import { subscribe } from "../api/events";
import { playNotifySound, unlockNotifySound, type NotifySound } from "./sound";
import { failureMessage } from "../lib/report-error";

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

type Ctx = { items: Notification[]; unread: number; total: number; markAllRead: () => void; markRead: (id: string) => void; clear: () => void; onOpen?: (n: Notification) => void };
// Nilai default aman: komponen yang merender <Shell> tanpa provider (mis. test) tak error.
// Di-export agar test bell bisa membungkus dengan value palsu (Task 6).
export const NotificationsContext = React.createContext<Ctx>({ items: [], unread: 0, total: 0, markAllRead: () => { }, markRead: () => { }, clear: () => { } });
export const useNotifications = () => React.useContext(NotificationsContext);

export function NotificationsProvider({ showToast, onOpen, isViewing, children }: {
  showToast: ShowToast; onOpen?: (n: Notification) => void;
  /** Sesi keputusan yang sedang ditonton operator (Terminal, sesi itu terfokus): tak perlu toast. */
  isViewing?: (n: Notification) => boolean; children: React.ReactNode;
}) {
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
  // Ref seperti onOpenRef: `handle` tetap stabil, sementara isi App (layar, fokus sesi) selalu terbaru.
  const isViewingRef = React.useRef(isViewing);
  isViewingRef.current = isViewing;
  // Id notifikasi yang sudah men-toast. Satu notifikasi = satu toast, walau frame WS-nya berulang.
  const toasted = React.useRef<Set<string>>(new Set());
  // Diisi di bawah, setelah markRead didefinisikan. Dipakai aksi "Jawab" pada toast (dipanggil kemudian).
  const markReadRef = React.useRef<(id: string) => void>(() => { });

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
    if (latest && !toasted.current.has(latest.id)) {
      toasted.current.add(latest.id);
      if (toasted.current.size > 200) toasted.current.delete(toasted.current.values().next().value as string);
      const t = toastFor(latest, prefs.current);
      if (t.enabled) {
        // Keputusan: toast membawa aksi "Jawab" (buka Terminal terfokus ke sesi itu, sekaligus tandai
        // terbaca). Bila operator sudah menonton sesi itu di Terminal, toast-nya dilewati; bunyi dan
        // notifikasi OS tetap berjalan seperti biasa.
        const decision = latest.type === "decision";
        const viewing = decision && isViewingRef.current?.(latest) === true;
        const opts = decision && onOpenRef.current ? {
          action: { label: "Jawab", onAction: () => { markReadRef.current(latest.id); onOpenRef.current?.(latest); } },
          duration: 7000,
        } : undefined;
        if (!viewing) showToast(t.msg, t.tone, t.icon, opts);
        playNotifySound(t.sound); notifyOS(t.msg, latest, onOpenRef.current);
      }
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

  // Audit UI/UX 2026-10 · galat tak lagi ditelan. Yang gagal dikembalikan ke keadaan sebelum tombol
  // ditekan (badge tetap jujur) dan toast menyebut aksinya beserta alasannya.
  const shown = React.useRef({ items, unread, total });
  shown.current = { items, unread, total };
  const markAllRead = React.useCallback(() => {
    const before = shown.current.unread;
    setUnread(0);
    api.markNotificationsRead().catch((e) => {
      setUnread(before);
      showToast(failureMessage("menandai notifikasi dibaca", e), "err", "x-circle");
    });
  }, [showToast]);
  // ADR-0204 · tandai SATU notifikasi terbaca. Optimistik: titik & badge turun seketika. Galat → HANYA
  // item itu yang dikembalikan ke belum-dibaca (bukan seluruh daftar, supaya frame WS yang masuk di
  // tengah tak tertimpa), lalu operator diberi tahu. Item yang sudah terbaca di daftar ini tak memicu
  // request. Item di luar daftar bell (arsip) tetap dikirim: server idempoten, jadi itu aman.
  const markRead = React.useCallback((id: string) => {
    const target = shown.current.items.find((n) => n.id === id);
    if (target?.readAt) return;
    const readAt = new Date().toISOString();
    if (target) {
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, readAt } : n)));
      setUnread((u) => Math.max(0, u - 1));
    }
    api.markNotificationRead(id).catch((e) => {
      if (target) {
        setItems((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: null } : n)));
        setUnread((u) => u + 1);
      }
      showToast(failureMessage("menandai notifikasi dibaca", e), "err", "x-circle");
    });
  }, [showToast]);
  markReadRef.current = markRead;
  const clear = React.useCallback(() => {
    const before = shown.current;
    setItems([]); setUnread(0); setTotal(0);
    api.clearNotifications().catch((e) => {
      setItems(before.items); setUnread(before.unread); setTotal(before.total);
      showToast(failureMessage("membersihkan notifikasi", e), "err", "x-circle");
    });
  }, [showToast]);

  return (
    <NotificationsContext.Provider value={{ items, unread, total, markAllRead, markRead, clear, onOpen }}>
      {children}
    </NotificationsContext.Provider>
  );
}
