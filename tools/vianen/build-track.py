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

    road   vn_weg.tga    seamless paving, terrain and water atlas
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
from shapely.geometry import Polygon

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')
SRC = os.path.join(ROOT, 'source', 'assets', 'vianen')
OUT = os.path.join(ROOT, 'public', 'assets', 'vianen')
sys.path.insert(0, HERE)
from route import load as load_osm  # noqa: E402
from facades import facade_atlas, sash_window, TYPES as HOUSE_TYPES  # noqa: E402
from surfaces import paving, landscape_texture, connected_terrain  # noqa: E402
from photo_warp import rectify  # noqa: E402

UNITS = 10.0          # world units per metre
CHUNK = 128.0         # chunk length in world units, as on the original tracks
ROAD = 50.0           # half the road width
KERB_HEIGHT = 1.0     # 10 cm, rather than a sharp 20 cm wheel obstacle
KERB_BEVEL = 6.0      # 60 cm transition: wheels roll onto the pavement instead of hitting a wall
WALK = 82.0           # from the centre line to the facades
VOOR = 170.0  # the Voorstraat's house line
DEPTH = 95.0          # depth of a house
LANE = 24.0           # waypoints right and left of the centre line
DECK = 64.0           # half the width of a bridge deck
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
DIKE_Z = 262.0   # north of this (metres) the road is on the dike
DIKE_UP = 80.0   # how high, world units
# Humps where a car leaves the road for a moment: metres east and north, height, world units.
HUMPS = [((95.0, 306.0), 46.0), ((120.0, -199.0), 24.0)]
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


def closed_tri(a, b, c, uvs, tint, facing):
    """Two non-degenerate triangles sharing the exact requested apex and edges.
    A midpoint on b--c fits the RMP's four-vertex record without offsetting its
    roof/gable boundary. Adjacent faces keep identical ridge and edge coordinates.
    """
    mid = tuple((b[k] + c[k]) / 2 for k in range(3))
    mapping = [uvs[0], uvs[1], tuple((uvs[1][k] + uvs[2][k]) / 2 for k in range(2)), uvs[2]]
    return quad([a, b, mid, c], mapping, tint, facing)


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
        self.lost = {}
        self.lost_at = []

    def add(self, kind, chunk, plane):
        for step in range(0, 12):
            for c in ((chunk + step) % self.n, (chunk - step) % self.n):
                if len(self.lists[c][kind]) < LIMITS[kind]:
                    self.lists[c][kind].append(plane)
                    return
        self.dropped += 1
        self.lost[kind] = self.lost.get(kind, 0) + 1
        self.lost_at.append((kind, chunk, sys._getframe(1).f_code.co_name))

    def room(self, kind, chunk):
        """Remaining slots in the same neighbourhood add() can use."""
        return sum(LIMITS[kind] - len(self.lists[c][kind]) for c in {(chunk + d) % self.n for d in range(-11, 12)})


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
            margin = min(rh, bw) * 0.12
            d.rectangle((x0 + margin, r * rh + margin, x0 + bw - margin, (r + 1) * rh - margin), fill=c)
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


def bracing_sprite(w, h):
    """The drawbridge's white cross-bracing between its posts, on the key colour."""
    im = Image.new('RGB', (w, h), KEY)
    d = ImageDraw.Draw(im)
    for a, b in (((0, 0), (w, h)), ((w, 0), (0, h))):
        d.line(a + b, fill=(238, 240, 238), width=8)
    d.rectangle((0, 0, w, 10), fill=(238, 240, 238))
    d.rectangle((0, h - 10, w, h), fill=(238, 240, 238))
    return im


def railing_sprite(w, h, colour=(236, 238, 236)):
    """Railings along the canals (white) and the lock (dark green-grey): posts and rails on the key colour."""
    im = Image.new('RGB', (w, h), KEY)
    d = ImageDraw.Draw(im)
    white = colour
    for y in (h * 0.30, h * 0.62):
        d.rectangle((0, y, w, y + h * 0.07), fill=white)
    for x in range(0, w, w // 4):
        d.rectangle((x + w * 0.02, h * 0.25, x + w * 0.07, h), fill=white)
    return im


def bollard_sprite(w, h):
    """The red and white posts along the Voorstraat (owner's photo 1453), on the key colour."""
    im = Image.new('RGB', (w, h), KEY)
    d = ImageDraw.Draw(im)
    x0, x1 = w * 0.3, w * 0.7
    for k in range(4):
        d.rectangle((x0, h * (0.2 + k * 0.2), x1, h * (0.4 + k * 0.2)), fill=(200, 30, 36) if k % 2 == 0 else (245, 245, 240))
    d.ellipse((x0, h * 0.14, x1, h * 0.26), fill=(200, 30, 36))
    return im


def bike_sprite(w, h):
    """A Dutch town bike from the side, black, on the key colour."""
    k = 4
    im = Image.new('RGB', (w * k, h * k), KEY)
    d = ImageDraw.Draw(im)
    W, H = w * k, h * k
    r = H * 0.3
    back, front = (W * 0.24, H - r - 2 * k), (W * 0.76, H - r - 2 * k)
    dark, lw = (24, 24, 26), 3 * k
    for c in (back, front):
        d.ellipse((c[0] - r, c[1] - r, c[0] + r, c[1] + r), outline=dark, width=lw)
        d.ellipse((c[0] - r * 0.2, c[1] - r * 0.2, c[0] + r * 0.2, c[1] + r * 0.2), outline=(120, 120, 120), width=k)
    seat, bar, crank = (W * 0.38, H * 0.18), (W * 0.68, H * 0.12), (W * 0.46, back[1])
    for a, b in ((back, crank), (crank, seat), (seat, back), (crank, (W * 0.66, H * 0.28)), (seat, (W * 0.66, H * 0.28)), ((W * 0.66, H * 0.28), front), (bar, front)):
        d.line((a, b), fill=dark, width=lw)
    d.line(((W * 0.33, seat[1]), (W * 0.43, seat[1])), fill=(70, 50, 40), width=4 * k)
    d.line(((W * 0.62, bar[1]), (W * 0.74, bar[1])), fill=dark, width=lw)
    d.rectangle((back[0] - r * 0.9, back[1] - r * 1.15, back[0] + r * 0.5, back[1] - r * 1.0), fill=dark)
    return im.resize((w, h), Image.Resampling.NEAREST)


def planter_sprite(w, h):
    """A big wooden tub with a shrub, as on the Voorstraat (owner's photo 1453), on the key colour."""
    rng = random.Random(5)
    im = Image.new('RGB', (w, h), KEY)
    d = ImageDraw.Draw(im)
    d.rectangle((w * 0.12, h * 0.55, w * 0.88, h), fill=(92, 70, 50))
    for x in range(int(w * 0.12), int(w * 0.88), 6):
        d.line((x, h * 0.55, x, h), fill=(70, 52, 38))
    d.rectangle((w * 0.1, h * 0.52, w * 0.9, h * 0.6), fill=(60, 60, 62))
    for _ in range(160):
        cx, cy = rng.uniform(w * 0.14, w * 0.86), rng.uniform(h * 0.08, h * 0.56)
        if ((cx - w / 2) / (w * 0.38)) ** 2 + ((cy - h * 0.34) / (h * 0.28)) ** 2 > 1:
            continue
        r = rng.uniform(2, 4)
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=rng.choice([(48, 68, 40), (68, 85, 46), (42, 65, 35), (82, 97, 57)]))
    return im


def street_sign(w, h, name):
    """A Dutch street name sign: white letters on dark blue, a white edge."""
    k = 4
    im = Image.new('RGB', (w * k, h * k), (16, 40, 120))
    d = ImageDraw.Draw(im)
    d.rectangle((3 * k, 3 * k, w * k - 3 * k, h * k - 3 * k), outline=(255, 255, 255), width=2 * k)
    size = 20 * k
    while True:
        try:
            f = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', size)
        except OSError:
            f = ImageFont.load_default()
            break
        x0, y0, x1, y1 = d.textbbox((0, 0), name, font=f)
        if x1 - x0 < (w - 14) * k or size < 8 * k:
            break
        size -= k
    x0, y0, x1, y1 = d.textbbox((0, 0), name, font=f)
    d.text(((w * k - (x1 - x0)) / 2 - x0, (h * k - (y1 - y0)) / 2 - y0), name, font=f, fill=(255, 255, 255))
    return im.resize((w, h), Image.Resampling.LANCZOS)


def produce_texture(w, h):
    """A market table seen from above: crates of fruit, vegetables and flowers."""
    rng = random.Random(77)
    im = Image.new('RGB', (w, h), (120, 88, 58))
    d = ImageDraw.Draw(im)
    colours = [(214, 40, 30), (240, 170, 30), (90, 160, 50), (240, 220, 60), (150, 40, 120), (230, 120, 40), (250, 250, 240)]
    for cy in range(0, h, 64):
        for cx in range(0, w, 64):
            d.rectangle((cx + 3, cy + 3, cx + 61, cy + 61), fill=(160, 120, 80))
            c = rng.choice(colours)
            for _ in range(40):
                x, y = cx + rng.uniform(8, 56), cy + rng.uniform(8, 56)
                r = rng.uniform(4, 8)
                d.ellipse((x - r, y - r, x + r, y + r), fill=tuple(max(0, min(255, v + rng.randint(-25, 25))) for v in c))
    return im


def tree_sprite(w, h, seed):
    """An open, branching autumn lime, after the owner's November photos.
    Avoid the opaque circular crowns that made the Voorstraat look like an avenue of lollipops.
    """
    rng = random.Random(seed)
    im = Image.new('RGB', (w, h), KEY)
    d = ImageDraw.Draw(im)
    bark = (79, 69, 54)
    d.polygon([(w * 0.47, h), (w * 0.53, h), (w * 0.515, h * 0.56), (w * 0.48, h * 0.56)], fill=bark)
    tips = []
    def branch(x, y, angle, length, depth):
        ex, ey = x + math.cos(angle) * length, y + math.sin(angle) * length
        width = max(1, int(w / 100 * (depth + 0.4)))
        d.line((x, y, ex, ey), fill=bark, width=width)
        if depth:
            branch(ex, ey, angle - rng.uniform(0.22, 0.55), length * rng.uniform(0.52, 0.68), depth - 1)
            branch(ex, ey, angle + rng.uniform(0.22, 0.55), length * rng.uniform(0.52, 0.68), depth - 1)
        else:
            tips.append((ex, ey))
    for k in range(7):
        angle = -math.pi / 2 + (k - 3) * 0.28 + rng.uniform(-0.12, 0.12)
        branch(w * 0.5, h * rng.uniform(0.54, 0.64), angle, h * rng.uniform(0.16, 0.22), 3)
    for x, y in tips:
        for _ in range(rng.randint(4, 14)):
            cx, cy = x + rng.gauss(0, w * 0.025), y + rng.gauss(0, h * 0.02)
            if not (w * 0.04 < cx < w * 0.96 and h * 0.025 < cy < h * 0.65):
                continue
            r = rng.uniform(0.5, 1.6) * w / 128
            colour = rng.choice([(89, 99, 53), (121, 111, 60), (142, 116, 60), (102, 88, 48)])
            d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=colour)
    return im


def tree_sprite_old(w, h, seed):
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
# Sixteen fronts: twelve drawn types and four rectified fronts from the owner's photos.
FACADES = [f'gevel{k}' for k in range(1, len(HOUSE_TYPES) + 1)]
GEVEL = {key: ((k % 4) * 256, (k // 4) * 256, (k % 4) * 256 + 256, (k // 4) * 256 + 256) for k, key in enumerate(FACADES)}
# From the repository owner's own photos (source/assets/vianen/own/, location data stripped):
# quads in fractions of the photo, top-left, top-right, bottom-right, bottom-left, straightened.
OWN = {
    'front_white': ('1444', ((718/1200, 485/1600), (906/1200, 295/1600), (917/1200, 993/1600), (725/1200, 912/1600))),
    # Only the two fully photographed bays: the former crop ran beyond the photo's cornice.
    'front_cream': ('1444', ((912/1200, 300/1600), (1128/1200, 30/1600), (1145/1200, 1058/1600), (920/1200, 994/1600))),
    'front_shop_white': ('1454', ((831/1200, 462/1600), (1029/1200, 356/1600), (1011/1200, 909/1600), (815/1200, 854/1600))),
    'front_shop_brick': ('1454', ((685/1200, 570/1600), (828/1200, 474/1600), (815/1200, 850/1600), (684/1200, 804/1600))),
    # White double sash dormer above the corner house; one plane, without its pitched roof.
    'dormer': ('1439', ((795/1200, 445/1600), (878/1200, 444/1600), (878/1200, 527/1600), (797/1200, 526/1600))),
    'lekpoort': ('1445', ((514/1200, 379/1600), (862/1200, 306/1600), (903/1200, 1180/1600), (455/1200, 1180/1600))),
    # The stone front plane, below the separately modelled battlements; no brick side wall.
    'stadhuis': ('1449', ((566/1200, 339/1600), (832/1200, 520/1600), (913/1200, 1185/1600), (510/1200, 1227/1600))),
    # The arched brick bridge over the canal: its three arches, side on.
    'arches': ('1466', ((481/1200, 793/1600), (943/1200, 822/1600), (943/1200, 951/1600), (481/1200, 858/1600))),
    'kerk2': ('1457', ((461/1200, 351/1600), (593/1200, 351/1600), (595/1200, 924/1600), (481/1200, 924/1600))),
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
    # One coplanar window bay, not the old mixture of wall, buttress and adjoining bay.
    'church': ('1457', ((65/1200, 496/1600), (265/1200, 499/1600), (218/1200, 941/1600), (20/1200, 940/1600))),
    'brick': ('1443', ((0.0, 0.25), (0.22, 0.25), (0.22, 0.75), (0.0, 0.75))),
    # The canal: its water and its grass bank, seen from above.
    'water': ('1466', ((0.02, 0.66), (0.28, 0.66), (0.24, 0.77), (0.0, 0.77))),
    'grass': ('1466', ((0.35, 0.78), (0.95, 0.78), (1.0, 1.0), (0.25, 1.0))),
}


def own(name, size):
    """Rectify a photo with a projective transform, so masonry and windows stay straight.
    QUAD is bilinear and bends perspective lines on oblique facades."""
    key, q = OWN[name]
    im = Image.open(os.path.join(SRC, 'own', key + '.jpg')).convert('RGB')
    w, h = im.size
    if any(not 0 <= c <= 1 for point in q for c in point):
        raise ValueError(f'{name}: facade control point outside the source photograph')
    return rectify(im, [(x * w, y * h) for x, y in q], size)


LAND = {'pavement': (0, 0, 256, 256), 'water': (256, 0, 384, 128),
        'bollard': (384, 0, 416, 128), 'lamp': (416, 0, 448, 128), 'crown': (256, 128, 384, 256),
        'bike': (384, 128, 512, 192), 'planter': (384, 192, 448, 256),
        **{f'street{k}': (128, 256 + 32 * k, 256, 288 + 32 * k) for k in range(8)}, 'grass': (0, 256, 128, 384), 'tiles': (256, 256, 384, 384),
        'slate': (384, 256, 512, 384), 'deck': (256, 384, 384, 512), 'awning': (384, 384, 512, 512),
        'dormer': (0, 384, 128, 512),
        'utility_roof': (448, 0, 512, 8), 'utility_brick': (448, 8, 512, 64), 'garage_door': (448, 64, 512, 128),
        'shed_door': (448, 192, 512, 256)}
# Materials, sprites, and the landmarks from the owner's photos.
BOUW = {
    'brick': (0, 0, 256, 256), 'stone': (256, 0, 512, 256), 'railing': (512, 0, 768, 256), 'church': (768, 0, 1024, 256),
    'slate': (0, 256, 256, 512), 'tree': (256, 256, 512, 512), 'lamp': (512, 256, 640, 512), 'tower': (640, 256, 896, 512),
    'white': (896, 256, 1024, 512),
    'side_brick': (640, 256, 896, 512),  # shared with the gate's side-wall material
    'lekpoort': (0, 512, 192, 1024), 'stadhuis': (192, 512, 512, 1024),
    'arches': (512, 512, 1024, 640), 'bracing': (512, 640, 640, 768), 'darkrail': (640, 640, 896, 768), 'steel': (896, 640, 1024, 768),
    'kerk2': (512, 768, 704, 1024), 'produce': (704, 768, 832, 1024),
    'jody_poster': (832, 768, 1024, 1024),
}
SURFACE = {'road': (0, 0, 256, 256), 'pavement': (256, 0, 512, 256),
           'grass': (0, 256, 256, 512), 'water': (256, 256, 512, 512)}
FUN = {'carton': (0, 0, 128, 128), 'wood': (128, 0, 256, 128),
       'cone': (0, 128, 128, 256), 'board': (128, 128, 256, 256)}
STREET_NAMES = []  # filled by build() from OSM before the textures: the signs' names
ATLAS_SIZE = {'gevel': (1024, 1024), 'land': (512, 512), 'bouw': (1024, 1024), 'surface': (512, 512), 'fun': (256, 256)}
ATLASES = {'gevel': GEVEL, 'land': LAND, 'bouw': BOUW, 'surface': SURFACE, 'fun': FUN}


def fun_texture():
    """Small opaque material atlas for fictional, smashable market/street furniture."""
    atlas = Image.new('RGB', (256, 256))
    def label(im, text, y, size, colour):
        draw = ImageDraw.Draw(im)
        while True:
            font = None
            for path in ('/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'):
                try:
                    font = ImageFont.truetype(path, size)
                    break
                except OSError:
                    pass
            font = font or ImageFont.load_default(size=size)
            a, b, c, d = draw.textbbox((0, 0), text, font=font)
            if c-a < im.width-18 or size <= 6:
                break
            size -= 1
        draw.text(((im.width-c+a)/2-a, y-b), text, font=font, fill=colour)
    rng = np.random.default_rng(1998)
    card = Image.fromarray(np.clip(np.array((171, 128, 78)) + rng.normal(0, 2, (128,128,1)), 0,255).astype(np.uint8))
    d = ImageDraw.Draw(card)
    d.rectangle((55,0,73,127), fill=(205,171,114))
    d.rectangle((14,42,114,83), fill=(226,211,177), outline=(93,69,43), width=2)
    label(card, 'FRAGIEL', 53, 19, (67,51,35))
    for x in (27,93):
        d.line((x,106,x,90), fill=(72,55,35), width=3)
        d.polygon([(x-5,96),(x,89),(x+5,96)], fill=(72,55,35))
    atlas.paste(card, FUN['carton'][:2])
    wood = Image.fromarray(np.clip(np.array((145,99,57)) + rng.normal(0,4,(128,128,1)), 0,255).astype(np.uint8))
    d = ImageDraw.Draw(wood)
    for y in range(3,128,9):
        d.line((0,y,127,y+2), fill=(123,82,46))
    atlas.paste(wood, FUN['wood'][:2])
    cone = Image.new('RGB',(128,128),(235,91,24)); d = ImageDraw.Draw(cone)
    for y0,y1 in ((29,49),(78,98)):
        d.rectangle((0,y0,127,y1), fill=(246,242,223))
    d.rectangle((0,119,127,127), fill=(35,37,39))
    atlas.paste(cone,FUN['cone'][:2])
    # Draw at the panel's actual 0.64 aspect ratio before square atlas packing.
    board = Image.new('RGB',(128,200),(134,88,45)); d = ImageDraw.Draw(board)
    d.rectangle((7,7,120,192), fill=(27,50,43), outline=(197,157,101), width=3)
    label(board,'MARKT',21,24,(238,234,207))
    label(board,'VERS',65,29,(247,240,211))
    d.line((21,105,107,105),fill=(195,205,180),width=2)
    # A simple chalk fruit sketch, rather than a new brand or an invented event.
    d.ellipse((37,120,88,164),outline=(224,225,194),width=3)
    d.line((64,125,69,114,79,113),fill=(224,225,194),width=3)
    label(board,'VANDAAG',173,15,(225,225,199))
    atlas.paste(board.resize((128,128),Image.Resampling.LANCZOS),FUN['board'][:2])
    return atlas


def build_textures():
    # Facades from the photos.
    gevel = facade_atlas(ATLAS_SIZE['gevel'])
    for k, spec in enumerate(HOUSE_TYPES):
        if spec.get('photo'):
            gevel.paste(own(spec['photo'], (256, 256)), GEVEL[FACADES[k]][:2])
    # Square: the race samples a non-square texture wrongly. Fractions, and so the UVs, stay.
    save_tga(gevel, os.path.join(OUT, 'vn_gevel.tga'))
    # The road: the herringbone klinkers in front of the houses, tinted to red brick.
    surface = Image.new('RGB', ATLAS_SIZE['surface'])
    for name, image in [('road', paving()), ('pavement', paving(herringbone=False)),
                        ('grass', landscape_texture(256)), ('water', landscape_texture(256, water=True))]:
        surface.paste(image, SURFACE[name][:2])
    save_tga(surface, os.path.join(OUT, 'vn_weg.tga'))
    # Land: pavement, roof tiles, slate, grass.
    land = Image.new('RGB', (512, 512))
    land.paste(paving(herringbone=False), LAND['pavement'][:2])
    land.paste(roof_tiles(256, 256, (168, 72, 46), 1).resize((128, 128), Image.Resampling.LANCZOS), LAND['tiles'][:2])
    land.paste(masonry(256, 256, 18, 9, (62, 68, 78), (40, 44, 50), 2, jitter=10).resize((128, 128), Image.Resampling.LANCZOS), LAND['slate'][:2])
    land.paste(landscape_texture(128, water=True), LAND['water'][:2])
    # The Voorstraat's furniture: a lime's crown, a lamp, a red and white post.
    land.paste(KEY, LAND['bollard'][:2] + (512, 256))
    land.paste(tree_sprite(128, 188, 21).crop((0, 0, 128, 128)), LAND['crown'][:2])
    land.paste(lamp_sprite(32, 128), LAND['lamp'][:2])
    land.paste(bollard_sprite(32, 128), LAND['bollard'][:2])
    land.paste(landscape_texture(128), LAND['grass'][:2])
    land.paste(bike_sprite(128, 64), LAND['bike'][:2])
    land.paste(planter_sprite(64, 64), LAND['planter'][:2])
    # Previously unused cells: low outbuildings need masonry and doors, not a
    # complete multi-storey shop facade squeezed onto a two-metre footprint.
    utility_brick = masonry(64, 64, 24, 12, (146, 107, 82), (117, 107, 94), 1987, jitter=8)
    land.paste(utility_brick.crop((0, 8, 64, 64)), LAND['utility_brick'][:2])
    bitumen = np.clip(np.array((52, 57, 57)) + np.random.default_rng(1987).normal(0, 3, (8, 64, 1)), 0, 254).astype(np.uint8)
    land.paste(Image.fromarray(bitumen), LAND['utility_roof'][:2])
    garage = utility_brick.copy(); gd = ImageDraw.Draw(garage)
    gd.rectangle((5, 12, 58, 63), fill=(91, 99, 93), outline=(205, 198, 181), width=2)
    for y in range(17, 62, 6):
        gd.line((8, y, 55, y), fill=(62, 73, 70))
    gd.rectangle((29, 49, 34, 50), fill=(42, 47, 45))
    land.paste(garage, LAND['garage_door'][:2])
    shed = utility_brick.copy(); sd = ImageDraw.Draw(shed)
    sd.rectangle((21, 17, 44, 63), fill=(54, 73, 62), outline=(199, 194, 175), width=2)
    for x in (28, 35):
        sd.line((x, 20, x, 62), fill=(42, 58, 49))
    sd.rectangle((39, 40, 41, 41), fill=(205, 197, 160))
    land.paste(shed, LAND['shed_door'][:2])
    for k, name in enumerate(STREET_NAMES[:8]):
        land.paste(street_sign(128, 32, name), LAND[f'street{k}'][:2])
    land.paste(masonry(256, 256, 1, 9, (150, 112, 74), (70, 52, 36), 12, jitter=16, stagger=False).rotate(90).resize((128, 128)), LAND['deck'][:2])
    awning = Image.new('RGB', (128, 128), (226, 218, 198))
    ad = ImageDraw.Draw(awning)
    for k in range(0, 128, 32):
        ad.rectangle((k, 0, k + 15, 128), fill=(133, 50, 44))
    land.paste(awning, LAND['awning'][:2])
    land.paste(own('dormer', (128, 128)), LAND['dormer'][:2])
    save_tga(land, os.path.join(OUT, 'vn_land.tga'))
    # Building materials and the sprites on the key colour.
    bouw = Image.new('RGB', ATLAS_SIZE['bouw'], KEY)
    big = BOUW
    for name in ('lekpoort', 'stadhuis', 'kerk2', 'arches'):
        r = BOUW[name]
        bouw.paste(own(name, (r[2] - r[0], r[3] - r[1])), r[:2])
    bouw.paste(produce_texture(256, 256).resize((128, 256), Image.Resampling.LANCZOS), BOUW['produce'][:2])
    # Reclaim all four old banner cells for one undistorted 3:4 portrait poster.
    poster = Image.open(os.path.join(SRC, 'posters', 'jody-bernal-poster.png')).convert('RGB')
    if poster.width * 4 != poster.height * 3:
        raise ValueError('Jody poster must have a 3:4 aspect ratio')
    bouw.paste(poster.resize((192, 256), Image.Resampling.LANCZOS), BOUW['jody_poster'][:2])
    bouw.paste(bracing_sprite(128, 128), BOUW['bracing'][:2])
    bouw.paste(railing_sprite(256, 128, colour=(52, 66, 62)), BOUW['darkrail'][:2])
    steel = (np.full((128, 128, 3), (30, 32, 34), float) + noise(128, 128, 5, 21)).clip(0, 255).astype(np.uint8)
    bouw.paste(Image.fromarray(steel), BOUW['steel'][:2])
    # The old crop was a close-up: its giant stones covered whole end walls. Use consistently
    # scaled Dutch brickwork for shared walls, parapets and gable ends.
    bouw.paste(masonry(256, 256, 80, 30, (124, 88, 72), (119, 107, 91), 1443, jitter=7), big['brick'][:2])
    bouw.paste(masonry(256, 256, 8, 4, (168, 164, 154), (120, 116, 108), 5, jitter=12), big['stone'][:2])
    bouw.paste(railing_sprite(256, 256), big['railing'][:2])
    bouw.paste(own('church', (256, 256)), big['church'][:2])
    bouw.paste(masonry(256, 256, 18, 9, (58, 64, 74), (36, 40, 46), 8, jitter=10), big['slate'][:2])
    bouw.paste(tree_sprite(256, 256, 9), big['tree'][:2])
    bouw.paste(lamp_sprite(128, 256), big['lamp'][:2])
    tower = masonry(256, 256, 64, 24, (124, 88, 72), (119, 107, 91), 10, jitter=7)
    td = ImageDraw.Draw(tower)
    for y in (35, 140):
        for x in (57, 166):
            sash_window(td, x, y, x + 28, y + 60)
    bouw.paste(tower, big['tower'][:2])
    white = (np.full((256, 128, 3), (238, 236, 228), float) + noise(128, 256, 4, 11)).clip(0, 255).astype(np.uint8)
    bouw.paste(Image.fromarray(white), big['white'][:2])
    save_tga(bouw, os.path.join(OUT, 'vn_bouw.tga'))
    save_tga(fun_texture(), os.path.join(OUT, 'vn_fun.tga'))


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


def two_sided_uv(mapping):
    """Vianen renderer flag; integer wrapping leaves the sampled atlas region unchanged."""
    return [(u + 4.0, v) for u, v in mapping]


def save_prop_mesh(name, faces):
    """Native legacy D3D: 33-byte vertices and 9-byte triangle records."""
    vertices, triangles = [], []
    for points, mapping, normal in faces:
        base = len(vertices)
        for point, tex in zip(points, mapping):
            vertices.append(struct.pack('<8fB', *point, *normal, *tex, 0))
        idx = quad(points, mapping, (255, 255, 255), normal)[3]
        triangles.extend(struct.pack('<3H3B', *(base + k for k in idx[j:j + 3]), 0, 0, 0) for j in (0, 3))
    data = struct.pack('<ii', len(vertices), len(triangles)) + b''.join(vertices) + b''.join(triangles)
    open(os.path.join(OUT, name), 'wb').write(data)


def build_bollard_mesh():
    """A closed octagonal red/white post for the native movable-object physics."""
    faces = []
    def face(points, mapping, normal):
        faces.append((points, mapping, normal))
    # Match the old sprite's painted pole (40% of its 30 cm rectangle), not its
    # transparent margin. The 12 cm body also fits entirely beyond the curb bevel.
    ring = [(0.6 * math.cos(k * math.tau / 8), 0.6 * math.sin(k * math.tau / 8)) for k in range(8)]
    for k, (x, z) in enumerate(ring):
        xx, zz = ring[(k + 1) % 8]
        face([(x, 0, z), (xx, 0, zz), (xx, 10, zz), (x, 10, z)],
             uv('land', 'bollard', u0=0.4, u1=0.6, v0=0.2, v1=0.99), norm((x + xx, 0, z + zz)))
    for y, normal, v in ((0, (0, -1, 0), 0.95), (10, (0, 1, 0), 0.25)):
        tex = uv('land', 'bollard', u0=0.45, u1=0.55, v0=v, v1=v)
        # Four quads close the cap with the same eight-sided perimeter as the body.
        for k in range(0, 8, 2):
            ps = [ring[k], ring[(k + 1) % 8], ring[(k + 2) % 8], (0, 0)]
            face([(x, y, z) for x, z in ps], tex, normal)
    save_prop_mesh('vn_paal.d3d', faces)


def build_lantern_mesh():
    """Closed cast-iron base, shaft, eight glass panes and a pitched lantern cap.
    Every section shares its perimeter with the next; no flat cutout or hollow end.
    """
    faces = []
    # World units: the previous lamp was 5.5 m tall with a roughly 30 cm lantern.
    profile = [(0, 1.1), (5, 1.1), (6, 0.6), (42, 0.6), (43, 1.2),
               (44, 1.3), (50, 1.6), (51, 1.8), (54, 0.35), (55, 0.15)]
    iron = uv('land', 'lamp', u0=0.5, u1=0.5, v0=0.6, v1=0.6)
    glass = uv('land', 'lamp', u0=0.5, u1=0.5, v0=0.14, v1=0.14)
    ring = lambda y, r: [(r * math.cos(k * math.tau / 8), y, r * math.sin(k * math.tau / 8)) for k in range(8)]
    for (y0, r0), (y1, r1) in zip(profile, profile[1:]):
        low, high = ring(y0, r0), ring(y1, r1)
        for k in range(8):
            j = (k + 1) % 8
            mid = (k + 0.5) * math.tau / 8
            normal = norm((math.cos(mid), (r0 - r1) / (y1 - y0), math.sin(mid)))
            faces.append(([low[k], low[j], high[j], high[k]], glass if y0 == 44 else iron, normal))
    for (y, r), normal in ((profile[0], (0, -1, 0)), (profile[-1], (0, 1, 0))):
        cap = ring(y, r)
        for k in range(0, 8, 2):
            faces.append(([cap[k], cap[(k + 1) % 8], cap[(k + 2) % 8], (0, y, 0)], iron, normal))
    # Slim iron corner ribs make the glass read as separate lantern panes.
    for k in range(8):
        angle = k * math.tau / 8
        radial = (math.cos(angle), math.sin(angle))
        tangent = (-radial[1], radial[0])
        def rib(y, r, t):
            radius = 1.3 + (y - 44) / 6 * 0.3 + 0.06 + r
            return (radial[0] * radius + tangent[0] * t, y,
                    radial[1] * radius + tangent[1] * t)
        corners = [(-0.06, -0.06), (0.06, -0.06), (0.06, 0.06), (-0.06, 0.06)]
        low, high = [[rib(y, r, t) for r, t in corners] for y in (44, 50)]
        for j in range(4):
            jj = (j + 1) % 4
            r, t = ((corners[j][q] + corners[jj][q]) / 2 for q in range(2))
            normal = norm((radial[0] * r + tangent[0] * t, 0, radial[1] * r + tangent[1] * t))
            faces.append(([low[j], low[jj], high[jj], high[j]], iron, normal))
        faces.extend([(low, iron, (0, -1, 0)), (high, iron, (0, 1, 0))])
    save_prop_mesh('vn_lamp.d3d', faces)


def build_bike_mesh():
    """A town bike with real tyre, frame, saddle and handlebar width; no sprite planes."""
    faces = []
    black = uv('land', 'lamp', u0=0.5, u1=0.5, v0=0.6, v1=0.6)
    # Opaque grey hub pixel in the existing bike atlas cell, reused for bare metal.
    metal = uv('land', 'bike', u0=31.5/128, u1=31.5/128, v0=43.5/64, v1=43.5/64)

    def tube(a, b, radius, material=black, sides=6):
        axis = norm(sub(b, a))
        reference = (0, 1, 0) if abs(axis[2]) > 0.9 else (0, 0, 1)
        u = norm(cross(axis, reference))
        v = cross(axis, u)
        rings = [[tuple(p[q] + radius * (u[q] * math.cos(k * math.tau / sides)
                  + v[q] * math.sin(k * math.tau / sides)) for q in range(3))
                  for k in range(sides)] for p in (a, b)]
        low, high = rings
        for k in range(sides):
            j = (k + 1) % sides
            mid = (k + 0.5) * math.tau / sides
            normal = tuple(u[q] * math.cos(mid) + v[q] * math.sin(mid) for q in range(3))
            faces.append(([low[k], low[j], high[j], high[k]], material, normal))
        for ring, center, normal in ((low, a, tuple(-x for x in axis)), (high, b, axis)):
            if sides == 4:
                faces.append((ring, material, normal))
            else:
                for k in range(0, sides, 2):
                    faces.append(([ring[k], ring[(k+1) % sides], ring[(k+2) % sides], center], material, normal))

    rear, front = (-5.2, 3.4, 0), (5.2, 3.4, 0)
    # A closed six-sided tyre/rim cross-section, extruded around each wheel.
    section = [(3.4, -0.16), (3.4, 0.16), (3.18, 0.22),
               (3.07, 0.18), (3.07, -0.18), (3.18, -0.22)]
    for center in (rear, front):
        def rim(k, j):
            radius, z = section[j % len(section)]
            angle = k * math.tau / 16
            return (center[0] + radius * math.cos(angle), center[1] + radius * math.sin(angle), z)
        for k in range(16):
            angle = (k + 0.5) * math.tau / 16
            for j in range(len(section)):
                r = (section[j][0] + section[(j+1) % len(section)][0]) / 2 - 3.23
                z = (section[j][1] + section[(j+1) % len(section)][1]) / 2
                normal = norm((r * math.cos(angle), r * math.sin(angle), z))
                faces.append(([rim(k,j), rim(k+1,j), rim(k+1,j+1), rim(k,j+1)],
                              metal if j in (2, 3, 4) else black, normal))
        tube((center[0], center[1], -0.45), (center[0], center[1], 0.45), 0.12, metal, 6)
        for k in range(8):
            angle = k * math.tau / 8
            z = 0.16 if k % 2 else -0.16
            tube((center[0] + 0.1 * math.cos(angle), center[1] + 0.1 * math.sin(angle), z),
                 (center[0] + 3.07 * math.cos(angle), center[1] + 3.07 * math.sin(angle), z),
                 0.025, metal, 4)

    crank, seat, head = (-0.8, 3.7, 0), (-2.4, 8.8, 0), (3.6, 8.8, 0)
    for a, b in ((rear, crank), (rear, seat), (crank, seat), (crank, head), (seat, head)):
        tube(a, b, 0.13)
    # Forks and rear stays straddle the tyres rather than passing through a flat wheel.
    for z in (-0.5, 0.5):
        tube((head[0], head[1], z), (front[0], front[1], z), 0.10)
        tube((seat[0], seat[1], z), (rear[0], rear[1], z), 0.08)
    tube(seat, (-2.4, 9.4, 0), 0.11, metal)
    # Closed oval saddle with a genuine 24 cm width.
    for k in range(8):
        a, b = k * math.tau / 8, (k+1) * math.tau / 8
        low = [(-2.4 + math.cos(a), 9.2, 1.2 * math.sin(a)), (-2.4 + math.cos(b), 9.2, 1.2 * math.sin(b))]
        high = [(x, 9.6, z) for x, _, z in low]
        faces.append(([low[0], low[1], high[1], high[0]], black, norm((math.cos((a+b)/2), 0, math.sin((a+b)/2)))))
    saddle = [(-2.4 + math.cos(k*math.tau/8), 0, 1.2*math.sin(k*math.tau/8)) for k in range(8)]
    for y, normal in ((9.2, (0,-1,0)), (9.6, (0,1,0))):
        for k in range(0,8,2):
            points = [saddle[k], saddle[(k+1)%8], saddle[(k+2)%8], (-2.4,0,0)]
            faces.append(([(x,y,z) for x,_,z in points], black, normal))
    tube(head, (4.0, 10.6, 0), 0.10, metal)
    tube((4.0,10.6,-2.8), (4.0,10.6,2.8), 0.10, metal)
    for z in (-2.8, 2.8):
        tube((4.0,10.6,z), (3.0,10.6,z), 0.16, black, 4)
    # Rear rack, pedals and a stand give the parked bike a supported footprint.
    for z in (-0.8, 0.8):
        tube((-7.3,7.1,z), (-3.5,7.1,z), 0.07, black, 4)
        tube((-5.2,3.4,z), (-6.7,7.1,z), 0.06, metal, 4)
    tube((-7.3,7.1,-0.8), (-7.3,7.1,0.8), 0.07, black, 4)
    tube((-0.8,3.7,-1.1), (-0.8,3.7,1.1), 0.09, metal, 4)
    tube((-1.5,3.7,-1.3), (-0.1,3.7,-1.3), 0.15, black, 4)
    tube((-1.5,3.7,1.3), (-0.1,3.7,1.3), 0.15, black, 4)
    tube((-0.8,3.7,-0.3), (-2.0,0,-2.4), 0.10, black, 4)
    save_prop_mesh('vn_fiets.d3d', faces)


def build_fun_meshes():
    """Closed lightweight cartons, open slatted crates, cones and two-sided A-boards."""
    wood = uv('fun','wood',v0=0.05,v1=0.21)
    dark = uv('fun','cone',u0=0.5,u1=0.5,v0=0.97,v1=0.97)
    def box(faces,x0,x1,y0,y1,z0,z1,mapping):
        P = lambda x,y,z: (x,y,z)
        for points,normal in (
            ([P(x0,y0,z0),P(x1,y0,z0),P(x1,y1,z0),P(x0,y1,z0)],(0,0,-1)),
            ([P(x1,y0,z1),P(x0,y0,z1),P(x0,y1,z1),P(x1,y1,z1)],(0,0,1)),
            ([P(x0,y0,z1),P(x0,y0,z0),P(x0,y1,z0),P(x0,y1,z1)],(-1,0,0)),
            ([P(x1,y0,z0),P(x1,y0,z1),P(x1,y1,z1),P(x1,y1,z0)],(1,0,0)),
            ([P(x0,y1,z0),P(x1,y1,z0),P(x1,y1,z1),P(x0,y1,z1)],(0,1,0)),
            ([P(x0,y0,z1),P(x1,y0,z1),P(x1,y0,z0),P(x0,y0,z0)],(0,-1,0)),
        ):
            faces.append((points,mapping(points,normal) if callable(mapping) else mapping,normal))
    carton = []
    box(carton,-2.75,2.75,0,5.5,-2.75,2.75,
        lambda points,normal: wall_uv('fun','carton',points,normal))
    save_prop_mesh('vn_doos.d3d',carton)
    crate = []
    box(crate,-2.9,2.9,0,0.4,-2.3,2.3,wood)
    for x in (-2.7,2.7):
        for z in (-2.1,2.1):
            box(crate,x-.3,x+.3,0,4.2,z-.3,z+.3,wood)
    for y in (0.65,1.85,3.05):
        for z0,z1 in ((-2.4,-2.15),(2.15,2.4)):
            box(crate,-2.65,2.65,y,y+.8,z0,z1,wood)
        for x0,x1 in ((-3,-2.75),(2.75,3)):
            box(crate,x0,x1,y,y+.8,-2.05,2.05,wood)
    save_prop_mesh('vn_kist.d3d',crate)
    cone = []
    box(cone,-2.2,2.2,0,.6,-2.2,2.2,dark)
    low = [(1.55*math.cos(k*math.tau/8),.6,1.55*math.sin(k*math.tau/8)) for k in range(8)]
    high = [(.15*math.cos(k*math.tau/8),7,.15*math.sin(k*math.tau/8)) for k in range(8)]
    for k in range(8):
        j=(k+1)%8;angle=(k+.5)*math.tau/8
        cone.append(([low[k],low[j],high[j],high[k]],uv('fun','cone',v1=.9),norm((math.cos(angle),1.4/6.4,math.sin(angle)))))
    for ring,y,normal in ((low,.6,(0,-1,0)),(high,7,(0,1,0))):
        for k in range(0,8,2):
            cone.append(([ring[k],ring[(k+1)%8],ring[(k+2)%8],(0,y,0)],uv('fun','cone',u0=.5,u1=.5,v0=.1,v1=.1),normal))
    save_prop_mesh('vn_kegel.d3d',cone)
    board = []
    for side in (-1,1):
        P=lambda x,y,d=0: (x,y,side*(2.4-y*.21)+d)
        outer=[P(-3.2,0),P(3.2,0),P(3.2,10),P(-3.2,10)]
        inner=[P(-3.2,0,-side*.25),P(3.2,0,-side*.25),P(3.2,10,-side*.25),P(-3.2,10,-side*.25)]
        normal=norm((0,.21,side))
        board.append((outer,wall_uv('fun','board',outer,normal),normal))
        board.append((inner,wood,tuple(-x for x in normal)))
        for a,b,facing in ((0,1,(0,-1,0)),(1,2,(1,0,0)),(2,3,(0,1,0)),(3,0,(-1,0,0))):
            board.append(([outer[a],outer[b],inner[b],inner[a]],wood,facing))
    save_prop_mesh('vn_bord.d3d',board)


def wall_uv(atlas, name, vs, facing, **crop):
    """Keep lettering readable from the front on either side of a street.
    Reversing a quad's winding for culling does not reverse its texture coordinates."""
    edge = sub(vs[1], vs[0])
    if edge[0] * -facing[2] + edge[2] * facing[0] < 0:
        crop['u0'], crop['u1'] = crop.get('u1', 1), crop.get('u0', 0)
    return uv(atlas, name, **crop)


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
        self.bridges = set()  # chunks over water: a narrower deck
        self.gaps = set()  # (chunk, side, t): a house's side at a side street's mouth
        self.line = {}     # (chunk, side): the house fronts' distance from the centre, WALK by default
        self.market_chunks = set()  # chunks with stalls: their awnings are the shops'
        self.open_square = set()  # (chunk, side) of the square kept free of trees, lamps and tubs
        self.near_water = set()  # chunks whose houses show their backs across water
        self.later = []    # (list, chunk, plane): decoration, added after the buildings
        self.ad_views = []  # fixed street cameras for checking lettering and mounting height
        self.parcels = []  # ground pads beneath the street houses, including dike elevations
        self.road_corridor = []  # keep terrain triangles away from the playable road's collision planes
        self.spans = []    # (chunk, side, t0, t1): houses on part of a skipped chunk
        self.shells = []   # essential closing faces, before optional backdrop buildings
        self.roof_details = []  # complete optional dormers/chimneys, after essential scenery
        self.bollards = []  # native movable objects, never also baked into the collision track
        self.lanterns = []
        self.parked_bikes = []
        self.smashables = []
        self.scenery_slots = []  # temporary planner reservations, removed before writing the RMP
        self.bridge_wings = []
        self.bridge_house_ends = []
        self.arch_bridge_chunks = set()

    def at(self, i, s):
        """Where the house fronts stand on this side of chunk i: wide on the Voorstraat."""
        return self.line.get((i % self.n, s), WALK)

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
            left = DECK if i in self.bridges else self.at(i, -1)
            right = DECK if i in self.bridges else self.at(i, 1)
            self.road_corridor.append([self.p(i, 0, -left)[::2], self.p(i, 1, -left)[::2], self.p(i, 1, right)[::2], self.p(i, 0, right)[::2]])
            for a, b in ((-ROAD, 0.0), (0.0, ROAD)):
                vs = [self.p(i, 0, a), self.p(i, 1, a), self.p(i, 1, b), self.p(i, 0, b)]
                # Rotate the atlas cell coordinates: across the road is u, along it is v.
                tile = uv('surface', 'road')
                self.chunks.add('road', i, quad(vs, [tile[0], tile[3], tile[2], tile[1]], grey, up))
            for s in (-1, 1):
                edge = DECK if i in self.bridges else self.at(i, s)
                k = max(1, round((edge - ROAD) / 60))
                for j in range(k):
                    inner = ROAD + KERB_BEVEL
                    a, b = inner + (edge - inner) * j / k, inner + (edge - inner) * (j + 1) / k
                    vs = [self.p(i, 0, s * a, KERB_HEIGHT), self.p(i, 1, s * a, KERB_HEIGHT),
                          self.p(i, 1, s * b, KERB_HEIGHT), self.p(i, 0, s * b, KERB_HEIGHT)]
                    tile = uv('land', 'pavement')
                    self.chunks.add('land', i, quad(vs, [tile[0], tile[3], tile[2], tile[1]], grey, up))
            # A continuous bevel, with shared road/pavement edges. The old vertical
            # 20 cm strip hit the wheel bodies like a wall and kicked the car upward.
            for s in (-1, 1):
                vs = [self.p(i, 0, s * ROAD), self.p(i, 1, s * ROAD),
                      self.p(i, 1, s * (ROAD + KERB_BEVEL), KERB_HEIGHT),
                      self.p(i, 0, s * (ROAD + KERB_BEVEL), KERB_HEIGHT)]
                self.chunks.add('land', i, quad(vs, uv('land', 'pavement', 0.0, 1.0, 0.0, 0.05),
                                              (200, 200, 200), (0, 1, 0)))

    # -- houses ---------------------------------------------------------------------------

    def houses(self):
        rng = random.Random(1640)
        rows = {}
        for s in (-1, 1):
            row = []
            for i in range(self.n):
                # Inside a tight bend a full house's back folds over: shallower houses there.
                depth = next((d for d in (DEPTH, 60.0, 30.0) if not self.bent(i, s, self.at(i, s) + d)), None)
                spans = [sp for sp in self.spans if sp[0] == i and sp[1] == s]
                if (i, s) in self.skip and spans:
                    pieces = [(sp[2], sp[3]) for sp in spans]
                elif (i, s) in self.skip or depth is None:
                    row.append(None)
                    row.append(None)
                    continue
                else:
                    split = rng.choice((0.43, 0.5, 0.57))
                    pieces = [(0.0, split), (split, 1.0)]
                for t0, t1 in pieces:
                    weights = [1, 4, 3, 1, 4, 3, 3, 1, 3, 3, 3, 1] + ([4] * 4 if self.at(i, s) == VOOR else [0] * 4)
                    if row and row[-1]:
                        weights[row[-1]['type']] = 0  # no identical neighbours
                    k = rng.choices(range(len(HOUSE_TYPES)), weights=weights)[0]
                    spec = HOUSE_TYPES[k]
                    # Give each storey a plausible height; four compressed storeys made the
                    # old fronts look like a grid. Narrow plots keep the simpler front types.
                    if t1 - t0 < 0.4:
                        k = rng.choice((0, 3, 4, 7))
                        spec = HOUSE_TYPES[k]
                    eave = (spec['floors'] + 1) * 30 + rng.choice((1, 5, 9))
                    top = eave / spec['eave']
                    gable = spec['top'] != 'cornice'
                    row.append({
                        'i': i, 't0': t0, 't1': t1, 's': s, 'depth': depth or DEPTH,
                        'type': k, 'eave': eave, 'top': top, 'gable': gable, 'roof': rng.choice((25, 32)),
                        'roofs': 'slate' if rng.random() < 0.8 else 'tiles',
                        'tint': tuple([rng.randint(236, 255)] * 3),
                    })
            rows[s] = row
        # A few shops advertise Jody Bernal: six houses spread over the lap, both sides.
        pick = random.Random(1999)
        chosen = []
        shops = [h for row in rows.values() for h in row if h and h['t1'] - h['t0'] >= 0.4 and HOUSE_TYPES[h['type']]['ground'] == 'shop']
        for h in pick.sample(shops, min(60, len(shops))):
            if len(chosen) < 6 and all(min(abs(h['i'] - c['i']), self.n - abs(h['i'] - c['i'])) > 10 for c in chosen):
                h['sign'] = 'jody_poster'
                chosen.append(h)
        self.signs = sorted((h['i'], h['s']) for h in chosen)
        for s, row in rows.items():
            m = len(row)
            for k, h in enumerate(row):
                if h:
                    self.house(h, row[(k - 1) % m], row[(k + 1) % m])

    @staticmethod
    def height(h):
        return h['top'] if h['gable'] else h['top'] + h['roof']

    def house_wall(self, i, plane, brick):
        if self.chunks.room('rail', i):
            self.chunks.add('rail', i, plane)
            return plane
        # Dense corners can exhaust the detail pass while the facade pass has room.
        # An opaque wall-colour sample from a drawn facade closes the same geometry there;
        # never silently drop an end wall or borrow a transparent gable corner.
        box = GEVEL[FACADES[5 if brick else 4]]
        sample = ((box[0] + 10.5) / 1024, (box[1] + 180.5) / 1024)
        vs, _, colour, indices = plane
        plane = (vs, [sample] * 4, colour, indices)
        self.chunks.add('extra', i, plane)
        return plane

    def house(self, h, prev, nxt):
        """A town house: its drawn front with the gable's outline, its roof, and side walls where a
        neighbour is lower. A gable front has its ridge running back from the street; a cornice
        front has it along the street."""
        i, s, t0, t1 = h['i'], h['s'], h['t0'], h['t1']
        E, T = h['eave'], h['top']
        f0 = self.at(i, s)
        f1 = f0 + h['depth']
        mid = (f0 + f1) / 2
        tm = (t0 + t1) / 2
        inward = tuple(-s * x for x in self.right(i))
        outward = tuple(s * x for x in self.right(i))
        fw = self.fwd(i)
        back = tuple(-x for x in fw)
        F = lambda t, y: self.p(i, t, s * f0, y)
        B = lambda t, y: self.p(i, t, s * f1, y)
        M = lambda t, y: self.p(i, t, s * mid, y)
        parcel = [F(t0, -1), F(t1, -1), B(t1, -1), B(t0, -1)]
        self.parcels.append([(v[0], v[2]) for v in parcel])
        self.chunks.add('road', i, quad(parcel, uv('surface', 'grass'), (240, 245, 235), (0, 1, 0)))
        roof = uv('land', h['roofs'])
        rtint = (225, 225, 230) if h['roofs'] == 'slate' else (236, 226, 220)
        vs = [F(t0, 0), F(t1, 0), F(t1, T), F(t0, T)]
        self.chunks.add('extra', i, quad(vs, wall_uv('gevel', FACADES[h['type']], vs, inward), h['tint'], inward))
        if HOUSE_TYPES[h['type']]['ground'] == 'shop' and (i * 7 + (s > 0) * 3 + round(t0 * 7)) % 5 == 0 and i not in self.market_chunks and f0 == WALK:
            # A striped sun awning over the shop window, under its name band, sloping out over
            # the pavement; seen from above and from below.
            ya = E * 1.12 / (HOUSE_TYPES[h['type']]['floors'] + 1.12) - 3
            A = lambda t, d, y: self.p(i, t, s * (f0 - d), y)
            a0, a1 = t0 + (t1 - t0) * 0.06, t1 - (t1 - t0) * 0.06
            vs = [A(a0, 0.5, ya), A(a1, 0.5, ya), A(a1, 14, ya - 7), A(a0, 14, ya - 7)]
            # Added after all buildings (Town.later): decoration never takes a roof's place.
            self.later.append(('land', i, quad(vs, uv('land', 'awning'), (255, 255, 255), norm((inward[0], 2.0, inward[2])))))
            self.later.append(('land', i, quad(vs, uv('land', 'awning'), (190, 180, 180), (0, -1, 0))))
        if (i, s) in self.near_water:
            # The back of the house, which shows across the water: another front, a little darker.
            # Matching silhouette: a random different gable used to leave holes below the roof.
            back_face = FACADES[h['type']]
            vs = [B(t1, 0), B(t0, 0), B(t0, T), B(t1, T)]
            self.later.append(('extra', i, quad(vs, wall_uv('gevel', back_face, vs, outward), (210, 210, 210), outward)))
        else:
            # Rear/raised/diagonal cameras can see every row, not just canal-side houses.
            vs = [B(t1, 0), B(t0, 0), B(t0, T), B(t1, T)]
            self.shells.append(('extra', i, quad(vs, wall_uv('gevel', FACADES[h['type']], vs, outward), (210, 210, 210), outward)))
        if h.get('sign'):
            # A portrait in the shop window, clear of the doorway and upper sash windows.
            # World and atlas aspect ratios agree: no widening of Jody's face or lettering.
            plot_w = math.dist(F(t0, 0), F(t1, 0))
            width = min(18.0, plot_w * 0.34)
            centre_t = t0 + (t1 - t0) * (0.32 if s < 0 else 0.68)
            half_t = (t1 - t0) * width / plot_w / 2
            a, b = centre_t - half_t, centre_t + half_t
            board_h = width * 4 / 3
            y0, y1 = 5.0, 5.0 + board_h
            # Keep the paper a true rectangle even on a road grade or curved plot line.
            # Building corners interpolate the grade; inheriting it would shear the portrait.
            anchor = self.p(i, centre_t, s * (f0 - 0.3))
            ends = [self.p(i, t, s * (f0 - 0.3)) for t in (0, 1)]
            along = norm((ends[1][0] - ends[0][0], 0, ends[1][2] - ends[0][2]))
            S = lambda t, y: tuple(anchor[q] + along[q] * (t - centre_t) / (b - a) * width
                                   + (y if q == 1 else 0) for q in range(3))
            vs = [S(a, y0), S(b, y0), S(b, y1), S(a, y1)]
            self.chunks.add('rail', i, quad(vs, wall_uv('bouw', h['sign'], vs, inward), (255, 255, 255), inward))
            target = S(centre_t, (y0 + y1) / 2)
            eye = [target[q] + inward[q] * 58 + fw[q] * 8 + (6 if q == 1 else 0) for q in range(3)]
            self.ad_views.append({'name': h['sign'], 'chunk': i, 'eye': eye, 'at': list(target)})
        if h['gable']:
            # Two slopes from the eaves at the sides up to the ridge behind the gable's top.
            ridge = T - 6
            self.chunks.add('land', i, quad([F(t0, E), B(t0, E), B(tm, ridge), F(tm, ridge)], roof, rtint, norm((back[0], 1.2, back[2]))))
            self.chunks.add('land', i, quad([F(tm, ridge), B(tm, ridge), B(t1, E), F(t1, E)], roof, rtint, norm((fw[0], 1.2, fw[2]))))
        else:
            R = h['roof']
            self.chunks.add('land', i, quad([F(t0, T), F(t1, T), M(t1, T + R), M(t0, T + R)], roof, rtint, norm((inward[0], 1.6, inward[2]))))
            self.chunks.add('land', i, quad([M(t0, T + R), M(t1, T + R), B(t1, T), B(t0, T)], roof, rtint, norm((outward[0], 1.6, outward[2]))))
        # Side walls where the neighbour is lower or missing, and the cornice house's gable end.
        top_wall = E if h['gable'] else T
        for t, other, facing in ((t0, prev, back), (t1, nxt, fw)):
            if (i, s, t) in self.gaps:
                # A side street's corner: the wall closed down to the ground, and on to where the
                # street's own fronts begin, so nothing leads behind the row (no ground there).
                other = None
                if f1 < f0 + DEPTH:
                    vs = [B(t, 0), self.p(i, t, s * (f0 + DEPTH), 0), self.p(i, t, s * (f0 + DEPTH), top_wall), B(t, top_wall)]
                    self.house_wall(i, quad(vs, uv('bouw', 'brick', 0, 1, 0, 0.6), (226, 214, 206), facing), True)
            if other is not None and self.at(other['i'], s) != f0:
                other = None  # the line steps here: the side shows from the ground up
            # A neighbour can hide this end only if its full depth and roof profile cover it.
            # Comparing peak heights alone left holes beside gabled/shallower neighbours.
            shared = other is not None and abs(other['depth'] - h['depth']) < 0.1
            if shared:
                other_wall = other['eave'] if other['gable'] else other['top']
                covers = other_wall >= top_wall
                if not h['gable']:
                    covers = covers and ((other_wall if other['gable'] else self.height(other)) >= self.height(h))
                if covers:
                    continue
            base = 0  # exposed end walls close down to their parcel, including below lower roofs
            vs = [F(t, base), B(t, base), B(t, top_wall), F(t, top_wall)]
            spec = HOUSE_TYPES[h['type']]
            material = ('side_brick' if base < 5 else 'brick') if spec['brick'] else 'white'
            wall_tint = (242, 234, 225) if spec['brick'] else spec['wall']
            if top_wall - base > 0.1:
                self.house_wall(i, quad(vs, uv('bouw', material, 0, 1, 0, max(0.15, (top_wall - base) / 140)), wall_tint, facing), spec['brick'])
            if not h['gable']:
                self.house_wall(i, closed_tri(F(t, T), B(t, T), M(t, T + h['roof']), uv_tri('bouw', 'brick' if spec['brick'] else 'white'), wall_tint, facing), spec['brick'])
            neighbour = (i - 1 if t == 0 else i + 1) % self.n
            if t in (0, 1) and neighbour in self.arch_bridge_chunks:
                self.finish_bridge_house_end(h, t, facing)
        self.house_roof_details(h)

    def finish_bridge_house_end(self, h, t, facing):
        """Finish the exposed bridge-facing end, preserving the closed wall behind it."""
        i, s = h['i'], h['s']
        front, depth = self.at(i, s), h['depth']
        P = lambda d, y: tuple(v + facing[k] * .2 for k, v in
                               enumerate(self.p(i, t, s * (front + d), y)))
        faces = []
        # A weather-resistant brick plinth anchors the white end wall to its parcel.
        faces.append(self.house_wall(i, quad([P(0, 0), P(depth, 0), P(depth, 8), P(0, 8)],
            uv('bouw', 'brick', v0=.85), (225, 215, 205), facing), True))
        # Crop one sash window from a drawn facade; keep the frame's aspect ratio
        # instead of stretching an entire shop front across the end wall.
        spec = HOUSE_TYPES[8]
        eave_px = int(512 * (1 - spec['eave']))
        floor_px = (512 - eave_px) * (1 - 1.12 / (spec['floors'] + 1.12)) / spec['floors']
        y0 = eave_px + floor_px * .18 - 4
        y1 = eave_px + floor_px * .82 + 4
        width_px = (256 * .76 / spec['cols']) * .55 + 8
        height = 20.0
        width = height * width_px / (y1 - y0)
        crop = dict(u0=(128 - width_px / 2) / 256, u1=(128 + width_px / 2) / 256,
                    v0=y0 / 512, v1=y1 / 512)
        floors = HOUSE_TYPES[h['type']]['floors'] + 1
        for level in range(floors):
            sill = 9 + level * (h['eave'] / floors)
            for d in (depth * .3, depth * .7):
                vs = [P(d - width / 2, sill), P(d + width / 2, sill),
                      P(d + width / 2, sill + height), P(d - width / 2, sill + height)]
                plane = quad(vs, wall_uv('gevel', FACADES[8], vs, facing, **crop), (245, 245, 240), facing)
                self.chunks.add('extra', i, plane)
                faces.append(plane)
        # A visible fascia follows both roof slopes, rather than leaving an
        # untrimmed white triangular end meeting a paper-thin roof edge.
        if not h['gable']:
            top, ridge = h['top'], h['top'] + h['roof']
            for d0, y0, d1, y1 in ((0, top, depth / 2, ridge), (depth / 2, ridge, depth, top)):
                vs = [P(d0, y0 - 1), P(d1, y1 - 1), P(d1, y1 + .2), P(d0, y0 + .2)]
                faces.append(self.house_wall(i, quad(vs, uv('bouw', 'white'), (235, 234, 222), facing), False))
        self.bridge_house_ends.append({'chunk': i, 'side': s, 't': t, 'windows': floors * 2, 'faces': faces})

    def jody_billboard(self, i=46):
        """A deliberately enormous 9 x 12 m, double-faced portrait on the open dike bank.
        Closed steel supports and panel edges remain visible from rear/elevated cameras."""
        origin = self.p(i, 0.45, 150)
        approach = self.p(i - 3, 0.5, 0, 20)
        normal = norm((approach[0] - origin[0], 0, approach[2] - origin[2]))
        across = (-normal[2], 0, normal[0])
        P = lambda x, d, y: tuple(origin[k] + across[k] * x + normal[k] * d
                                  + (y if k == 1 else 0) for k in range(3))
        steel = uv('bouw', 'steel')
        for d, facing in ((2, normal), (-2, tuple(-x for x in normal))):
            vs = [P(-45, d, 40), P(45, d, 40), P(45, d, 160), P(-45, d, 160)]
            self.chunks.add('rail', i, quad(vs, wall_uv('bouw', 'jody_poster', vs, facing),
                                          (255, 255, 255), facing))
        for vs, facing in (
            ([P(-45, -2, 40), P(-45, 2, 40), P(-45, 2, 160), P(-45, -2, 160)], tuple(-v for v in across)),
            ([P(45, -2, 40), P(45, 2, 40), P(45, 2, 160), P(45, -2, 160)], across),
            ([P(-45, -2, 160), P(45, -2, 160), P(45, 2, 160), P(-45, 2, 160)], (0, 1, 0)),
            ([P(-45, -2, 40), P(45, -2, 40), P(45, 2, 40), P(-45, 2, 40)], (0, -1, 0)),
        ):
            self.chunks.add('rail', i, quad(vs, steel, (255, 255, 255), facing))
        # Extend both feet below the bank; terrain hides the buried foundation.
        for x in (-28, 28):
            a, b, d0, d1, y0, y1 = x - 2, x + 2, -1.8, 1.8, -140, 45
            for vs, facing in (
                ([P(a, d0, y0), P(b, d0, y0), P(b, d0, y1), P(a, d0, y1)], tuple(-v for v in normal)),
                ([P(a, d1, y0), P(b, d1, y0), P(b, d1, y1), P(a, d1, y1)], normal),
                ([P(a, d0, y0), P(a, d1, y0), P(a, d1, y1), P(a, d0, y1)], tuple(-v for v in across)),
                ([P(b, d0, y0), P(b, d1, y0), P(b, d1, y1), P(b, d0, y1)], across),
                ([P(a, d0, y1), P(b, d0, y1), P(b, d1, y1), P(a, d1, y1)], (0, 1, 0)),
                ([P(a, d0, y0), P(b, d0, y0), P(b, d1, y0), P(a, d1, y0)], (0, -1, 0)),
            ):
                self.chunks.add('rail', i, quad(vs, steel, (255, 255, 255), facing))
        self.billboard_view = {'name': 'Jody giant billboard', 'chunk': i - 3,
                               'eye': approach, 'at': P(0, 2, 100)}
        self.billboard_reverse_view = {'name': 'Jody giant billboard rear', 'chunk': i,
            'eye': P(0, -200, 80), 'at': P(0, -2, 100)}

    def house_roof_details(self, h):
        """Dormers and modest brick stacks, following the roofs in photos 1439 and 1446.
        Queue whole closed volumes: budget pressure must never leave a floating window."""
        if h['gable'] or h['depth'] < 60:
            return
        i, s, t0, t1 = h['i'], h['s'], h['t0'], h['t1']
        front = self.at(i, s)
        span = math.dist(self.p(i, t0, s * front), self.p(i, t1, s * front))
        if span < 48:
            return
        inward = tuple(-s * v for v in self.right(i))
        outward = tuple(-v for v in inward)
        fw, back = self.fwd(i), tuple(-v for v in self.fwd(i))
        # Opaque wall pixel of the white drawn facade, shared by the fallback end walls.
        solid = [(10.5 / 1024, 436.5 / 1024)] * 4
        # A window-free brick strip of the drawn facade: about two bricks across a
        # half-metre stack, rather than stretching a whole house or painting a plain block.
        stack_brick = uv('gevel', 'gevel6', u0=0.025, u1=0.095, v0=0.16, v1=0.41)

        def volume(name, tm, width, d0, d1, y0, y1, colour, window=False):
            dt = (t1 - t0) * width / span / 2
            P = lambda t, d, y: self.p(i, t, s * (front + d), y)
            a, b = tm - dt, tm + dt
            faces = []
            vs = [P(a, d0, y0), P(b, d0, y0), P(b, d0, y1), P(a, d0, y1)]
            faces.append(('land' if window else 'extra', quad(vs,
                wall_uv('land', 'dormer', vs, inward) if window else stack_brick,
                (255, 255, 255), inward)))
            for vs, normal, tint in (
                ([P(a, d1, y0), P(b, d1, y0), P(b, d1, y1), P(a, d1, y1)], outward, colour),
                ([P(a, d0, y0), P(a, d1, y0), P(a, d1, y1), P(a, d0, y1)], back, colour),
                ([P(b, d0, y0), P(b, d1, y0), P(b, d1, y1), P(b, d0, y1)], fw, colour),
                ([P(a, d0, y1), P(b, d0, y1), P(b, d1, y1), P(a, d1, y1)], (0, 1, 0), (65, 67, 69)),
            ):
                cap = normal == (0, 1, 0)
                faces.append(('extra', quad(vs, solid if window or cap else stack_brick,
                    tint if window or cap else (255, 255, 255), normal)))
            self.roof_details.append((name, i, faces))

        salt = i * 7 + (s > 0) * 3 + round(t0 * 7)
        T, R = h['top'], h['roof']
        if salt % 3 == 0:
            volume('dormer', (t0 + t1) / 2, 16, 8, 20, T + 2, T + 18,
                   (72, 76, 79), window=True)
        if salt % 4 == 1:
            ridge = h['depth'] / 2
            volume('chimney', t0 + (t1 - t0) * 0.2, 5, ridge - 3.5, ridge + 3.5,
                   T + R - 5, T + R + 12, (139, 98, 78))

    def finish_roofs(self):
        from collections import Counter
        placed = Counter()
        for name, i, faces in self.roof_details:
            needs = Counter(kind for kind, _ in faces)
            if all(self.chunks.room(kind, i) >= count for kind, count in needs.items()):
                for kind, plane in faces:
                    self.chunks.add(kind, i, plane)
                placed[name] += 1
        print('Photo-based roof details', dict(placed))
        self.roof_counts = dict(placed)

    # -- the Lekpoort ---------------------------------------------------------------------

    def lekpoort(self, i):
        """The gate tower over the road: a passage, the photo's brick body on both faces, brick
        sides, a slate roof and a spire with a white lantern."""
        TW, L, A, H = WALK + 14, 96.0, 94.0, 300.0
        GAP = 55.0  # matches the opening in the rectified front, rather than a second smaller arch
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
            # Both gate faces use one continuous image across the piers and arch haunches.
            # Reverse the full image on the far face, not each subrectangle independently.
            face_u = U if a == 0 else lambda x: 1 - U(x)
            for x0, x1, y0, y1 in ((-TW, -GAP, 0, A), (GAP, TW, 0, A), (-TW, TW, A, H)):
                vs = [P(x0, a, y0), P(x1, a, y0), P(x1, a, y1), P(x0, a, y1)]
                self.chunks.add('rail', i, quad(vs, uv('bouw', 'lekpoort', face_u(x0), face_u(x1), V(y1), V(y0)), (255, 255, 255), facing))
            # The real passage is arched. Four haunches preserve the opening silhouette instead
            # of cutting an enormous rectangle out of the photographed gate front.
            bounds = (-GAP, -GAP / 2, 0.0, GAP / 2, GAP)
            arch = lambda x: A - 26 + 25.4 * math.sqrt(max(0, 1 - (x / GAP) ** 2))
            cell = uv('bouw', 'lekpoort')
            tex = lambda x, y: (cell[0][0] + face_u(x) * (cell[1][0] - cell[0][0]), cell[2][1] + V(y) * (cell[0][1] - cell[2][1]))
            for x0, x1 in zip(bounds, bounds[1:]):
                y0, y1 = arch(x0), arch(x1)
                vs = [P(x0, a, y0), P(x1, a, y1), P(x1, a, A), P(x0, a, A)]
                self.chunks.add('rail', i, quad(vs, [tex(x0, y0), tex(x1, y1), tex(x1, A), tex(x0, A)], (255, 255, 255), facing))
        for x, facing in ((-TW, tuple(-c for c in r)), (TW, r)):
            vs = [P(x, 0, 0), P(x, L, 0), P(x, L, H), P(x, 0, H)]
            self.chunks.add('rail', i, quad(vs, uv('bouw', 'tower'), (235, 225, 215), facing))
        # The passage: its walls and vault.
        for x, facing in ((-GAP, r), (GAP, tuple(-c for c in r))):
            vs = [P(x, 0, 0), P(x, L, 0), P(x, L, A), P(x, 0, A)]
            self.chunks.add('rail', i, quad(vs, uv('bouw', 'brick', 0, 1, 0, 0.6), (180, 170, 160), facing))
        for x0, x1 in zip(bounds, bounds[1:]):
            vs = [P(x0, 0, arch(x0)), P(x1, 0, arch(x1)), P(x1, L, arch(x1)), P(x0, L, arch(x0))]
            self.chunks.add('rail', i, quad(vs, uv('bouw', 'brick'), (160, 150, 140), (0, -1, 0)))
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
        # Corner turrets with slate caps, as on the gate's town and river faces (photos 1441, 1442).
        tw = 13.0
        for x in (-TW, TW):
            for a0 in (0.0, L):
                cx, ca = x - (tw if x > 0 else -tw) * 0.4, a0 + (tw if a0 == 0 else -tw) * 0.4
                ring = [P(cx - tw, ca - tw, 0), P(cx + tw, ca - tw, 0), P(cx + tw, ca + tw, 0), P(cx - tw, ca + tw, 0)]
                ring = [(v[0], o[1] + H - 40, v[2]) for v in ring]
                peak = P(cx, ca, H + 75)
                for k in range(4):
                    a, b = ring[k], ring[(k + 1) % 4]
                    out = norm((a[0] + b[0] - 2 * peak[0], 0.0, a[2] + b[2] - 2 * peak[2]))
                    up = o[1] + H + 22
                    self.chunks.add('rail', i, quad([a, b, (b[0], up, b[2]), (a[0], up, a[2])], uv('bouw', 'tower', 0, 0.2, 0, 0.3), (235, 225, 215), out))
                    self.chunks.add('rail', i, tri((a[0], up, a[2]), (b[0], up, b[2]), peak, uv_tri('bouw', 'slate'), (210, 210, 220), norm((out[0], 0.8, out[2]))))

    def dome(self, i, c, r, y0, y1, cap, name, tint, n=6):
        """A round turret: an n-sided prism of r around point c from y0 to y1 above it, and a cap of
        slate cap high."""
        ring = [(c[0] + r * math.cos(2 * math.pi * k / n), c[2] + r * math.sin(2 * math.pi * k / n)) for k in range(n)]
        peak = (c[0], c[1] + y1 + cap, c[2])
        for k in range(n):
            (ax, az), (bx, bz) = ring[k], ring[(k + 1) % n]
            out = norm(((ax + bx) / 2 - c[0], 0.0, (az + bz) / 2 - c[2]))
            vs = [(ax, c[1] + y0, az), (bx, c[1] + y0, bz), (bx, c[1] + y1, bz), (ax, c[1] + y1, az)]
            self.chunks.add('rail', i, quad(vs, uv('bouw', name, 0, 1.0 / n * 2, 0, 1), tint, out))
            self.chunks.add('rail', i, tri((ax, c[1] + y1, az), (bx, c[1] + y1, bz), peak, uv_tri('bouw', 'slate'), (120, 120, 135), norm((out[0], 0.9, out[2]))))

    # -- the Stadhuis ---------------------------------------------------------------------

    def stadhuis(self, i, s):
        """As in the owner's photo 1449: a tall, narrow front of grey stone (the photo itself) with
        battlements, a lower brick wing behind it under a slate roof, and a round stair turret with
        a slate cone at the wing's far corner."""
        H, SD, D, WH = 170.0, 48.0, 230.0, 130.0
        self.skip.add((i, s))
        self.open_square |= {((i + k) % self.n, s) for k in (-2, -1, 0, 1)}
        inward = tuple(-s * x for x in self.right(i))
        fw = self.fwd(i)
        L0 = self.at(i, s)
        F = lambda t, y, d=0.0: self.p(i, t, s * (L0 + d), y)
        # The stone front block.
        vs = [F(0, 0), F(1, 0), F(1, H), F(0, H)]
        self.chunks.add('rail', i, quad(vs, wall_uv('bouw', 'stadhuis', vs, inward), (255, 255, 255), inward))
        for t, facing in ((0, tuple(-x for x in fw)), (1, fw)):
            self.chunks.add('rail', i, quad([F(t, 0), F(t, 0, SD), F(t, H, SD), F(t, H)], uv('bouw', 'stone', 0, 0.4, 0, 1), (225, 225, 228), facing))
        self.chunks.add('land', i, quad([F(0, H), F(1, H), F(1, H, SD), F(0, H, SD)], uv('land', 'slate'), (180, 180, 185), (0, 1, 0)))
        # Battlements: five merlons along the front, two on each side.
        for k in range(5):
            t0, t1 = 0.04 + k * 0.2, 0.04 + k * 0.2 + 0.11
            self.chunks.add('rail', i, quad([F(t0, H), F(t1, H), F(t1, H + 14), F(t0, H + 14)], uv('bouw', 'stone', 0, 0.3, 0, 0.3), (240, 240, 240), inward))
        for t, facing in ((0, tuple(-x for x in fw)), (1, fw)):
            for d0 in (4.0, 30.0):
                self.chunks.add('rail', i, quad([F(t, H, d0), F(t, H, d0 + 14), F(t, H + 14, d0 + 14), F(t, H + 14, d0)], uv('bouw', 'stone', 0, 0.3, 0, 0.3), (240, 240, 240), facing))
        # The brick wing behind, a little narrower, its gable to the street above the stone block.
        a, b = 0.06, 0.94
        for t, facing in ((a, tuple(-x for x in fw)), (b, fw)):
            self.chunks.add('rail', i, quad([F(t, 0, SD), F(t, 0, D), F(t, WH, D), F(t, WH, SD)], uv('bouw', 'brick', 0, 1, 0, 0.9), (215, 200, 190), facing))
        R = 70.0
        self.chunks.add('land', i, quad([F(a, WH, SD), F(a, WH, D), F(0.5, WH + R, D), F(0.5, WH + R, SD)], uv('land', 'slate'), (205, 205, 215), norm((-fw[0], 1.0, -fw[2]))))
        self.chunks.add('land', i, quad([F(0.5, WH + R, SD), F(0.5, WH + R, D), F(b, WH, D), F(b, WH, SD)], uv('land', 'slate'), (205, 205, 215), norm((fw[0], 1.0, fw[2]))))
        out = tuple(s * x for x in self.right(i))
        self.chunks.add('rail', i, tri(F(a, WH, D), F(b, WH, D), F(0.5, WH + R, D), uv_tri('bouw', 'brick'), (215, 200, 190), out))
        self.chunks.add('rail', i, quad([F(0, 0, SD), F(1, 0, SD), F(1, H, SD), F(0, H, SD)], uv('bouw', 'stone'), (215, 210, 205), out))
        self.chunks.add('rail', i, quad([F(a, 0, D), F(b, 0, D), F(b, WH, D), F(a, WH, D)], uv('bouw', 'brick'), (215, 200, 190), out))
        # The stair turret on the wing's far corner, toward the cars that come.
        self.dome(i, F(a, 0, D - 22), 20.0, 0.0, 165.0, 45.0, 'brick', (210, 190, 175))

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
        # Its ends: a garden wall back from the street, so no gap opens beside the next house.
        for c, t in (((i - 1) % self.n, 0.22), ((i + 1) % self.n, 1.0)):
            fwc = self.fwd(c)
            vs = [self.p(c, t, s * WALK, 0), self.p(c, t, s * (WALK + DEPTH), 0), self.p(c, t, s * (WALK + DEPTH), 36), self.p(c, t, s * WALK, 36)]
            for face in (fwc, tuple(-x for x in fwc)):
                self.chunks.add('rail', c, quad(vs, uv('bouw', 'brick', 0, 1, 0, 0.3), (230, 220, 210), face))
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
            G = 78.0
            Q = lambda t, y, c=c: self.p(c, t, s * (f0 + 45), y)
            for t0, t1 in ((0, 0.5), (0.5, 1)):
                vs = [F(t0, 0), F(t1, 0), F(t1, H), F(t0, H)]
                self.chunks.add('rail', c, quad(vs, wall_uv('bouw', 'church', vs, inn), (245, 235, 225), inn))
                vs = [B(t1, 0), B(t0, 0), B(t0, H), B(t1, H)]
                self.chunks.add('rail', c, quad(vs, wall_uv('bouw', 'church', vs, out), (220, 215, 205), out))
                # A steep gable over each window, its little roof running back into the nave's.
                tm = (t0 + t1) / 2
                self.chunks.add('rail', c, tri(F(t0, H), F(t1, H), F(tm, H + G), uv_tri('bouw', 'brick'), (235, 215, 200), inn))
                self.chunks.add('land', c, quad([F(t0, H), F(tm, H + G), Q(tm, H + G), Q(t0, H)], uv('land', 'slate'), (210, 210, 220), norm((-self.fwd(c)[0], 1.0, -self.fwd(c)[2]))))
                self.chunks.add('land', c, quad([F(tm, H + G), F(t1, H), Q(t1, H), Q(tm, H + G)], uv('land', 'slate'), (210, 210, 220), norm((self.fwd(c)[0], 1.0, self.fwd(c)[2]))))
            vs = [F(0, H), F(1, H), M(1, H + R), M(0, H + R)]
            self.chunks.add('land', c, quad(vs, uv('land', 'slate'), (220, 220, 230), norm((inn[0], 1.0, inn[2]))))
            vs = [M(0, H + R), M(1, H + R), B(1, H), B(0, H)]
            self.chunks.add('land', c, quad(vs, uv('land', 'slate'), (220, 220, 230), norm((out[0], 1.0, out[2]))))
        # West gable, behind the tower: closes the nave's roof at that end.
        F = lambda y: self.p(i, 0, s * f0, y)
        B = lambda y: self.p(i, 0, s * f1, y)
        M = lambda y: self.p(i, 0, s * mid, y)
        back = tuple(-x for x in self.fwd(i))
        self.chunks.add('rail', i, quad([F(0), B(0), B(H), F(H)], uv('bouw', 'brick'), (225, 210, 200), back))
        self.chunks.add('rail', i, tri(F(H), B(H), M(H + R), uv_tri('bouw', 'brick'), (225, 210, 200), back))
        # East gable.
        e = (i + 2) % self.n
        F = lambda y: self.p(e, 0, s * f0, y)
        B = lambda y: self.p(e, 0, s * f1, y)
        M = lambda y: self.p(e, 0, s * mid, y)
        fw = self.fwd(e)
        vs = [F(0), B(0), B(H), F(H)]
        self.chunks.add('rail', e, quad(vs, wall_uv('bouw', 'church', vs, fw), (235, 225, 215), fw))
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
            mapping = wall_uv('bouw', 'kerk2', vs, facing)
            kind = 'rail'
            self.chunks.add(kind, c, quad(vs, mapping, (240, 232, 222), facing))
        # The top as in the owner's photos 1457-1459: a flat lead roof behind a stone gallery, and on
        # it a small white lantern with a dark cap and a vane.
        corners = [P(t0, o0, HT), P(t1, o0, HT), P(t1, o1, HT), P(t0, o1, HT)]
        self.chunks.add('land', c, quad(corners, uv('land', 'slate'), (170, 170, 180), (0, 1, 0)))
        ctop = P((t0 + t1) / 2, (o0 + o1) / 2, HT)
        for k in range(4):
            a, b = corners[k], corners[(k + 1) % 4]
            out = norm((a[0] + b[0] - 2 * ctop[0], 0.0, a[2] + b[2] - 2 * ctop[2]))
            g0, g1 = a[1], b[1]
            vs = [a, b, (b[0], g1 + 22, b[2]), (a[0], g0 + 22, a[2])]
            self.chunks.add('rail', c, quad(vs, uv('bouw', 'darkrail'), (215, 215, 210), out))
            self.chunks.add('rail', c, quad(vs, uv('bouw', 'darkrail'), (215, 215, 210), tuple(-x for x in out)))
        self.dome(c, ctop, 22.0, 0.0, 52.0, 30.0, 'white', (245, 245, 240))
        top = (ctop[0], ctop[1] + 82, ctop[2])
        r = self.right(c)
        self.chunks.add('rail', c, quad([(top[0] - r[0] * 1.5, top[1], top[2] - r[2] * 1.5), (top[0] + r[0] * 1.5, top[1], top[2] + r[2] * 1.5), (top[0] + r[0] * 1.5, top[1] + 40, top[2] + r[2] * 1.5), (top[0] - r[0] * 1.5, top[1] + 40, top[2] - r[2] * 1.5)], two_sided_uv(uv('bouw', 'steel')), (90, 90, 90), tuple(-x for x in self.fwd(c))))
        # The churchyard: grass, and lime trees.
        for k in (0, 1):
            cc = (i + k) % self.n
            vs = [self.p(cc, 0, s * WALK, 2), self.p(cc, 1, s * WALK, 2), self.p(cc, 1, s * f0, 2), self.p(cc, 0, s * f0, 2)]
            self.chunks.add('land', cc, quad(vs, uv('land', 'grass'), (230, 240, 220), (0, 1, 0)))

    # -- trees, lamps, the dike ----------------------------------------------------------------

    def sprite(self, i, t, off, w, h, name, base=0.0, atlas='bouw', kind='rail', y0=0.0, uvs=None, tint=(255, 255, 255), across=False):
        """A flat prop, visible from either side. U + 4 tags its reverse-facing render triangles.
        Integer UV wrapping preserves the atlas lookup; physics still gets one original plane.
        This avoids overflowing the original engine's per-chunk plane limits with duplicate props.
        """
        if name in ('lamp', 'bike'):
            # Bridge lanterns need feet on the deck, rather than suspended beyond its edge.
            if name == 'lamp' and i in self.bridges:
                off = math.copysign(min(abs(off), DECK - 3), off)
            position = self.p(i, t, off, KERB_HEIGHT)
            if name == 'bike':
                a, b = self.p(i, 0, off), self.p(i, 1, off)
                yaw = math.degrees(math.atan2(-(b[2] - a[2]), b[0] - a[0]))
                self.parked_bikes.append((i, position, yaw))
            else:
                self.lanterns.append((i, position))
            slot = object()
            self.scenery_slots.append(slot)
            self.chunks.add(kind, i, slot)
            return
        c = self.p(i, t, off, base)
        f, r = self.fwd(i), self.right(i)
        side = 1 if off > 0 else -1
        # across: square to the road, facing the cars that come (seen whole down a long street).
        d = r if across else f
        a = (c[0] - d[0] * w / 2, c[1] + y0, c[2] - d[2] * w / 2)
        b = (c[0] + d[0] * w / 2, c[1] + y0, c[2] + d[2] * w / 2)
        vs = [a, b, (b[0], c[1] + h, b[2]), (a[0], c[1] + h, a[2])]
        facing = tuple(-x for x in f) if across else tuple(-side * x for x in r)
        mapping = two_sided_uv(uvs or uv(atlas, name))
        self.chunks.add(kind, i, quad(vs, mapping, tint, facing))

    def square(self, chunks):
        """The Voorstraat as in the owner's photos: a wide klinker square between road and houses,
        a row of lime trees, lamps between them, red and white posts along the kerb. All on the
        land list (its atlas has them), as the rail lists are full."""
        for i in chunks:
            for s in (-1, 1):
                if self.at(i, s) == WALK:
                    continue
                # Nothing in front of the Stadhuis: its square stays open, so it shows down the street.
                if (i, s) in self.open_square:
                    continue
                # A lime: a trunk the car can hit, the crown above the cars.
                self.sprite(i, 0.5, s * (ROAD + 40), 3.5, 52, None, atlas='land', kind='land', across=True, uvs=uv('land', 'deck', 0.4, 0.6, 0, 1), tint=(110, 90, 75))
                self.sprite(i, 0.5, s * (ROAD + 40), 64, 100 + (i % 3) * 4, 'crown', atlas='land', kind='land', across=True, y0=45)
                if i % 2 == 0:
                    self.sprite(i, 0.0, s * (ROAD + 40), 7, 55, 'lamp', atlas='land', kind='land', across=True)
                else:
                    self.sprite(i, 0.0, s * (ROAD + 40), 14, 12, 'planter', atlas='land', kind='land', across=True)
                if (i + (s > 0)) % 3 == 0:
                    self.sprite(i, 0.62, s * (ROAD + 44), 19, 11, 'bike', atlas='land', kind='land')
                for t in (0.25, 0.75):
                    self.bollards.append((i, self.p(i, t, s * (ROAD + 7), KERB_HEIGHT)))
                    # Preserve the existing scenery allocation: newly freed post slots must
                    # not randomly admit different background houses or displace roof details.
                    slot = object()
                    self.scenery_slots.append(slot)
                    self.chunks.add('land', i, slot)

    def bikes(self):
        """Bicycles parked against the house fronts here and there, as in every Dutch street."""
        rng = random.Random(1870)
        for i in range(self.n):
            for s in (-1, 1):
                if (i, s) in self.skip or self.at(i, s) != WALK or rng.random() > 0.28:
                    continue
                t = rng.choice((0.2, 0.45, 0.7))
                self.sprite(i, t, s * (WALK - 5), 19, 11, 'bike', atlas='land', kind='land')
                if rng.random() < 0.4:
                    self.sprite(i, t + 0.12, s * (WALK - 6), 19, 11, 'bike', atlas='land', kind='land')

    def fun_props(self):
        """Optional targets on pavements, with the entire racing road left open."""
        def place(i,t,side,off,name,kind):
            a,b=self.p(i,0,side*off),self.p(i,1,side*off)
            yaw=math.degrees(math.atan2(-(b[2]-a[2]),b[0]-a[0]))
            self.smashables.append((i,kind,self.p(i,t,side*off,KERB_HEIGHT),yaw,name))
        for k,i in enumerate((3,7,12,20,23,25)):
            side=next((s for s in ((-1,1) if k%2 else (1,-1))
                       if (i,s) not in self.skip and (i,s) not in self.open_square and self.at(i,s)==VOOR),None)
            if side is None:
                continue
            for t,off,name,kind in ((.12,70,'VN_BOX_ANIM',22),(.17,76,'VN_BOX_ANIM',22),
                                    (.38,70,'VN_CRATE_ANIM',22),(.46,77,'VN_CRATE_ANIM',22),
                                    (.68,72,'VN_SIGN_ANIM',22),(.87,64,'VN_CONE_ANIM',2)):
                place(i,t,side,off,name,kind)
        for i in (35,56,69,92):
            side=next((s for s in (-1,1) if (i,s) not in self.skip and i not in self.bridges),None)
            if side is not None:
                for t,off in ((.10,65),(.35,68),(.60,65)):
                    place(i,t,side,off,'VN_CONE_ANIM',2)

    def road_dashes(self):
        """White dashes along both road edges, as by the Grote Kerk (photos 1457-1459)."""
        white = uv('land', 'bollard', 0.42, 0.58, 0.45, 0.55)
        for i in range(self.n):
            if i in self.bridges or self.at(i, -1) != WALK or self.at(i, 1) != WALK:
                continue
            for s in (-1, 1):
                a, b = s * (ROAD - 9), s * (ROAD - 6)
                for t0 in (0.3,):
                    vs = [self.p(i, t0, a, 0.8), self.p(i, t0 + 0.3, a, 0.8), self.p(i, t0 + 0.22, b, 0.8), self.p(i, t0, b, 0.8)]
                    self.chunks.add('land', i, quad(vs, white, (255, 255, 255), (0, 1, 0)))

    def sign(self, i, t, s, k, y=46.0):
        """Street name sign k on the house front at t, high on the wall, facing the road."""
        L0 = self.at(i, s) - 1.2
        a, b = self.p(i, t - 0.1, s * L0, y), self.p(i, t + 0.1, s * L0, y)
        vs = [a, b, (b[0], b[1] + 6.5, b[2]), (a[0], a[1] + 6.5, a[2])]
        facing = tuple(-s * x for x in self.right(i))
        self.chunks.add('land', i, quad(vs, wall_uv('land', f'street{k}', vs, facing), (255, 255, 255), facing))

    def lamps(self):
        """Against the facades, on the straights: in a bend a car cuts over the pavement."""
        for i in range(0, self.n, 2):
            a, b = self.fr[i - 1][0], self.fr[(i + 1) % self.n][0]
            if abs(math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1])) > 0.06:
                continue
            s = 1 if (i // 2) % 2 else -1
            if (i, s) in self.skip or self.at(i, s) != WALK:
                continue
            self.sprite(i, 0.5, s * (WALK - 5), 7, 55, 'lamp', atlas='land', kind='land')

    def find_water(self, water):
        """The chunk sides where an OSM water polygon lies beside the road."""
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
        return sides

    def water_sides(self, sides):
        """Where the moat runs beside the road: a quay edge with white railings, a grass bank down
        to the water, the water, the far bank and trees, instead of houses."""
        for i, s in sorted(sides):
            if i in self.bridges:
                continue
            self.skip.add((i, s))
            inward = tuple(-s * x for x in self.right(i))
            g0 = self.p(i, 0, 0)[1]
            low = WATER_Y - g0
            P = lambda t, off, y, i=i: self.p(i, t, s * off, y)
            # Quay edge, railing on it.
            self.chunks.add('rail', i, quad([P(0, WALK, 0), P(1, WALK, 0), P(1, WALK, 3), P(0, WALK, 3)], uv('bouw', 'brick', 0, 1, 0, 0.12), (220, 210, 200), inward))
            self.chunks.add('rail', i, quad([P(0, WALK, 0), P(1, WALK, 0), P(1, WALK, 14), P(0, WALK, 14)], uv('bouw', 'railing'), (255, 255, 255), inward))
            self.chunks.add('rail', i, quad([P(0, WALK, 0), P(1, WALK, 0), P(1, WALK, 14), P(0, WALK, 14)], uv('bouw', 'railing'), (255, 255, 255), tuple(-x for x in inward)))
            # The connected terrain mesh supplies both banks and the canal, across chunks.
            if i % 2 == 0:
                self.sprite(i, 0.5, s * (WALK + 600), 80, 120, 'tree', base=-self.ground[i])

    def market(self, first, last):
        """Market stalls along Voorstraat, as in the owner's photos: a table of produce under a
        striped awning on two white poles, against the houses."""
        rng = random.Random(1452)
        self.market_chunks.update(k % self.n for k in range(first, last + 1))
        for i in range(first, last + 1):
            for s in (-1, 1):
                if (i, s) in self.skip or rng.random() < 0.3:
                    continue
                inward = tuple(-s * x for x in self.right(i))
                t0, t1 = 0.22, 0.78
                F = lambda t, off, y: self.p(i, t, s * off, y)
                front, back = self.at(i, s) - 22, self.at(i, s) - 4
                # The table: its front and its top of crates.
                self.chunks.add('land', i, quad([F(t0, front + 4, 2), F(t1, front + 4, 2), F(t1, front + 4, 10), F(t0, front + 4, 10)], uv('land', 'deck'), (230, 220, 205), inward))
                self.chunks.add('rail', i, quad([F(t0, front + 4, 10), F(t1, front + 4, 10), F(t1, back, 11), F(t0, back, 11)], uv('bouw', 'produce'), (225, 220, 202), (0, 1, 0)))
                # Poles at the front corners.
                for t in (t0, t1):
                    c = F(t, front - 2, 0)
                    fw = self.fwd(i)
                    pole = [(c[0] - fw[0] * 0.5, c[1], c[2] - fw[2] * 0.5), (c[0] + fw[0] * 0.5, c[1], c[2] + fw[2] * 0.5), (c[0] + fw[0] * 0.5, c[1] + 25, c[2] + fw[2] * 0.5), (c[0] - fw[0] * 0.5, c[1] + 25, c[2] - fw[2] * 0.5)]
                    self.chunks.add('land', i, quad(pole, two_sided_uv(uv('land', 'bollard', 0.4, 0.6, 0.43, 0.57)), (255, 255, 255), inward))
                # The awning, sloping down toward the street, seen from above and below.
                canopy = [F(t0 - 0.03, front - 4, 25), F(t1 + 0.03, front - 4, 25), F(t1 + 0.03, back, 30), F(t0 - 0.03, back, 30)]
                self.chunks.add('land', i, quad(canopy, uv('land', 'awning'), (255, 255, 255), norm((inward[0], 1.5, inward[2]))))
                self.chunks.add('land', i, quad(canopy, uv('land', 'awning'), (200, 190, 190), (0, -1, 0)))

    def side_house(self, i, vs, facing, spec):
        """A closed little cornice house behind a side-street facade, not a floating billboard."""
        rear = [(x - facing[0] * 36, y, z - facing[2] * 36) for x, y, z in vs]
        face = FACADES[spec]
        self.chunks.add('extra', i, quad(vs, wall_uv('gevel', face, vs, facing, v0=1 - HOUSE_TYPES[spec]['eave']), (236, 236, 236), facing))
        out = tuple(-x for x in facing)
        back = [rear[1], rear[0], rear[3], rear[2]]
        self.shells.append(('extra', i, quad(back, wall_uv('gevel', face, back, out, v0=1 - HOUSE_TYPES[spec]['eave']), (215, 215, 215), out)))
        centre = tuple(sum(p[k] for p in vs + rear) / 8 for k in range(3))
        for a, b, c, d in ((vs[0], rear[0], rear[3], vs[3]), (rear[1], vs[1], vs[2], rear[2])):
            normal = norm(((a[0] + b[0]) / 2 - centre[0], 0, (a[2] + b[2]) / 2 - centre[2]))
            self.chunks.add('rail', i, quad([a, b, c, d], uv('bouw', 'brick'), (220, 210, 200), normal))
        self.chunks.add('land', i, quad([vs[3], vs[2], rear[2], rear[3]], uv('land', 'slate'), (205, 205, 215), (0, 1, 0)))

    def side_street(self, i, s):
        """A narrow street off the route between house fronts, closed by a house at its end."""
        t0, t1 = 0.32, 0.68
        self.skip.add((i, s))
        self.spans += [(i, s, 0.0, t0), (i, s, t1, 1.0)]
        self.gaps |= {(i, s, t0), (i, s, t1)}
        L = 200.0
        fw = self.fwd(i)
        inward = tuple(-s * x for x in self.right(i))
        Q = lambda t, off, y: self.p(i, t, s * off, y)
        WL = self.at(i, s)
        self.road_corridor.append([Q(t0, ROAD, 0)[::2], Q(t1, ROAD, 0)[::2], Q(t1, WL + L, 0)[::2], Q(t0, WL + L, 0)[::2]])
        self.chunks.add('road', i, quad([Q(t0, ROAD, 0), Q(t1, ROAD, 0), Q(t1, WL + L, 0), Q(t0, WL + L, 0)], uv('surface', 'road'), (215, 215, 215), (0, 1, 0)))
        rng = random.Random(i * 7 + s)
        for t, facing in ((t0, fw), (t1, tuple(-x for x in fw))):
            off = WL + DEPTH
            while off < WL + L - 20:
                step = min(70.0, WL + L - off)
                spec = rng.choice([k for k, t in enumerate(HOUSE_TYPES) if t['top'] == 'cornice'])
                eave = rng.choice((84, 94, 104))
                top = eave
                vs = [Q(t, off, 0), Q(t, off + step, 0), Q(t, off + step, top), Q(t, off, top)]
                self.side_house(i, vs, facing, spec)
                off += step
        spec = rng.choice([k for k, t in enumerate(HOUSE_TYPES) if t['top'] == 'cornice'])
        top = 100
        vs = [Q(t0, WL + L, 0), Q(t1, WL + L, 0), Q(t1, WL + L, top), Q(t0, WL + L, top)]
        self.side_house(i, vs, inward, spec)

    def bridge(self, first, last, solid_ends=False):
        """A stretch of road over water: no houses, water both sides below, a narrower deck."""
        for i in range(first, last + 1):
            i %= self.n
            self.bridges.add(i)
            # A visible underside and fascia keep bank-level views from seeing through the deck.
            deck = [self.p(i, 0, -DECK, -5), self.p(i, 1, -DECK, -5), self.p(i, 1, DECK, -5), self.p(i, 0, DECK, -5)]
            self.chunks.add('land', i, quad(deck, uv('land', 'deck'), (140, 135, 125), (0, -1, 0)))
            for s in (-1, 1):
                self.skip.add((i, s))
                g0 = self.p(i, 0, 0)[1]
                low = WATER_Y - g0
                P = lambda t, off, y, i=i, s=s: self.p(i, t, s * off, y)
                self.chunks.add('land', i, quad([P(0, DECK, -5), P(1, DECK, -5), P(1, DECK, 0), P(0, DECK, 0)], uv('land', 'deck'), (185, 180, 170), tuple(s * x for x in self.right(i))))
                # Water under the deck belongs to the connected canal mesh.
        # The bridge's ends: the corner from the deck's edge out to the quay or house line, closed,
        # or a car slips past the parapet's end down to the water and off its far edge.
        for i, t, facing in ((first % self.n, 0.0, -1), (last % self.n, 1.0, 1)):
            fw = tuple(facing * x for x in self.fwd(i))
            for s in (-1, 1):
                P = lambda off, y, i=i, s=s, t=t: self.p(i, t, s * off, y)
                g0 = self.p(i, t, 0)[1]
                if solid_ends:
                    # Solid retaining wings with a stone cap, matching the bridge
                    # rail height. The former two-sided 3 m panel had no top/edges.
                    P = lambda off, y, d: tuple(v + self.fwd(i)[k] * d for k, v in
                                                enumerate(self.p(i, t, s * off, y)))
                    a, b, lo, hi = DECK, WALK + 2, WATER_Y - g0, 18
                    wing = []
                    sides = []
                    # Split at road grade so the visible brickwork keeps ordinary
                    # courses, instead of stretching a few rows up the buried pier.
                    for y0, y1, material in ((lo, 0, 'stone'), (0, hi, 'brick')):
                        sides.extend((
                            ([P(a,y0,-2),P(b,y0,-2),P(b,y1,-2),P(a,y1,-2)],tuple(-v for v in self.fwd(i)),material),
                            ([P(b,y0,2),P(a,y0,2),P(a,y1,2),P(b,y1,2)],self.fwd(i),material),
                            ([P(a,y0,2),P(a,y0,-2),P(a,y1,-2),P(a,y1,2)],tuple(-s*v for v in self.right(i)),material),
                            ([P(b,y0,-2),P(b,y0,2),P(b,y1,2),P(b,y1,-2)],tuple(s*v for v in self.right(i)),material),
                        ))
                    for vs, normal, material in sides + [
                        ([P(a,hi,-2),P(b,hi,-2),P(b,hi,2),P(a,hi,2)],(0,1,0),'stone'),
                        ([P(a,lo,2),P(b,lo,2),P(b,lo,-2),P(a,lo,-2)],(0,-1,0),'brick'),
                    ]:
                        width = math.dist(vs[0],vs[1])
                        mapping = uv('bouw',material,0,min(1,width/75),0,.3 if material=='brick' else .7)
                        plane = quad(vs, mapping, (230,220,205), normal)
                        self.chunks.add('rail',i,plane)
                        wing.append(plane)
                    self.bridge_wings.append({'chunk':i,'side':s,'t':t,'faces':wing})
                    continue
                vs = [P(DECK, WATER_Y - g0), P(WALK + 2, WATER_Y - g0), P(WALK + 2, 30), P(DECK, 30)]
                for face in (fw, tuple(-x for x in fw)):
                    self.chunks.add('rail', i, quad(vs, uv('bouw', 'brick', 0, 0.3, 0, 0.5), (226, 214, 206), face))

    def parapets(self, i, rail):
        """Both edges of a bridge deck: a low brick parapet with a stone cap, a railing on it."""
        for s in (-1, 1):
            inward = tuple(-s * x for x in self.right(i))
            P = lambda t, off, y: self.p(i, t, s * off, y)
            self.chunks.add('rail', i, quad([P(0, DECK, 0), P(1, DECK, 0), P(1, DECK, 8), P(0, DECK, 8)], uv('bouw', 'brick', 0, 1, 0, 0.12), (230, 215, 205), inward))
            self.chunks.add('rail', i, quad([P(0, DECK, 8), P(1, DECK, 8), P(1, DECK + 6, 8), P(0, DECK + 6, 8)], uv('bouw', 'stone', 0, 1, 0, 0.1), (245, 245, 245), (0, 1, 0)))
            if rail:
                vs = [P(0, DECK, 0), P(1, DECK, 0), P(1, DECK, 18), P(0, DECK, 18)]
                self.chunks.add('rail', i, quad(vs, uv('bouw', rail), (255, 255, 255), inward))
                self.chunks.add('rail', i, quad(vs, uv('bouw', rail), (255, 255, 255), tuple(-x for x in inward)))

    def arched_bridge(self, first, last):
        """The hump on the dike as the brick bridge with three arches in the owner's photo: its
        faces from the water up to the road, both sides, and parapets."""
        self.arch_bridge_chunks.update(range(first, last + 1))
        self.bridge(first, last, solid_ends=True)
        span = last - first + 1
        for k, i in enumerate(range(first, last + 1)):
            i %= self.n
            for s in (-1, 1):
                outward = tuple(s * x for x in self.right(i))
                g0, g1 = self.p(i, 0, 0)[1], self.p(i, 1, 0)[1]
                a, b = self.p(i, 0, s * (DECK + 6)), self.p(i, 1, s * (DECK + 6))
                vs = [(a[0], WATER_Y - 4, a[2]), (b[0], WATER_Y - 4, b[2]), (b[0], g1, b[2]), (a[0], g0, a[2])]
                u0, u1 = (k / span, (k + 1) / span) if s > 0 else (1 - k / span, 1 - (k + 1) / span)
                self.chunks.add('rail', i, quad(vs, uv('bouw', 'arches', u0, u1), (255, 255, 255), outward))
            self.parapets(i, 'darkrail')

    def drawbridge(self, first, last):
        """The black steel drawbridge of the owner's photos, across the road: two tall posts, a
        boxed top beam with a white top, white cross-bracing above the cars, the balance arms on
        top, lanterns at the corners, dark railings along the deck."""
        self.bridge(first, last)
        for i in range(first, last + 1):
            self.parapets(i % self.n, 'darkrail')
        i = (first + last) // 2 % self.n
        f, r = self.fwd(i), self.right(i)
        o = self.p(i, 0.5, 0)
        X = DECK + 4
        P = lambda x, a, y: (o[0] + r[0] * x + f[0] * a, o[1] + y * 0.45, o[2] + r[2] * x + f[2] * a)
        steel, white = uv('bouw', 'steel'), uv('bouw', 'white')
        back, ahead = tuple(-c for c in f), f

        def box(x0, x1, a0, a1, y0, y1, top=None):
            for vs, facing in (
                ([P(x0, a0, y0), P(x1, a0, y0), P(x1, a0, y1), P(x0, a0, y1)], back),
                ([P(x0, a1, y0), P(x1, a1, y0), P(x1, a1, y1), P(x0, a1, y1)], ahead),
                ([P(x0, a0, y0), P(x0, a1, y0), P(x0, a1, y1), P(x0, a0, y1)], tuple(-c for c in r)),
                ([P(x1, a0, y0), P(x1, a1, y0), P(x1, a1, y1), P(x1, a0, y1)], r),
            ):
                self.chunks.add('rail', i, quad(vs, steel, (255, 255, 255), facing))
            self.chunks.add('rail', i, quad([P(x0, a0, y1), P(x1, a0, y1), P(x1, a1, y1), P(x0, a1, y1)], top or steel, (255, 255, 255), (0, 1, 0)))
            self.chunks.add('rail', i, quad([P(x0, a0, y0), P(x1, a0, y0), P(x1, a1, y0), P(x0, a1, y0)], steel, (190, 190, 190), (0, -1, 0)))

        for x in (-X - 8, X):
            box(x, x + 8, -4, 4, 0, 190)
        box(-X - 8, X + 8, -6, 6, 162, 182, white)
        # Cross-bracing between the posts, high above the cars.
        vs = [P(-X, 0, 108), P(X, 0, 108), P(X, 0, 162), P(-X, 0, 162)]
        self.chunks.add('rail', i, quad(vs, uv('bouw', 'bracing'), (255, 255, 255), back))
        self.chunks.add('rail', i, quad(vs, uv('bouw', 'bracing'), (255, 255, 255), ahead))
        # Balance arms: from the top of the posts back over the road, rising.
        for x in (-X - 6, X + 2):
            vs = [P(x, -40, 196), P(x + 4, -40, 196), P(x + 4, 150, 214), P(x, 150, 214)]
            self.chunks.add('rail', i, quad(vs, steel, (255, 255, 255), (0, 1, 0)))
            vs = [P(x + 2, -40, 186), P(x + 2, 150, 204), P(x + 2, 150, 216), P(x + 2, -40, 198)]
            self.chunks.add('rail', i, quad(vs, steel, (255, 255, 255), r))
            self.chunks.add('rail', i, quad(vs, steel, (255, 255, 255), tuple(-c for c in r)))
        for k in (first, last):
            for s in (-1, 1):
                self.sprite(k % self.n, 0.5 if k == first else 0.6, s * (DECK + 12), 7, 55, 'lamp')


class Streets:
    """Distance from points to OSM streets, and their directions; metres."""

    def __init__(self, nodes, ways):
        kinds = {'residential', 'unclassified', 'living_street', 'pedestrian', 'tertiary', 'service'}
        self.segs = []
        for w in ways:
            if w.get('tags', {}).get('highway') not in kinds:
                continue
            ns = [nodes[k] for k in w['nodes'] if k in nodes]
            self.segs += list(zip(ns, ns[1:]))
            self.named = getattr(self, 'named', [])
            self.named += [(a, b, w['tags'].get('name')) for a, b in zip(ns, ns[1:]) if w['tags'].get('name')]

    def nearest(self, pt):
        best = (1e9, None)
        for a, b in self.segs:
            dx, dz = b[0] - a[0], b[1] - a[1]
            L = dx * dx + dz * dz
            if L == 0:
                continue
            t = max(0, min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dz) / L))
            d = math.hypot(pt[0] - a[0] - t * dx, pt[1] - a[1] - t * dz)
            if d < best[0]:
                best = (d, (dx / math.sqrt(L), dz / math.sqrt(L)))
        return best


def street_name(streets, pt):
    """The name of the nearest named street to pt (metres), and how far it is."""
    best = (1e9, None)
    for a, b, name in streets.named:
        dx, dz = b[0] - a[0], b[1] - a[1]
        L = dx * dx + dz * dz
        if L == 0:
            continue
        t = max(0, min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dz) / L))
        d = math.hypot(pt[0] - a[0] - t * dx, pt[1] - a[1] - t * dz)
        if d < best[0]:
            best = (d, name)
    return best


def side_streets(town, streets, water):
    """Chunk sides where a real street leaves the route at about a right angle."""
    found = []
    for i in range(town.n):
        for s in (-1, 1):
            if (i, s) in town.skip or i in town.bridges or (i, s) in water:
                continue
            probe = town.p(i, 0.5, s * (WALK + 300))
            d, direction = streets.nearest((probe[0] / UNITS, probe[2] / UNITS))
            r = town.right(i)
            if d < 7 and direction and abs(direction[0] * r[0] + direction[1] * r[2]) > 0.8:
                if all(abs(i - j) > 4 or s != t for j, t in found):
                    found.append((i, s))
    return found


def backdrop_profile(footprint, tags, default_height):
    """Prefer OSM height/levels; distinguish small ancillary footprints from houses."""
    def number(key):
        try:
            value = float(str(tags.get(key, '')).strip().removesuffix('m').strip())
            return value if 0 < value < 100 else None
        except ValueError:
            return None
    rectangle = list(footprint.minimum_rotated_rectangle.exterior.coords)
    width = min(math.dist(a, b) for a, b in zip(rectangle, rectangle[1:]))
    category = tags.get('building', 'yes')
    ancillary = category in ('garage', 'garages', 'shed', 'service', 'outbuilding', 'hut')
    tagged_height, levels = number('height'), number('building:levels')
    utility = ancillary or (category == 'yes' and not tagged_height and not levels
                            and (footprint.area < 4000 or width < 25))
    height = tagged_height * UNITS if tagged_height else levels * 30 if levels else (
        28 if ancillary else 24 if utility else default_height)
    # A multi-storey garage explicitly tagged as such is not a low shed.
    utility = utility and height <= 40
    return utility, height, width


def building_fronts(town, nodes, ways, limit=100):
    """Closed, roofed buildings on OSM footprints behind the street rows.

    The old backdrop was a set of one-sided gable billboards: from the bridge you could see
    floating fronts and straight through their roofs. Complete low-detail volumes cost fewer
    facade planes and work from both sides of the canal. Foreground houses get their slots first.
    """
    def nearest(pt):
        return min((math.dist(pt, c), i) for i, c in enumerate(town.c))
    candidates = []
    for w in ways:
        if 'building' not in w.get('tags', {}):
            continue
        poly = [(nodes[k][0] * UNITS, nodes[k][1] * UNITS) for k in w['nodes'] if k in nodes]
        if len(poly) > 1 and poly[0] == poly[-1]:
            poly.pop()
        # A centre-fan roof needs a convex footprint. Leave complex courtyards out rather than
        # inventing a roof across their open space.
        if not 3 <= len(poly) <= 8:
            continue
        turns = [(poly[(j + 1) % len(poly)][0] - p[0]) * (poly[(j + 2) % len(poly)][1] - poly[(j + 1) % len(poly)][1])
                 - (poly[(j + 1) % len(poly)][1] - p[1]) * (poly[(j + 2) % len(poly)][0] - poly[(j + 1) % len(poly)][0]) for j, p in enumerate(poly)]
        if min(turns) < -1 and max(turns) > 1:
            continue
        dists = [nearest(p) for p in poly]
        closest, ci = min(dists)
        if closest < max(town.at(ci, -1), town.at(ci, 1)) + DEPTH + 40 or closest > 1300:
            continue
        candidates.append((closest, w['id'], ci, poly, w['tags']))
    rng = random.Random(1355)
    placed = 0
    town.backdrop_buildings = []
    for _, osm_id, ci, poly, tags in sorted(candidates):
        if placed >= limit:
            break
        footprint = Polygon(poly)
        if footprint.intersection(town.water_shape).area > footprint.area * 0.05:
            continue  # the rounded game canal must not leave an OSM house floating over water
        edges = list(zip(poly, poly[1:] + poly[:1]))
        faces = sum(max(1, round(math.dist(a, b) / 75)) for a, b in edges)
        utility, _, _ = backdrop_profile(footprint, tags, 90)
        wall_pass = 'land' if utility else 'extra'
        roof_faces = 1 if utility and len(poly) == 4 else len(edges)
        # Keep room for water-facing backs and street furniture added afterwards.
        if (town.chunks.room(wall_pass, ci) < faces + (roof_faces if utility else 0) + 32
                or town.chunks.room('land', ci) < roof_faces + 32):
            continue
        kind = rng.choice((1, 2, 4, 5, 6))  # solid cornice fronts, roof is actual geometry
        spec = HOUSE_TYPES[kind]
        utility, height, span = backdrop_profile(footprint, tags, (spec['floors'] + 1) * 30 + rng.choice((0, 5, 10)))
        g = 0.0  # OSM background houses stand on town terrain, not the nearest elevated bridge.
        cx = sum(p[0] for p in poly) / len(poly)
        cz = sum(p[1] for p in poly) / len(poly)
        peak = (cx, g + height + (0 if utility else min(32, span * 0.35)), cz)
        roof = uv_tri('land', 'slate' if rng.random() < 0.8 else 'tiles')
        # Put one entrance on a short end, toward the nearest street. Other walls
        # remain plain masonry, instead of repeating shop doors around a shed.
        short = min(math.dist(a, b) for a, b in edges)
        door = min((j for j, (a, b) in enumerate(edges) if math.dist(a, b) <= short * 1.3),
                   key=lambda j: nearest(tuple((a + b) / 2 for a, b in zip(*edges[j])))[0])
        emitted = []
        def emit(kind, plane):
            town.chunks.add(kind, ci, plane)
            emitted.append(plane)
        for j, (a, b) in enumerate(edges):
            L = math.dist(a, b)
            if L < 0.01:
                continue
            normal = norm(((a[0] + b[0]) / 2 - cx, 0, (a[1] + b[1]) / 2 - cz))
            n = max(1, round(L / 75))
            for k in range(n):
                p0 = (a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n)
                p1 = (a[0] + (b[0] - a[0]) * (k + 1) / n, a[1] + (b[1] - a[1]) * (k + 1) / n)
                vs = [(p0[0], g, p0[1]), (p1[0], g, p1[1]), (p1[0], g + height, p1[1]), (p0[0], g + height, p0[1])]
                if utility:
                    material = ('garage_door' if tags.get('building') in ('garage', 'garages') else 'shed_door') if j == door else 'utility_brick'
                    emit('land', quad(vs, wall_uv('land', material, vs, normal), (235, 235, 230), normal))
                else:
                    emit('extra', quad(vs, wall_uv('gevel', FACADES[kind], vs, normal, v0=1 - spec['eave']), (225, 225, 220), normal))
            if not utility or len(poly) != 4:
                emit('land', closed_tri((a[0], g + height, a[1]), (b[0], g + height, b[1]), peak, roof, (215, 215, 218), (0, 1, 0) if utility else norm((normal[0], 1.5, normal[2]))))
        if utility and len(poly) == 4:
            emit('land', quad([(x, g + height, z) for x, z in poly], uv('land', 'utility_roof'), (230, 230, 230), (0, 1, 0)))
        town.backdrop_buildings.append({'osmId': osm_id, 'chunk': ci, 'footprint': poly,
            'building': tags.get('building'), 'utility': utility, 'height': height, 'faces': emitted})
        placed += 1
    return placed


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
    # Humps: a steep rise to a crest and a sharp drop after it, so a fast car takes off.
    for at, height in HUMPS:
        k = town.near(at)
        for d, f in ((-2, 0.35), (-1, 0.75), (0, 1.0), (1, 0.15)):
            town.ground[(k + d) % n] += height * f
        print('hump at chunk', k, 'height', height)
    nodes, ways = load_osm(os.path.join(SRC, 'osm.json'))
    water = [[nodes[k] for k in w['nodes'] if k in nodes] for w in ways if w.get('tags', {}).get('natural') == 'water']
    # The gate on the straight just before the bend: the passage is a straight box.
    turn = lambda i: abs(math.atan2(town.fr[(i + 1) % n][0][1], town.fr[(i + 1) % n][0][0]) - math.atan2(town.fr[i - 1][0][1], town.fr[i - 1][0][0]))
    poort = min(range(poort - 6, poort + 1), key=lambda i: (turn(i % n) > 0.05, -i)) % n
    print('lekpoort on chunk', poort, 'turn', round(math.degrees(turn(poort)), 1))
    town.skip.update({(poort, -1), (poort, 1)})
    hump = town.near(HUMPS[0][0])
    town.arched_bridge(hump - 2, hump + 1)
    nodes, ways = load_osm(os.path.join(SRC, 'osm.json'))
    water = [[nodes[k] for k in w['nodes'] if k in nodes] for w in ways if w.get('tags', {}).get('natural') == 'water']
    sides = town.find_water(water)
    print('water sides', len(sides))
    east = [i for i, s in sorted(sides) if s == -1 and centre[i][0] > 1800 and abs(centre[i][1]) < 1200 and abs(i - hump) > 6]
    if east:
        mid = east[len(east) // 2]
        town.drawbridge(mid - 1, mid + 1)
        print('drawbridge on chunks', mid - 1, mid + 1)
    # The Voorstraat, from past the Grote Kerk to before the Lekpoort: the houses stand far back
    # (about 34 m front to front, as in the town) behind a wide square.
    voorstraat = [k % n for k in range(kerk + 4, poort - 1 + (n if poort < kerk else 0))]
    for k in voorstraat:
        for s_ in (-1, 1):
            if (k, s_) not in sides and k not in town.bridges:
                town.line[(k, s_)] = VOOR
    print('voorstraat chunks', voorstraat[0], '..', voorstraat[-1])
    town.street()
    town.stadhuis(st, town.side(st, STADHUIS))
    # Put the church outside the returning corner, opposite its OSM side, so the tower
    # and nave are visible ahead as the player turns into the Voorstraat.
    kerk_side = -town.side(kerk, GROTE_KERK)
    town.grote_kerk((kerk + 2) % n, kerk_side)
    town.lekpoort(poort)
    town.water_sides(sides)
    town.jody_billboard()
    # (chunk, side) near water on that side: the houses there show their backs across it.
    town.near_water = {((c + d) % n, s_) for c, s_ in sides for d in range(-8, 9)}
    town.water_points = [town.p(c, 0.5, s_ * (WALK + 250))[::2] for c, s_ in sides]
    streets = Streets(nodes, ways)
    # Street names: the route's own per chunk, and each side street's.
    route_names = [street_name(streets, (c[0] / UNITS, c[1] / UNITS)) for c in centre]
    branches = side_streets(town, streets, sides)
    for i, s_ in branches:
        town.side_street(i, s_)
    print('side streets', len(branches), branches)
    town.market(st - 7, st - 1)
    town.market(st + 2, poort - 3)
    town.lamps()
    town.houses()
    # Street name signs: where the route enters a street (both sides), and at each side street's
    # corner its own name. The commonest names get the eight slots.
    wanted = []
    for i in range(n):
        d, name = route_names[i]
        if d < 12 and name and (i == 0 or route_names[i - 1][1] != name):
            for s_ in (-1, 1):
                if (i, s_) not in town.skip:
                    wanted.append((i, 0.3, s_, name))
    for i, s_ in branches:
        pr = town.p(i, 0.5, s_ * (town.at(i, s_) + 120))
        d, name = street_name(streets, (pr[0] / UNITS, pr[2] / UNITS))
        if d < 12 and name:
            wanted.append((i, 0.2, s_, name))
    from collections import Counter
    STREET_NAMES[:] = [nm for nm, _ in Counter(w[3] for w in wanted).most_common(8)]
    placed = 0
    for i, t, s_, name in wanted:
        if name in STREET_NAMES:
            town.sign(i, t, s_, STREET_NAMES.index(name))
            placed += 1
    print('street signs', placed, STREET_NAMES)
    # Last: what has no room left is furniture, never a wall or a roof.
    town.square(voorstraat)
    for kind, c, plane in town.later:
        town.chunks.add(kind, c, plane)
    town.bikes()
    town.fun_props()
    town.road_dashes()
    for kind, c, plane in town.shells:
        town.chunks.add(kind, c, plane)
    connected_terrain(town, water, sides, quad, tri, uv)
    # Complete backdrop buildings use only the space left after the street and its furniture.
    print('roofed buildings behind the rows', building_fronts(town, nodes, ways))
    town.finish_roofs()
    reserved = {id(slot) for slot in town.scenery_slots}
    for chunk in town.chunks.lists:
        for kind in LIMITS:
            chunk[kind][:] = [plane for plane in chunk[kind] if id(plane) not in reserved]
    print('Jody Bernal signs on', town.signs)
    if town.chunks.dropped:
        raise RuntimeError(f'Geometry exceeded the chunk budget: {town.chunks.lost_at}')

    chunks = [[c[k] for k in ('road', 'land', 'extra', 'rail')] for c in town.chunks.lists]
    if os.environ.get('VIANEN_BRIDGE_ENDS'):
        refs = {id(plane): [ci, pi, vi] for ci, chunk in enumerate(chunks)
                for pi, planes in enumerate(chunk) for vi, plane in enumerate(planes)}
        groups = {'wings': town.bridge_wings, 'houses': town.bridge_house_ends}
        json.dump({kind: [{**b, 'faces': [refs[id(p)] for p in b['faces']]} for b in values]
                   for kind, values in groups.items()}, open(os.environ['VIANEN_BRIDGE_ENDS'], 'w'))
    if os.environ.get('VIANEN_BUILDINGS'):
        refs = {id(plane): [ci, pi, vi] for ci, chunk in enumerate(chunks)
                for pi, planes in enumerate(chunk) for vi, plane in enumerate(planes)}
        json.dump([{**b, 'faces': [refs[id(p)] for p in b['faces']]} for b in town.backdrop_buildings],
                  open(os.environ['VIANEN_BUILDINGS'], 'w'))
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
    # Type 22 is the game's fragile lightweight prop: 10 kg, low rebound, hit particles.
    # These have independent convex physics bodies and remain fallen after an impact.
    for chunk, position in town.bollards:
        objs.append(obj(chunk, 22, position, 0, 'VN_PAAL_ANIM'))
    # Native road-sign behaviour: 50 kg, low rebound and a pole-impact sound.
    for chunk, position in town.lanterns:
        objs.append(obj(chunk, 3, position, 0, 'VN_LAMP_ANIM'))
    for chunk, position, yaw in town.parked_bikes:
        objs.append(obj(chunk, 22, position, yaw, 'VN_BIKE_ANIM'))
    for chunk, kind, position, yaw, name in town.smashables:
        objs.append(obj(chunk,kind,position,yaw,name))
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
    build_bollard_mesh()
    build_lantern_mesh()
    build_bike_mesh()
    build_fun_meshes()
    from runpy import run_path
    run_path(os.path.join(HERE, 'build-impact-sounds.py'))['build']()
    build_loading()
    write_attribution()
    if os.environ.get('VIANEN_VIEWS'):
        # For tools/vianen/shots.mjs --views: a camera on each landmark, from the street.
        ss, ks = town.side(st, STADHUIS), kerk_side
        ki = (kerk + 2) % n
        V = lambda name, chunk, eye, at: {'name': name, 'chunk': chunk % n, 'eye': list(eye), 'at': list(at)}
        views = [
            V('stadhuis', st - 2, town.p(st - 1, 0.3, -ss * 60, 40), town.p(st, 0.5, ss * (town.at(st, ss) + 40), 150)),
            V('lekpoort', poort - 3, town.p(poort - 2, 0.2, 0, 35), town.p(poort, 0.6, 0, 170)),
            V('kerktoren', ki - 4, town.p(ki - 4, 0.5, -ks * 20, 40), town.p(ki - 1, 0.6, ks * (WALK + 110), 380)),
            V('kerk', ki - 3, town.p(ki - 1, 0.0, -ks * 40, 40), town.p(ki, 0.3, ks * (WALK + 110), 220)),
        ]
        # All six windows, including both street sides, for checking portrait UVs and scale.
        views.extend(town.ad_views)
        views.extend([town.billboard_view, town.billboard_reverse_view])
        json.dump(sorted(views, key=lambda v: v['chunk']), open(os.environ['VIANEN_VIEWS'], 'w'))
    if os.environ.get('VIANEN_SIDES'):
        # For checks: each side street's chunk, side, and points at its mouth and near its end.
        json.dump([[i, s_, town.p(i, 0.5, s_ * ROAD), town.p(i, 0.5, s_ * (WALK + 170)), town.p(i, 0.5, s_ * (WALK + 45)), town.p(i, 0.1, s_ * (WALK + 45)), town.p(i, 0.9, s_ * (WALK + 45))] for i, s_ in branches], open(os.environ['VIANEN_SIDES'], 'w'))
    json.dump({'chunks': n, 'start': START, 'lengthMetres': round(n * CHUNK / UNITS), 'planes': total,
               'posters': len(town.signs), 'billboards': 1, 'movableBollards': len(town.bollards),
               'movableLanterns': len(town.lanterns),
               'movableBikes': len(town.parked_bikes),
               'smashableProps': dict(Counter(p[4] for p in town.smashables)),
               'backdropBuildings': len(town.backdrop_buildings),
               'utilityBuildings': sum(b['utility'] for b in town.backdrop_buildings),
               'roofDetails': town.roof_counts}, open(os.path.join(OUT, 'vianen.json'), 'w'))
    full = {k: sum(1 for c in town.chunks.lists if len(c[k]) == LIMITS[k]) for k in LIMITS}
    print('planes', total, 'objects', len(objs), 'length m', round(n * CHUNK / UNITS), 'full lists', full)


def write_attribution():
    lines = [
        '# Vianen etappe: sources',
        '',
        'Streets and building positions: © OpenStreetMap contributors, ODbL 1.0, <https://www.openstreetmap.org/copyright>.',
        '',
        'The Lekpoort, the Stadhuis, the Grote Kerk, the bridge arches and four Voorstraat house fronts are cut and straightened from photos of Vianen taken by the repository owner, Roland Meertens, in November 2026 (`source/assets/vianen/own/`).',
        '',
        'The wait screen `../loading/e10.png` is cut from [Lekpoort - Vianen - Utrecht - (Bewerkt).jpg](https://commons.wikimedia.org/wiki/File:Lekpoort_-_Vianen_-_Utrecht_-_(Bewerkt).jpg), Frans Berkelaar, CC BY 2.0, on Wikimedia Commons.',
        '',
        'Twelve house fronts are drawn by `tools/vianen/facades.py`, with proportions and materials informed by the owner\'s photos. Seamless paving, grass and water are generated by `tools/vianen/surfaces.py`. Brickwork, roof tiles, slate, stone, plaster, trees and street furniture are drawn by `tools/vianen/build-track.py`. Dormer windows are rectified from the owner\'s photo 1439, with closed dormer and chimney geometry informed by photos 1439 and 1446.',
        '',
        'Jody Bernal poster: artwork generated with the built-in image generation tool using [Kees Spiero\'s 12 April 2001 portrait](https://commons.wikimedia.org/wiki/File:2001_Portret_Jody_Bernal,_zanger_van_de_hit_Que_si_Que_no_(1).jpg), Stadsarchief Delft, [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). Background replaced, portrait reframed and typography added. Source portrait, finished artwork and generation prompt: `source/assets/vianen/posters/`.',
        '',
        'The cardboard cartons, slatted wooden crates, traffic cones and market chalkboards are original procedural models and materials drawn by `tools/vianen/build-track.py` (`vn_fun.tga`). Their market lettering is fictional scenery.',
        '',
        'The four material impact sounds (`vn_card.wav`, `vn_wood.wav`, `vn_rubber.wav`, `vn_metal.wav`) are original procedural audio generated by `tools/vianen/build-impact-sounds.py`.',
        '',
        'Low garage/storage volumes use OpenStreetMap footprints and building classifications, with original procedural brick, door and bitumen-roof materials. Recorded height/levels are used when present; untagged small ancillary buildings use approximate single-storey heights.',
    ]
    open(os.path.join(OUT, 'ATTRIBUTION.md'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')


if __name__ == '__main__':
    build()
