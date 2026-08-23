"""Sheet rig -> aset keyed + geometri CSS lengkap (posisi %, origin sendi, jangkar tangan)."""
import sys, json
sys.path.insert(0, "/Users/zamaludin/Documents/Zamal/NAFANESIA/hanoman/internal/scripts/pet")
from PIL import Image
import numpy as np
import petlib

SRC = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/hanoman-dalang/rig2"

def despill(im):
    a = np.asarray(im, dtype=np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    g = np.minimum(g, np.maximum(r, b))
    greenish = (g > r * 0.92) & (b < g * 0.62) & (r > 60)
    a[..., 1] = np.where(greenish, r * 0.8, g)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")

def goldmask(im):
    a = np.asarray(im, dtype=np.int16)
    r, g, b, al = a[...,0], a[...,1], a[...,2], a[...,3]
    return (al > 200) & (r > 140) & (g > 80) & (b < 110) & (r > b + 60)

def centroid(im, x0, y0, x1, y1):
    m = goldmask(im)
    sub = np.zeros_like(m); sub[y0:y1, x0:x1] = m[y0:y1, x0:x1]
    ys, xs = np.nonzero(sub)
    return (float(xs.mean()), float(ys.mean()), len(xs))

im = Image.open(SRC)
cw, ch = im.width // 3, im.height // 2
cells = {"body": (0, 0), "arm-ul": (1, 0), "arm-ur": (2, 0), "arm-ml": (0, 1), "arm-mr": (1, 1)}
parts = {}
import os; os.makedirs(OUT, exist_ok=True)
for name, (cx, cy) in cells.items():
    cell = im.crop((cx * cw, cy * ch, (cx + 1) * cw, (cy + 1) * ch))
    keyed = despill(petlib.chroma_key(cell))
    l, t, r, b = keyed.getchannel("A").getbbox()
    keyed = keyed.crop((max(0, l - 6), max(0, t - 6), min(keyed.width, r + 6), min(keyed.height, b + 6)))
    keyed.save(f"{OUT}/hnm-hero-rig-{name}-master-v01.webp", "WEBP", quality=90, method=6)
    keyed.save(f"{OUT}/hnm-hero-rig-{name}-v01.webp", "WEBP", quality=82, method=6)
    parts[name] = keyed

# cakram sendi: badan 4 kuadran zona bahu; lengan 1 kuadran sesuai orientasinya
body = parts["body"]; W, H = body.size
bd = {
    "UL": centroid(body, 0, int(H*0.25), int(W*0.33), int(H*0.52)),
    "LL": centroid(body, 0, int(H*0.52), int(W*0.30), int(H*0.78)),
    "UR": centroid(body, int(W*0.67), int(H*0.25), W, int(H*0.52)),
    "LR": centroid(body, int(W*0.70), int(H*0.52), W, int(H*0.78)),
}
armzone = {"arm-ul": "BR", "arm-ur": "BL", "arm-ml": "TR", "arm-mr": "TL"}
ad, hd = {}, {}
for name, z in armzone.items():
    p = parts[name]; w, h = p.size
    x0, x1 = (w//2, w) if "R" in z else (0, w//2)
    y0, y1 = (h//2, h) if "B" in z else (0, h//2)
    ad[name] = centroid(p, x0, y0, x1, y1)
    # jangkar tangan = centroid emas kuadran SEBERANG cakram (gapit di genggaman)
    hx0, hx1 = (0, w//2) if "R" in z else (w//2, w)
    hy0, hy1 = (0, h//2) if "B" in z else (h//2, h)
    hd[name] = centroid(p, hx0, hy0, hx1, hy1)

# rakit: badan di B=(0,0); lengan offset agar cakramnya menimpa cakram badan
pair = {"arm-ul": "UL", "arm-ur": "UR", "arm-ml": "LL", "arm-mr": "LR"}
pos = {"body": (0.0, 0.0)}
for name, bkey in pair.items():
    bx, by, _ = bd[bkey]; axc, ayc, _ = ad[name]
    pos[name] = (bx - axc, by - ayc)
xs = [pos[n][0] for n in pos] + [pos[n][0] + parts[n].width for n in pos]
ys = [pos[n][1] for n in pos] + [pos[n][1] + parts[n].height for n in pos]
X0, Y0, X1, Y1 = min(xs), min(ys), max(xs), max(ys)
CW, CH = X1 - X0, Y1 - Y0
print(f"/* kanvas {CW:.0f} x {CH:.0f} — aspect-ratio: {CW:.0f} / {CH:.0f} */")
for n in ["body", "arm-ul", "arm-ur", "arm-ml", "arm-mr"]:
    px, py = pos[n][0] - X0, pos[n][1] - Y0
    L, T, Wd = px/CW*100, py/CH*100, parts[n].width/CW*100
    if n == "body":
        print(f".hn-dlg-rig-body {{ left: {L:.2f}%; top: {T:.2f}%; width: {Wd:.2f}%; }}")
    else:
        ox, oy, _ = ad[n]
        print(f".hn-dlg-rig-arm--{n[4:]} {{ left: {L:.2f}%; top: {T:.2f}%; width: {Wd:.2f}%; transform-origin: {ox/parts[n].width*100:.1f}% {oy/parts[n].height*100:.1f}%; }}")
for n, key in [("arm-ul","ul"),("arm-ur","ur"),("arm-ml","ml"),("arm-mr","mr")]:
    hx, hy, cnt = hd[n]
    gx = (pos[n][0] - X0 + hx) / CW * 100
    gy = (pos[n][1] - Y0 + hy) / CH * 100
    print(f'.hn-dlg-hand[data-hand="{key}"] {{ left: {gx:.1f}%; top: {gy:.1f}%; }} /* n={cnt} */')
print(json.dumps({n: parts[n].size for n in parts}))
