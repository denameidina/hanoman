# Release doc — hanoman

Detail kanoniknya di [requirements/rd.md](../requirements/rd.md).

## Kanal
- `main` → target integrasi; `hanoman/spec-<n>` satu branch per backlog item.
- Tag `v<semver>` → rilis paket npm `hanoman` lewat trusted publishing (OIDC), tak pernah dari branch.

## Identitas versi
- Semver dari root `package.json`, ditanam ke `dist/build-info.json`; dibandingkan dengan registry npm.

## Menuju v1.0
- Auth, Overview, Projects, Backlog (+ review & rebase/merge), Terminal (sesi tmux + steer + worktree), Docs SoT (render+edit), VPS, Settings, Notifikasi & indikator limit.

## Nanti
- Notifikasi Slack, laporan biaya per project, audit log.
