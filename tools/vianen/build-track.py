#!/usr/bin/env python3
"""Builds the Vianen etappe, a first sketch: a loop through Vianen's old town from OpenStreetMap,
with facades cut from openly licensed Wikimedia Commons photos. Not a track of the original.

    python3 tools/vianen/build-track.py

Reads source/assets/vianen/ (osm.json, photos/, photos.json). Writes public/assets/vianen/:
the six track files in the layouts of docs/research and original-game-decompiled/docs/formats/
game-data.md, the textures, and ATTRIBUTION.md; and public/assets/loading/e10*.png. source/host/
vianen.js makes them
etappe 10, a slot the original reserves but never fills.

The road, pavements and facades are .rmp planes: quads of x, y, z, u, v and a colour, drawn in four
passes with one texture each (road, land, extra, rail: raser.ini [MAPS] args 2 to 5). All four
collide, so a facade is also a wall.
"""
import json, math, os, struct, sys
from PIL import Image, ImageOps, ImageEnhance

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')
SRC = os.path.join(ROOT, 'source', 'assets', 'vianen')
OUT = os.path.join(ROOT, 'public', 'assets', 'vianen')
sys.path.insert(0, HERE)
from route import loop  # noqa: E402

UNITS = 10.0          # world units per metre
CHUNK = 128.0         # chunk length in world units, as on the original tracks
ROAD = 50.0           # half the road width
WALK = 82.0           # from the centre line to the facades
LANE = 24.0           # waypoints right and left of the centre line
START = 10            # start chunk; the grid takes the 8 chunks before it
MIN_RADIUS = 260.0    # tightest bend of the centre line, world units
# Landmarks: metres east and north (route.py), and what stands there.
STADHUIS = (22.0, 70.0)
GROTE_KERK = (100.0, -185.0)
LEKPOORT = (-8.0, 165.0)


# --- the centre line -----------------------------------------------------------------------

def chaikin(pts, rounds=3):
    for _ in range(rounds):
        out = []
        for a, b in zip(pts, pts[1:] + pts[:1]):
            out += [(0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]), (0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1])]
        pts = out
    return pts


def resample(pts, length=None):
    return resample_step(pts, CHUNK)


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

def quad(vs, uvs, colour, facing):
    """Four vertices and the 6 indices that make both triangles face `facing` (D3D: clockwise is front)."""
    def normal(i, j, k):
        a = [vs[j][q] - vs[i][q] for q in range(3)]
        b = [vs[k][q] - vs[i][q] for q in range(3)]
        return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
    n = normal(0, 2, 1)
    front = sum(n[q] * facing[q] for q in range(3)) > 0
    idx = (0, 2, 1, 0, 3, 2) if front else (0, 1, 2, 0, 2, 3)
    return (vs, uvs, colour, idx)


def pack_plane(p):
    vs, uvs, colour, idx = p
    b = b''
    for v, uv in zip(vs, uvs):
        b += struct.pack('<5f', v[0], v[1], v[2], uv[0], uv[1]) + bytes((colour[0], colour[1], colour[2], 0))
    return b + struct.pack('<6i', *idx)


# --- textures -------------------------------------------------------------------------------

def photo(key):
    return Image.open(os.path.join(SRC, 'photos', key + '.jpg')).convert('RGB')


def crop(im, box):
    w, h = im.size
    return im.crop((int(box[0] * w), int(box[1] * h), int(box[2] * w), int(box[3] * h)))


def warm(im):
    """The RCE photos are black and white: tint them toward brick and plaster."""
    g = ImageOps.grayscale(im)
    return ImageOps.colorize(g, black=(40, 28, 22), white=(250, 236, 214), mid=(150, 104, 80))


def save_tga(im, path):
    im.convert('RGB').save(path, format='TGA', compression=None)


# Atlas 1024 x 1024: regions in pixels, UVs from them.
ATLAS = {
    'lekpoort': (0, 0, 256, 512),
    'stadhuis': (256, 0, 512, 512),
    'kerk': (512, 0, 1024, 512),
}
FACADES = [f'gevel{k}' for k in range(1, 9)]
for k, key in enumerate(FACADES):
    ATLAS[key] = ((k % 4) * 256, 512 + (k // 4) * 256, (k % 4) * 256 + 256, 768 + (k // 4) * 256)
CROPS = {
    'lekpoort': ('lekpoort1', (0.27, 0.10, 0.77, 0.97), False),
    'stadhuis': ('stadhuis2', (0.14, 0.03, 0.93, 0.97), False),
    'kerk': ('kerk2', (0.15, 0.12, 0.70, 0.52), False),
    'gevel1': ('gevel1', (0.0, 0.03, 1.0, 0.55), True), 'gevel2': ('gevel2', (0.0, 0.0, 1.0, 0.55), True),
    'gevel3': ('gevel3', (0.0, 0.05, 1.0, 0.60), True), 'gevel4': ('gevel4', (0.0, 0.10, 1.0, 0.62), True),
    'gevel5': ('gevel5', (0.05, 0.0, 1.0, 0.55), True), 'gevel6': ('gevel6', (0.0, 0.0, 1.0, 0.55), True),
    'gevel7': ('gevel7', (0.0, 0.05, 1.0, 0.58), True), 'gevel8': ('gevel8', (0.0, 0.05, 1.0, 0.58), True),
}


def build_textures():
    atlas = Image.new('RGB', (1024, 1024), (120, 90, 70))
    for name, (key, box, bw) in CROPS.items():
        r = ATLAS[name]
        im = crop(photo(key), box)
        if bw:
            im = warm(im)
        atlas.paste(im.resize((r[2] - r[0], r[3] - r[1]), Image.Resampling.LANCZOS), r[:2])
    save_tga(atlas, os.path.join(OUT, 'vn_gevel.tga'))
    # Road: the herringbone klinkers in front of the houses, tinted to red brick.
    road = crop(photo('gevel2'), (0.15, 0.72, 0.85, 0.97))
    road = ImageOps.colorize(ImageOps.autocontrast(ImageOps.grayscale(road)), black=(60, 32, 26), white=(196, 120, 96), mid=(132, 70, 56))
    save_tga(road.resize((256, 256), Image.Resampling.LANCZOS), os.path.join(OUT, 'vn_weg.tga'))
    walk = crop(photo('gevel6'), (0.05, 0.75, 0.75, 0.98))
    walk = ImageOps.colorize(ImageOps.autocontrast(ImageOps.grayscale(walk)), black=(70, 66, 60), white=(214, 206, 192))
    save_tga(walk.resize((256, 256), Image.Resampling.LANCZOS), os.path.join(OUT, 'vn_gras.tga'))


def build_loading():
    """The wait screen of etappe 10 (source/race-runner.js loads assets/loading/eNN.png): the Lekpoort."""
    from PIL import ImageDraw, ImageFont
    im = photo('lekpoort3')
    w, h = im.size
    box = (0, 0, w, int(w * 3 / 4)) if h >= w * 3 / 4 else ((w - int(h * 4 / 3)) // 2, 0, (w + int(h * 4 / 3)) // 2, h)
    im = im.crop(box).resize((640, 480), Image.Resampling.LANCZOS)
    d = ImageDraw.Draw(im)
    try:
        font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold Italic.ttf', 72)
    except OSError:
        font = ImageFont.load_default()
    for dx, dy, colour in ((4, 4, (0, 0, 0)), (0, 0, (255, 210, 0))):
        d.text((40 + dx, 330 + dy), 'VIANEN', font=font, fill=colour)
    out = os.path.join(ROOT, 'public', 'assets', 'loading')
    for name in ('e10.png', 'e10-8.png', 'e10-lo.png'):
        im.save(os.path.join(out, name))


def uv(name, u0=0.0, u1=1.0, v0=0.0, v1=1.0):
    """UVs of part of an atlas region, v down from the top: for a quad bottom-start, bottom-end, top-end, top-start."""
    x0, y0, x1, y1 = (c / 1024.0 for c in ATLAS[name])
    U = lambda u: x0 + (x1 - x0) * u
    V = lambda v: y0 + (y1 - y0) * v
    return [(U(u0), V(v1)), (U(u1), V(v1)), (U(u1), V(v0)), (U(u0), V(v0))]


# --- the track ------------------------------------------------------------------------------

def build():
    os.makedirs(OUT, exist_ok=True)
    route, _, _ = loop(os.path.join(SRC, 'osm.json'))
    # Fine steps, rounded until no bend is tighter than the facades are wide, then chunks.
    fine = resample_step([(x * UNITS, z * UNITS) for x, z in chaikin(route)], 16.0)
    rounds = 0
    while radius(fine) < MIN_RADIUS and rounds < 4000:
        fine = relax(fine, 20)
        rounds += 20
    centre = resample(fine)
    print('smallest bend', round(radius(centre)), 'after', rounds, 'rounds')
    n = len(centre)
    fr = frames(centre)
    edge = lambda i, off: (centre[i % n][0] + fr[i % n][1][0] * off, centre[i % n][1] + fr[i % n][1][1] * off)
    near = lambda p: min(range(n), key=lambda i: math.dist(centre[i], (p[0] * UNITS, p[1] * UNITS)))
    side = lambda i, p: 1 if (p[0] * UNITS - centre[i][0]) * fr[i][1][0] + (p[1] * UNITS - centre[i][1]) * fr[i][1][1] > 0 else -1
    stadhuis, kerk, poort = near(STADHUIS), near(GROTE_KERK), near(LEKPOORT)
    print('chunks', n, 'stadhuis', stadhuis, 'kerk', kerk, 'lekpoort', poort)

    grey = (225, 225, 225)
    chunks = []
    for i in range(n):
        j = i + 1
        road, land, extra, rail = [], [], [], []
        # Road: two halves, the texture once per half and chunk.
        for a, b in ((-ROAD, 0.0), (0.0, ROAD)):
            p0, p1, p2, p3 = edge(i, a), edge(j, a), edge(j, b), edge(i, b)
            vs = [(p0[0], 0, p0[1]), (p1[0], 0, p1[1]), (p2[0], 0, p2[1]), (p3[0], 0, p3[1])]
            road.append(quad(vs, [(0, 1), (0, 0), (1, 0), (1, 1)], grey, (0, 1, 0)))
        # Pavements, a curb's height up.
        for a, b in ((-WALK, -ROAD), (ROAD, WALK)):
            p0, p1, p2, p3 = edge(i, a), edge(j, a), edge(j, b), edge(i, b)
            vs = [(p0[0], 2, p0[1]), (p1[0], 2, p1[1]), (p2[0], 2, p2[1]), (p3[0], 2, p3[1])]
            land.append(quad(vs, [(0, 1), (0, 0), (0.5, 0), (0.5, 1)], grey, (0, 1, 0)))
        # Facades on both sides, facing the road. Inside a bend they fold over: left out there.
        for s in (-1, 1):
            p0, p1 = edge(i, s * WALK), edge(j, s * WALK)
            seg = (p1[0] - p0[0], p1[1] - p0[1])
            if seg[0] * fr[i][0][0] + seg[1] * fr[i][0][1] < 0.4 * CHUNK:
                continue
            inward = (-fr[i][1][0] * s, 0, -fr[i][1][1] * s)
            name, top, tint = FACADES[(i * 3 + (s > 0)) % len(FACADES)], 95 + 25 * ((i * 7 + s) % 3), (235, 225, 215)
            if i in (stadhuis, stadhuis + 1) and s == side(i, STADHUIS):
                name, top, tint = 'stadhuis', 210, (255, 255, 255)
                u0, u1 = (0.0, 0.5) if i == stadhuis else (0.5, 1.0)
            elif abs(i - kerk) <= 1 and s == side(kerk, GROTE_KERK):
                name, top, tint = 'kerk', 260, (255, 255, 255)
                u0, u1 = ((i - kerk + 1) / 3, (i - kerk + 2) / 3)
            else:
                u0, u1 = 0.0, 1.0
            vs = [(p0[0], 0, p0[1]), (p1[0], 0, p1[1]), (p1[0], top, p1[1]), (p0[0], top, p0[1])]
            extra.append(quad(vs, uv(name, u0, u1), tint, inward))
        # The Lekpoort across the road: pillars on the pavements and the tower above the road.
        if i == poort:
            f = fr[i][0]
            for facing in (f, (-f[0], -f[1])):
                to = (-facing[0], 0, -facing[1])
                L, R = edge(i, -WALK), edge(i, WALK)
                lo, hi = 95, 330
                vs = [(L[0], lo, L[1]), (R[0], lo, R[1]), (R[0], hi, R[1]), (L[0], hi, L[1])]
                rail.append(quad(vs, uv('lekpoort', 0.0, 1.0, 0.0, 0.7), (255, 255, 255), to))
                for a, b, u0, u1 in ((-WALK, -ROAD, 0.0, 0.18), (ROAD, WALK, 0.82, 1.0)):
                    A, B = edge(i, a), edge(i, b)
                    vs = [(A[0], 0, A[1]), (B[0], 0, B[1]), (B[0], lo, B[1]), (A[0], lo, A[1])]
                    rail.append(quad(vs, uv('lekpoort', u0, u1, 0.7, 1.0), (255, 255, 255), to))
        chunks.append((road, land, extra, rail))

    # .rmp: version -1, the plane total, then per chunk the four lists.
    total = sum(len(l) for c in chunks for l in c)
    rmp = struct.pack('<iii', -1, total, n)
    for c in chunks:
        for lst in c:
            rmp += struct.pack('<i', len(lst)) + b''.join(pack_plane(p) for p in lst)
    # .dmp waypoints: [type, trigger, x, y, z, next, alt2, alt1, previous]. Right lane i*2 drives
    # with the race, left lane i*2+1 against it, as the original's lanes do.
    dmp = struct.pack('<i', 2 * n)
    for i in range(n):
        for lane, (off, nxt, prv) in enumerate(((LANE, (i + 1) % n, (i - 1) % n), (-LANE, (i - 1) % n, (i + 1) % n))):
            p = edge(i, off)
            dmp += struct.pack('<iifffiiii', 4, 0, p[0], 0.0, p[1], nxt * 2 + lane, -1, -1, prv * 2 + lane)
    # .pmp chunks: position, two triggers, rails, left waypoints, right waypoints. Chunk 0 marker;
    # start and finish one past the start chunk, finish valid the next, as on Amsterdam (119, 120).
    trig = {0: (9, 0), START + 1: (13, 14), START + 2: (15, 0)}
    pmp = struct.pack('<i', n)
    for i in range(n):
        t = trig.get(i, (0, 0))
        pmp += struct.pack('<3f2i', centre[i][0], 0.0, centre[i][1], *t)
        pmp += struct.pack('<i', 0) + struct.pack('<ii', 1, i * 2 + 1) + struct.pack('<ii', 1, i * 2)
    # .omp: the start and finish banner over the line, and a few pickups.
    def obj(chunk, kind, p, rot_y, name):
        return struct.pack('<ii3f3f', chunk, kind, p[0], p[1], p[2], 0.0, rot_y, 0.0) + name.encode('latin1').ljust(32, b'\0') + struct.pack('<i', 0)
    objs = []
    s = START + 1
    heading = math.degrees(math.atan2(fr[s][0][1], fr[s][0][0]))
    objs.append(obj(s, 12, (centre[s][0], 75.0, centre[s][1]), heading, 'a_zepp00_ANIM'))
    for k, name in ((20, 'pw_turbs_ANIM'), (35, 'pw_reps_ANIM'), (50, 'pw_5pts_ANIM'), (65, 'pw_turbb_ANIM'), (75, 'pw_10pts_ANIM')):
        if k < n:
            p = edge(k, LANE * (1 if k % 2 else -1))
            objs.append(obj(k, 25, (p[0], 5.0, p[1]), heading, name))
    omp = struct.pack('<i', len(objs)) + b''.join(objs)
    files = {
        'vianen.rmp': rmp, 'vianen.dmp': dmp, 'vianen.pmp': pmp, 'vianen.omp': omp,
        'vianen.cmp': struct.pack('<i', 0), 'vianen.pth': struct.pack('<ii', -1, 0),
    }
    for name, data in files.items():
        open(os.path.join(OUT, name), 'wb').write(data)
    build_textures()
    build_loading()
    write_attribution()
    json.dump({'chunks': n, 'start': START, 'lengthMetres': round(n * CHUNK / UNITS)}, open(os.path.join(OUT, 'vianen.json'), 'w'))
    print('planes', total, 'objects', len(objs), 'length m', round(n * CHUNK / UNITS))


def write_attribution():
    photos = json.load(open(os.path.join(SRC, 'photos.json'), encoding='utf-8'))
    used = sorted({key for key, _, _ in CROPS.values()} | {'gevel2', 'gevel6', 'lekpoort3'})
    lines = [
        '# Vianen etappe: sources',
        '',
        'Streets and building positions: © OpenStreetMap contributors, ODbL 1.0, <https://www.openstreetmap.org/copyright>.',
        '',
        'The textures `vn_gevel.tga`, `vn_weg.tga` and `vn_gras.tga`, and the wait screen `../loading/e10.png`, are cut, scaled and tinted from these photos on Wikimedia Commons, and are shared under the same licences:',
        '',
    ]
    for key in used:
        p = photos[key]
        lines.append(f"- [{p['title']}]({p['page']}), {p['artist'] or 'unknown author'}, {p['license']}")
    open(os.path.join(OUT, 'ATTRIBUTION.md'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')


if __name__ == '__main__':
    build()
