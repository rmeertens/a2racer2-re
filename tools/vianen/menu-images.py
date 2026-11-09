#!/usr/bin/env python3
"""The Quick Race pictures for Vianen, in the style of the original's: a 250x250 round slideshow
(frame 0 a map of the lap with its landmarks, frames 1-5 views of the track) and a 246x40 name
banner. Made from the OSM streets, the built track and the screenshots in evidence/vianen/ (run
tools/vianen/shots.mjs with --views first). Writes public/assets/vianen/menu/.
    python3 tools/vianen/menu-images.py"""
import json, math, os, struct, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')
sys.path.insert(0, HERE)
from route import load  # noqa: E402

OUT = os.path.join(ROOT, 'public', 'assets', 'vianen', 'menu')
MENU = os.path.join(ROOT, 'public', 'assets', 'menu')
EVIDENCE = os.path.join(ROOT, 'evidence', 'vianen')
UNITS = 10.0
SIZE = 250
FONTS = '/System/Library/Fonts/Supplemental/'


def font(name, size):
    try:
        return ImageFont.truetype(FONTS + name, size)
    except OSError:
        return ImageFont.load_default()


def disc_mask():
    """The original's round window: the alpha of its first slideshow picture."""
    return Image.open(os.path.join(MENU, 'qtc00_01.png')).convert('RGBA').split()[3]


def glass(im):
    """A soft light over the top of the disc, as the originals have."""
    im = im.convert('RGBA')
    light = Image.new('L', (SIZE, SIZE), 0)
    ImageDraw.Draw(light).ellipse((40, 8, 210, 120), fill=70)
    light = light.filter(ImageFilter.GaussianBlur(18))
    im = Image.composite(Image.new('RGBA', (SIZE, SIZE), (255, 255, 255, 255)), im, light)
    im.putalpha(disc_mask())
    return im


def chunk_centres():
    b = open(os.path.join(ROOT, 'public', 'assets', 'vianen', 'vianen.pmp'), 'rb').read()
    n = struct.unpack_from('<i', b, 0)[0]
    o, C = 4, []
    for _ in range(n):
        x, y, z = struct.unpack_from('<3f', b, o)
        o += 20
        for _ in range(3):
            k = struct.unpack_from('<i', b, o)[0]
            o += 4 + 4 * k
        C.append((x / UNITS, z / UNITS))
    return C


def map_frame(marks):
    """Frame 0: the old town from above, the lap in red, a flag at the start, rings and names."""
    C = chunk_centres()
    xs, zs = [c[0] for c in C], [c[1] for c in C]
    cx, cz = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2
    scale = 190 / max(max(xs) - min(xs), max(zs) - min(zs))
    P = lambda x, z: (SIZE / 2 + (x - cx) * scale, SIZE / 2 - (z - cz) * scale)  # north up
    im = Image.new('RGB', (SIZE, SIZE), (226, 232, 196))
    d = ImageDraw.Draw(im)
    nodes, ways = load(os.path.join(ROOT, 'source', 'assets', 'vianen', 'osm.json'))
    for w in ways:
        tags = w.get('tags', {})
        pts = [P(*nodes[k]) for k in w['nodes'] if k in nodes]
        if len(pts) < 2:
            continue
        if tags.get('natural') == 'water' or tags.get('waterway'):
            if len(pts) > 2 and tags.get('natural') == 'water':
                d.polygon(pts, fill=(150, 196, 222))
            else:
                d.line(pts, fill=(150, 196, 222), width=4)
    for w in ways:
        tags = w.get('tags', {})
        pts = [P(*nodes[k]) for k in w['nodes'] if k in nodes]
        if len(pts) > 2 and 'building' in tags:
            d.polygon(pts, fill=(214, 196, 170))
    for w in ways:
        pts = [P(*nodes[k]) for k in w['nodes'] if k in nodes]
        if len(pts) > 1 and w.get('tags', {}).get('highway'):
            d.line(pts, fill=(250, 250, 240), width=2)
    lap = [P(*c) for c in C] + [P(*C[0])]
    d.line(lap, fill=(120, 10, 10), width=7)
    d.line(lap, fill=(210, 30, 30), width=4)
    small = font('Arial Bold.ttf', 12)
    for name, chunk, left, down in marks:
        x, y = P(*C[chunk % len(C)])
        d.ellipse((x - 8, y - 8, x + 8, y + 8), fill=(40, 60, 20), outline=(200, 230, 40), width=3)
        tx = x - 11 - d.textlength(name, font=small) if left else x + 11
        y += down
        for dx, dy in ((1, 1), (-1, -1), (1, -1), (-1, 1)):
            d.text((tx + dx, y - 7 + dy), name, font=small, fill=(20, 40, 10))
        d.text((tx, y - 7), name, font=small, fill=(220, 245, 80))
    # The chequered flag at the start.
    x, y = P(*C[11])
    d.line((x, y, x, y - 30), fill=(30, 30, 30), width=2)
    for r in range(3):
        for c in range(4):
            colour = (20, 20, 20) if (r + c) % 2 == 0 else (250, 250, 250)
            d.rectangle((x - 21 + c * 5, y - 30 + r * 5, x - 16 + c * 5, y - 25 + r * 5), fill=colour)
    return glass(im)


def view_frame(name):
    """A screenshot cut to a square and put in the disc."""
    im = Image.open(os.path.join(EVIDENCE, name)).convert('RGB')
    w, h = im.size
    s = min(w, h)
    im = im.crop(((w - s) // 2, 0, (w + s) // 2, s)).resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    return glass(im)


def banner(text):
    """The track's name as the originals write it: italic, yellow green, a dark edge."""
    im = Image.new('RGBA', (246, 40), (255, 255, 255, 0))
    d = ImageDraw.Draw(im)
    f = font('Arial Black.ttf', 26)
    w = d.textlength(text, font=f)
    x, y = (246 - w) / 2, 3
    for dx in range(-2, 3):
        for dy in range(-2, 3):
            d.text((x + dx, y + dy), text, font=f, fill=(24, 40, 8, 255))
    d.text((x, y), text, font=f, fill=(206, 236, 52, 255))
    # Lean it as the originals' italic script does.
    return im.transform(im.size, Image.Transform.AFFINE, (1, 0.25, -5, 0, 1, 0), Image.Resampling.BICUBIC)


def main():
    os.makedirs(OUT, exist_ok=True)
    # name, chunk, label on the left, label lower by
    marks = [('Lekpoort', 28, False, 0), ('Stadhuis', 18, False, -6), ('Grote Kerk', 104, False, 0), ('Ophaalbrug', 77, True, 14), ('Dijk', 43, False, 0)]
    map_frame(marks).save(os.path.join(OUT, 'qtc010_00.png'))
    views = ['view-lekpoort.png', 'chunk-3.png', 'view-stadhuis.png', 'view-kerktoren.png', 'view-kerk.png']
    for k, name in enumerate(views, 1):
        view_frame(name).save(os.path.join(OUT, f'qtc010_{k:02d}.png'))
    banner('Vianen').save(os.path.join(OUT, 'trname10.png'))
    print('menu pictures in', OUT)


if __name__ == '__main__':
    main()
