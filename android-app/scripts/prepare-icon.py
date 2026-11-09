#!/usr/bin/env python3
"""Extract the large standalone Monetra trend symbol from Main.png."""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "Main.png"
OUTPUT = Path(__file__).resolve().parents[1] / "assets" / "icon.png"

if not SOURCE.is_file():
    raise SystemExit(f"Missing source logo: {SOURCE}")

image = Image.open(SOURCE).convert("RGBA")
if image.size != (1760, 1120):
    raise SystemExit(f"Unexpected source dimensions {image.size}; refusing an unsafe crop.")

# Exact bounds of the large arrow symbol on the left of the wordmark.
# The Monetra lettering and the small caption/secondary mark are outside this crop.
mark = image.crop((270, 390, 490, 560))
pixels = mark.load()
for y in range(mark.height):
    for x in range(mark.width):
        r, g, b, _ = pixels[x, y]
        # Make the warm off-white paper transparent while preserving the olive mark.
        distance = ((r - 248) ** 2 + (g - 247) ** 2 + (b - 239) ** 2) ** 0.5
        alpha = max(0, min(255, int((distance - 10) * 3.2)))
        pixels[x, y] = (r, g, b, alpha)

bbox = mark.getbbox()
if not bbox:
    raise SystemExit("Could not isolate the trend symbol from Main.png.")
mark = mark.crop(bbox)

canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
scale = min(650 / mark.width, 650 / mark.height)
size = (max(1, round(mark.width * scale)), max(1, round(mark.height * scale)))
mark = mark.resize(size, Image.Resampling.LANCZOS)
canvas.alpha_composite(mark, ((1024 - size[0]) // 2, (1024 - size[1]) // 2))

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
canvas.save(OUTPUT, format="PNG", optimize=True)
print(f"Created symbol-only icon: {OUTPUT} ({canvas.width}x{canvas.height})")
