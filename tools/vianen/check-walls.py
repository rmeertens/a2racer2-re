#!/usr/bin/env python3
"""Checks that the Vianen track's streets are walled: samples the building line on both sides of
every chunk and reports where no upright plane stands within 8 units. The dike's river side is
open on purpose (a low stone edge)."""
import math, struct, sys

D = 'public/assets/vianen/'
WALK = 82.0
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
p, bases = 12, []
for c in range(n):
    for li in range(4):
        k = struct.unpack_from('<i', b, p)[0]
        p += 4
        for _ in range(k):
            vs = [struct.unpack_from('<fff', b, p + 24 * v) for v in range(4)]
            p += 120
            ys = [v[1] for v in vs]
            if li in (2, 3) and max(ys) - min(ys) >= 20 and min(ys) < 5:
                low = sorted(vs, key=lambda v: v[1])[:2]
                bases.append(((low[0][0], low[0][2]), (low[1][0], low[1][2])))


def dist(pt, a, b):
    dx, dz = b[0] - a[0], b[1] - a[1]
    L = dx * dx + dz * dz or 1
    t = max(0, min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dz) / L))
    return math.hypot(pt[0] - a[0] - t * dx, pt[1] - a[1] - t * dz)


def right(i):
    a, d = C[i - 1], C[(i + 1) % n]
    f = (d[0] - a[0], d[1] - a[1])
    L = math.hypot(*f)
    return (f[1] / L, -f[0] / L)


gaps = {-1: set(), 1: set()}
for i in range(n):
    j = (i + 1) % n
    for s in (-1, 1):
        r0, r1 = right(i), right(j)
        p0 = (C[i][0] + r0[0] * s * WALK, C[i][1] + r0[1] * s * WALK)
        p1 = (C[j][0] + r1[0] * s * WALK, C[j][1] + r1[1] * s * WALK)
        for k in range(8):
            t = (k + 0.5) / 8
            pt = (p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t)
            if min(dist(pt, a, b) for a, b in bases) > 8:
                gaps[s].add(i)
for s in (-1, 1):
    print('side', s, 'chunks with a gap:', sorted(gaps[s]))
