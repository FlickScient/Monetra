#!/usr/bin/env python3
"""Extract the standalone Monetra trend mark from the supplied brand sheet."""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "Main.png"
OUTPUT = Path(__file__).resolve().parents[1] / "assets" / "icon.png"

if not SOURCE.is_file():
    raise SystemExit(f"Missing source logo: {SOURCE}")

image = Image.open(SOURCE).convert("RGBA")
if image.size != (1504, 1120):
    raise SystemExit(f"Unexpected source dimensions {image.size}; refusing an unsafe crop.")

# The large standalone mark is left of the Monetra wordmark. This crop excludes
# the wordmark and the smaller explanatory mark/tagline below it.
mark = image.crop((240, 340, 425, 490))
pixels = mark.load()
for y in range(mark.height):
    for x in range(mark.width):
        r, g, b, _ = pixels[x, y]
        # Remove the warm off-white sheet background while retaining antialiased
        # olive edges as partial alpha.
        distance = ((r - 248) ** 2 + (g - 247) ** 2 + (b - 239) ** 2) ** 0.5
        alpha = max(0, min(255, int((distance - 12) * 3.0)))
        pixels[x, y] = (r, g, b, alpha)

bbox = mark.getbbox()
if not bbox:
    raise SystemExit("Could not isolate the trend mark from Main.png.")
mark = mark.crop(bbox)

canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
max_side = 620
scale = min(max_side / mark.width, max_side / mark.height)
size = (max(1, round(mark.width * scale)), max(1, round(mark.height * scale)))
mark = mark.resize(size, Image.Resampling.LANCZOS)
canvas.alpha_composite(mark, ((1024 - size[0]) // 2, (1024 - size[1]) // 2))

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
canvas.save(OUTPUT, format="PNG", optimize=True)
print(f"Created symbol-only launcher icon: {OUTPUT} ({canvas.size[0]}x{canvas.size[1]})")
