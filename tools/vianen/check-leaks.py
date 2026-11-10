#!/usr/bin/env python3
"""Checks that no one can drive off the Vianen track into the void: draws the town from above
(ground: every upward plane; walls: every upright plane at least 12 units high), floods from the
road between walls, and reports each place reached where nothing is underneath. Run after
build-track.py:  python3 tools/vianen/check-leaks.py [--png out.png]"""
import struct, sys
from collections import deque
import numpy as np
from PIL import Image, ImageDraw

D = 'public/assets/vianen/'
CELL = 4.0
pm = open(D + 'vianen.pmp', 'rb').read()
n = struct.unpack_from('<i', pm, 0)[0]
o, C = 4, []
for c in range(n):
    x, y, z = struct.unpack_from('<3f', pm, o)
    o += 20
    for _ in range(3):
        k = struct.unpack_from('<i', pm, o)[0]
        o += 4 + 4 * k
    C.append((x, z))
b = open(D + 'vianen.rmp', 'rb').read()
p, planes = 12, []
for c in range(n):
    for li in range(4):
        k = struct.unpack_from('<i', b, p)[0]
        p += 4
        for _ in range(k):
            planes.append([struct.unpack_from('<fff', b, p + 24 * v) for v in range(4)])
            p += 120
xs = [v[0] for q in planes for v in q]
zs = [v[2] for q in planes for v in q]
x0, z0 = min(xs) - 20, min(zs) - 20
W, H = int((max(xs) - x0) / CELL) + 40, int((max(zs) - z0) / CELL) + 40
cell = lambda x, z: ((x - x0) / CELL, (z - z0) / CELL)
ground = Image.new('1', (W, H), 0)
walls = Image.new('1', (W, H), 0)
g, w = ImageDraw.Draw(ground), ImageDraw.Draw(walls)
for q in planes:
    ys = [v[1] for v in q]
    pts = [cell(v[0], v[2]) for v in q]
    area = abs(sum(pts[k][0] * pts[k - 1][1] - pts[k - 1][0] * pts[k][1] for k in range(4))) / 2
    if area < 4:
        # A sloping railing's two lowest vertices can be at the same end. Measure its height
        # at each x/z column, then project the full span; road elevation is not wall height.
        columns = {}
        for x, y, z in q:
            columns.setdefault((round(x, 3), round(z, 3)), []).append(y)
        height = max(max(c) - min(c) for c in columns.values())
        if height >= 12:
            a, b = max(((a, b) for a in q for b in q), key=lambda p: (p[0][0] - p[1][0]) ** 2 + (p[0][2] - p[1][2]) ** 2)
            w.line([cell(a[0], a[2]), cell(b[0], b[2])], fill=1, width=2)
    elif area >= 1:
        g.polygon(pts, fill=1)
G, Wl = np.array(ground), np.array(walls)
# Ground edges often lie along a wall's foot: one cell of slack against rasterising.
G0 = G.copy()
for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
    G |= np.roll(np.roll(G0, dz, 0), dx, 1)
seen = np.zeros_like(G)
todo = deque()
for x, z in C:
    cx, cz = map(int, cell(x, z))
    if not Wl[cz, cx]:
        seen[cz, cx] = True
        todo.append((cx, cz))
leaks = []
while todo:
    cx, cz = todo.popleft()
    if not G[cz, cx]:
        leaks.append((cx, cz))
        continue
    for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        a, bb = cx + dx, cz + dz
        if 0 <= a < W and 0 <= bb < H and not seen[bb, a] and not Wl[bb, a]:
            seen[bb, a] = True
            todo.append((a, bb))
def chunk(cx, cz):
    x, z = x0 + cx * CELL, z0 + cz * CELL
    return min(range(n), key=lambda i: (C[i][0] - x) ** 2 + (C[i][1] - z) ** 2)
where = {}
for cx, cz in leaks:
    where.setdefault(chunk(cx, cz), []).append((round(x0 + cx * CELL), round(z0 + cz * CELL)))
print('reachable cells', int(seen.sum()), 'leaks', len(leaks))
for i in sorted(where):
    print(f'  near chunk {i}: {len(where[i])} cells, e.g. {where[i][0]}')
if '--png' in sys.argv:
    img = np.zeros((H, W, 3), np.uint8)
    img[G] = (90, 90, 90)
    img[seen & G] = (60, 140, 60)
    img[Wl] = (255, 255, 255)
    for cx, cz in leaks:
        img[max(0, cz - 3):cz + 4, max(0, cx - 3):cx + 4] = (255, 0, 0)
    Image.fromarray(img).save(sys.argv[sys.argv.index('--png') + 1])
sys.exit(1 if leaks else 0)
