#!/usr/bin/env bash
# ssh palsu (HANOMAN_SSH_BIN) — pola yang sama dengan fake-claude.sh.
# FAKE_SSH_MODE: unreachable | verify-fail | audit-fail | (kosong = sukses)
case "${FAKE_SSH_MODE:-}" in
  unreachable) echo "ssh: connect to host x port 22: Connection refused" >&2; exit 255 ;;
  # SPEC-165 · login password ditolak (password salah / PasswordAuthentication off)
  bad-password)
    if [ -n "${HANOMAN_SSH_PASSWORD:-}" ]; then
      echo "root@x: Permission denied (publickey,password)." >&2; exit 255
    fi ;;
esac

# SPEC-165 · rekam bagaimana ssh dipanggil supaya test bisa memeriksa argumen & env.
if [ -n "${FAKE_SSH_LOG:-}" ]; then
  { echo "ARGV $*"
    echo "ASKPASS ${SSH_ASKPASS:-none}"
    echo "ASKPASS_REQUIRE ${SSH_ASKPASS_REQUIRE:-none}"
    # Nilai passwordnya sendiri TIDAK dicatat — hanya ada/tidaknya.
    echo "HAS_PASSWORD $([ -n "${HANOMAN_SSH_PASSWORD:-}" ] && echo yes || echo no)"
  } >> "$FAKE_SSH_LOG"
fi

input="$(cat)"          # stdin = isi script (kosong untuk healthcheck/verify)
last="${*: -1}"         # arg terakhir = perintah remote

# SPEC-165 · verifikasi key-only pasca-bootstrap gagal (key tak benar-benar terpasang).
if [ "${FAKE_SSH_MODE:-}" = "bootstrap-verify-fail" ] && [ -z "${HANOMAN_SSH_PASSWORD:-}" ]; then
  echo "root@x: Permission denied (publickey)." >&2; exit 255
fi

# verify-fail: harden sukses, tapi koneksi verifikasi berikutnya gagal
if [ "${FAKE_SSH_MODE:-}" = "verify-fail" ] && [[ "$input" != *"hanoman-harden"* ]]; then
  echo "ssh: connect to host x port 22: Connection refused" >&2; exit 255
fi

if [[ "$last" == *"HEALTH"* ]]; then
  echo "HEALTH uptime up 3 days"; echo "HEALTH disk 42%"
  echo "HEALTH mem 512/2048MB"; echo "HEALTH load 0.1 0.2 0.3"; exit 0
fi
# SPEC-883 · provision.sh: MODE=probe → COMP, MODE=apply → STEP (would bila DRY_RUN=1).
if [[ "$input" == *"hanoman-provision"* ]]; then
  if [[ "$last" == *"MODE=probe"* ]]; then
    if [ "${FAKE_SSH_MODE:-}" = "probe-garbage" ]; then echo "sudo: a password is required"; exit 0; fi
    echo "COMP base ok git+tmux+curl"
    echo "COMP node ok v22.11.0"
    case "${FAKE_SSH_MODE:-}" in
      hanoman-present|setup-expired|setup-absent) echo "COMP hanoman ok 1.4.2" ;;
      *) echo "COMP hanoman absent" ;;
    esac
    echo "COMP caddy absent"; echo "COMP podman absent"; echo "COMP agent-image absent"
    echo "COMP claude partial not-logged-in 1.2.3"
    echo "COMP codex absent"; echo "COMP gh absent"
    exit 0
  fi
  items=$(echo "$last" | sed -n 's/.*ITEMS=\([^ ]*\).*/\1/p')
  mode=ok; [[ "$last" == *"DRY_RUN=1"* ]] && mode=would
  IFS=',' read -ra arr <<< "$items"
  for it in "${arr[@]}"; do echo "STEP $it $mode dipasang(fake)"; done
  exit 0
fi

# SPEC-883 · pembacaan setup token (perintah remote `sudo -n cat …/setup.token`).
if [[ "$last" == *"setup.token"* ]]; then
  case "${FAKE_SSH_MODE:-}" in
    setup-expired) echo "tok-lama"; echo "2020-01-01T00:00:00.000Z"; exit 0 ;;
    setup-absent)  echo "cat: setup.token: No such file" >&2; exit 1 ;;
    *)             echo "tok-baru"
                   date -u -v+15M +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null ||
                     date -u -d "+15 minutes" +"%Y-%m-%dT%H:%M:%S.000Z"
                   exit 0 ;;
  esac
fi

# SPEC-220 · remediate.sh: emit STEP per item — would bila DRY_RUN=1 (preview), ok bila apply.
if [[ "$input" == *"hanoman-remediate"* ]]; then
  items=$(echo "$last" | sed -n 's/.*ITEMS=\([^ ]*\).*/\1/p')
  mode=ok; [[ "$last" == *"DRY_RUN=1"* ]] && mode=would
  IFS=',' read -ra arr <<< "$items"
  for it in "${arr[@]}"; do echo "STEP $it $mode diterapkan(fake)"; done
  exit 0
fi
if [[ "$input" == *"hanoman-harden"* ]]; then
  echo "STEP precheck ok deb ssh_port=22"; echo "STEP firewall ok ufw aktif"
  echo "STEP fail2ban ok"; echo "STEP auto_updates ok"; echo "STEP ssh ok"; echo "STEP ntp ok"; exit 0
fi
if [[ "$input" == *"hanoman-audit"* ]]; then
  echo "CHECK sudo_ok pass root"; echo "CHECK os_supported pass ubuntu 24.04"
  echo "CHECK ssh_root_login pass"
  if [ "${FAKE_SSH_MODE:-}" = "audit-fail" ]; then
    echo "CHECK ssh_password_auth fail PasswordAuthentication yes"
  else
    echo "CHECK ssh_password_auth pass"
  fi
  echo "CHECK firewall pass ufw active"; echo "CHECK fail2ban pass aktif"
  echo "CHECK auto_updates pass unattended-upgrades"
  echo "CHECK ntp pass aktif"; echo "CHECK open_ports warn port publik tak terdaftar: 5432"
  echo "CHECK pending_updates pass"
  # SPEC-220 · baris CHECK <itemId> katalog (untuk snapshot + scoring)
  echo "CHECK fw-b1 pass"; echo "CHECK ids-b1 pass"; echo "CHECK ker-b1 pass"
  if [ "${FAKE_SSH_MODE:-}" = "audit-fail" ]; then echo "CHECK ssh-b3 fail PasswordAuthentication yes"
  else echo "CHECK ssh-b3 pass"; fi
  # SPEC-221 · deteksi stack app-layer (advisory)
  echo "STACK webserver absent tak ada nginx/apache"; echo "STACK database present postgres"
  echo "STACK aapanel absent"; echo "STACK ssl absent"
  exit 0
fi
exit 0   # perintah lain (mis. verify `true`)
