// SPEC-863 · pane yang masuk/keluar alternate screen atas perintah, bukan atas waktu: `A` masuk,
// `B` keluar. Deterministik supaya test tak menebak jendela poll.
process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdout.write("SIAP\r\n");
process.stdin.on("data", (d) => {
  for (const ch of d.toString("utf8")) {
    if (ch === "A") process.stdout.write("\x1b[?1049hALT\r\n");
    else if (ch === "B") process.stdout.write("\x1b[?1049lBIASA\r\n");
  }
});
setInterval(() => {}, 1 << 30);
