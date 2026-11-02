# -*- coding: utf-8 -*-
"""清理生成图自带的绿边，切出桌宠、立绘、头像（源图本身已带透明通道）。"""
import os
import numpy as np
from PIL import Image, ImageFilter

SRC = r"E:\我也是创作上了\虚拟Liven\assets\character\source"
OUT = r"E:\我也是创作上了\虚拟Liven\assets\character"
QOUT = os.path.join(OUT, "q")
os.makedirs(QOUT, exist_ok=True)


def clean(path, pad=10):
    img = Image.open(path).convert("RGBA")
    arr = np.array(img).astype(np.float32)
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    cap = np.maximum(r, b)
    greenness = g - cap

    # 强绿：直接判为背景（围巾是深绿，g 不会明显高于 r/b）
    strong = (greenness > 42) & (g > 105)
    arr[..., 3] = np.where(strong, 0, arr[..., 3])

    # 中绿：留在发丝边缘的溢出，把绿色压回中性（只处理亮部，别把深绿围巾洗灰）
    moderate = (greenness > 5) & (g > 80) & ~strong
    arr[..., 1] = np.where(moderate, np.minimum(g, cap), arr[..., 1])

    # 去掉生成图边缘的白色/浅色描边（半透明的浅色像素一律清掉）
    alpha_arr = arr[..., 3]
    pale = (alpha_arr < 250) & (np.minimum(np.minimum(r, g), b) > 185)
    arr[..., 3] = np.where(pale, 0, alpha_arr)

    # 收 2px 边缘，去掉生成图自带的白色/绿色描边，再轻微羽化
    alpha = Image.fromarray(np.clip(arr[..., 3], 0, 255).astype(np.uint8), "L")
    alpha = alpha.filter(ImageFilter.MinFilter(5)).filter(ImageFilter.GaussianBlur(0.7))
    arr[..., 3] = np.array(alpha)
    arr = np.clip(arr, 0, 255).astype(np.uint8)
    out = Image.fromarray(arr, "RGBA")
    box = out.getbbox()
    if box:
        out = out.crop((max(0, box[0] - pad), max(0, box[1] - pad),
                        min(out.width, box[2] + pad), min(out.height, box[3] + pad)))
    return out


def save(img, name, max_side=None):
    if max_side and max(img.size) > max_side:
        k = max_side / max(img.size)
        img = img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS)
    p = os.path.join(OUT, name)
    img.save(p)
    print(name, img.size, os.path.getsize(p))


print("== portrait")
portrait = clean(os.path.join(SRC, "portrait.webp"))
save(portrait, "liven-portrait.png", 1400)

# 头像：裁一块接近方形（脸 + 肩）
pw, ph = portrait.size
side = int(min(pw, ph) * 0.62)
cx = int(pw * 0.50)
cy = int(ph * 0.40)
left = max(0, min(pw - side, cx - side // 2))
top = max(0, min(ph - side, cy - side // 2))
avatar = portrait.crop((left, top, left + side, top + side))
save(avatar, "avatar.png", 320)

print("== threeview")
three = clean(os.path.join(SRC, "threeview.png"))
tw, th = three.size
for i, name in enumerate(["liven-front.png", "liven-side.png", "liven-back.png"]):
    part = three.crop((tw * i // 3, 0, tw * (i + 1) // 3, th))
    bb = part.getbbox()
    if bb:
        part = part.crop((max(0, bb[0] - 8), max(0, bb[1] - 8),
                          min(part.width, bb[2] + 8), min(part.height, bb[3] + 8)))
    save(part, name, 1100)

print("== qgrid")
q = clean(os.path.join(SRC, "qgrid.png"))
qw, qh = q.size
names = [["q-sip", "q-offer"], ["q-wipe", "q-surprise"]]
for row in range(2):
    for col in range(2):
        cell = q.crop((qw * col // 2, qh * row // 2, qw * (col + 1) // 2, qh * (row + 1) // 2))
        bb = cell.getbbox()
        if bb:
            cell = cell.crop((max(0, bb[0] - 8), max(0, bb[1] - 8),
                              min(cell.width, bb[2] + 8), min(cell.height, bb[3] + 8)))
        p = os.path.join(QOUT, names[row][col] + ".png")
        cell.save(p)
        print(" q/" + names[row][col] + ".png", cell.size, os.path.getsize(p))

# 预览：放到咖啡馆底色上，检查边缘
for name in ["liven-portrait.png", "liven-front.png", "avatar.png"]:
    im = Image.open(os.path.join(OUT, name)).convert("RGBA")
    canvas = Image.new("RGBA", (im.width + 80, im.height + 80), (194, 172, 135, 255))
    canvas.alpha_composite(im, (40, 40))
    canvas.convert("RGB").save(os.path.join(OUT, "_preview_" + name.replace(".png", ".jpg")), quality=88)
for name in ["q-sip", "q-offer", "q-wipe", "q-surprise"]:
    im = Image.open(os.path.join(QOUT, name + ".png")).convert("RGBA")
    for tag, bg in [("cafe", (194, 172, 135, 255)), ("dark", (43, 47, 43, 255))]:
        canvas = Image.new("RGBA", (im.width + 80, im.height + 80), bg)
        canvas.alpha_composite(im, (40, 40))
        canvas.convert("RGB").save(os.path.join(QOUT, "_preview_" + name + "_" + tag + ".jpg"), quality=88)
print("done")
