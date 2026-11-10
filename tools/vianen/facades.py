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
BRICK = (133, 87, 69)
DARK_BRICK = (100, 72, 61)
PLASTER = (238, 234, 224)
CREAM = (228, 202, 156)
GREY = (196, 192, 184)
TRIM = (246, 244, 238)
GLASS = (44, 54, 66)
SHUTTER_RED = (176, 34, 38)
SHUTTER_GREEN = (40, 84, 58)
DOOR = [(36, 70, 52), (60, 32, 28), (34, 40, 60), (20, 22, 24)]

# Each house type: wall, gable, upper floors, windows per floor, shutters, ground floor, eave as a share
# of the height (the rest is gable).
TYPES = [
    {'wall': BRICK, 'brick': True, 'top': 'step', 'floors': 2, 'cols': 2, 'shutters': None, 'ground': 'door', 'eave': 0.76},
    {'wall': PLASTER, 'brick': False, 'top': 'cornice', 'floors': 2, 'cols': 3, 'shutters': None, 'ground': 'shop', 'eave': 0.98},
    {'wall': (222, 211, 189), 'brick': False, 'top': 'cornice', 'floors': 1, 'cols': 3, 'shutters': SHUTTER_GREEN, 'ground': 'door', 'eave': 0.98},
    {'wall': DARK_BRICK, 'brick': True, 'top': 'spout', 'floors': 1, 'cols': 2, 'shutters': None, 'ground': 'shop', 'eave': 0.74},
    {'wall': PLASTER, 'brick': False, 'top': 'cornice', 'floors': 1, 'cols': 2, 'shutters': None, 'ground': 'door', 'eave': 0.98},
    {'wall': (145, 94, 76), 'brick': True, 'top': 'cornice', 'floors': 2, 'cols': 3, 'shutters': None, 'ground': 'door', 'eave': 0.98},
    {'wall': DARK_BRICK, 'brick': True, 'top': 'cornice', 'floors': 1, 'cols': 3, 'shutters': None, 'ground': 'shop', 'eave': 0.98},
    {'wall': BRICK, 'brick': True, 'top': 'bell', 'floors': 2, 'cols': 2, 'shutters': None, 'ground': 'door', 'eave': 0.76},
    {'wall': (206, 198, 181), 'brick': False, 'top': 'cornice', 'floors': 2, 'cols': 3, 'shutters': None, 'ground': 'door', 'eave': 0.98, 'rusticated': True},
    {'wall': (108, 78, 65), 'brick': True, 'top': 'cornice', 'floors': 2, 'cols': 2, 'shutters': None, 'ground': 'shop', 'eave': 0.98},
    {'wall': (227, 220, 202), 'brick': False, 'top': 'cornice', 'floors': 1, 'cols': 3, 'shutters': None, 'ground': 'shop', 'eave': 0.98},
    {'wall': (141, 103, 81), 'brick': True, 'top': 'spout', 'floors': 1, 'cols': 2, 'shutters': SHUTTER_GREEN, 'ground': 'door', 'eave': 0.80},
    # Actual Voorstraat fronts, rectified by build-track.py after drawing the atlas.
    {'wall': PLASTER, 'brick': False, 'top': 'cornice', 'floors': 1, 'cols': 2, 'shutters': SHUTTER_GREEN, 'ground': 'door', 'eave': 0.98, 'photo': 'front_white'},
    {'wall': (230, 215, 185), 'brick': False, 'top': 'cornice', 'floors': 1, 'cols': 2, 'shutters': None, 'ground': 'door', 'eave': 0.98, 'photo': 'front_cream'},
    {'wall': PLASTER, 'brick': False, 'top': 'cornice', 'floors': 2, 'cols': 2, 'shutters': None, 'ground': 'shop', 'eave': 0.98, 'photo': 'front_shop_white'},
    {'wall': BRICK, 'brick': True, 'top': 'cornice', 'floors': 2, 'cols': 2, 'shutters': None, 'ground': 'shop', 'eave': 0.98, 'photo': 'front_shop_brick'},
]


def jitter(c, rng, k=10):
    return tuple(max(0, min(255, v + rng.randint(-k, k))) for v in c)


def wall_texture(w, h, colour, brick, seed):
    rng = random.Random(seed)
    im = Image.new('RGB', (w, h), colour)
    if brick:
        d = ImageDraw.Draw(im)
        mortar = tuple(min(255, int(v * 0.75 + 38)) for v in colour)
        rh = 4
        for r in range(h // rh + 1):
            y = r * rh
            d.line((0, y, w, y), fill=mortar)
            off = -5 if r % 2 else 0
            for x in range(off, w, 10):
                d.line((x, y, x, y + rh), fill=mortar)
                d.rectangle((x + 1, y + 1, x + 9, y + rh - 1), fill=jitter(colour, rng, 8))
    a = np.asarray(im).astype(float)
    a += np.random.default_rng(seed).normal(0, 1.8, (h, w, 1))
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
    # Recess, narrow frame and lower sill, rather than a white grid pasted on the wall.
    d.rectangle((x0 - 5, y0 - 4, x1 + 5, y1 + 5), fill=(75, 70, 64))
    d.rectangle((x0 - 3, y0 - 2, x1 + 3, y1 + 2), fill=TRIM)
    d.rectangle((x0, y0, x1, y1), fill=GLASS)
    # Sky reflection in the upper panes.
    d.polygon([(x0 + 1, y0 + 1), (x1 - 1, y0 + 1), (x1 - 1, y0 + (y1 - y0) * 0.55), (x0 + 1, y0 + (y1 - y0) * 0.35)], fill=(97, 110, 118))
    d.rectangle((x0 + 3, y1 - (y1 - y0) * 0.25, x1 - 3, y1 - 2), fill=(70, 70, 65))
    mid = y0 + (y1 - y0) * 0.43
    d.rectangle((x0, mid - 1, x1, mid + 1), fill=TRIM)
    d.line(((x0 + x1) / 2, y0, (x0 + x1) / 2, y1), fill=TRIM, width=1)
    d.rectangle((x0 - 5, y1 + 3, x1 + 5, y1 + 6), fill=(208, 205, 194))
    d.line((x0 - 4, y1 + 7, x1 + 6, y1 + 7), fill=(102, 94, 83), width=2)


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
    if spec.get('rusticated'):
        wd = ImageDraw.Draw(wall)
        for y in range(0, h, 24):
            wd.line((0, y, w, y), fill=(160, 153, 140), width=1)
            wd.line((0, y + 1, w, y + 1), fill=(228, 221, 207), width=1)
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
    ground_h = (h - eave_y) * (1.12 / (spec['floors'] + 1.12))
    upper = (h - eave_y) - ground_h
    floor_h = upper / spec['floors']
    cols = spec['cols']
    margin = w * (0.17 if spec['shutters'] else 0.12)
    span = (w - 2 * margin) / cols
    for f in range(spec['floors']):
        y0 = eave_y + f * floor_h + floor_h * 0.18
        y1 = y0 + floor_h * 0.64
        for c in range(cols):
            cx = margin + span * (c + 0.5)
            ww = span * (0.42 if spec['shutters'] else 0.55)
            sash_window(d, cx - ww / 2, y0, cx + ww / 2, y1, spec['shutters'])
        # A string course under each floor on brick houses.
        if not spec['brick']:
            d.line((0, y1 + floor_h * 0.13, w, y1 + floor_h * 0.13), fill=(204, 200, 188), width=2)
    gy = h - ground_h
    if spec['ground'] == 'shop':
        frame = rng.choice(((31, 49, 43), (43, 46, 46), (66, 49, 42)))
        d.rectangle((6, gy + 4, w - 6, h - 6), fill=frame)
        d.rectangle((14, gy + 28, w * 0.66, h - 26), fill=(52, 64, 68))
        d.polygon([(15, gy + 29), (w * 0.65, gy + 29), (w * 0.65, h - 66), (15, h - 90)], fill=(100, 112, 117))
        # Recessed displays behind the glass, rather than a featureless grey pane.
        # These belong only to the drawn fronts; photo facades are supplied separately.
        x0,x1,y0,y1=18,int(w*.65)-4,int(gy+35),h-30
        style=(seed//3)%3
        d.rectangle((x0,y0,x1,y1),fill=(47,59,59))
        for row in range(2):
            shelf=y0+(row+1)*(y1-y0)//3+10
            d.rectangle((x0,shelf,x1,shelf+3),fill=(108,85,60))
            for col in range(5):
                x=x0+8+col*(x1-x0-16)/5
                if style==0:
                    d.ellipse((x,shelf-12,x+19,shelf-2),fill=(162,127,79),outline=(110,86,54))
                    d.line((x+5,shelf-9,x+8,shelf-6),fill=(209,178,119),width=2)
                elif style==1:
                    d.rectangle((x,shelf-11,x+13,shelf-1),fill=(131,89,66))
                    d.line((x+6,shelf-10,x+6,shelf-27),fill=(67,100,69),width=3)
                    d.ellipse((x,shelf-30,x+12,shelf-18),fill=(173,150,105) if col%2 else (148,84,83))
                else:
                    for book in range(3):
                        d.rectangle((x+book*5,shelf-20+book*2,x+book*5+3,shelf-1),fill=((102,125,119),(144,112,76),(128,91,91))[book])
        d.line((x0+8,y0+3,x0+8+(y1-y0)*.2,y1-3),fill=(106,125,125),width=3)
        d.line((w * 0.34, gy + 29, w * 0.34, h - 26), fill=frame, width=3)
        d.rectangle((w * 0.72, gy + 26, w - 14, h - 6), fill=(17, 27, 26))
        d.rectangle((w * 0.75, gy + 32, w - 20, h - 48), fill=(79, 94, 97))
        d.rectangle((10, gy + 8, w - 10, gy + 20), outline=(184, 170, 135), width=1)
        d.ellipse((w * 0.73, h - 43, w * 0.73 + 3, h - 40), fill=(188, 158, 91))
    else:
        dx = rng.choice((0.2, 0.5, 0.8)) * w
        dw = w * 0.2
        d.rectangle((dx - dw / 2 - 5, gy + 6, dx + dw / 2 + 5, h), fill=TRIM)
        d.rectangle((dx - dw / 2, gy + 14, dx + dw / 2, h), fill=rng.choice(DOOR))
        d.rectangle((dx - dw / 2 + 6, gy + 18, dx + dw / 2 - 6, gy + 40), fill=GLASS)
        for py in (0.45, 0.72):
            d.rectangle((dx - dw / 2 + 6, gy + ground_h * py, dx + dw / 2 - 6, gy + ground_h * (py + 0.18)), outline=(91, 97, 82), width=2)
        d.ellipse((dx + dw * 0.25, h - 52, dx + dw * 0.25 + 3, h - 49), fill=(187, 158, 95))
        for wx in (w * 0.2, w * 0.5, w * 0.8):
            if abs(wx - dx) > w * 0.2:
                sash_window(d, wx - w * 0.1, gy + 26, wx + w * 0.1, h - 24)
    # Plinth.
    d.rectangle((0, h - 8, w, h), fill=(90, 86, 82))
    # Fine rainwater pipe and a shadow under the cornice; these anchor each separate plot.
    d.line((w - 4, eave_y + 8, w - 4, h), fill=(75, 76, 71), width=2)
    if spec['top'] == 'cornice':
        d.rectangle((0, eave_y + 8, w - 6, eave_y + 13), fill=(126, 121, 110))
    return im


def facade_atlas(size=(1024, 1024)):
    """Sixteen distinct fronts in a 4 x 4 atlas, without increasing texture memory."""
    atlas = Image.new('RGB', size, KEY)
    for k, spec in enumerate(TYPES):
        drawn = facade(spec, 256, 512, seed=100 + k)
        front = drawn.resize((256, 256), Image.Resampling.LANCZOS)
        # Resampling the silhouette must not mix the colour key into its opaque border.
        mask = drawn.resize((256, 256), Image.Resampling.NEAREST)
        a = np.asarray(front).copy(); key = np.all(np.asarray(mask) == KEY, axis=2)
        a[key] = KEY
        # Edge pixels inside the mask keep their own masonry, not a magenta antialias fringe.
        fringe = (~key) & (a[..., 0] > 190) & (a[..., 1] < 70) & (a[..., 2] > 90)
        a[fringe] = np.asarray(mask)[fringe]
        atlas.paste(Image.fromarray(a), ((k % 4) * 256, (k // 4) * 256))
    return atlas
