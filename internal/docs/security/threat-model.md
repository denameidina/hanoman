# Threat model deployment publik Hanoman

Status: normatif sejak SPEC-761 · keputusan arsitektur:
[ADR-0117](../adr/0117-boundary-deployment-publik-otoritas-efektif-sandbox-sesi.md) · bukti awal:
[audit SPEC-761](../research/audit-spec-761-hardening-public-deployment.md) · rujukan primer:
[primary security sources](../research/spec-761-primary-security-sources.md).

## Scope dan asumsi

Scope mencakup public Help/status portal, reverse/access proxy, Fastify control plane, SQLite dan
`HANOMAN_HOME`, sync hub/client, webhook keluar, WebSocket terminal/events/sync, repository dan
worktree, tmux/CLI agen, upload, transcript, serta credential model/Git/VPS. SPEC-759 sudah menangani
stored XSS preview Markdown dan tidak diulang di sini.

Asumsi production: origin bind loopback; public dan control hostname berbeda; control dilindungi
SSO/MFA/VPN/access proxy; API/worker adalah user non-root; semua agen berada dalam rootless Podman;
egress keluar sandbox melalui proxy allowlist; scanner upload tersedia. Bila salah satu asumsi ini
tidak benar, server harus gagal boot atau ingress harus tetap tertutup.

## Asset dan tujuan keamanan

| Asset | Tujuan |
|---|---|
| Cookie admin, setup token, AgentToken, device token, webhook secret | confidentiality, single-use/revocation, tidak masuk URL/log |
| Model/API/Git/VPS credential | tidak tersedia bagi public input atau filesystem sandbox luas |
| SQLite, `secret.key`, upload, transcript, prompt/temp | 0700/0600, retensi terukur, backup private |
| Repository, worktree, docs SoT | integrity; operasi path tidak mengikuti symlink keluar root |
| PTY/tmux, scheduler/governor/lead/cron | hanya launch ber-approval; resource dan OS boundary |
| Ticket/attachment dan record sync | validasi schema/content/quota; isolasi project; PII lifecycle |
| Webhook/sync destinations | exact authorized origin; no redirect/rebind/private target |
| Availability | limiter/store/quota bounded; timeout; batch retention; connection cap |

## Aktor dan kemampuan

- Pelapor anonim: dapat membuka Help host, mengirim field dan attachment arbitrer dalam batas HTTP,
  serta menyimpan kunci status tiket yang diterbitkan sekali.
- Akun client: cookie sah tetapi hanya portal scoped; endpoint baru deny-by-default.
- Admin operator: cookie control-plane, berada di balik access proxy, boleh memberi launch approval.
- AI agent eksternal: Bearer AgentToken dengan capability eksplisit; tidak boleh mendelegasikan token,
  mengubah credential/destination sensitif, atau memperoleh launch transitif tanpa `sessions:write`.
- Device sync: Bearer device token untuk feed/attachment antar-instance; bukan admin.
- Penerima webhook/host remote: tidak dipercaya; dapat redirect, mengubah DNS, lambat, atau merespons
  payload besar.
- Agen dalam sandbox: dianggap dapat mengikuti prompt jahat dan menjalankan command arbitrer.
- Operator host/root: trusted secara administratif; compromise host/root berada di luar kemampuan
  containment rootless container dan memerlukan incident response/rotasi.

## Trust boundary dan aliran data

```text
anonymous ─ Help host ─ ingress role ─ ticket/quarantine ─ human review ─ approved Spec
operator ─ access proxy ─ control host ─ auth/capability ─ launch gate ─ rootless agent sandbox
device ─ Bearer ─ sync schema gate ─ SQLite
SQLite event ─ webhook allowlist ─ pinned/no-redirect transport ─ untrusted receiver
browser ─ exact Origin + one-time WS ticket ─ bounded long-lived connection ─ PTY/events
```

Setiap panah yang menyeberang boundary memiliki choke point tunggal. Route-level authorization tidak
boleh dianggap cukup untuk efek lanjut; path lexical tidak boleh dianggap containment; DNS resolve
tidak boleh dianggap alamat connect; MIME client tidak boleh dianggap tipe file.

## Abuse case, kontrol, dan residual risk

| Ancaman | Kontrol wajib | Residual/operasi |
|---|---|---|
| Help prompt/attachment menyuruh agen mengeksekusi instruksi | triase hanya notification review; manual accept; blok `UNTRUSTED_TICKET_DATA`; launch approval; sandbox/egress minimum | admin masih dapat salah menyetujui; UI/runbook harus mempertahankan provenance publik |
| `settings:write` mengganti sync host lalu token/data terkirim | `SYNC_SERVER_URL` cookie-only; URL+token tombstone atomik; pairing ulang; Bearer header; record schema/size gate | admin dapat memilih host jahat; perubahan harus diaudit dan token lama dirotasi |
| Agen mengambil alih host | service non-root; rootless container; read-only root; caps none; narrow mount; resource limit; egress proxy | kernel/container/proxy vulnerability tetap ada; patch host/image dan pisahkan credential |
| settings/projects/backlog memicu RCE transitif | approval LOCAL-only hanya admin/`sessions:write`; assert final di `startSpecSession` untuk semua caller | bug baru yang spawn di luar choke point harus gagal code review/test matrix |
| symlink file/dir/dangling/swap keluar repo | canonical root, per-component `lstat`, `O_NOFOLLOW`, descriptor read, EXCL temp+revalidate+atomic rename | Node tidak punya `openat2(RESOLVE_BENEATH)` lintas platform; sandbox mount membatasi parent-swap residual |
| webhook redirect/rebind ke private host sambil membawa signature/body | validasi semua A/AAAA, reject private/metadata, pin address, preserve SNI, no redirect, timeout/byte cap | `allowPrivate` adalah opt-in admin dan memperluas target; monitor destination changes |
| dependency runtime rentan | versi patched; `pnpm audit --prod` nol critical/high; tidak memakai ignore | advisory baru muncul setelah release; owner release menilai dan memperbarui sebelum SLA internal |
| sibling subdomain membuka terminal WS atau token bocor ke log | exact Origin; 30s one-use subprotocol ticket; no query token; payload/rate/connection caps; periodic+pre-input revalidation | access proxy/log masih sensitif; redaksi header dan log policy tetap wajib |
| attacker memenangkan first-user setup | setup token console/file 0600, 15m, control host only, atomic fixed-id create, permanent close | host/local reader dapat mengambil token; bootstrap dari console private dan hapus/rotasi bila ragu |
| spoofed XFF dan Map growth | exact hop/CIDR trusted proxy, loopback origin, bounded TTL/LRU limiter, body cap | distributed abuse dapat menghabiskan quota sah; observability/WAF/CAPTCHA dapat ditambah terpisah |
| PII/secret tertinggal atau world-readable | umask 0077, modes enforced, symlink refusal, encrypted secret, bounded retention+hold+retry | backup/log eksternal punya lifecycle sendiri; operator wajib mengaturnya setara |
| MIME spoof/polyglot/bomb/malware/quota exhaustion | magic match, sharp decode+re-encode, pixel/dimension/time caps, ticket/project/global quota, quarantine scanner fail-closed, attachment headers | scanner bukan bukti absolut; update signatures dan pantau quarantine/quota |

## Invariant pengujian

- Public host tidak dapat mencapai auth/settings/terminal/scheduler/webhook/IDE/sync/VPS; control host
  tidak menerima Help publik; host asing ditolak.
- Token settings/projects/backlog tanpa `sessions:write` menghasilkan nol `createSession`; legacy
  approval migration dan explicit approval positif tetap berjalan.
- Symlink file, directory, nested, dangling, dan swap tidak membaca/menulis sentinel di luar root.
- Webhook 301/302/307/308 tidak menyentuh capture target; alamat connect sama dengan yang divalidasi.
- WS foreign/missing Origin, credential query, ticket replay, oversized/burst message, dan revoked
  principal gagal tertutup.
- Dua setup paralel dengan token sama menghasilkan tepat satu admin.
- Upload MIME palsu, decode gagal, pixel bomb, quota lewat, dan scanner gagal tidak dipromosikan.
- Permission diuji lewat mode aktual; retention dry-run/hold/file-delete-failure diuji dengan DB
  terisolasi. Test server selalu serial dan memakai `TEST_DATABASE_URL` unik.

## Incident response dan perubahan model

Jika public/control boundary pernah salah konfigurasi atau agen pernah berjalan di host/root tanpa
sandbox, tutup Help ingress, cabut sesi, lalu rotasi seluruh device/agent/webhook/setup/model/API/Git/
VPS credential dan secret access proxy yang mungkin terbaca. Audit outbound logs dan perubahan config,
namun jangan menyalin token ke tiket/commit. Restore dari backup yang juga membawa `secret.key`.

Menghidupkan kembali Help auto-launch, sandbox `off` di production, host control publik, query token,
redirect webhook, atau deny-hook command sebagai pengganti OS sandbox memerlukan ADR baru.

Active DAST terhadap produksi, malware upload nyata, credential replay, DNS rebinding ke target live,
atau pengujian yang mengubah data user memerlukan otorisasi manusia terpisah. Default verifikasi adalah
unit/integrasi negatif dan smoke lokal/staging.
