# Non-functional requirements

- **Realtime terminal** — latensi frame terminal ke UI < 1 dtk (WebSocket PTY); input yang diterima
  selama koneksi dibuka atau saat key-repeat cepat tetap terkirim berurutan tanpa terpotong quota
  normal pengguna. Arah keluarnya **hemat kawat** (SPEC-812): keluaran PTY di-coalesce dalam jendela
  16 ms dan socket memakai `permessage-deflate`, sehingga satu pane ramai keluaran menempati puluhan
  kbit/detik alih-alih ±1 Mbit/detik — batas yang menentukan apakah echo ketikan dari ponsel lewat
  domain publik mengalir atau mengantre di belakang keluaran agen.
- **Interupsi** — instruksi ke sesi (steer / ctrl-c / tutup) diterapkan ≤ 2 dtk lewat tmux.
- **Isolasi** — tiap backlog memakai worktree terpisah (boundary Git), sedangkan production menjalankan
  semua agen dalam rootless Podman dengan mount minimum, root read-only, resource limit, dan egress
  allowlist (boundary security, ADR-0117). API/worker adalah user non-root dedicated.
- **Durabilitas** — state bertahan restart via satu berkas SQLite di `$HANOMAN_HOME`; sesi terminal
  yang berjalan bertahan restart API karena hidup di tmux (ADR-0016); docs
  dibaca live dari disk, tak ada salinan yang bisa basi.
- **Telegram at-most-once** — offset, dedupe, binding, dispatch, dan outbox durable; state batas crash
  menjadi `uncertain` dan tak diretry otomatis, sehingga update yang sama tak pernah masuk session
  dua kali (ADR-0096).
- **Telegram latency** — update sah di-steer/di-spawn dalam ≤5 dtk di luar waktu long-poll/network;
  progress berbasis state server, bukan streaming reasoning.
- **Sumber daya** — beberapa sesi berjalan bersamaan di satu mesin operator, jadi sesi memverifikasi
  **ber-scope** secara default (`Setting.verifyScope = "changed"`, SPEC-376/ADR-0080): test hanya untuk
  berkas yang berubah, typecheck per paket, lint per berkas, build penuh & boot-server hanya bila
  relevan. Tanpa itu, N sesi melipatgandakan suite penuh (di repo ini: 258 berkas test + 6 proses
  `tsc` per sesi). Suite penuh adalah langkah **manusia** sebelum merge, bukan langkah sesi.
- **Keamanan** — server bind loopback; exact public/control host dipisah, control plane berada di
  belakang SSO/MFA/VPN/access proxy, trusted proxy dibatasi, dan limiter bounded. Guardrail deny
  PreToolUse tetap dicabut (ADR-0037); permission bypass hanya hidup di dalam boundary OS ADR-0117.
- **Lifecycle data** — `$HANOMAN_HOME` private 0700/0600; retention bounded berlaku untuk ticket,
  attachment, transcript/session, delivery, dan result dengan hold eksplisit serta retry bila delete
  file gagal.
