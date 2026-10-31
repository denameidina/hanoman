#!/usr/bin/env bash
# codex-image.sh — spawn Codex to generate raster images, land verified PNGs on disk.
# Codex's built-in image_gen tool needs no OPENAI_API_KEY; it uses the ChatGPT login.
set -euo pipefail

usage() {
  cat <<'USAGE'
codex-image.sh — generate PNG assets via Codex's built-in image_gen tool.

Usage:
  codex-image.sh --out FILE.png            [options] < spec.txt
  codex-image.sh --out-dir DIR --count N   [options] < spec.txt

The image spec is read from stdin (use a heredoc or a file).

Options:
  -o, --out FILE        Destination PNG for a single asset. Implies --count 1.
      --out-dir DIR     Destination directory when generating several assets.
      --name PREFIX     Filename prefix under --out-dir (default: asset).
  -n, --count N         Number of distinct assets to generate (default: 1, max 8).
  -r, --ref FILE        Reference image passed to Codex (repeatable, PNG/JPG).
  -s, --size WxH        Pixel size (default: 1024x1024). Both edges multiples of 16,
                        max edge 3840, ratio <= 3:1, 655360..8294400 total pixels.
  -t, --transparent     Ask for a genuinely transparent background.
      --fit             Resize the result to exactly --size (image_gen treats size as a hint).
      --raw             Harvest from ~/.codex/generated_images instead of Codex's copies.
      --effort LEVEL    Codex reasoning effort: low|medium|high (default: low).
      --timeout SEC     Hard timeout (default: 900).
      --keep            Keep the staging directory for debugging.
  -h, --help            Show this help.

Exit codes:
  0 success (every requested PNG exists and is a real PNG)
  2 usage error
  3 Codex turn failed (see the printed reason)
  4 Codex produced no image
  5 timeout
  6 --transparent was asked for but the result is opaque (file kept for inspection)
USAGE
}

OUT_FILE=""; OUT_DIR=""; NAME="asset"; COUNT=1; SIZE="1024x1024"
TRANSPARENT=0; RAW=0; EFFORT="low"; TIMEOUT=900; KEEP=0; FIT=0
REFS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -o|--out)         OUT_FILE="$2"; shift 2 ;;
    --out-dir)        OUT_DIR="$2"; shift 2 ;;
    --name)           NAME="$2"; shift 2 ;;
    -n|--count)       COUNT="$2"; shift 2 ;;
    -r|--ref)         REFS+=("$2"); shift 2 ;;
    -s|--size)        SIZE="$2"; shift 2 ;;
    -t|--transparent) TRANSPARENT=1; shift ;;
    --fit)            FIT=1; shift ;;
    --raw)            RAW=1; shift ;;
    --effort)         EFFORT="$2"; shift 2 ;;
    --timeout)        TIMEOUT="$2"; shift 2 ;;
    --keep)           KEEP=1; shift ;;
    -h|--help)        usage; exit 0 ;;
    *) echo "codex-image: unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

command -v codex >/dev/null 2>&1 || { echo "codex-image: codex CLI not found on PATH" >&2; exit 2; }

if [[ -n "$OUT_FILE" ]]; then
  [[ -n "$OUT_DIR" ]] && { echo "codex-image: use --out or --out-dir, not both" >&2; exit 2; }
  COUNT=1
  OUT_DIR="$(cd "$(dirname "$OUT_FILE")" 2>/dev/null && pwd)" || {
    echo "codex-image: destination directory does not exist: $(dirname "$OUT_FILE")" >&2; exit 2; }
elif [[ -n "$OUT_DIR" ]]; then
  mkdir -p "$OUT_DIR"
  OUT_DIR="$(cd "$OUT_DIR" && pwd)"
else
  echo "codex-image: --out or --out-dir is required" >&2; usage >&2; exit 2
fi

[[ "$COUNT" =~ ^[1-8]$ ]] || { echo "codex-image: --count must be 1..8" >&2; exit 2; }
[[ "$SIZE" =~ ^[0-9]+x[0-9]+$ ]] || { echo "codex-image: --size must look like 1536x1024" >&2; exit 2; }
for r in "${REFS[@]+"${REFS[@]}"}"; do
  [[ -f "$r" ]] || { echo "codex-image: reference image not found: $r" >&2; exit 2; }
done

if [[ "$TRANSPARENT" == "1" && ${#REFS[@]} -gt 0 ]]; then
  echo "codex-image: WARNING --ref together with --transparent reliably returns an OPAQUE image" >&2
  echo "codex-image: (measured: 0.0% clear with a reference, ~59% without, same spec). Reference" >&2
  echo "codex-image: images route through the edit path, which flattens alpha and paints a fake" >&2
  echo "codex-image: transparency checkerboard. Describe the style in words instead of attaching one." >&2
fi

SPEC="$(cat)"
[[ -n "${SPEC//[[:space:]]/}" ]] || { echo "codex-image: empty spec on stdin" >&2; exit 2; }

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/codex-image.XXXXXX")"
cleanup() { [[ "$KEEP" == "1" ]] || rm -rf "$STAGE"; }
trap cleanup EXIT
[[ "$KEEP" == "1" ]] && echo "codex-image: staging dir $STAGE" >&2

# --- build the prompt: the caller's spec plus a hard output contract ---
{
  echo "Generate raster image assets with your built-in image_gen tool (imagegen skill)."
  echo
  echo "=== IMAGE SPEC ==="
  echo "$SPEC"
  echo
  echo "Size: ${SIZE}."
  [[ "$TRANSPARENT" == "1" ]] && echo "Background: genuinely transparent; preserve the alpha channel."
  if [[ ${#REFS[@]} -gt 0 ]]; then
    echo "Attached images are references for style, subject and composition — not edit targets,"
    echo "unless the spec above says otherwise."
  fi
  echo
  echo "=== OUTPUT CONTRACT ==="
  echo "Your deliverable is exactly ${COUNT} PNG file(s) in your current working directory:"
  for i in $(seq 1 "$COUNT"); do printf '  %s-%02d.png\n' "$NAME" "$i"; done
  if [[ "$COUNT" -gt 1 ]]; then
    echo "If the spec above enumerates ${COUNT} distinct subjects, render them in the order listed,"
    echo "one subject per file, sharing the style, palette and framing stated once at the top."
    echo "If it describes a single subject, render ${COUNT} variants of that subject instead."
  fi
  echo "Each file is the image_gen output written to disk unchanged — same pixels, same alpha,"
  echo "same dimensions as generated. Issue one image_gen call per file."
  echo "Write nothing else: no README, no notes, no scripts, no edits to any other file."
  echo "Do not run remove_chroma_key.py, do not despill, do not crop, resize or recolor."
  echo "Finish with one line per file, and nothing after them:"
  echo "SAVED: <absolute path>"
} > "$STAGE/prompt.txt"

GEN_DIR="${CODEX_HOME:-$HOME/.codex}/generated_images"
mkdir -p "$GEN_DIR"
CODEX_ARGS=(exec --skip-git-repo-check -s workspace-write -C "$STAGE" --add-dir "$GEN_DIR"
            -c "model_reasoning_effort=\"$EFFORT\"" --json -o "$STAGE/last.txt")
for r in "${REFS[@]+"${REFS[@]}"}"; do CODEX_ARGS+=(-i "$r"); done
CODEX_ARGS+=(-)

echo "codex-image: generating ${COUNT} image(s) at ${SIZE} (timeout ${TIMEOUT}s)…" >&2
codex "${CODEX_ARGS[@]}" < "$STAGE/prompt.txt" > "$STAGE/events.jsonl" 2> "$STAGE/stderr.txt" &
CODEX_PID=$!
WAITED=0
while kill -0 "$CODEX_PID" 2>/dev/null; do
  if [[ "$WAITED" -ge "$TIMEOUT" ]]; then
    kill -TERM "$CODEX_PID" 2>/dev/null || true; sleep 2
    kill -KILL "$CODEX_PID" 2>/dev/null || true
    echo "codex-image: TIMEOUT after ${TIMEOUT}s" >&2
    exit 5
  fi
  sleep 3; WAITED=$((WAITED + 3))
done
wait "$CODEX_PID" 2>/dev/null || true   # codex exec exits 0 even when the turn failed

# --- codex exec's exit code lies; the events stream is the source of truth ---
FAIL="$(python3 - "$STAGE/events.jsonl" <<'PY'
import json, sys
reason = ""
for line in open(sys.argv[1], encoding="utf-8", errors="replace"):
    line = line.strip()
    if not line: continue
    try: ev = json.loads(line)
    except Exception: continue
    if ev.get("type") == "turn.failed":
        reason = (ev.get("error") or {}).get("message", "turn failed")
    elif ev.get("type") == "error" and not reason:
        reason = ev.get("message", "error")
print(reason)
PY
)"
if [[ -n "$FAIL" ]]; then
  echo "codex-image: Codex turn FAILED: $FAIL" >&2
  case "$FAIL" in
    *revoked*|*"log in again"*|*[Uu]nauthorized*|*401*)
      echo "codex-image: the ChatGPT login is stale. Run 'codex login' and retry." >&2 ;;
  esac
  exit 3
fi

THREAD="$(python3 - "$STAGE/events.jsonl" <<'PY'
import json, sys
for line in open(sys.argv[1], encoding="utf-8", errors="replace"):
    try: ev = json.loads(line)
    except Exception: continue
    if ev.get("type") == "thread.started":
        print(ev.get("thread_id", "")); break
PY
)"

# --- harvest: Codex's saved deliverables, else the raw generated_images drop ---
RAW_DIR="${CODEX_HOME:-$HOME/.codex}/generated_images/$THREAD"
FOUND=()
if [[ "$RAW" == "0" ]]; then
  while IFS= read -r f; do FOUND+=("$f"); done < <(find "$STAGE" -maxdepth 1 -name '*.png' | sort)
fi
if [[ ${#FOUND[@]} -eq 0 && -d "$RAW_DIR" ]]; then
  [[ "$RAW" == "0" ]] && echo "codex-image: no PNG in staging; falling back to raw $RAW_DIR" >&2
  while IFS= read -r f; do FOUND+=("$f"); done < <(ls -t "$RAW_DIR"/*.png 2>/dev/null | head -n "$COUNT" | sort)
fi
if [[ ${#FOUND[@]} -eq 0 ]]; then
  echo "codex-image: Codex produced no image. Its final message was:" >&2
  sed 's/^/  | /' "$STAGE/last.txt" >&2 2>/dev/null || true
  exit 4
fi
if [[ ${#FOUND[@]} -lt "$COUNT" ]]; then
  echo "codex-image: WARNING wanted $COUNT image(s), got ${#FOUND[@]}" >&2
fi

# --- verify every file really is a PNG, then place it ---
STATUS=0; i=0
for src in "${FOUND[@]}"; do
  i=$((i + 1)); [[ "$i" -gt "$COUNT" ]] && break
  if [[ -n "$OUT_FILE" ]]; then dst="$OUT_FILE"; else dst="$(printf '%s/%s-%02d.png' "$OUT_DIR" "$NAME" "$i")"; fi
  cp -f "$src" "$dst"
  if ! file -b "$dst" | grep -qi '^PNG image data'; then
    echo "codex-image: NOT a PNG: $dst ($(file -b "$dst"))" >&2; STATUS=4; continue
  fi
  read_dims() { file -b "$1" | sed -n 's/.*, \([0-9]*\) x \([0-9]*\),.*/\1x\2/p'; }
  dims="$(read_dims "$dst")"
  if [[ -n "$dims" && "$dims" != "$SIZE" ]]; then
    if [[ "$FIT" == "1" ]] && command -v sips >/dev/null 2>&1; then
      sips -z "${SIZE#*x}" "${SIZE%x*}" "$dst" --out "$dst" >/dev/null 2>&1
      echo "codex-image: resized $dims -> $SIZE (--fit)" >&2
      dims="$(read_dims "$dst")"
    else
      echo "codex-image: NOTE image_gen returned $dims, not the requested $SIZE — it treats size as a hint. Pass --fit to resize." >&2
    fi
  fi
  if [[ "$TRANSPARENT" == "1" ]]; then
    chk="$(python3 - "$dst" <<'PYCHK'
import sys
try:
    from PIL import Image
except ImportError:
    print("skip"); raise SystemExit
im = Image.open(sys.argv[1]).convert("RGBA")
clear = sum(im.getchannel("A").histogram()[:9]) / (im.width * im.height)
corners = [im.getpixel(p)[3] for p in
           [(0, 0), (im.width - 1, 0), (0, im.height - 1), (im.width - 1, im.height - 1)]]
print("ok" if clear >= 0.05 and max(corners) < 16 else "opaque %.1f%%" % (clear * 100))
PYCHK
)"
    case "$chk" in
      ok) ;;
      skip) echo "codex-image: NOTE Pillow missing, transparency not verified: $dst" >&2 ;;
      *) echo "codex-image: TRANSPARENCY FAILED $dst (only $chk of pixels are clear)." >&2
         echo "codex-image: the model most likely PAINTED a transparency checkerboard instead of" >&2
         echo "codex-image: leaving alpha. Add 'no checkerboard, no fake transparency grid' to Avoid." >&2
         printf 'BAD %s (%s) — opaque background, not delivered as transparent\n' \
                "$dst" "${dims:-unknown size}"
         STATUS=6; continue ;;
    esac
  fi
  printf 'OK %s (%s, %s bytes)\n' "$dst" "${dims:-unknown size}" "$(wc -c < "$dst" | tr -d ' ')"
done
[[ "$STATUS" == "0" ]] || exit "$STATUS"
