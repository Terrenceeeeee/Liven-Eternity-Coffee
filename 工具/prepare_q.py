"""把 Q 版素材统一成可无缝换姿势的画布。

输入：
  assets/character/source/qgrid.png   四格（白底 + 绿边）
  assets/character/source/blink.jpg   左右两格（绿幕，睁眼/闭眼）
  assets/character/source/wave.png    招手（绿幕）
  assets/character/source/yawn.png    打哈欠（绿幕）

输出：
  assets/character/q/q-*.png          600x800，人物高 750，脚底对齐
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "character" / "source"
OUT = ROOT / "assets" / "character" / "q"

CANVAS = (600, 800)
TARGET_H = 750
BOTTOM = 782


def key_green(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA")
    arr = np.array(im).astype(np.int16)
    r, g, b, a = arr[..., 0], arr[..., 1], arr[..., 2], arr[..., 3]
    cap = np.maximum(r, b)
    greenness = g - cap

    # 强绿：纯背景与描边光晕
    strong = (greenness > 30) & (g > 95)
    arr[..., 3] = np.where(strong, 0, a)

    # 中绿：留在发丝边缘的溢色，压回中性（深绿围巾不受影响）
    spill = (greenness > 3) & (g > 75) & ~strong
    arr[..., 1] = np.where(spill, cap, arr[..., 1])

    # 浅色半透明边：生成图常见的白边
    pale = (arr[..., 3] < 250) & (np.minimum(np.minimum(r, g), b) > 185)
    arr[..., 3] = np.where(pale, 0, arr[..., 3])

    alpha = Image.fromarray(np.clip(arr[..., 3], 0, 255).astype(np.uint8), "L")
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.6))
    arr[..., 3] = np.array(alpha)
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")


def normalize(im: Image.Image, name: str) -> Image.Image:
    im = im.convert("RGBA")
    bbox = im.getbbox()
    if not bbox:
        raise ValueError(f"{name}: 抠完是空的")
    im = im.crop(bbox)
    w, h = im.size
    scale = TARGET_H / h
    im = im.resize((max(1, round(w * scale)), TARGET_H), Image.LANCZOS)
    if im.width > CANVAS[0]:
        raise ValueError(f"{name}: 太宽 {im.width} > {CANVAS[0]}，需要加宽画布")
    out = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    out.alpha_composite(im, ((CANVAS[0] - im.width) // 2, BOTTOM - im.height))
    return out


def four_grid():
    im = Image.open(SRC / "qgrid.png").convert("RGBA")
    w, h = im.size
    names = ["sip", "offer", "wipe", "surprise"]
    for i, name in enumerate(names):
        col, row = i % 2, i // 2
        cell = im.crop((col * w // 2, row * h // 2, (col + 1) * w // 2, (row + 1) * h // 2))
        normalize(key_green(cell), name).save(OUT / f"q-{name}.png")
        print("q-" + name, (OUT / f"q-{name}.png").stat().st_size)


def blink():
    im = Image.open(SRC / "blink.jpg").convert("RGBA")
    w, h = im.size
    for name, box in (("blink-open", (0, 0, w // 2, h)), ("blink-close", (w // 2, 0, w, h))):
        normalize(key_green(im.crop(box)), name).save(OUT / f"q-{name}.png")
        print("q-" + name, (OUT / f"q-{name}.png").stat().st_size)


def single(name):
    im = Image.open(SRC / f"{name}.png")
    normalize(key_green(im), name).save(OUT / f"q-{name}.png")
    print("q-" + name, (OUT / f"q-{name}.png").stat().st_size)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    four_grid()
    blink()
    single("wave")
    single("yawn")
    print("done")
