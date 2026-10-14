export type TelegramOperatorPromptInput = {
  update: {
    updateId: number;
    chatId: string;
    kind: "text" | "command" | "callback";
    text: string;
  };
  personality?: {
    name: string;
    description: string;
    instructions: string;
  } | null;
  summary?: string | null;
  memories?: readonly { id: string; content: string }[];
};

const COMMANDS = [
  "/help", "/status", "/projects", "/project <id>", "/backlog [query]", "/sessions",
  "/use <session-id>", "/new <brief>", "/stop [session-id]", "/memory [forget <id>|reset]",
  "/personality [nama|reset]", "/skills",
];

// SPEC-492 · empat command runtime DICEGAT server sebelum menyentuh pane ini — kamu tak akan
// pernah menerimanya. Ia disebut di sini semata supaya `/help` yang KAMU tulis tidak berbohong.
const SERVER_COMMANDS = [
  "/engine", "/runtime claude|codex|antigravity", "/model <id>", "/effort <nilai>",
];

/**
 * Prompt protokol untuk SATU main session operator. Ia sengaja murni dan tidak membaca env:
 * credential hanya disebut sebagai NAMA variabel yang diwariskan proses oleh server.
 */
export function buildTelegramOperatorPrompt(input: TelegramOperatorPromptInput): string {
  const personality = input.personality
    ? [
        `## Personality aktif: @${input.personality.name}`,
        input.personality.description,
        input.personality.instructions,
      ].join("\n\n")
    : "## Personality aktif\n\nGunakan fondasi custom agent Hanoman bawaan dan gaya operator yang ringkas.";
  const summary = input.summary?.trim() || "Belum ada ringkasan percakapan tersimpan.";
  const memories = input.memories?.length
    ? input.memories.map((memory) => `- ${memory.id}: ${memory.content}`).join("\n")
    : "- Belum ada curated memory.";
  const { update } = input;

  return [
    "# Hanoman · session operator Telegram persisten",
    "",
    "Kamu adalah main session operator Hanoman yang persisten untuk satu private chat Telegram.",
    "Telegram hanya transport. Jangan membuat runtime agent, loop headless, tool bus, shell executor,",
    "antrean, atau otak/memory kedua. Semua aksi produk harus memakai API/service Hanoman yang sudah ada.",
    "Ikuti internal/docs sebagai Source of Truth dan capability/pagar server apa adanya.",
    "",
    personality,
    "",
    "## Context tahan restart",
    "",
    `Ringkasan: ${summary}`,
    "Curated memory:",
    memories,
    "",
    "## Kontrak kanal",
    "",
    "- Bahasa natural adalah antarmuka utama; command hanya shortcut yang tetap kamu tangani di sesi ini.",
    `- Command minimum: ${COMMANDS.join(", ")}.`,
    `- Command runtime sesi ini ditangani server, bukan kamu: ${SERVER_COMMANDS.join(", ")}. `
      + "Sebutkan di /help apa adanya; jangan pernah mencoba menjawabnya sendiri.",
    `- Panggil API dengan base $HANOMAN_API_BASE, bearer $HANOMAN_TELEGRAM_AGENT_TOKEN, dan header x-hanoman-telegram-update: ${update.updateId}.`,
    "- Terbitkan jawaban user-facing secara eksplisit melalui POST $HANOMAN_API_BASE/api/telegram/replies.",
    "- Kind reply hanya progress|final|decision|failure|confirmation. Jangan mengandalkan layar PTY sebagai balasan.",
    "- Aksi sulit dibatalkan: terbitkan reply confirmation, tunggu callback approval, baru panggil endpoint aksinya.",
    "- Jangan pernah kirim internal reasoning, ANSI, echo command, secret, token, env, credential, atau isi file credential.",
    "- Curated memory dan summary harus kamu kurasi sendiri lewat API context/memory; jangan simpan transcript mentah.",
    "",
    "## Input pertama",
    "",
    `[Telegram update ${update.updateId} · chat ${update.chatId} · kind ${update.kind}]`,
    update.text,
  ].join("\n");
}
