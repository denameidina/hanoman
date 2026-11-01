import { registerAccountResolver, registerSessionHooks } from "../pty";
import { accountIdForLoginSession } from "./login";
import { checkAccount, refreshAllStatuses, refreshSnapshot } from "./registry";
import { resolveLaunchAccount } from "./resolver";

/**
 * ADR-0234 · dipanggil server.ts SEBELUM sesi apa pun bisa lahir (dan sebelum auto-resume): snapshot
 * harus terisi supaya resolver & `accountExists` menjawab benar. Status login diperbarui di latar.
 */
export async function installRuntimeAccounts(): Promise<void> {
  await refreshSnapshot();
  registerAccountResolver((agent, requested) => resolveLaunchAccount(agent, requested));
  registerSessionHooks({
    // Sesi login ditutup operator → baca ulang status akun itu.
    onDeath: (d) => {
      const id = accountIdForLoginSession(d.sessionId);
      if (id) void checkAccount(id).catch((e) => console.error("akun runtime (periksa sesudah login):", e));
    },
  });
  void refreshAllStatuses().catch((e) => console.error("akun runtime (status boot):", e));
}
