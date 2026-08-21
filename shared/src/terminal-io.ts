// SPEC-860 · bentuk BALASAN terminal. Ia tinggal di shared karena dua sisi menilai byte yang sama:
// server menolak balasan dari klien non-pertama (`writeTo`), dan sejak SPEC-878 klien menolak
// mengantrekannya saat socket mati — balasan milik sambungan yang sudah lenyap tak berarti apa pun
// bagi sambungan berikutnya, dan satu blob campuran menembus gerbang server apa adanya.
// Tak satu pun bentuk di bawah beririsan dengan sekuens tombol (`\x1b[A`, `\x1bOA`, `\x1b[3~`,
// laporan mouse `…M`), jadi ketikan manusia tak pernah tersentuh gerbangnya.
const TERMINAL_RESPONSE = new RegExp([
  "\\x1b\\[[?>][0-9;]*c",                   // balasan DA
  "\\x1b\\[\\??[0-9]+;[0-9]+R",             // CPR / DECXCPR
  "\\x1b\\[\\??[0-9;]*n",                   // balasan DSR
  "\\x1b\\[\\??[0-9;]*\\$y",                // DECRPM
  "\\x1b\\][0-9][0-9;]*;[^\\x07\\x1b]*(?:\\x07|\\x1b\\\\)",   // balasan warna OSC
  "\\x1bP[0-9]*[$+>][a-z|][^\\x1b]*\\x1b\\\\",                // DECRPSS / XTGETTCAP / XTVERSION
].join("|"), "g");

/** Frame yang isinya SELURUHNYA balasan terminal — tak ada satu pun byte ketikan di dalamnya. */
export const isTerminalResponse = (d: string): boolean =>
  d.length > 0 && d.replace(TERMINAL_RESPONSE, "") === "";
