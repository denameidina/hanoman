#!/usr/bin/env bash
# SPEC-851 · Gerbang provenance rilis: commit yang ditag WAJIB sudah masuk branch rilis.
#
# Kenapa berkas terpisah dan bukan blok `run:` inline seperti gerbang tag==versi: gerbang ini
# punya cabang (repo dangkal, ref rilis hilang, bukan ancestor) dan kegagalannya hanya kelihatan
# di CI, jauh dari orang yang menyuntingnya. Di berkas sendiri ia bisa dipagari test terhadap repo
# git betulan — cli/test/release-ancestry.test.ts.
#
# Tanpa dependency dan tanpa toolchain, supaya ia bisa berjalan tepat sesudah checkout: sebelum
# setup node/pnpm, sebelum `pnpm install`, dan sebelum step mana pun meminta OIDC.
#
# Pemakaian: scripts/assert-release-ancestry.sh [commit-ish] [ref-rilis]
set -uo pipefail

COMMITISH="${1:-HEAD}"
RELEASE_REF="${2:-origin/main}"

fail() {
  echo "::error::$*"
  exit 1
}

# `$GITHUB_SHA` pada tag BERANOTASI bisa menunjuk objek tag, bukan commitnya — jadi apa pun yang
# masuk di-resolve dulu ke commit, bukan dipakai apa adanya.
SHA="$(git rev-parse --verify --quiet "${COMMITISH}^{commit}")"
[ -n "$SHA" ] || fail "'$COMMITISH' tak bisa di-resolve ke commit di clone ini"

# Fail closed, bukan menebak: di repo dangkal `merge-base` menjawab dari riwayat yang terpotong dan
# menolak commit yang sebenarnya ADA di branch rilis. Kalau `fetch-depth: 0` hilang dari
# release.yml, yang muncul harus "riwayatnya kurang", bukan tuduhan palsu terhadap commitnya.
if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
  fail "riwayat git masih dangkal (shallow) — pemeriksaan ancestry tak bisa dipercaya; pasang 'fetch-depth: 0' pada actions/checkout"
fi

REF_SHA="$(git rev-parse --verify --quiet "${RELEASE_REF}^{commit}")"
[ -n "$REF_SHA" ] || fail "ref rilis '$RELEASE_REF' tak ada di clone ini — fetch dulu (checkout pada push bertag hanya mengambil refspec tag itu)"

git merge-base --is-ancestor "$SHA" "$REF_SHA"
rc=$?
if [ "$rc" -eq 0 ]; then
  echo "commit $SHA sudah masuk $RELEASE_REF ($REF_SHA) — gerbang provenance lulus"
  exit 0
fi
[ "$rc" -eq 1 ] || fail "'git merge-base --is-ancestor' gagal dengan exit $rc — bukan jawaban 'bukan ancestor'"

fail "commit $SHA BELUM masuk '$RELEASE_REF' — merge dulu ke branch rilis, lalu tag ulang dari commit yang sudah di sana"
