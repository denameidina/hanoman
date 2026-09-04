#!/bin/sh
# Berdiri sebagai `claude` di test PTY: cetak argv-nya (agar test bisa membuktikan
# --dangerously-skip-permissions benar-benar diteruskan), lalu tetap hidup meng-echo
# stdin. /bin/cat tidak bisa dipakai — ia mati seketika karena flag itu ilegal baginya.
#
# Tiap argumen dipotong 120 karakter. Sejak SPEC-909 nilai `--settings` membawa JSON hook
# beberapa KB; dicetak utuh ia mengisi lebih dari 24 baris pane, dan yang diterima klien saat
# attach adalah LAYAR (bukan scrollback) — "args:" tergulir keluar sebelum ada yang membacanya,
# dan empat test yang menunggu kata itu menggantung sampai timeout (audit 2026-09-05).
out="args:"
for a in "$@"; do
  out="$out $(printf '%.120s' "$a")"
done
printf '%s\n' "$out"
# SPEC-403 · bukti env sesi yang dipasang createSession (mis. IS_SANDBOX=1 saat root).
echo "env: IS_SANDBOX=${IS_SANDBOX:-}"
# SPEC-862 · bukti gerbang prompt kredensial: pane sesi agen tak punya manusia, jadi ssh/git
# tak boleh pernah meminta ketikan di tty-nya.
echo "sshenv: ASKPASS=${SSH_ASKPASS:-} REQUIRE=${SSH_ASKPASS_REQUIRE:-} GITPROMPT=${GIT_TERMINAL_PROMPT:-}"
exec cat
