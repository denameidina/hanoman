import { builtinAccountId, isBuiltinAccountId } from "@hanoman/shared";
import { agentBin, registerAccountResolver, registerSessionHooks } from "../pty";
import { getAntigravityLimits } from "../antigravity-limits";
import { activateAgyAccount, activeAgyAccount, agyAccountLimits, captureActiveSlot, probeAgyLogin } from "./antigravity-swap";
import { setAntigravityAccountLimits } from "./limits";
import { setAntigravityLogin, setBeforeLogin } from "./login";
import { accountIdForLoginSession } from "./login";
import { accountSnapshot, checkAccount, refreshAllStatuses, refreshSnapshot, setProbe } from "./registry";
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
  installAntigravitySwap();
  void refreshAllStatuses().catch((e) => console.error("akun runtime (status boot):", e));
}

const AGY_BUILTIN = builtinAccountId("antigravity");
const darwin = process.platform === "darwin";

/**
 * ADR-0234 · Antigravity mode tukar (hanya macOS): probe/limit/login dari slot, dan token hasil refresh
 * agy ditangkap ke slot akun aktif setiap kali sebuah sesi ditutup. Di platform lain akun bawaan agy
 * tetap dianggap aktif (perilaku lama) dan akun agy terdaftar tak bisa login.
 */
function installAntigravitySwap(): void {
  setProbe("antigravity", async (_home, accountId) =>
    darwin ? probeAgyLogin(accountId) : { loggedIn: isBuiltinAccountId(accountId), identity: null });
  setAntigravityAccountLimits(
    (row) => agyAccountLimits(row.id),
    // Akun bawaan saat akun lain aktif: Keychain memuat login akun LAIN — baca slot bawaan, bukan Keychain.
    () => (!darwin || activeAgyAccount() === AGY_BUILTIN ? getAntigravityLimits() : agyAccountLimits(AGY_BUILTIN)),
  );
  setAntigravityLogin(() => [agentBin("antigravity")]);
  setBeforeLogin((runtime, accountId) => { if (runtime === "antigravity" && darwin) activateAgyAccount(accountId); });
  registerSessionHooks({
    onDeath: () => {
      if (!darwin || !accountSnapshot().rows.some((r) => r.runtime === "antigravity")) return;
      try { captureActiveSlot(); } catch (e) { console.error("akun agy (tangkap slot):", e); }
    },
  });
}
