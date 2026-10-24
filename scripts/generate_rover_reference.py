"""Render fixtures/images/rover-reference.png, an original top-down rover illustration.

The image is drawn entirely from primitives in this script (no third-party imagery), so the
repository owns it. Output is deterministic; rerun after edits and commit the PNG.

    uv run --with pillow scripts/generate_rover_reference.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parents[1] / "fixtures" / "images" / "rover-reference.png"
W, H = 1024, 768


def _font(size: int) -> ImageFont.ImageFont:
    return ImageFont.load_default(size=size)


def render() -> Image.Image:
    img = Image.new("RGB", (W, H), "#eef1f5")
    d = ImageDraw.Draw(img)

    for gx in range(0, W, 32):
        d.line((gx, 0, gx, H), fill="#e2e6ec")
    for gy in range(0, H, 32):
        d.line((0, gy, W, gy), fill="#e2e6ec")

    cx, cy = W // 2, H // 2 + 20
    d.ellipse((cx - 250, cy - 200, cx + 270, cy + 230), fill="#d7dce3")

    # Chassis plate (front faces right).
    d.rounded_rectangle((cx - 230, cy - 150, cx + 230, cy + 150), radius=40, fill="#c9ced6", outline="#7b8493", width=4)
    for hx in range(cx - 190, cx + 200, 60):
        for hy in (cy - 120, cy + 120):
            d.ellipse((hx - 6, hy - 6, hx + 6, hy + 6), fill="#9aa3b1")

    # Drive wheels on the sides, motors behind them.
    for side in (-1, 1):
        d.rounded_rectangle((cx - 60, cy + side * 150 - 35 * (side > 0), cx + 40, cy + side * 150 + 35 * (side < 0)),
                            radius=10, fill="#f2c14e", outline="#b8892a", width=3)
    for wx, wy in ((cx - 80, cy - 230), (cx - 80, cy + 160)):
        d.rounded_rectangle((wx, wy, wx + 140, wy + 70), radius=22, fill="#22252b", outline="#111318", width=3)
        for tx in range(wx + 12, wx + 135, 16):
            d.line((tx, wy + 8, tx, wy + 62), fill="#3b3f47", width=5)
        d.rounded_rectangle((wx + 50, wy + 26, wx + 90, wy + 44), radius=6, fill="#f2c14e")

    # Rear caster.
    d.ellipse((cx - 215, cy - 30, cx - 155, cy + 30), fill="#5b6270", outline="#2f343c", width=3)
    d.ellipse((cx - 195, cy - 10, cx - 175, cy + 10), fill="#c9ced6")

    # Battery packs.
    d.rounded_rectangle((cx - 140, cy - 95, cx - 30, cy - 15), radius=8, fill="#3d6fb6", outline="#24487c", width=3)
    d.rounded_rectangle((cx - 140, cy + 15, cx - 30, cy + 95), radius=8, fill="#4f86cf", outline="#24487c", width=3)

    # Controller and motor driver boards.
    d.rounded_rectangle((cx - 10, cy - 95, cx + 120, cy + 10), radius=6, fill="#2f8f5b", outline="#1d5c3a", width=3)
    for px in range(cx + 4, cx + 110, 12):
        d.rectangle((px, cy - 88, px + 5, cy - 82), fill="#e7d27a")
    d.rectangle((cx + 30, cy - 60, cx + 70, cy - 25), fill="#1f2328")
    d.rounded_rectangle((cx - 10, cy + 30, cx + 90, cy + 95), radius=6, fill="#c0423b", outline="#7e2622", width=3)
    d.rectangle((cx + 20, cy + 50, cx + 55, cy + 75), fill="#1f2328")

    # Front range sensor.
    d.rounded_rectangle((cx + 170, cy - 55, cx + 215, cy + 55), radius=6, fill="#2c5aa0", outline="#173868", width=3)
    for sy in (cy - 28, cy + 28):
        d.ellipse((cx + 190, sy - 20, cx + 230, sy + 20), fill="#c8ccd2", outline="#6c727c", width=3)
        d.ellipse((cx + 203, sy - 7, cx + 217, sy + 7), fill="#2a2d33")

    # Sensor cone and heading arrow.
    d.polygon([(cx + 235, cy), (cx + 420, cy - 90), (cx + 420, cy + 90)], outline="#8fa7cc")
    d.line((cx + 250, cy, cx + 400, cy), fill="#55657d", width=4)
    d.polygon([(cx + 400, cy - 12), (cx + 425, cy), (cx + 400, cy + 12)], fill="#55657d")

    d.text((40, 32), "Rivet rover reference (synthetic)", fill="#1f2a3a", font=_font(34))
    d.text((40, 76), "Original illustration for fixtures/tests. Not a photo of real hardware.", fill="#4a5568", font=_font(20))
    d.text((40, H - 56), "front: right  |  2WD differential drive + rear caster + front range sensor", fill="#4a5568", font=_font(18))
    return img


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    render().save(OUT, format="PNG", optimize=True)
    print(OUT)


if __name__ == "__main__":
    main()
