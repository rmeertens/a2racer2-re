#!/usr/bin/env python3
"""Builds the Vianen etappe: a loop through Vianen's old town, its own track, etappe 10.

    python3 tools/vianen/build-track.py

Reads source/assets/vianen/ (osm.json for the streets, photos/ and photos.json for the facades,
openly licensed photos from Wikimedia Commons). Writes public/assets/vianen/ (the six track files
in the layouts of original-game-decompiled/docs/formats/game-data.md, the textures,
ATTRIBUTION.md) and public/assets/loading/e10*.png. source/host/vianen.js makes them etappe 10, a
slot the original reserves but never fills.

Everything is .rmp planes: quads of x, y, z, u, v and a colour, drawn in four passes with one
texture each, and all colliding:

    road   vn_weg.tga    brick klinkers
    land   vn_land.tga   pavements, roof tiles, slate, grass
    extra  vn_gevel.tga  facades from the photos: Voorstraat's houses, the Stadhuis, the Lekpoort,
                         the Grote Kerk
    rail   vn_bouw.tga   brick, stone, plaster, church wall, slate, and a tree and a lamp post on
                         the key colour (255, 0, 127), which the game draws see-through

The houses have depth: a facade, a gabled roof, and end walls with gables where a neighbour is
lower. The Lekpoort is a tower over the road with its passage and spire, the Stadhuis a block with
battlements, the Grote Kerk a nave with a steep roof and a tower with a spire. A chunk holds at
most 16 road, 24 land, 12 extra and 12 rail planes (FUN_004b30c0, fatal above), so a landmark's
planes go to the nearest chunks with room.
"""
import json, math, os, random, struct, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')
SRC = os.path.join(ROOT, 'source', 'assets', 'vianen')
OUT = os.path.join(ROOT, 'public', 'assets', 'vianen')
sys.path.insert(0, HERE)
from route import load as load_osm  # noqa: E402

UNITS = 10.0          # world units per metre
CHUNK = 128.0         # chunk length in world units, as on the original tracks
ROAD = 50.0           # half the road width
WALK = 82.0           # from the centre line to the facades
DEPTH = 95.0          # depth of a house
LANE = 24.0           # waypoints right and left of the centre line
START = 10            # start chunk; the grid takes the 8 chunks before it
MIN_RADIUS = 260.0    # tightest bend of the centre line, world units
LIMITS = {'road': 16, 'land': 24, 'extra': 12, 'rail': 12}
KEY = (255, 0, 127)
SUN = (0.45, 0.78, -0.43)
# Landmarks: metres east and north (route.py).
STADHUIS = (22.0, 70.0)
GROTE_KERK = (100.0, -185.0)
LEKPOORT = (-8.0, 190.0)
# The lap, drawn along the streets (metres east and north of route.LAT0, LON0): up Voorstraat past
# the Stadhuis to the Lekpoort, out onto the dike along the moat's north side, down the east side
# along the moat, west along the south moat, back to the Grote Kerk.
LAP = [(72, -196), (60, -115), (41, -15), (11, 100), (-1, 154), (-12, 196), (-35, 273), (80, 304),
       (211, 322), (245, 300), (237, 231), (226, 115), (223, -54), (224, -180), (205, -205), (180, -200)]
DIKE_Z = 245.0   # north of this (metres) the road is on the dike
DIKE_UP = 40.0   # how high, world units
WATER_Y = -25.0  # the moat's water level


# --- the centre line -----------------------------------------------------------------------

def chaikin(pts, rounds=3):
    for _ in range(rounds):
        out = []
        for a, b in zip(pts, pts[1:] + pts[:1]):
            out += [(0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]), (0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1])]
        pts = out
    return pts


def resample_step(pts, length):
    ring = pts + pts[:1]
    lens = [math.dist(a, b) for a, b in zip(ring, ring[1:])]
    total = sum(lens)
    n = round(total / length)
    step = total / n
    out, seg, along = [], 0, 0.0
    for k in range(n):
        want = k * step
        while along + lens[seg] < want:
            along += lens[seg]
            seg += 1
        t = (want - along) / lens[seg]
        a, b = ring[seg], ring[seg + 1]
        out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    return out


def relax(pts, rounds):
    """Laplacian smoothing of a closed line: rounds the street corners into bends a car can take."""
    for _ in range(rounds):
        n = len(pts)
        pts = [((pts[i - 1][0] + 2 * pts[i][0] + pts[(i + 1) % n][0]) / 4, (pts[i - 1][1] + 2 * pts[i][1] + pts[(i + 1) % n][1]) / 4) for i in range(n)]
    return pts


def radius(c):
    """Smallest bend radius of a closed line, world units."""
    out = 1e9
    n = len(c)
    for i in range(n):
        a, b, d = c[i - 1], c[i], c[(i + 1) % n]
        ab, bd, ad = math.dist(a, b), math.dist(b, d), math.dist(a, d)
        area2 = abs((b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]))
        if area2 > 1e-6:
            out = min(out, ab * bd * ad / (2 * area2))
    return out


def frames(c):
    n = len(c)
    out = []
    for i in range(n):
        a, b = c[i - 1], c[(i + 1) % n]
        dx, dz = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dz)
        f = (dx / L, dz / L)
        out.append((f, (f[1], -f[0])))  # forward, right (left-handed, y up)
    return out


# --- planes ---------------------------------------------------------------------------------

def sub(a, b):
    return tuple(x - y for x, y in zip(a, b))


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def norm(v):
    L = math.sqrt(sum(x * x for x in v)) or 1.0
    return tuple(x / L for x in v)


def quad(vs, uvs, tint, facing):
    """Four vertices and the 6 indices that make both triangles face `facing` (D3D: clockwise is front).
    The colour is the tint lit by a low sun, so that the sides of a building differ."""
    n = cross(sub(vs[2], vs[0]), sub(vs[1], vs[0]))
    front = sum(n[q] * facing[q] for q in range(3)) > 0
    idx = (0, 2, 1, 0, 3, 2) if front else (0, 1, 2, 0, 2, 3)
    f = norm(facing)
    light = 0.62 + 0.38 * max(0.0, sum(f[q] * SUN[q] for q in range(3)))
    colour = tuple(max(0, min(255, int(c * light))) for c in tint)
    return (vs, uvs, colour, idx)


def tri(a, b, c, uvs, tint, facing):
    """A triangle as a quad: the apex split in two a unit apart, so no triangle is degenerate."""
    d = sub(b, a)
    L = math.sqrt(d[0] ** 2 + d[2] ** 2) or 1.0
    e = (d[0] / L * 0.6, 0, d[2] / L * 0.6)
    c1 = (c[0] + e[0], c[1], c[2] + e[2])
    c0 = (c[0] - e[0], c[1], c[2] - e[2])
    return quad([a, b, c1, c0], uvs, tint, facing)


def pack_plane(p):
    vs, uvs, colour, idx = p
    b = b''
    for v, uv in zip(vs, uvs):
        b += struct.pack('<5f', v[0], v[1], v[2], uv[0], uv[1]) + bytes((colour[0], colour[1], colour[2], 0))
    return b + struct.pack('<6i', *idx)


class Chunks:
    """Planes per chunk and list, within the game's limits: a full list passes a plane on to the
    nearest chunk with room."""

    def __init__(self, n):
        self.n = n
        self.lists = [{k: [] for k in LIMITS} for _ in range(n)]
        self.dropped = 0

    def add(self, kind, chunk, plane):
        for step in range(0, 12):
            for c in ((chunk + step) % self.n, (chunk - step) % self.n):
                if len(self.lists[c][kind]) < LIMITS[kind]:
                    self.lists[c][kind].append(plane)
                    return
        self.dropped += 1


# --- textures -------------------------------------------------------------------------------

def photo(key):
    return Image.open(os.path.join(SRC, 'photos', key + '.jpg')).convert('RGB')


def crop(im, box):
    w, h = im.size
    return im.crop((int(box[0] * w), int(box[1] * h), int(box[2] * w), int(box[3] * h)))


def warm(im):
    """The RCE photos are black and white: tint them toward brick and plaster."""
    return ImageOps.colorize(ImageOps.grayscale(im), black=(40, 28, 22), white=(250, 236, 214), mid=(150, 104, 80))


def save_tga(im, path):
    im.convert('RGB').save(path, format='TGA', compression=None)


def noise(w, h, amount, seed):
    rng = np.random.default_rng(seed)
    return rng.normal(0, amount, (h, w, 1))


def masonry(w, h, rows, per_row, colour, mortar, seed, jitter=18, stagger=True):
    """Bricks or stones: rows of blocks, each a little different, with mortar between."""
    rng = random.Random(seed)
    im = Image.new('RGB', (w, h), mortar)
    d = ImageDraw.Draw(im)
    rh = h / rows
    bw = w / per_row
    for r in range(rows):
        off = (bw / 2) if (stagger and r % 2) else 0
        for k in range(-1, per_row + 1):
            x0 = k * bw + off
            j = rng.randint(-jitter, jitter)
            c = tuple(max(0, min(255, v + j)) for v in colour)
            d.rectangle((x0 + 1, r * rh + 1, x0 + bw - 2, (r + 1) * rh - 2), fill=c)
    a = np.asarray(im).astype(float) + noise(w, h, 6, seed)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def roof_tiles(w, h, base, seed):
    """Rows of curved tiles, darker at each row's lower edge."""
    rng = random.Random(seed)
    im = Image.new('RGB', (w, h))
    d = ImageDraw.Draw(im)
    rows, cols = 16, 14
    rh, cw = h / rows, w / cols
    for r in range(rows):
        for k in range(cols + 1):
            c = tuple(max(0, min(255, v + rng.randint(-14, 14))) for v in base)
            x0 = k * cw - (cw / 2 if r % 2 else 0)
            d.rounded_rectangle((x0, r * rh, x0 + cw - 1, (r + 1) * rh), radius=int(cw / 3), fill=c)
            d.line((x0, (r + 1) * rh - 1, x0 + cw, (r + 1) * rh - 1), fill=tuple(int(v * 0.55) for v in c), width=2)
    return im


def gothic_window(d, x0, y0, x1, y1):
    """A tall window with a pointed arch: stone frame, dark leaded glass."""
    w = x1 - x0
    d.rectangle((x0, y0 + w / 2, x1, y1), fill=(200, 192, 176))
    d.pieslice((x0, y0, x1 + w * 0.0, y0 + w), 180, 360, fill=(200, 192, 176))
    i = w * 0.18
    d.rectangle((x0 + i, y0 + w / 2, x1 - i, y1 - i), fill=(46, 56, 66))
    d.pieslice((x0 + i, y0 + i, x1 - i, y0 + w - i), 180, 360, fill=(46, 56, 66))
    d.line(((x0 + x1) / 2, y0 + w / 2, (x0 + x1) / 2, y1 - i), fill=(150, 145, 135), width=2)


def railing_sprite(w, h):
    """The white railings along the canals: posts and two rails on the key colour."""
    im = Image.new('RGB', (w, h), KEY)
    d = ImageDraw.Draw(im)
    white = (236, 238, 236)
    for y in (h * 0.30, h * 0.62):
        d.rectangle((0, y, w, y + h * 0.07), fill=white)
    for x in range(0, w, w // 4):
        d.rectangle((x + w * 0.02, h * 0.25, x + w * 0.07, h), fill=white)
    return im


def tree_sprite(w, h, seed):
    """A lime tree, as the dike and churchyard have: trunk and leaf masses on the key colour."""
    rng = random.Random(seed)
    im = Image.new('RGB', (w, h), KEY)
    d = ImageDraw.Draw(im)
    d.rectangle((w * 0.46, h * 0.55, w * 0.54, h), fill=(78, 60, 44))
    for _ in range(140):
        r = rng.uniform(w * 0.06, w * 0.14)
        a = rng.uniform(0, 2 * math.pi)
        dist = rng.uniform(0, 1) ** 0.6 * w * 0.34
        cx = w / 2 + math.cos(a) * dist
        cy = h * 0.36 + math.sin(a) * dist * 0.95
        g = rng.randint(70, 130)
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(int(g * 0.45), g, int(g * 0.3)))
    # Light from above: lighter tops.
    a = np.asarray(im).astype(float)
    keyed = (a[..., 0] == 255) & (a[..., 1] == 0) & (a[..., 2] == 127)
    ramp = np.linspace(1.25, 0.75, h)[:, None, None]
    a = np.where(keyed[..., None], a, np.clip(a * ramp, 0, 254))
    return Image.fromarray(a.astype(np.uint8))


def lamp_sprite(w, h):
    """A black cast-iron lamp post with a lantern, on the key colour."""
    im = Image.new('RGB', (w, h), KEY)
    d = ImageDraw.Draw(im)
    cx = w / 2
    d.rectangle((cx - w * 0.06, h * 0.22, cx + w * 0.06, h), fill=(24, 26, 28))
    d.rectangle((cx - w * 0.16, h * 0.9, cx + w * 0.16, h), fill=(24, 26, 28))
    d.polygon([(cx - w * 0.22, h * 0.08), (cx + w * 0.22, h * 0.08), (cx + w * 0.15, h * 0.22), (cx - w * 0.15, h * 0.22)], fill=(250, 226, 150))
    d.polygon([(cx - w * 0.26, h * 0.08), (cx + w * 0.26, h * 0.08), (cx, 0)], fill=(24, 26, 28))
    d.rectangle((cx - w * 0.22, h * 0.21, cx + w * 0.22, h * 0.235), fill=(24, 26, 28))
    return im


# Atlases: name -> pixel box in the layout sizes below. The files are stretched to squares (1024,
# 512, 512): the race samples non-square textures wrongly. That needs the middle texture memory
# setting (CTextureDetailManager.cpp is fatal when short), which source/host/vianen.js ensures.
GEVEL = {'lekpoort': (0, 0, 128, 512), 'stadhuis': (128, 0, 384, 512), 'kerk': (384, 0, 640, 256), 'kerk2': (384, 256, 640, 512)}
FACADES = [f'gevel{k}' for k in range(1, 9)]
for _k, _key in enumerate(FACADES):
    GEVEL[_key] = (640 + (_k % 2) * 192, (_k // 2) * 128, 640 + (_k % 2) * 192 + 192, (_k // 2) * 128 + 128)
# From the repository owner's own photos (source/assets/vianen/own/, location data stripped):
# quads in fractions of the photo, top-left, top-right, bottom-right, bottom-left, straightened.
OWN = {
    'lekpoort': ('1445', ((0.40, 0.20), (0.745, 0.20), (0.745, 0.73), (0.40, 0.73))),
    'stadhuis': ('1449', ((0.43, 0.17), (0.715, 0.39), (0.72, 0.73), (0.42, 0.775))),
    'kerk': ('1457', ((0.0, 0.14), (0.37, 0.14), (0.37, 0.60), (0.0, 0.60))),
    'kerk2': ('1457', ((0.375, 0.19), (0.50, 0.19), (0.50, 0.59), (0.375, 0.59))),
    'gevel1': ('1446', ((0.53, 0.36), (1.0, 0.30), (1.0, 0.64), (0.53, 0.62))),
    'gevel2': ('1446', ((0.0, 0.0), (0.30, 0.33), (0.30, 0.60), (0.0, 0.67))),
    'gevel3': ('1439', ((0.47, 0.24), (0.82, 0.24), (0.82, 0.60), (0.47, 0.60))),
    'gevel4': ('1439', ((0.82, 0.15), (1.0, 0.13), (1.0, 0.62), (0.82, 0.60))),
    'gevel5': ('1454', ((0.70, 0.24), (0.84, 0.20), (0.84, 0.57), (0.70, 0.54))),
    'gevel6': ('1454', ((0.85, 0.17), (1.0, 0.05), (1.0, 0.58), (0.85, 0.56))),
    'gevel7': ('1444', ((0.60, 0.24), (1.0, 0.0), (1.0, 0.66), (0.60, 0.57))),
    'gevel8': ('1444', ((0.0, 0.05), (0.20, 0.29), (0.20, 0.62), (0.0, 0.66))),
    # Ground, seen from above: Voorstraat's herringbone klinkers and a cobbled pavement.
    'road': ('1444', ((0.30, 0.66), (0.70, 0.66), (1.0, 1.0), (0.0, 1.0))),
    'pavement': ('1446', ((0.2, 0.72), (0.8, 0.72), (1.0, 1.0), (0.0, 1.0))),
    'church': ('1457', ((0.05, 0.30), (0.34, 0.30), (0.34, 0.60), (0.05, 0.60))),
    'brick': ('1443', ((0.0, 0.25), (0.22, 0.25), (0.22, 0.75), (0.0, 0.75))),
    # The canal: its water and its grass bank, seen from above.
    'water': ('1466', ((0.02, 0.66), (0.28, 0.66), (0.24, 0.77), (0.0, 0.77))),
    'grass': ('1466', ((0.35, 0.78), (0.95, 0.78), (1.0, 1.0), (0.25, 1.0))),
}


def own(name, size):
    """A quad of one of the owner's photos, straightened into a rectangle of size."""
    key, q = OWN[name]
    im = Image.open(os.path.join(SRC, 'own', key + '.jpg')).convert('RGB')
    w, h = im.size
    (tl, tr, br, bl) = [(x * w, y * h) for x, y in q]
    # PIL's QUAD takes upper-left, lower-left, lower-right, upper-right.
    data = (*tl, *bl, *br, *tr)
    big = (size[0] * 2, size[1] * 2)
    return im.transform(big, Image.Transform.QUAD, data, Image.Resampling.BICUBIC).resize(size, Image.Resampling.LANCZOS)


LAND = {'pavement': (0, 0, 256, 256), 'water': (256, 0, 512, 256), 'grass': (0, 256, 256, 512), 'tiles': (256, 256, 384, 384),
        'slate': (384, 256, 512, 384), 'deck': (256, 384, 384, 512), 'awning': (384, 384, 512, 512)}
BOUW = {
    'brick': (0, 0, 128, 128), 'stone': (128, 0, 256, 128), 'railing': (256, 0, 384, 128), 'church': (384, 0, 512, 128),
    'slate': (0, 128, 128, 256), 'tree': (128, 128, 256, 256), 'lamp': (256, 128, 320, 256), 'tower': (320, 128, 448, 256),
    'white': (448, 128, 512, 256),
}
ATLAS_SIZE = {'gevel': (1024, 512), 'land': (512, 512), 'bouw': (512, 256)}
ATLASES = {'gevel': GEVEL, 'land': LAND, 'bouw': BOUW}


def build_textures():
    # Facades from the photos.
    gevel = Image.new('RGB', ATLAS_SIZE['gevel'], (120, 90, 70))
    for name in ['lekpoort', 'stadhuis', 'kerk', 'kerk2', *FACADES]:
        r = GEVEL[name]
        gevel.paste(own(name, (r[2] - r[0], r[3] - r[1])), r[:2])
    # Square: the race samples a non-square texture wrongly. Fractions, and so the UVs, stay.
    save_tga(gevel.resize((1024, 1024), Image.Resampling.LANCZOS), os.path.join(OUT, 'vn_gevel.tga'))
    # The road: the herringbone klinkers in front of the houses, tinted to red brick.
    save_tga(own('road', (256, 256)), os.path.join(OUT, 'vn_weg.tga'))
    # Land: pavement, roof tiles, slate, grass.
    land = Image.new('RGB', (512, 512))
    land.paste(own('pavement', (256, 256)), LAND['pavement'][:2])
    land.paste(roof_tiles(256, 256, (168, 72, 46), 1).resize((128, 128), Image.Resampling.LANCZOS), LAND['tiles'][:2])
    land.paste(masonry(256, 256, 18, 9, (62, 68, 78), (40, 44, 50), 2, jitter=10).resize((128, 128), Image.Resampling.LANCZOS), LAND['slate'][:2])
    land.paste(own('water', (256, 256)), LAND['water'][:2])
    land.paste(own('grass', (256, 256)), LAND['grass'][:2])
    land.paste(masonry(256, 256, 1, 9, (150, 112, 74), (70, 52, 36), 12, jitter=16, stagger=False).rotate(90).resize((128, 128)), LAND['deck'][:2])
    awning = Image.new('RGB', (128, 128), (240, 238, 232))
    ad = ImageDraw.Draw(awning)
    for k in range(0, 128, 32):
        ad.rectangle((k, 0, k + 15, 128), fill=(196, 30, 36))
    land.paste(awning, LAND['awning'][:2])
    save_tga(land, os.path.join(OUT, 'vn_land.tga'))
    # Building materials and the sprites on the key colour.
    # Drawn at twice the size, then halved (nearest, so the key colour stays exact).
    bouw = Image.new('RGB', (1024, 512), KEY)
    big = {k: tuple(c * 2 for c in v) for k, v in BOUW.items()}
    bouw.paste(own('brick', (256, 256)), big['brick'][:2])
    bouw.paste(masonry(256, 256, 8, 4, (168, 164, 154), (120, 116, 108), 5, jitter=12), big['stone'][:2])
    bouw.paste(railing_sprite(256, 256), big['railing'][:2])
    bouw.paste(own('church', (256, 256)), big['church'][:2])
    bouw.paste(masonry(256, 256, 18, 9, (58, 64, 74), (36, 40, 46), 8, jitter=10), big['slate'][:2])
    bouw.paste(tree_sprite(256, 256, 9), big['tree'][:2])
    bouw.paste(lamp_sprite(128, 256), big['lamp'][:2])
    tower = masonry(256, 256, 32, 8, (146, 64, 46), (190, 176, 150), 10)
    td = ImageDraw.Draw(tower)
    for y in (40, 140):
        td.rectangle((108, y + 14, 148, y + 70), fill=(40, 44, 50))
        td.pieslice((108, y, 148, y + 28), 180, 360, fill=(40, 44, 50))
        td.rectangle((104, y + 70, 152, y + 74), fill=(200, 190, 170))
    bouw.paste(tower, big['tower'][:2])
    white = (np.full((256, 128, 3), (238, 236, 228), float) + noise(128, 256, 4, 11)).clip(0, 255).astype(np.uint8)
    bouw.paste(Image.fromarray(white), big['white'][:2])
    save_tga(bouw.resize((512, 512), Image.Resampling.NEAREST), os.path.join(OUT, 'vn_bouw.tga'))


def uv(atlas, name, u0=0.0, u1=1.0, v0=0.0, v1=1.0):
    """UVs of part of an atlas cell, v down from the top: for bottom-start, bottom-end, top-end, top-start."""
    W, H = ATLAS_SIZE[atlas]
    box = ATLASES[atlas][name]
    x0, x1 = box[0] / W, box[2] / W
    y0, y1 = box[1] / H, box[3] / H
    # Half a texel in from the edges, so neighbouring cells do not bleed in.
    ex, ey = 0.5 / W, 0.5 / H
    U = lambda u: x0 + ex + (x1 - x0 - 2 * ex) * u
    V = lambda v: y0 + ey + (y1 - y0 - 2 * ey) * v
    return [(U(u0), V(v1)), (U(u1), V(v1)), (U(u1), V(v0)), (U(u0), V(v0))]


def uv_tri(atlas, name, v_apex=0.0):
    """UVs for tri(): base along the bottom, the apex at the top middle."""
    b = uv(atlas, name)
    top = (b[0][0] + b[1][0]) / 2
    vy = b[2][1] + (b[0][1] - b[2][1]) * v_apex
    return [b[0], b[1], (top, vy), (top, vy)]


def build_loading():
    """The wait screen of etappe 10 (source/race-runner.js loads assets/loading/eNN.png): the Lekpoort."""
    im = photo('lekpoort3')
    w, h = im.size
    box = (0, 0, w, int(w * 3 / 4)) if h >= w * 3 / 4 else ((w - int(h * 4 / 3)) // 2, 0, (w + int(h * 4 / 3)) // 2, h)
    im = im.crop(box).resize((640, 480), Image.Resampling.LANCZOS)
    d = ImageDraw.Draw(im)
    try:
        font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold Italic.ttf', 72)
    except OSError:
        font = ImageFont.load_default()
    for dx, colour in ((4, (0, 0, 0)), (0, (255, 210, 0))):
        d.text((40 + dx, 330 + dx), 'VIANEN', font=font, fill=colour)
    out = os.path.join(ROOT, 'public', 'assets', 'loading')
    im.save(os.path.join(out, 'e10.png'))
    im.save(os.path.join(out, 'e10-8.png'))
    im.resize((320, 200), Image.Resampling.LANCZOS).save(os.path.join(out, 'e10-lo.png'))


# --- the town -------------------------------------------------------------------------------

class Town:
    def __init__(self, centre):
        self.c = centre
        self.n = len(centre)
        self.fr = frames(centre)
        self.chunks = Chunks(self.n)
        self.ground = [0.0] * self.n
        self.skip = set()  # (chunk, side) without houses
        self.spans = []    # (chunk, side, t0, t1): houses on part of a skipped chunk

    def p(self, i, t, off, y=0.0):
        """A point t of the way along chunk i, off to the right of the centre line, y up."""
        n = self.n
        a, b = self.c[i % n], self.c[(i + 1) % n]
        ra, rb = self.fr[i % n][1], self.fr[(i + 1) % n][1]
        x = a[0] + ra[0] * off + (b[0] + rb[0] * off - a[0] - ra[0] * off) * t
        z = a[1] + ra[1] * off + (b[1] + rb[1] * off - a[1] - ra[1] * off) * t
        g = self.ground[i % n] + (self.ground[(i + 1) % n] - self.ground[i % n]) * t
        return (x, y + g, z)

    def lift(self, profile, smooth=4):
        """Ground heights per chunk, eased into ramps."""
        n = self.n
        g = list(profile)
        for _ in range(smooth):
            g = [(g[i - 1] + 2 * g[i] + g[(i + 1) % n]) / 4 for i in range(n)]
        self.ground = g

    def fwd(self, i):
        f = self.fr[i % self.n][0]
        return (f[0], 0.0, f[1])

    def right(self, i):
        r = self.fr[i % self.n][1]
        return (r[0], 0.0, r[1])

    def near(self, xz_metres):
        return min(range(self.n), key=lambda i: math.dist(self.c[i], (xz_metres[0] * UNITS, xz_metres[1] * UNITS)))

    def side(self, i, xz_metres):
        p = (xz_metres[0] * UNITS - self.c[i][0], xz_metres[1] * UNITS - self.c[i][1])
        r = self.fr[i][1]
        return 1 if p[0] * r[0] + p[1] * r[1] > 0 else -1

    def bent(self, i, s, off):
        """True where the bend folds a line this far out over itself, on the inside of the bend."""
        a, b = self.p(i, 0, s * off), self.p(i, 1, s * off)
        f = self.fwd(i)
        return (b[0] - a[0]) * f[0] + (b[2] - a[2]) * f[2] < 0.45 * CHUNK

    # -- the street -----------------------------------------------------------------------

    def street(self):
        grey = (225, 225, 225)
        up = (0, 1, 0)
        for i in range(self.n):
            for a, b in ((-ROAD, 0.0), (0.0, ROAD)):
                vs = [self.p(i, 0, a), self.p(i, 1, a), self.p(i, 1, b), self.p(i, 0, b)]
                self.chunks.add('road', i, quad(vs, [(0, 1), (0, 0), (1, 0), (1, 1)], grey, up))
            for a, b in ((-WALK, -ROAD), (ROAD, WALK)):
                vs = [self.p(i, 0, a, 2), self.p(i, 1, a, 2), self.p(i, 1, b, 2), self.p(i, 0, b, 2)]
                self.chunks.add('land', i, quad(vs, uv('land', 'pavement', 0, 0.5, 0, 1), grey, up))
            # Kerbs: the step from the road up to the pavement.
            for s in (-1, 1):
                vs = [self.p(i, 0, s * ROAD, 0), self.p(i, 1, s * ROAD, 0), self.p(i, 1, s * ROAD, 2), self.p(i, 0, s * ROAD, 2)]
                inward = tuple(-s * x for x in self.right(i))
                self.chunks.add('land', i, quad(vs, uv('land', 'pavement', 0.0, 1.0, 0.0, 0.05), (200, 200, 200), inward))

    # -- houses ---------------------------------------------------------------------------

    def houses(self):
        rng = random.Random(1640)
        rows = {}
        for s in (-1, 1):
            row = []
            for i in range(self.n):
                # Inside a tight bend a full house's back folds over: shallower houses there.
                depth = next((d for d in (DEPTH, 60.0, 30.0) if not self.bent(i, s, WALK + d)), None)
                spans = [sp for sp in self.spans if sp[0] == i and sp[1] == s]
                if (i, s) in self.skip and spans:
                    pieces = [(sp[2], sp[3]) for sp in spans]
                elif (i, s) in self.skip or depth is None:
                    row.append(None)
                    row.append(None)
                    continue
                else:
                    pieces = [(0.0, 0.5), (0.5, 1.0)]
                for t0, t1 in pieces:
                    row.append({
                        'i': i, 't0': t0, 't1': t1, 's': s, 'depth': depth or DEPTH,
                        'h': rng.choice((72, 84, 96, 108, 120)), 'roof': rng.choice((38, 48, 58)),
                        'face': rng.choice(FACADES), 'u': rng.uniform(0.0, 0.62),
                        'tint': rng.choice(((240, 230, 220), (230, 236, 240), (244, 226, 206), (236, 236, 230))),
                    })
            rows[s] = row
        for s, row in rows.items():
            m = len(row)
            for k, h in enumerate(row):
                if h:
                    self.house(h, row[(k - 1) % m], row[(k + 1) % m])

    def house(self, h, prev, nxt):
        i, s, t0, t1 = h['i'], h['s'], h['t0'], h['t1']
        H, R = h['h'], h['roof']
        f0, f1 = WALK, WALK + h['depth']
        mid = (f0 + f1) / 2
        inward = tuple(-s * x for x in self.right(i))
        outward = tuple(s * x for x in self.right(i))
        fw = self.fwd(i)
        F = lambda t, y: self.p(i, t, s * f0, y)
        B = lambda t, y: self.p(i, t, s * f1, y)
        M = lambda t, y: self.p(i, t, s * mid, y)
        # The facade: a third of a row of houses from the photos.
        vs = [F(t0, 0), F(t1, 0), F(t1, H), F(t0, H)]
        self.chunks.add('extra', i, quad(vs, uv('gevel', h['face'], h['u'], h['u'] + 0.38), h['tint'], inward))
        # The roof, ridge along the street.
        up_in = norm((inward[0], 1.6, inward[2]))
        up_out = norm((outward[0], 1.6, outward[2]))
        vs = [F(t0, H), F(t1, H), M(t1, H + R), M(t0, H + R)]
        self.chunks.add('land', i, quad(vs, uv('land', 'tiles'), (236, 226, 220), up_in))
        vs = [M(t0, H + R), M(t1, H + R), B(t1, H), B(t0, H)]
        self.chunks.add('land', i, quad(vs, uv('land', 'tiles'), (236, 226, 220), up_out))
        # End walls and gables where the neighbour is lower or missing.
        for t, other, facing in ((t0, prev, tuple(-x for x in fw)), (t1, nxt, fw)):
            lower = other is None or other['h'] + other['roof'] < H + R
            if not lower:
                continue
            base = 0 if other is None else min(H, other['h'])
            vs = [F(t, base), B(t, base), B(t, H), F(t, H)]
            self.chunks.add('rail', i, quad(vs, uv('bouw', 'brick', 0, 1, 0, max(0.1, (H - base) / 130)), (230, 220, 214), facing))
            self.chunks.add('rail', i, tri(F(t, H), B(t, H), M(t, H + R), uv_tri('bouw', 'brick'), (230, 220, 214), facing))

    # -- the Lekpoort ---------------------------------------------------------------------

    def lekpoort(self, i):
        """The gate tower over the road: a passage, the photo's brick body on both faces, brick
        sides, a slate roof and a spire with a white lantern."""
        TW, L, A, H = WALK + 14, 96.0, 118.0, 300.0
        GAP = ROAD + 14  # the passage, a little wider than the road
        f, r = self.fwd(i), self.right(i)
        o = self.p(i, 0.15, 0)
        # The street's houses run up to the tower on both sides.
        for s in (-1, 1):
            self.spans += [(i, s, 0.0, 0.15), (i, s, 0.9, 1.0)]
        P = lambda x, a, y: (o[0] + r[0] * x + f[0] * a, o[1] + y, o[2] + r[2] * x + f[2] * a)
        back, ahead = tuple(-x for x in f), f
        U = lambda x: (x + TW) / (2 * TW)
        V = lambda y: 1 - y / H
        for a, facing in ((0.0, back), (L, ahead)):
            for x0, x1, y0, y1 in ((-TW, -GAP, 0, A), (GAP, TW, 0, A), (-TW, TW, A, H)):
                vs = [P(x0, a, y0), P(x1, a, y0), P(x1, a, y1), P(x0, a, y1)]
                self.chunks.add('extra', i, quad(vs, uv('gevel', 'lekpoort', U(x0), U(x1), V(y1), V(y0)), (255, 255, 255), facing))
        for x, facing in ((-TW, tuple(-c for c in r)), (TW, r)):
            vs = [P(x, 0, 0), P(x, L, 0), P(x, L, H), P(x, 0, H)]
            self.chunks.add('rail', i, quad(vs, uv('bouw', 'tower'), (235, 225, 215), facing))
        # The passage: its walls and vault.
        for x, facing in ((-GAP, r), (GAP, tuple(-c for c in r))):
            vs = [P(x, 0, 0), P(x, L, 0), P(x, L, A), P(x, 0, A)]
            self.chunks.add('rail', i, quad(vs, uv('bouw', 'brick', 0, 1, 0, 0.6), (180, 170, 160), facing))
        vs = [P(-GAP, 0, A), P(GAP, 0, A), P(GAP, L, A), P(-GAP, L, A)]
        self.chunks.add('rail', i, quad(vs, uv('bouw', 'brick'), (150, 140, 130), (0, -1, 0)))
        # Roof: a pyramid of slate, then the spire's lantern and needle.
        apex = P(0, L / 2, H + 120)
        corners = [P(-TW, 0, H), P(TW, 0, H), P(TW, L, H), P(-TW, L, H)]
        for k in range(4):
            a, b = corners[k], corners[(k + 1) % 4]
            out = norm((a[0] + b[0] - 2 * apex[0], 0.0, a[2] + b[2] - 2 * apex[2]))
            self.chunks.add('rail', i, tri(a, b, apex, uv_tri('bouw', 'slate'), (220, 220, 230), norm((out[0], 1.0, out[2]))))
        lw = 14.0
        lantern = [P(-lw, L / 2 - lw, H + 95), P(lw, L / 2 - lw, H + 95), P(lw, L / 2 + lw, H + 95), P(-lw, L / 2 + lw, H + 95)]
        top = H + 140
        for k in range(4):
            a, b = lantern[k], lantern[(k + 1) % 4]
            out = norm((a[0] + b[0] - 2 * apex[0], 0.0, a[2] + b[2] - 2 * apex[2]))
            vs = [a, b, (b[0], top, b[2]), (a[0], top, a[2])]
            self.chunks.add('rail', i, quad(vs, uv('bouw', 'white'), (255, 255, 255), out))
            needle = (apex[0], H + 250, apex[2])
            self.chunks.add('rail', i, tri((a[0], top, a[2]), (b[0], top, b[2]), needle, uv_tri('bouw', 'slate'), (210, 210, 220), norm((out[0], 0.6, out[2]))))

    # -- the Stadhuis ---------------------------------------------------------------------

    def stadhuis(self, i, s):
        """A tall block of grey stone with the photo's front and battlements."""
        H, D = 235.0, 130.0
        self.skip.add((i, s))
        inward = tuple(-s * x for x in self.right(i))
        fw = self.fwd(i)
        F = lambda t, y, d=0.0: self.p(i, t, s * (WALK + d), y)
        vs = [F(0, 0), F(1, 0), F(1, H), F(0, H)]
        self.chunks.add('extra', i, quad(vs, uv('gevel', 'stadhuis'), (255, 255, 255), inward))
        for t, facing in ((0, tuple(-x for x in fw)), (1, fw)):
            vs = [F(t, 0), F(t, 0, D), F(t, H, D), F(t, H)]
            self.chunks.add('rail', i, quad(vs, uv('bouw', 'stone'), (235, 235, 235), facing))
        vs = [F(0, H), F(1, H), F(1, H, D), F(0, H, D)]
        self.chunks.add('land', i, quad(vs, uv('land', 'slate'), (200, 200, 200), (0, 1, 0)))
        # Battlements along the front: five merlons.
        for k in range(5):
            t0, t1 = 0.04 + k * 0.2, 0.04 + k * 0.2 + 0.11
            vs = [F(t0, H), F(t1, H), F(t1, H + 24), F(t0, H + 24)]
            self.chunks.add('rail', i, quad(vs, uv('bouw', 'stone', 0, 0.3, 0, 0.3), (240, 240, 240), inward))

    # -- the Grote Kerk ---------------------------------------------------------------------

    def grote_kerk(self, i, s):
        """The nave along the street, set back behind a churchyard, with a tower at its west end."""
        for k in (-1, 0, 1):
            self.skip.add(((i + k) % self.n, s))
        # A house before the tower; a low brick wall closes the churchyard along the street.
        self.spans.append(((i - 1) % self.n, s, 0.0, 0.22))
        for k, (t0, t1) in ((-1, (0.22, 1.0)), (0, (0.0, 1.0)), (1, (0.0, 1.0))):
            c = (i + k) % self.n
            inn = tuple(-s * x for x in self.right(c))
            vs = [self.p(c, t0, s * WALK, 0), self.p(c, t1, s * WALK, 0), self.p(c, t1, s * WALK, 36), self.p(c, t0, s * WALK, 36)]
            self.chunks.add('rail', c, quad(vs, uv('bouw', 'brick', 0, 1, 0, 0.3), (230, 220, 210), inn))
            vs = [self.p(c, t0, s * WALK, 36), self.p(c, t1, s * WALK, 36), self.p(c, t1, s * (WALK + 6), 36), self.p(c, t0, s * (WALK + 6), 36)]
            self.chunks.add('rail', c, quad(vs, uv('bouw', 'stone', 0, 1, 0, 0.1), (240, 240, 240), (0, 1, 0)))
        set_back, W, H, R = 30.0, 170.0, 150.0, 165.0
        f0, f1 = WALK + set_back, WALK + set_back + W
        mid = (f0 + f1) / 2
        inward = tuple(-s * x for x in self.right(i))
        for k in (0, 1):
            c = (i + k) % self.n
            F = lambda t, y, c=c: self.p(c, t, s * f0, y)
            B = lambda t, y, c=c: self.p(c, t, s * f1, y)
            M = lambda t, y, c=c: self.p(c, t, s * mid, y)
            inn = tuple(-s * x for x in self.right(c))
            out = tuple(s * x for x in self.right(c))
            for t0, t1 in ((0, 0.5), (0.5, 1)):
                vs = [F(t0, 0), F(t1, 0), F(t1, H), F(t0, H)]
                self.chunks.add('rail', c, quad(vs, uv('bouw', 'church'), (245, 235, 225), inn))
            vs = [F(0, H), F(1, H), M(1, H + R), M(0, H + R)]
            self.chunks.add('land', c, quad(vs, uv('land', 'slate'), (220, 220, 230), norm((inn[0], 1.0, inn[2]))))
            vs = [M(0, H + R), M(1, H + R), B(1, H), B(0, H)]
            self.chunks.add('land', c, quad(vs, uv('land', 'slate'), (220, 220, 230), norm((out[0], 1.0, out[2]))))
        # East gable.
        e = (i + 2) % self.n
        F = lambda y: self.p(e, 0, s * f0, y)
        B = lambda y: self.p(e, 0, s * f1, y)
        M = lambda y: self.p(e, 0, s * mid, y)
        fw = self.fwd(e)
        self.chunks.add('rail', e, quad([F(0), B(0), B(H), F(H)], uv('bouw', 'church'), (235, 225, 215), fw))
        self.chunks.add('rail', e, tri(F(H), B(H), M(H + R), uv_tri('bouw', 'brick'), (235, 225, 215), fw))
        # The tower at the west end: its street face from the photo, the rest brick, a slate spire.
        T = 100.0
        c = i
        o0, o1 = f0 + 30, f0 + 30 + T
        P = lambda t, d, y: self.p(c, t, s * d, y)
        back = tuple(-x for x in self.fwd(c))
        HT = 380.0
        t0, t1 = -0.75, 0.03
        faces = [
            ([P(t0, o0, 0), P(t1, o0, 0), P(t1, o0, HT), P(t0, o0, HT)], inward, 'extra'),
            ([P(t0, o1, 0), P(t1, o1, 0), P(t1, o1, HT), P(t0, o1, HT)], tuple(-x for x in inward), 'rail'),
            ([P(t0, o0, 0), P(t0, o1, 0), P(t0, o1, HT), P(t0, o0, HT)], back, 'rail'),
            ([P(t1, o0, 0), P(t1, o1, 0), P(t1, o1, HT), P(t1, o0, HT)], self.fwd(c), 'rail'),
        ]
        for vs, facing, kind in faces:
            mapping = uv('gevel', 'kerk2') if kind == 'extra' else uv('bouw', 'tower')
            self.chunks.add(kind, c, quad(vs, mapping, (240, 232, 222), facing))
        apex = P((t0 + t1) / 2, (o0 + o1) / 2, HT + 260)
        corners = [P(t0, o0, HT), P(t1, o0, HT), P(t1, o1, HT), P(t0, o1, HT)]
        for k in range(4):
            a, b = corners[k], corners[(k + 1) % 4]
            out = norm((a[0] + b[0] - 2 * apex[0], 0.0, a[2] + b[2] - 2 * apex[2]))
            self.chunks.add('rail', c, tri(a, b, apex, uv_tri('bouw', 'slate'), (215, 215, 225), norm((out[0], 0.5, out[2]))))
        # The churchyard: grass, and lime trees.
        for k in (0, 1):
            cc = (i + k) % self.n
            vs = [self.p(cc, 0, s * WALK, 2), self.p(cc, 1, s * WALK, 2), self.p(cc, 1, s * f0, 2), self.p(cc, 0, s * f0, 2)]
            self.chunks.add('land', cc, quad(vs, uv('land', 'grass'), (230, 240, 220), (0, 1, 0)))

    # -- trees, lamps, the dike ----------------------------------------------------------------

    def sprite(self, i, t, off, w, h, name, base=0.0):
        """Two crossed upright quads with a sprite on the key colour."""
        c = self.p(i, t, off, base)
        f, r = self.fwd(i), self.right(i)
        for d in (f, r):
            a = (c[0] - d[0] * w / 2, c[1], c[2] - d[2] * w / 2)
            b = (c[0] + d[0] * w / 2, c[1], c[2] + d[2] * w / 2)
            n = (d[2], 0, -d[0])
            vs = [a, b, (b[0], c[1] + h, b[2]), (a[0], c[1] + h, a[2])]
            self.chunks.add('rail', i, quad(vs, uv('bouw', name), (255, 255, 255), n))
            # The other side too, so the sprite shows from both.
            self.chunks.add('rail', i, quad(vs, uv('bouw', name), (255, 255, 255), tuple(-x for x in n)))

    def lamps(self):
        """Against the facades, on the straights: in a bend a car cuts over the pavement."""
        for i in range(0, self.n, 2):
            a, b = self.fr[i - 1][0], self.fr[(i + 1) % self.n][0]
            if abs(math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1])) > 0.06:
                continue
            s = 1 if (i // 2) % 2 else -1
            if (i, s) in self.skip:
                continue
            self.sprite(i, 0.5, s * (WALK - 5), 12, 70, 'lamp')

    def water_sides(self, water):
        """Where the moat runs beside the road: a quay edge with white railings, a grass bank down
        to the water, the water, the far bank and trees, instead of houses."""
        sides = set()
        for i in range(self.n):
            for s in (-1, 1):
                probe = self.p(i, 0.5, s * (WALK + 200))
                if any(inside((probe[0] / UNITS, probe[2] / UNITS), poly) for poly in water):
                    sides.add((i, s))
        # Fill single-chunk holes, so a side changes rarely.
        for i in range(self.n):
            for s in (-1, 1):
                if (i - 1) % self.n in {c for c, t in sides if t == s} and (i + 1) % self.n in {c for c, t in sides if t == s}:
                    sides.add((i, s))
        for i, s in sorted(sides):
            self.skip.add((i, s))
            inward = tuple(-s * x for x in self.right(i))
            g0 = self.p(i, 0, 0)[1]
            low = WATER_Y - g0
            P = lambda t, off, y, i=i: self.p(i, t, s * off, y)
            # Quay edge, railing on it.
            self.chunks.add('rail', i, quad([P(0, WALK, 0), P(1, WALK, 0), P(1, WALK, 10), P(0, WALK, 10)], uv('bouw', 'brick', 0, 1, 0, 0.12), (220, 210, 200), inward))
            self.chunks.add('rail', i, quad([P(0, WALK, 10), P(1, WALK, 10), P(1, WALK, 34), P(0, WALK, 34)], uv('bouw', 'railing'), (255, 255, 255), inward))
            self.chunks.add('rail', i, quad([P(0, WALK, 10), P(1, WALK, 10), P(1, WALK, 34), P(0, WALK, 34)], uv('bouw', 'railing'), (255, 255, 255), tuple(-x for x in inward)))
            # Bank, water, far bank.
            self.chunks.add('land', i, quad([P(0, WALK, 2), P(1, WALK, 2), P(1, WALK + 90, low), P(0, WALK + 90, low)], uv('land', 'grass'), (235, 240, 225), norm((-inward[0] * 0.3, 1, -inward[2] * 0.3))))
            self.chunks.add('land', i, quad([P(0, WALK + 90, low), P(1, WALK + 90, low), P(1, WALK + 420, low), P(0, WALK + 420, low)], uv('land', 'water'), (230, 238, 245), (0, 1, 0)))
            self.chunks.add('land', i, quad([P(0, WALK + 420, low), P(1, WALK + 420, low), P(1, WALK + 520, -g0 + 4), P(0, WALK + 520, -g0 + 4)], uv('land', 'grass'), (225, 235, 215), norm((inward[0] * 0.3, 1, inward[2] * 0.3))))
            if i % 2 == 0:
                self.sprite(i, 0.5, s * (WALK + 600), 130, 210, 'tree', base=-self.ground[i])
        return sides

    def market(self, first, last):
        """Market stalls along Voorstraat: a counter and a striped awning, against the houses."""
        rng = random.Random(1452)
        for i in range(first, last + 1):
            for s in (-1, 1):
                if (i, s) in self.skip or rng.random() < 0.35:
                    continue
                inward = tuple(-s * x for x in self.right(i))
                fw = self.fwd(i)
                t0, t1 = 0.12, 0.88
                F = lambda t, off, y: self.p(i, t, s * off, y)
                front, back = WALK - 30, WALK - 2
                wood = uv('land', 'deck')
                for vs, facing in (
                    ([F(t0, front, 2), F(t1, front, 2), F(t1, front, 20), F(t0, front, 20)], inward),
                    ([F(t0, front, 2), F(t0, back, 2), F(t0, back, 20), F(t0, front, 20)], tuple(-x for x in fw)),
                    ([F(t1, front, 2), F(t1, back, 2), F(t1, back, 20), F(t1, front, 20)], fw),
                ):
                    self.chunks.add('land', i, quad(vs, wood, (230, 220, 205), facing))
                self.chunks.add('land', i, quad([F(t0, front, 20), F(t1, front, 20), F(t1, back, 20), F(t0, back, 20)], uv('land', 'pavement', 0, 0.3, 0, 0.3), (250, 245, 235), (0, 1, 0)))
                # The awning, sloping down toward the street.
                self.chunks.add('land', i, quad([F(t0, front - 6, 40), F(t1, front - 6, 40), F(t1, back, 50), F(t0, back, 50)], uv('land', 'awning'), (255, 255, 255), norm((inward[0], 1.5, inward[2]))))
                self.chunks.add('land', i, quad([F(t0, front - 6, 40), F(t1, front - 6, 40), F(t1, back, 50), F(t0, back, 50)], uv('land', 'awning'), (180, 170, 170), (0, -1, 0)))

    def drawbridge(self, i, s):
        """A white drawbridge over the moat, as at the lock: a timber deck from the quay across the
        water, two white portals on the near bank and the balance beams above them."""
        g0 = self.p(i, 0, 0)[1]
        f = self.fwd(i)
        r = tuple(s * x for x in self.right(i))
        o = self.p(i, 0.5, s * WALK)
        P = lambda a, d, y: (o[0] + f[0] * a + r[0] * d, o[1] + y, o[2] + f[2] * a + r[2] * d)
        deck_y = WATER_Y - g0 + 18
        w = 28.0
        self.chunks.add('land', i, quad([P(-w, 90, deck_y), P(w, 90, deck_y), P(w, 420, deck_y), P(-w, 420, deck_y)], uv('land', 'deck'), (240, 230, 215), (0, 1, 0)))
        white = uv('bouw', 'white')
        for a in (-w, w):
            for d0 in (90, 150):
                post = [P(a - 3, d0, deck_y), P(a + 3, d0, deck_y), P(a + 3, d0, deck_y + 150), P(a - 3, d0, deck_y + 150)]
                self.chunks.add('rail', i, quad(post, white, (255, 255, 255), tuple(-x for x in r)))
                self.chunks.add('rail', i, quad(post, white, (255, 255, 255), r))
            # The balance beam: from behind the portal out over the water.
            beam = [P(a - 3, 40, deck_y + 150), P(a + 3, 40, deck_y + 150), P(a + 3, 300, deck_y + 120), P(a - 3, 300, deck_y + 120)]
            self.chunks.add('rail', i, quad(beam, white, (255, 255, 255), (0, 1, 0)))
            self.chunks.add('rail', i, quad(beam, white, (230, 230, 230), (0, -1, 0)))
        for d0 in (90, 150):
            top = [P(-w, d0, deck_y + 140), P(w, d0, deck_y + 140), P(w, d0, deck_y + 150), P(-w, d0, deck_y + 150)]
            self.chunks.add('rail', i, quad(top, white, (255, 255, 255), tuple(-x for x in r)))
            self.chunks.add('rail', i, quad(top, white, (255, 255, 255), r))


def inside(pt, poly):
    """Point in polygon, even-odd."""
    x, y = pt
    hit = False
    for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            hit = not hit
    return hit


def build():
    os.makedirs(OUT, exist_ok=True)
    fine = resample_step([(x * UNITS, z * UNITS) for x, z in chaikin([tuple(map(float, q)) for q in LAP])], 16.0)
    rounds = 0
    while radius(fine) < MIN_RADIUS and rounds < 4000:
        fine = relax(fine, 20)
        rounds += 20
    centre = resample_step(fine, CHUNK)
    town = Town(centre)
    n = town.n
    st, kerk, poort = town.near(STADHUIS), town.near(GROTE_KERK), town.near(LEKPOORT)
    print('chunks', n, 'smallest bend', round(radius(centre)), 'stadhuis', st, 'kerk', kerk, 'lekpoort', poort)
    town.lift([DIKE_UP if c[1] > DIKE_Z * UNITS else 0.0 for c in centre])
    nodes, ways = load_osm(os.path.join(SRC, 'osm.json'))
    water = [[nodes[k] for k in w['nodes'] if k in nodes] for w in ways if w.get('tags', {}).get('natural') == 'water']
    # The gate on the straight just before the bend: the passage is a straight box.
    turn = lambda i: abs(math.atan2(town.fr[(i + 1) % n][0][1], town.fr[(i + 1) % n][0][0]) - math.atan2(town.fr[i - 1][0][1], town.fr[i - 1][0][0]))
    poort = min(range(poort - 6, poort + 1), key=lambda i: (turn(i % n) > 0.05, -i)) % n
    print('lekpoort on chunk', poort, 'turn', round(math.degrees(turn(poort)), 1))
    town.skip.update({(poort, -1), (poort, 1)})
    town.street()
    town.stadhuis(st, town.side(st, STADHUIS))
    town.grote_kerk((kerk + 2) % n, town.side(kerk, GROTE_KERK))
    town.lekpoort(poort)
    sides = town.water_sides(water)
    print('water sides', len(sides), 'chunks', sorted({i for i, s in sides}))
    east = [i for i, s in sorted(sides) if s == -1 and centre[i][0] > 1800 and abs(centre[i][1]) < 1200]
    if east:
        town.drawbridge(east[len(east) // 2], -1)
    town.market(st - 7, st - 1)
    town.market(st + 2, poort - 3)
    town.lamps()
    town.houses()
    if town.chunks.dropped:
        print('planes that found no room:', town.chunks.dropped)

    chunks = [[c[k] for k in ('road', 'land', 'extra', 'rail')] for c in town.chunks.lists]
    total = sum(len(l) for c in chunks for l in c)
    rmp = struct.pack('<iii', -1, total, n)
    for c in chunks:
        for lst in c:
            rmp += struct.pack('<i', len(lst)) + b''.join(pack_plane(p) for p in lst)
    edge = lambda i, off: (town.p(i, 0, off)[0], town.p(i, 0, off)[2], town.p(i, 0, off)[1])
    # .dmp waypoints: [type, trigger, x, y, z, next, alt2, alt1, previous]. Right lane i*2 drives
    # with the race, left lane i*2+1 against it, as the original's lanes do.
    dmp = struct.pack('<i', 2 * n)
    for i in range(n):
        for lane, (off, nxt, prv) in enumerate(((LANE, (i + 1) % n, (i - 1) % n), (-LANE, (i - 1) % n, (i + 1) % n))):
            p = edge(i, off)
            dmp += struct.pack('<iifffiiii', 4, 0, p[0], p[2], p[1], nxt * 2 + lane, -1, -1, prv * 2 + lane)
    # .pmp chunks: position, two triggers, rails, left and right waypoints. Chunk 0 marker; start
    # and finish one past the start chunk, finish valid the next, as on Amsterdam (119, 120).
    trig = {0: (9, 0), START + 1: (13, 14), START + 2: (15, 0)}
    pmp = struct.pack('<i', n)
    for i in range(n):
        t = trig.get(i, (0, 0))
        pmp += struct.pack('<3f2i', centre[i][0], town.ground[i], centre[i][1], *t)
        pmp += struct.pack('<i', 0) + struct.pack('<ii', 1, i * 2 + 1) + struct.pack('<ii', 1, i * 2)
    # .omp: the start and finish banner over the line, and pickups.
    def obj(chunk, kind, p, rot_y, name):
        return struct.pack('<ii3f3f', chunk, kind, p[0], p[1], p[2], 0.0, rot_y, 0.0) + name.encode('latin1').ljust(32, b'\0') + struct.pack('<i', 0)
    objs = []
    s = START + 1
    f = town.fr[s][0]
    heading = math.degrees(math.atan2(f[1], f[0]))
    objs.append(obj(s, 12, (centre[s][0], 75.0 + town.ground[s], centre[s][1]), heading, 'a_zepp00_ANIM'))
    for frac, name in ((0.2, 'pw_turbs_ANIM'), (0.35, 'pw_reps_ANIM'), (0.5, 'pw_5pts_ANIM'), (0.65, 'pw_turbb_ANIM'), (0.8, 'pw_10pts_ANIM'), (0.92, 'pw_turbs_ANIM')):
        k = int(n * frac)
        p = edge(k, LANE * (1 if k % 2 else -1))
        objs.append(obj(k, 25, (p[0], 5.0 + p[2], p[1]), heading, name))
    omp = struct.pack('<i', len(objs)) + b''.join(objs)
    files = {
        'vianen.rmp': rmp, 'vianen.dmp': dmp, 'vianen.pmp': pmp, 'vianen.omp': omp,
        'vianen.cmp': struct.pack('<i', 0), 'vianen.pth': struct.pack('<ii', -1, 0),
    }
    for name, data in files.items():
        open(os.path.join(OUT, name), 'wb').write(data)
    for old in ('vn_gras.tga',):
        if os.path.exists(os.path.join(OUT, old)):
            os.remove(os.path.join(OUT, old))
    build_textures()
    build_loading()
    write_attribution()
    json.dump({'chunks': n, 'start': START, 'lengthMetres': round(n * CHUNK / UNITS), 'planes': total}, open(os.path.join(OUT, 'vianen.json'), 'w'))
    full = {k: sum(1 for c in town.chunks.lists if len(c[k]) == LIMITS[k]) for k in LIMITS}
    print('planes', total, 'objects', len(objs), 'length m', round(n * CHUNK / UNITS), 'full lists', full)


def write_attribution():
    lines = [
        '# Vianen etappe: sources',
        '',
        'Streets and building positions: © OpenStreetMap contributors, ODbL 1.0, <https://www.openstreetmap.org/copyright>.',
        '',
        'The facades, the Lekpoort, the Stadhuis, the Grote Kerk, the road, the pavement and the brick are cut and straightened from photos of Vianen taken by the repository owner, Roland Meertens, in November 2026 (`source/assets/vianen/own/`).',
        '',
        'The wait screen `../loading/e10.png` is cut from [Lekpoort - Vianen - Utrecht - (Bewerkt).jpg](https://commons.wikimedia.org/wiki/File:Lekpoort_-_Vianen_-_Utrecht_-_(Bewerkt).jpg), Frans Berkelaar, CC BY 2.0, on Wikimedia Commons.',
        '',
        'Roof tiles, slate, stone, plaster, grass, the tree and the lamp post are drawn by `tools/vianen/build-track.py`.',
    ]
    open(os.path.join(OUT, 'ATTRIBUTION.md'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')


if __name__ == '__main__':
    build()
