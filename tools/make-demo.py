"""Generates the demo images in samples/.

demo-ai.png         AI-style softened pixel art (grid 16x16, 48x48 logical)
demo-reference.png  the clean logical art, nearest-neighbour upscaled

Usage: python tools/make-demo.py
"""
from __future__ import annotations

import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "samples"
SCALE = 16
W = H = 48

# Cozy sunset palette
SKY = ["#2c2140", "#4b2c52", "#7b3b5c", "#b8515f", "#e07a5f", "#f2a65a"]
SUN = ["#ffe29a", "#ffc857", "#ffb03a"]
MOUNTAIN = ["#6b4a7a", "#4e3560", "#3a2849"]
GROUND = ["#3e6b4f", "#345a43", "#284837"]
GRASS = ["#5c8f5f", "#76a86b", "#8fbf79"]
SLIME = ["#8fe36b", "#5fc95a", "#3fa84a", "#237a3e"]
SLIME_LIGHT = "#c7ff9d"
OUTLINE = "#15341f"
WHITE = "#fff7e8"
EYE = "#173323"


def rect(draw: ImageDraw.ImageDraw, box, fill):
    draw.rectangle(box, fill=fill)


def main() -> None:
    img = Image.new("RGB", (W, H), SKY[3])
    d = ImageDraw.Draw(img)

    # Sky bands
    bands = [
        (0, 8, SKY[0]),
        (8, 14, SKY[1]),
        (14, 20, SKY[2]),
        (20, 25, SKY[3]),
        (25, 29, SKY[4]),
        (29, 32, SKY[5]),
    ]
    for y0, y1, color in bands:
        rect(d, (0, y0, W - 1, y1 - 1), color)

    # Stars
    for x, y in [(5, 3), (11, 6), (18, 3), (28, 5), (40, 2), (44, 7), (34, 8)]:
        d.point((x, y), fill="#f6e7b8")

    # Sun
    d.ellipse((31, 8, 43, 20), fill=SUN[2])
    d.ellipse((33, 10, 41, 18), fill=SUN[1])
    d.ellipse((35, 12, 39, 16), fill=SUN[0])

    # Clouds
    for cx, cy in [(13, 13), (36, 7)]:
        d.ellipse((cx - 4, cy - 1, cx + 4, cy + 2), fill="#e8b9a8")
        d.ellipse((cx - 2, cy - 3, cx + 2, cy + 1), fill="#f3d0bd")

    # Mountains
    d.polygon([(0, 32), (11, 20), (21, 32)], fill=MOUNTAIN[2])
    d.polygon([(12, 32), (25, 17), (38, 32)], fill=MOUNTAIN[1])
    d.polygon([(28, 32), (39, 23), (48, 32)], fill=MOUNTAIN[2])
    d.polygon([(0, 32), (6, 26), (12, 32)], fill=MOUNTAIN[0])
    d.polygon([(18, 32), (25, 24), (31, 32)], fill=MOUNTAIN[0])

    # Ground
    rect(d, (0, 32, W - 1, 37), GROUND[0])
    rect(d, (0, 38, W - 1, 43), GROUND[1])
    rect(d, (0, 44, W - 1, H - 1), GROUND[2])
    for x in range(0, W, 4):
        d.point((x, 34), fill=GRASS[1])
        d.point((x + 2, 35), fill=GRASS[0])
    for x in range(2, W, 6):
        d.line((x, 42, x, 39), fill=GRASS[0])
        d.point((x - 1, 40), fill=GRASS[1])
        d.point((x + 1, 40), fill=GRASS[2])
        d.point((x, 38), fill=GRASS[2])

    # Slime shadow
    d.ellipse((12, 41, 33, 45), fill=GROUND[2])

    # Slime body: outline, body, bottom shade, highlight
    d.ellipse((10, 25, 34, 44), fill=OUTLINE)
    d.ellipse((11, 26, 33, 43), fill=SLIME[2])
    d.ellipse((12, 27, 32, 42), fill=SLIME[1])
    d.ellipse((13, 28, 31, 40), fill=SLIME[0])
    d.ellipse((14, 29, 30, 33), fill=SLIME[0])
    d.rectangle((16, 34, 28, 39), fill=SLIME[0])
    d.rectangle((16, 40, 27, 41), fill=SLIME[1])
    d.ellipse((15, 29, 22, 34), fill=SLIME_LIGHT)
    d.ellipse((16, 30, 20, 32), fill="#e2ffc4")

    # Eyes
    d.rectangle((17, 34, 18, 37), fill=EYE)
    d.rectangle((24, 34, 25, 37), fill=EYE)
    d.point((17, 34), fill=WHITE)
    d.point((24, 34), fill=WHITE)

    # Mouth
    d.rectangle((20, 39, 22, 39), fill=EYE)
    d.point((19, 38), fill=EYE)
    d.point((23, 38), fill=EYE)

    # Tiny mushroom
    d.rectangle((38, 40, 39, 44), fill="#e8d5b5")
    d.ellipse((35, 36, 42, 41), fill="#d8584f")
    d.point((36, 38), fill=WHITE)
    d.point((40, 39), fill=WHITE)
    d.point((38, 37), fill=WHITE)

    SAMPLES.mkdir(parents=True, exist_ok=True)
    reference = img.resize((W * SCALE, H * SCALE), Image.Resampling.NEAREST)
    reference.save(SAMPLES / "demo-reference.png")

    # AI-ish finish: soft anti-aliasing, tiny chromatic noise, low-frequency
    # lighting variation and JPEG compression artifacts.
    ai = reference.filter(ImageFilter.GaussianBlur(1.35))
    pixels = ai.load()
    rng = random.Random(20240517)
    for y in range(ai.height):
        for x in range(ai.width):
            # gentle global light falloff
            glow = int(4 * (1 - y / ai.height) - 2)
            nr = rng.randint(-3, 3)
            ng = rng.randint(-3, 3)
            nb = rng.randint(-3, 3)
            r, g, b = pixels[x, y]
            pixels[x, y] = (
                max(0, min(255, r + nr + glow)),
                max(0, min(255, g + ng + glow)),
                max(0, min(255, b + nb + glow)),
            )

    tmp = SAMPLES / "demo-ai.tmp.jpg"
    ai.save(tmp, quality=86, subsampling=1)
    with Image.open(tmp) as loaded:
        loaded.convert("RGB").save(SAMPLES / "demo-ai.png")
    tmp.unlink()

    print("Wrote", SAMPLES / "demo-ai.png")
    print("Wrote", SAMPLES / "demo-reference.png")


if __name__ == "__main__":
    main()
