#!/usr/bin/env bash
# hanoman-provision · SPEC-883 · ADR-0137
#
# Marker "hanoman-provision" di baris atas WAJIB: server mengirim skrip ini lewat stdin dan
# fixture test (server/test/fixtures/fake-ssh.sh) mencabang atas isi stdin memakai marker itu.
#
# Dua mode, dipilih lewat env MODE:
#   MODE=probe                                 → COMP <id> <ok|partial|absent> <detail>
#   MODE=apply ITEMS=a,b PROFILE=lab DRY_RUN=1 → STEP <id> <would|ok|fail|skip> <detail>
#
# NOL asumsi tentang SSH: skrip ini dijalankan lewat `ssh … bash -s` DAN secara lokal oleh
# `hanoman provision`. Jangan pernah membaca $SSH_*, /dev/tty, atau berasumsi ada tty.
# NOL rahasia: tak pernah membaca, menulis, atau meminta kredensial agen.
set -uo pipefail   # sengaja TANPA -e: satu komponen gagal tak boleh membunuh laporan sisanya

MODE="${MODE:-probe}"
PROFILE="${PROFILE:-lab}"
DOMAIN="${DOMAIN:-}"
DRY_RUN="${DRY_RUN:-}"
HANOMAN_PORT="${HANOMAN_PORT:-8787}"
HANOMAN_USER="${HANOMAN_USER:-hanoman}"
HANOMAN_DATA="${HANOMAN_DATA:-/var/lib/hanoman}"
IMAGE="${IMAGE:-hanoman-agent:latest}"

comp() { echo "COMP $1 $2 ${3:-}"; }
step() { echo "STEP $1 $2 ${3:-}"; }
have() { command -v "$1" >/dev/null 2>&1; }

# ---------- probe ----------

probe_base()   { if have git && have tmux && have curl; then comp base ok "git+tmux+curl"; else comp base absent "paket dasar belum lengkap"; fi; }
probe_node()   { if have node; then comp node ok "$(node --version 2>/dev/null | head -1)"; else comp node absent ""; fi; }
probe_podman() { if have podman; then comp podman ok "$(podman --version 2>/dev/null | head -1)"; else comp podman absent ""; fi; }
probe_gh()     { if have gh; then comp gh partial not-logged-in; else comp gh absent ""; fi; }

probe_caddy() {
  if ! have caddy; then comp caddy absent ""; return; fi
  if systemctl is-active --quiet caddy 2>/dev/null; then comp caddy ok "$(caddy version 2>/dev/null | head -1)"
  else comp caddy partial service-inactive; fi
}

probe_hanoman() {
  if ! have hanoman; then comp hanoman absent ""; return; fi
  local v; v="$(hanoman --version 2>/dev/null | head -1)"
  if systemctl is-active --quiet hanoman 2>/dev/null; then comp hanoman ok "$v"
  else comp hanoman partial "service-inactive $v"; fi
}

probe_agent_image() {
  if ! have podman; then comp agent-image absent "podman tak ada"; return; fi
  local id; id="$(podman image inspect --format '{{.Id}}' "$IMAGE" 2>/dev/null | head -1)"
  if [ -n "$id" ]; then comp agent-image ok "${id:0:12}"; else comp agent-image absent ""; fi
}

# Komponen ber-login TIDAK PERNAH `ok`: biner ada ≠ siap dipakai (SPEC-487, marker ≠ bukti).
probe_agent_cli() {
  local id="$1"
  if have "$id"; then comp "$id" partial "not-logged-in $("$id" --version 2>/dev/null | head -1)"
  else comp "$id" absent ""; fi
}

do_probe() {
  probe_base; probe_node; probe_hanoman; probe_caddy; probe_podman; probe_agent_image
  probe_agent_cli claude; probe_agent_cli codex; probe_gh
}

case "$MODE" in
  probe) do_probe ;;
  apply) echo "STEP _ fail mode apply belum diimplementasikan" ;;
  *)     echo "STEP _ fail MODE tak dikenal: $MODE"; exit 2 ;;
esac
