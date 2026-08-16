// SPEC-812 · berdiri sebagai TUI agen yang sedang ramai: redraw layar penuh berkala, ANSI-berat.
// Bukan `seq`/`yes` — tmux adalah mesin keadaan terminal dan MENGGABUNGKAN keluaran yang datang
// lebih cepat dari loop keluarannya sendiri, jadi keluaran deras tanpa jeda tak pernah sampai ke
// klien sebagai burst. Yang membuat burst nyata adalah redraw besar yang dipisahkan jeda.
const frames = Number(process.argv[2] ?? 20);
const ROWS = Number(process.argv[3] ?? 24);
const COLS = Number(process.argv[4] ?? 78);
let n = 0;
let drawn = 0;
const draw = () => {
  let out = "\x1b[H";
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) out += `\x1b[38;5;${16 + ((n + r + c) % 200)}m#`;
    out += "\x1b[0m\r\n";
  }
  process.stdout.write(out);
  n += 1;
};
const timer = setInterval(() => {
  draw();
  drawn += 1;
  if (drawn >= frames) {
    clearInterval(timer);
    process.stdout.write("\r\nBURSTDONE\r\n");
  }
}, 60);
