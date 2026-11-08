#!/usr/bin/env python3
"""Re-skins Wenen (etappe 3) as Vianen: the same track, Vianen's looks.

    python3 tools/vianen/reskin-wenen.py

Reads Wenen's textures from original-game-decompiled/extracted/game-archives/rcs/, its menu and
wait pictures from public/assets/, and the Vianen sources in source/assets/vianen/ (photos from
Wikimedia Commons, streets from OpenStreetMap). Writes public/assets/vianen/wenen/:

- vn3_weg.tga: the road, its grey asphalt turned to red brick klinkers, the markings kept.
- vn3_gra2.tga, vn3_vang.tga: the two facade atlases of the track's walls.
- vn3_oper.tga, vn3_pr2.tga, vn3_mus2.tga, vn3_bors.tga, vn3_mitt.tga: the textures of Wenen's
  landmark objects (opera, parliament, museums, stock exchange).
  In all of these every photo cell gets a Vianen facade, fitted to it. Cells with the key colour
  (magenta, see-through) hold trees, lamps and statues, and stay.
- qtc03_00..05.png, ttc03_00..05.png, trname03.png: the menu's slideshow and track name.
- e03.png, e03-8.png, e03-lo.png: the wait screen.

source/host/vianen.js points the game and the menu at these files.
"""
import json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')
RCS = os.path.join(ROOT, 'original-game-decompiled', 'extracted', 'game-archives', 'rcs')
SRC = os.path.join(ROOT, 'source', 'assets', 'vianen')
OUT = os.path.join(ROOT, 'public', 'assets', 'vianen', 'wenen')
MENU = os.path.join(ROOT, 'public', 'assets', 'menu')
LOADING = os.path.join(ROOT, 'public', 'assets', 'loading')
sys.path.insert(0, HERE)
from route import loop, TARGETS  # noqa: E402

FONT = '/System/Library/Fonts/Supplemental/Arial Bold Italic.ttf'


def photo(key):
    return Image.open(os.path.join(SRC, 'photos', key + '.jpg')).convert('RGB')


def crop(im, box):
    w, h = im.size
    return im.crop((int(box[0] * w), int(box[1] * h), int(box[2] * w), int(box[3] * h)))


def warm(im):
    """The RCE photos are black and white: tint them toward brick and plaster."""
    return ImageOps.colorize(ImageOps.grayscale(im), black=(40, 28, 22), white=(250, 236, 214), mid=(150, 104, 80))


# Facades to fit into cells: tall ones for narrow cells, rows of houses for wide ones.
TALL = [
    ('lekpoort1', (0.27, 0.10, 0.77, 0.97), False),
    ('stadhuis2', (0.14, 0.03, 0.93, 0.97), False),
    ('lekpoort2', (0.30, 0.02, 0.70, 0.95), True),
    ('stadhuis1', (0.30, 0.10, 0.75, 0.75), False),
]
WIDE = [(f'gevel{k}', (0.0, 0.03, 1.0, 0.58), True) for k in range(1, 9)] + [
    ('kerk2', (0.15, 0.12, 0.70, 0.52), False),
    ('stadhuis2', (0.14, 0.03, 0.93, 0.60), False),
]
LANDMARK = {
    'e03_oper': [TALL[1], WIDE[9]],          # the opera becomes the Stadhuis
    'e03_pr2': [('kerk2', (0.15, 0.10, 0.70, 0.55), False), TALL[0]],  # the parliament, the Grote Kerk
    'e03_mus2': [TALL[0], TALL[2]],           # the museums, the Lekpoort
    'e03_bors': [TALL[3], WIDE[9]],
    'e03_mitt': [TALL[1]],
}
CACHE = {}


def source(spec):
    key, box, bw = spec
    if spec not in CACHE:
        im = crop(photo(key), box)
        CACHE[spec] = warm(im) if bw else im
    return CACHE[spec]


def cells(rgb):
    """Photo cells of an atlas: solid areas that are neither black nor the magenta key."""
    r, g, b = rgb[..., 0].astype(int), rgb[..., 1].astype(int), rgb[..., 2].astype(int)
    magenta = (r > 180) & (g < 80) & (b > 90)
    black = (r + g + b) < 24
    labels, n = ndimage.label(~magenta & ~black)
    out = []
    for k, sl in enumerate(ndimage.find_objects(labels), 1):
        if sl is None:
            continue
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if h < 20 or w < 20:
            continue
        fill = (labels[sl] == k).mean()
        key = magenta[sl].mean()
        if fill < 0.8 or key > 0.01:
            continue
        out.append((sl[1].start, sl[0].start, w, h))
    return sorted(out, key=lambda c: -c[2] * c[3])


def ini_cells(index, size):
    """The track's own cells of texture `index`: etappe3.ini [textureN], 4 UV corners each."""
    text = open(os.path.join(ROOT, 'public', 'assets', 'game', 'etappe3.ini'), encoding='latin1').read().replace('\r', '')
    sec = text.split(f'[texture{index}]', 1)[1].split('\n[', 1)[0]
    out = set()
    for line in sec.splitlines():
        if '=' not in line or line.lower().startswith('count'):
            continue
        v = [float(x) for x in line.split('=', 1)[1].split(',') if x.strip()]
        us, vs = v[0::2], v[1::2]
        x0, x1 = round(min(us) * size[0]), round(max(us) * size[0])
        y0, y1 = round(min(vs) * size[1]), round(max(vs) * size[1])
        if x1 - x0 >= 8 and y1 - y0 >= 8:
            out.add((x0, y0, x1 - x0, y1 - y0))
    return sorted(out, key=lambda c: -c[2] * c[3])


def reskin_atlas(name, first=(), ini=None):
    src = Image.open(os.path.join(RCS, name + '.tga')).convert('RGB')
    rgb = np.asarray(src)
    out = src.copy()
    tall = wide = 0
    found = cells(rgb) if ini is None else ini_cells(ini, src.size)
    r, g, b = rgb[..., 0].astype(int), rgb[..., 1].astype(int), rgb[..., 2].astype(int)
    key = (r > 180) & (g < 80) & (b > 90)
    for k, (x, y, w, h) in enumerate(found):
        if key[y:y + h, x:x + w].mean() > 0.02:
            continue
        if k < len(first):
            spec = first[k]
        elif h > 1.5 * w:
            spec = TALL[tall % len(TALL)]
            tall += 1
        else:
            spec = WIDE[wide % len(WIDE)]
            wide += 1
        out.paste(source(spec).resize((w, h), Image.Resampling.LANCZOS), (x, y))
    out.save(os.path.join(OUT, 'vn3_' + name[4:] + '.tga'), format='TGA', compression=None)
    return len(found)


def reskin_road():
    """Grey asphalt to red brick klinkers; white markings and coloured cells stay."""
    src = Image.open(os.path.join(RCS, 'e03_weg.tga')).convert('RGB')
    a = np.asarray(src).astype(float)
    brick = crop(photo('gevel2'), (0.15, 0.72, 0.85, 0.97))
    brick = ImageOps.colorize(ImageOps.autocontrast(ImageOps.grayscale(brick)), black=(60, 32, 26), white=(196, 120, 96), mid=(132, 70, 56))
    tile = np.asarray(brick.resize((128, 128), Image.Resampling.LANCZOS)).astype(float)
    h, w = a.shape[:2]
    reps = np.tile(tile, (math.ceil(h / 128), math.ceil(w / 128), 1))[:h, :w]
    lum = a.mean(axis=2)
    sat = a.max(axis=2) - a.min(axis=2)
    # Everything but the white markings and the coloured cells (magenta key, grass, signs) becomes brick.
    marking = (lum > 185) & (sat < 40)
    coloured = sat > 70
    grey = ~marking & ~coloured
    # A little of the asphalt's light and dark, so wear and edges still show.
    shade = np.clip(lum / max(1.0, lum[grey].mean() if grey.any() else 128), 0.8, 1.2)[..., None]
    out = np.where(grey[..., None], np.clip(reps * shade, 0, 255), a)
    Image.fromarray(out.astype(np.uint8)).save(os.path.join(OUT, 'vn3_weg.tga'), format='TGA', compression=None)


def circle(base_name, picture):
    """A slideshow frame: the picture in the original's circle, with its glass rim laid over."""
    orig = Image.open(os.path.join(MENU, base_name)).convert('RGBA')
    w, h = orig.size
    pic = ImageOps.fit(picture.convert('RGB'), (w, h), Image.Resampling.LANCZOS).convert('RGBA')
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.hypot(xx - w / 2, yy - h / 2) / (min(w, h) / 2)
    # The rim: the original from 88 % of the radius out, fading in.
    t = np.clip((r - 0.80) / 0.12, 0, 1)
    o = np.asarray(orig).astype(float)
    p = np.asarray(pic).astype(float)
    mix = p * (1 - t[..., None] * 0.85) + o * (t[..., None] * 0.85)
    mix[..., 3] = o[..., 3]
    return Image.fromarray(mix.astype(np.uint8), 'RGBA')


def route_map(size):
    """Frame 0: the old town with the Vianen loop and its landmarks, as Wenen's shows its route."""
    pts, nodes, ways = loop(os.path.join(SRC, 'osm.json'))
    im = Image.new('RGB', (size, size), (214, 232, 160))
    d = ImageDraw.Draw(im)
    s = size / 520.0
    S = lambda p: (size / 2 + (p[0] + 10) * s, size / 2 - (p[1] - 0) * s)
    for wy in ways:
        t = wy.get('tags', {})
        ns = [S(nodes[n]) for n in wy['nodes'] if n in nodes]
        if 'building' in t and len(ns) > 2:
            d.polygon(ns, fill=(196, 206, 140))
        elif ('waterway' in t or t.get('natural') == 'water') and len(ns) > 1:
            d.line(ns, fill=(120, 170, 220), width=3)
        elif 'highway' in t and len(ns) > 1:
            d.line(ns, fill=(250, 250, 240), width=2)
    d.line([S(p) for p in pts + pts[:1]], fill=(200, 20, 20), width=5)
    try:
        font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 15)
    except OSError:
        font = ImageFont.load_default()
    # Labels where the circle leaves room for them: left of the pin near the right edge.
    for label, (x, z), left in (('Lekpoort', (-12.5, 191.7), True), ('Stadhuis', (20.0, 82.0), False), ('Grote Kerk', (100.0, -185.0), True)):
        cx, cy = S((x, z))
        d.ellipse((cx - 8, cy - 8, cx + 8, cy + 8), outline=(40, 120, 20), width=4, fill=(240, 250, 200))
        tx = cx - 12 - d.textlength(label, font=font) if left else cx + 10
        d.text((tx, cy - 18), label, font=font, fill=(20, 60, 10), stroke_width=2, stroke_fill=(240, 250, 220))
    return im


def track_name():
    """trname03.png: the name in the menu's style, yellow on a transparent ground."""
    orig = Image.open(os.path.join(MENU, 'trname03.png')).convert('RGBA')
    w, h = orig.size
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    font = ImageFont.truetype(FONT, 22)
    text = 'Vianen'
    tw = d.textlength(text, font=font)
    d.text(((w - tw) / 2, (h - 26) / 2), text, font=font, fill=(236, 214, 30, 255), stroke_width=2, stroke_fill=(40, 60, 10, 255))
    return im


def wait_screen(size):
    im = ImageOps.fit(photo('lekpoort3'), size, Image.Resampling.LANCZOS)
    d = ImageDraw.Draw(im)
    font = ImageFont.truetype(FONT, int(72 * size[1] / 480))
    for dx, colour in ((4, (0, 0, 0)), (0, (255, 210, 0))):
        d.text((int(40 * size[0] / 640) + dx, int(330 * size[1] / 480) + dx), 'VIANEN', font=font, fill=colour)
    return im


def main():
    os.makedirs(OUT, exist_ok=True)
    reskin_road()
    # The wall atlases by the track's own cells ([texture2] is vang, [texture3] gra2), the objects' by their photo areas.
    counts = {'e03_vang': reskin_atlas('e03_vang', ini=2), 'e03_gra2': reskin_atlas('e03_gra2', ini=3)}
    counts.update({name: reskin_atlas(name, LANDMARK[name]) for name in LANDMARK})
    print('cells replaced', counts)
    pictures = [route_map(250), photo('lekpoort1'), photo('stadhuis2'), crop(photo('kerk2'), (0.1, 0.0, 0.8, 0.8)), photo('lekpoort3'), warm(photo('theekoepel'))]
    for prefix in ('qtc03', 'ttc03'):
        for k, pic in enumerate(pictures):
            name = f'{prefix}_{k:02d}.png'
            circle(name, pic).save(os.path.join(OUT, name))
    track_name().save(os.path.join(OUT, 'trname03.png'))
    for name in ('e03.png', 'e03-8.png', 'e03-lo.png'):
        size = Image.open(os.path.join(LOADING, name)).size
        wait_screen(size).save(os.path.join(OUT, name))
    print('written to', OUT)


if __name__ == '__main__':
    main()
