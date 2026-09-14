import { listPhaseInvocations } from "./agent-invocations";
import { setPhaseInvocations } from "./pty";

// ADR-0164 · jembatan DB → pty. pty.ts tetap nol dependensi DB (ADR-0094 §7): pemanggil yang
// membaca invocation lalu menyuntikkannya. Telemetri tak pernah boleh menggagalkan event atau attach.
export async function refreshPhaseInvocations(sessionId: string): Promise<void> {
  try { setPhaseInvocations(sessionId, await listPhaseInvocations(sessionId)); }
  catch { /* frame berikutnya tetap membawa rencana fase dari roster */ }
}
