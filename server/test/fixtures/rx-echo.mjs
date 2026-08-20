// SPEC-860 · berdiri sebagai TUI agen dari sisi yang penting untuk bug ini: apa pun yang masuk
// sebagai stdin DITAMPILKAN sebagai teks. Raw mode mematikan echo tty, jadi yang tergambar di
// pane hanya yang benar-benar sampai ke program — persis nasib balasan terminal yang tak ada
// yang menunggunya. ESC dicetak sebagai `\e` supaya tmux tak menelannya sebagai escape sequence.
process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on("data", (d) => {
  process.stdout.write(`RX[${d.toString("utf8").replace(/\x1b/g, "\\e")}]\r\n`);
});
setInterval(() => {}, 60_000);
