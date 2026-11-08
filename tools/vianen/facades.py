"""Dutch town-house fronts for Vianen, drawn: walls, sash windows, shutters, doors, shop fronts and
the gable's outline against the key colour (255, 0, 127), which the game draws see-through.

The palette and the details follow the repository owner's photos of Vianen (source/assets/vianen/own/
and the originals): red-brown and dark brick, white and cream plaster, white-framed sash windows,
the Stadhuis's red and white shutters, black shop fronts, charcoal glazed roof tiles, and stepped,
spout and bell gables like those along Voorstraat and by the Lekpoort.
"""
import math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

KEY = (255, 0, 127)
BRICK = (152, 86, 64)
DARK_BRICK = (112, 66, 50)
PLASTER = (238, 234, 224)
CREAM = (228, 202, 156)
GREY = (196, 192, 184)
TRIM = (246, 244, 238)
GLASS = (44, 54, 66)
SHUTTER_RED = (176, 34, 38)
SHUTTER_GREEN = (40, 84, 58)
DOOR = [(36, 70, 52), (60, 32, 28), (34, 40, 60), (20, 22, 24)]

# Each house type: wall, gable, floors, windows per floor, shutters, ground floor, eave as a share
# of the height (the rest is gable).
TYPES = [
    {'wall': BRICK, 'brick': True, 'top': 'step', 'floors': 3, 'cols': 2, 'shutters': None, 'ground': 'door', 'eave': 0.68},
    {'wall': PLASTER, 'brick': False, 'top': 'cornice', 'floors': 3, 'cols': 3, 'shutters': None, 'ground': 'shop', 'eave': 0.94},
    {'wall': CREAM, 'brick': False, 'top': 'cornice', 'floors': 2, 'cols': 3, 'shutters': SHUTTER_GREEN, 'ground': 'door', 'eave': 0.94},
    {'wall': DARK_BRICK, 'brick': True, 'top': 'bell', 'floors': 2, 'cols': 2, 'shutters': None, 'ground': 'shop', 'eave': 0.66},
    {'wall': PLASTER, 'brick': False, 'top': 'spout', 'floors': 2, 'cols': 2, 'shutters': SHUTTER_RED, 'ground': 'door', 'eave': 0.64},
    {'wall': BRICK, 'brick': True, 'top': 'cornice', 'floors': 3, 'cols': 3, 'shutters': SHUTTER_RED, 'ground': 'door', 'eave': 0.94},
    {'wall': GREY, 'brick': False, 'top': 'step', 'floors': 2, 'cols': 2, 'shutters': None, 'ground': 'shop', 'eave': 0.66},
    {'wall': BRICK, 'brick': True, 'top': 'neck', 'floors': 3, 'cols': 2, 'shutters': SHUTTER_GREEN, 'ground': 'door', 'eave': 0.70},
]


def jitter(c, rng, k=10):
    return tuple(max(0, min(255, v + rng.randint(-k, k))) for v in c)


def wall_texture(w, h, colour, brick, seed):
    rng = random.Random(seed)
    im = Image.new('RGB', (w, h), colour)
    if brick:
        d = ImageDraw.Draw(im)
        mortar = tuple(min(255, int(v * 0.55 + 100)) for v in colour)
        rh = 7
        for r in range(h // rh + 1):
            y = r * rh
            d.line((0, y, w, y), fill=mortar)
            off = 0 if r % 2 else 9
            for x in range(off, w, 18):
                d.line((x, y, x, y + rh), fill=mortar)
            for x in range(off, w, 18):
                d.rectangle((x + 1, y + 1, x + 17, y + rh - 1), fill=jitter(colour, rng, 12))
    a = np.asarray(im).astype(float)
    a += np.random.default_rng(seed).normal(0, 4, (h, w, 1))
    # Weathering: a little darker toward the bottom.
    a *= np.linspace(1.02, 0.9, h)[:, None, None]
    return Image.fromarray(np.clip(a, 0, 254).astype(np.uint8))


def sash_window(d, x0, y0, x1, y1, shutters=None):
    """A white-framed sash window, small panes, a sill; shutters either side if given."""
    w = x1 - x0
    if shutters:
        sw = w * 0.42
        for sx0 in (x0 - sw - 2, x1 + 2):
            d.rectangle((sx0, y0, sx0 + sw, y1), fill=shutters)
            if shutters == SHUTTER_RED:
                # The Stadhuis's flames: white diagonals on red.
                d.polygon([(sx0, y0), (sx0 + sw, (y0 + y1) / 2), (sx0, y1)], fill=TRIM)
            d.rectangle((sx0, y0, sx0 + sw, y1), outline=tuple(int(v * 0.6) for v in shutters), width=1)
    d.rectangle((x0 - 3, y0 - 3, x1 + 3, y1 + 3), fill=TRIM)
    d.rectangle((x0, y0, x1, y1), fill=GLASS)
    # Sky reflection in the upper panes.
    d.rectangle((x0 + 1, y0 + 1, x1 - 1, y0 + (y1 - y0) * 0.35), fill=(86, 100, 118))
    mid = (y0 + y1) / 2
    d.rectangle((x0, mid - 2, x1, mid + 2), fill=TRIM)
    for k in (1, 2):
        x = x0 + w * k / 3
        d.line((x, y0, x, y1), fill=TRIM, width=2)
    d.line((x0, (y0 + mid) / 2, x1, (y0 + mid) / 2), fill=TRIM, width=1)
    d.line((x0, (mid + y1) / 2, x1, (mid + y1) / 2), fill=TRIM, width=1)
    d.rectangle((x0 - 6, y1 + 3, x1 + 6, y1 + 8), fill=(220, 216, 206))


def outline(top, w, h, eave_y):
    """The silhouette above the eave line as a polygon in pixels (the facade below is solid)."""
    if top == 'cornice':
        return [(0, eave_y), (w, eave_y), (w, eave_y - 10), (0, eave_y - 10)] if eave_y > 10 else None
    if top == 'step':
        steps = 4
        pts = [(0, eave_y)]
        for k in range(steps):
            x = w * 0.5 * k / steps
            y = eave_y - (eave_y - 6) * (k + 1) / steps
            pts += [(x + 6, pts[-1][1]), (x + 6, y)]
        top_y = pts[-1][1]
        pts += [(w - pts[-1][0], top_y)]
        left = pts[1:-1]
        right = [(w - x, y) for x, y in reversed(left)]
        return [(0, eave_y)] + left + right + [(w, eave_y)]
    if top == 'spout':
        return [(0, eave_y), (w * 0.5 - 14, 6), (w * 0.5 + 14, 6), (w, eave_y)]
    if top in ('bell', 'neck'):
        pts = [(0, eave_y)]
        for k in range(21):
            t = k / 20
            x = w * (0.08 + 0.34 * t)
            if top == 'bell':
                y = eave_y - (eave_y - 8) * math.sin(t * math.pi / 2) ** 0.7
            else:
                y = eave_y - (eave_y - 8) * (t if t < 0.6 else 0.6 + (t - 0.6) * 1.0)
            pts.append((x, y))
        right = [(w - x, y) for x, y in reversed(pts[1:])]
        return pts + [(w * 0.5, 8)] + right + [(w, eave_y)]
    return None


def facade(spec, w=256, h=512, seed=0):
    rng = random.Random(seed)
    eave_y = int(h * (1 - spec['eave']))
    wall = wall_texture(w, h, spec['wall'], spec['brick'], seed)
    im = Image.new('RGB', (w, h), KEY)
    mask = Image.new('L', (w, h), 0)
    md = ImageDraw.Draw(mask)
    md.rectangle((0, eave_y, w, h), fill=255)
    poly = outline(spec['top'], w, h, eave_y)
    if poly:
        md.polygon(poly, fill=255)
    im.paste(wall, (0, 0), mask)
    d = ImageDraw.Draw(im)
    # Gable trim: the coping along the outline, a small round window in a tall gable.
    if poly and spec['top'] != 'cornice':
        d.line(poly[1:-1], fill=TRIM if not spec['brick'] else (210, 200, 186), width=4)
        if eave_y > 80:
            cx, cy = w / 2, eave_y * 0.62
            d.ellipse((cx - 16, cy - 16, cx + 16, cy + 16), fill=TRIM)
            d.ellipse((cx - 11, cy - 11, cx + 11, cy + 11), fill=GLASS)
    else:
        d.rectangle((0, eave_y - 10, w, eave_y + 4), fill=TRIM)
        d.rectangle((0, eave_y + 4, w, eave_y + 8), fill=tuple(int(v * 0.8) for v in TRIM))
    # Floors.
    ground_h = (h - eave_y) * 0.30
    upper = (h - eave_y) - ground_h
    floor_h = upper / spec['floors']
    cols = spec['cols']
    margin = w * (0.17 if spec['shutters'] else 0.12)
    span = (w - 2 * margin) / cols
    for f in range(spec['floors']):
        y0 = eave_y + 14 + f * floor_h + floor_h * 0.14
        y1 = y0 + floor_h * 0.62
        for c in range(cols):
            cx = margin + span * (c + 0.5)
            ww = span * (0.42 if spec['shutters'] else 0.55)
            sash_window(d, cx - ww / 2, y0, cx + ww / 2, y1, spec['shutters'])
        # A string course under each floor on brick houses.
        if spec['brick']:
            d.rectangle((0, y1 + floor_h * 0.22, w, y1 + floor_h * 0.22 + 3), fill=(206, 196, 180))
    gy = h - ground_h
    if spec['ground'] == 'shop':
        d.rectangle((6, gy + 4, w - 6, h - 6), fill=(24, 26, 28))
        d.rectangle((14, gy + 30, w * 0.66, h - 14), fill=(70, 88, 104))
        d.rectangle((14, gy + 30, w * 0.66, gy + 60), fill=(120, 140, 156))
        d.rectangle((w * 0.72, gy + 26, w - 14, h - 6), fill=rng.choice(DOOR))
        d.rectangle((10, gy + 8, w - 10, gy + 22), fill=jitter((200, 170, 60), rng, 30))
    else:
        dx = rng.choice((0.2, 0.5, 0.8)) * w
        dw = w * 0.2
        d.rectangle((dx - dw / 2 - 5, gy + 6, dx + dw / 2 + 5, h), fill=TRIM)
        d.rectangle((dx - dw / 2, gy + 14, dx + dw / 2, h), fill=rng.choice(DOOR))
        d.rectangle((dx - dw / 2 + 6, gy + 18, dx + dw / 2 - 6, gy + 40), fill=GLASS)
        for wx in (w * 0.2, w * 0.5, w * 0.8):
            if abs(wx - dx) > w * 0.2:
                sash_window(d, wx - w * 0.1, gy + 26, wx + w * 0.1, h - 24)
    # Plinth.
    d.rectangle((0, h - 8, w, h), fill=(90, 86, 82))
    return im


def facade_atlas(size=(1024, 1024)):
    """Eight houses, 256 x 512 each, four by two."""
    atlas = Image.new('RGB', size, KEY)
    for k, spec in enumerate(TYPES):
        atlas.paste(facade(spec, 256, 512, seed=100 + k), ((k % 4) * 256, (k // 4) * 512))
    return atlas
