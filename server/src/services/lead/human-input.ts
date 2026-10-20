// ADR-0228 · kapan manusia terakhir MENGETIK di pane lead. Modul tanpa dependensi supaya `pty.ts`
// bisa mencatatnya tanpa impor sirkular ke `lead-session.ts`. In-memory dengan sengaja: setelah
// restart tak ada manusia yang "sedang mengetik", dan kurir boleh langsung mengantar.
const lastInput = new Map<string, number>();

export function noteHumanInput(sessionId: string, at: number = Date.now()): void { lastInput.set(sessionId, at); }
export function humanActiveAt(sessionId: string): number | null { return lastInput.get(sessionId) ?? null; }
export function __resetHumanInput(): void { lastInput.clear(); }
