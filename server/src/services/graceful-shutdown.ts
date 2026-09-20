// Penutupan server yang TIDAK BISA menggantung. `app.close()` menunggu koneksi WS/keep-alive dan
// runtime Telegram; bila satu saja tak kunjung selesai, `process.exit` tak pernah tercapai dan
// server lama tinggal sebagai yatim (PPID 1) yang masih memegang klien tmux. Bersama server baru
// mereka saling menendang lewat `attach-session -d` (±8 attach/dtk), dan kebocoran node-pty di
// bawah churn itu menghabiskan PTY sistem (kern.tty.ptmx_max = 511): setiap terminal baru gagal
// "attach failed" dan dashboard menyambung ulang selamanya.
const DEFAULT_TIMEOUT_MS = 5_000;

export function createShutdown(o: {
  close: () => Promise<unknown>;
  exit: (code: number) => void;
  log?: (msg: string) => void;
  timeoutMs?: number;
}): (sig: string) => Promise<void> {
  const log = o.log ?? ((m) => console.log(m));
  let running: Promise<void> | undefined;
  return (sig) => running ??= (async () => {
    log(`${sig} — menutup`);
    const timer = setTimeout(() => {
      log(`penutupan melewati ${o.timeoutMs ?? DEFAULT_TIMEOUT_MS} ms — keluar paksa`);
      o.exit(1);
    }, o.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    timer.unref?.();
    try { await o.close(); } catch (e) { log(`penutupan gagal: ${(e as Error).message}`); }
    clearTimeout(timer);
    o.exit(0);
  })();
}
