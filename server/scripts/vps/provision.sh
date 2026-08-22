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

# ---------- apply ----------

FAILED=""                                   # daftar id yang gagal, dipakai gerbang blocked-by
mark_failed() { FAILED="$FAILED $1"; }
has_failed()  { case " $FAILED " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

# Prasyarat per komponen, DUPLIKAT dari katalog TypeScript dengan sengaja: server sudah
# mengirim daftar terurut & lengkap, tabel ini hanya dipakai untuk menerbitkan `blocked-by`
# yang benar saat sebuah prasyarat gagal di tengah jalan. Jaga keduanya selaras.
deps_of() {
  case "$1" in
    node)         echo "base" ;;
    hanoman)      if [ "$PROFILE" = production ]; then echo "node podman"; else echo "node"; fi ;;
    podman)       echo "base" ;;
    agent-image)  echo "podman" ;;
    claude|codex) if [ "$PROFILE" = production ]; then echo "agent-image"; else echo "node"; fi ;;
    gh)           echo "base" ;;
    *)            echo "" ;;
  esac
}

pkg_install() {
  if have apt-get; then DEBIAN_FRONTEND=noninteractive apt-get install -y "$@" >/dev/null 2>&1
  elif have dnf;    then dnf install -y "$@" >/dev/null 2>&1
  else return 127; fi
}

# Alamat publik mesin ini. curl ke resolver eksternal adalah satu-satunya cara yang jujur di
# balik NAT; kegagalannya (offline) memulangkan string kosong dan gerbang DNS menolak apa adanya.
public_ip() { curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null | head -1; }
resolve_a() { getent ahostsv4 "$1" 2>/dev/null | awk '{print $1}' | head -1; }

apply_base() {
  pkg_install curl git tmux ca-certificates build-essential python3 ||
    pkg_install curl git tmux ca-certificates gcc gcc-c++ make python3
}
apply_node() { curl -fsSL https://deb.nodesource.com/setup_22.x 2>/dev/null | bash - >/dev/null 2>&1 && pkg_install nodejs; }
apply_gh()   { pkg_install gh; }
apply_claude() { npm i -g @anthropic-ai/claude-code >/dev/null 2>&1; }
apply_codex()  { npm i -g @openai/codex >/dev/null 2>&1; }

apply_podman() {
  pkg_install podman || return 1
  id -u "$HANOMAN_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$HANOMAN_DATA" "$HANOMAN_USER"
  sudo -u "$HANOMAN_USER" podman network exists hanoman-egress 2>/dev/null ||
    sudo -u "$HANOMAN_USER" podman network create --internal hanoman-egress >/dev/null 2>&1
}

apply_agent_image() {
  local cf="${CONTAINERFILE:-/tmp/hanoman-agent.Containerfile}"
  [ -f "$cf" ] || return 1
  sudo -u "$HANOMAN_USER" podman build -t "$IMAGE" -f "$cf" >/dev/null 2>&1
}

# Profil lab TIDAK menyetel NODE_ENV=production: gerbang assertRuntimeBoundary menuntut Podman,
# credential dir, dan egress proxy di sana. Konsekuensinya cookie sesi lahir tanpa flag `Secure`
# (server/src/services/auth.ts) — itu sebabnya profil lab tak boleh melayani permukaan Help publik.
write_env() {
  umask 077
  { echo "HANOMAN_HOME=$HANOMAN_DATA"
    echo "PORT=$HANOMAN_PORT"
    echo "HOST=127.0.0.1"
    echo "HANOMAN_TMUX_SOCKET=hanoman-prod"
    if [ "$PROFILE" = production ]; then
      echo "NODE_ENV=production"
      echo "HANOMAN_SESSION_SANDBOX=podman"
      echo "HANOMAN_SESSION_IMAGE=$IMAGE"
      echo "HANOMAN_SESSION_NETWORK=hanoman-egress"
      echo "HANOMAN_EGRESS_PROXY=${EGRESS_PROXY:-http://127.0.0.1:3128}"
      echo "HANOMAN_AGENT_CREDENTIAL_DIR=$HANOMAN_DATA/agent-credentials"
      echo "HANOMAN_TRUST_PROXY=1"
      echo "HANOMAN_SINGLE_ORIGIN=1"
      [ -n "$DOMAIN" ] && echo "HANOMAN_CONTROL_ORIGINS=https://$DOMAIN"
    fi
  } > /etc/hanoman.env || return 1
  chown "root:$HANOMAN_USER" /etc/hanoman.env 2>/dev/null
  chmod 0640 /etc/hanoman.env
}

write_unit() {
  cat > /etc/systemd/system/hanoman.service <<UNIT
[Unit]
Description=hanoman orchestrator + dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$HANOMAN_USER
Group=$HANOMAN_USER
WorkingDirectory=$HANOMAN_DATA
UMask=0077
Environment=HOME=$HANOMAN_DATA
EnvironmentFile=/etc/hanoman.env
ExecStart=/usr/bin/env hanoman
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
}

apply_hanoman() {
  id -u "$HANOMAN_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "$HANOMAN_DATA" "$HANOMAN_USER"
  install -d -o "$HANOMAN_USER" -g "$HANOMAN_USER" -m 0700 "$HANOMAN_DATA" || return 1
  npm i -g hanoman >/dev/null 2>&1 || return 1
  write_env || return 1
  write_unit || return 1
  systemctl daemon-reload >/dev/null 2>&1
  systemctl enable --now hanoman >/dev/null 2>&1
}

apply_caddy() {
  pkg_install caddy || return 1
  mkdir -p /etc/caddy
  cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "no-referrer"
	}
	encode zstd gzip
	reverse_proxy 127.0.0.1:$HANOMAN_PORT
}
CADDY
  caddy validate --config /etc/caddy/Caddyfile >/dev/null 2>&1 || return 1
  systemctl enable --now caddy >/dev/null 2>&1
  systemctl reload caddy >/dev/null 2>&1
}

# Gerbang DNS mendahului instalasi apa pun: sertifikat ACME yang gagal terbit meninggalkan Caddy
# hidup tanpa TLS DAN membakar rate-limit Let's Encrypt. Menolak di depan jauh lebih murah.
caddy_gate() {
  [ -n "$DOMAIN" ] || { echo "domain-required"; return 1; }
  local want got
  want="$(public_ip)"; got="$(resolve_a "$DOMAIN")"
  [ -n "$got" ] || { echo "dns-unresolved $DOMAIN"; return 1; }
  [ "$got" = "$want" ] || { echo "dns-mismatch $got != ${want:-tak-diketahui}"; return 1; }
  return 0
}

# Status satu komponen (kolom ketiga baris COMP) — dipakai gerbang idempotensi.
probe_one() {
  case "$1" in
    base) probe_base ;; node) probe_node ;; hanoman) probe_hanoman ;; caddy) probe_caddy ;;
    podman) probe_podman ;; agent-image) probe_agent_image ;; gh) probe_gh ;;
    claude|codex) probe_agent_cli "$1" ;;
  esac | awk '{print $3}'
}

# Komponen ber-login berhenti di `partial`, jadi `partial` DIANGGAP sudah terpasang untuk mereka —
# memasang ulang biner tak akan membuat siapa pun login.
already_present() {
  local id="$1" st="$2"
  [ "$st" = ok ] && return 0
  if [ "$st" = partial ]; then
    case "$id" in claude|codex|gh) return 0 ;; esac
  fi
  return 1
}

apply_one() {
  local id="$1"

  for d in $(deps_of "$id"); do
    if has_failed "$d"; then step "$id" skip "blocked-by $d"; mark_failed "$id"; return; fi
  done

  if [ "$id" = caddy ]; then
    local why
    if ! why="$(caddy_gate)"; then step caddy fail "$why"; mark_failed caddy; return; fi
  fi

  local st; st="$(probe_one "$id")"
  if already_present "$id" "$st"; then step "$id" skip "already-present"; return; fi

  if [ -n "$DRY_RUN" ]; then step "$id" would "akan dipasang"; return; fi

  local rc=0
  case "$id" in
    base) apply_base || rc=$? ;; node) apply_node || rc=$? ;; hanoman) apply_hanoman || rc=$? ;;
    caddy) apply_caddy || rc=$? ;; podman) apply_podman || rc=$? ;;
    agent-image) apply_agent_image || rc=$? ;; claude) apply_claude || rc=$? ;;
    codex) apply_codex || rc=$? ;; gh) apply_gh || rc=$? ;;
    *) step "$id" fail "komponen tak dikenal"; mark_failed "$id"; return ;;
  esac

  if [ "$rc" -eq 0 ]; then step "$id" ok "terpasang"; else step "$id" fail "kode keluar $rc"; mark_failed "$id"; fi
}

do_apply() {
  IFS=',' read -ra arr <<< "${ITEMS:-}"
  for id in "${arr[@]}"; do [ -n "$id" ] && apply_one "$id"; done
}

case "$MODE" in
  probe) do_probe ;;
  apply) do_apply ;;
  *)     echo "STEP _ fail MODE tak dikenal: $MODE"; exit 2 ;;
esac
