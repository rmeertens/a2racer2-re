"""Seamless paving and a continuous town/canal surface for the Vianen asset builder."""
import math
import numpy as np
from PIL import Image, ImageFilter
from shapely import constrained_delaunay_triangles, make_valid
from shapely.geometry import Polygon, Point, box
from shapely.ops import unary_union


def paving(size=256, herringbone=True):
    # A 5.12 x 12.8 m tile; both axes span an integer number of pattern periods. Unlike the
    # old street-photo crop, it has no perspective, baked shadows or hard patch boundaries.
    y, x = np.mgrid[:size, :size]
    x = x / size * 32
    y = y / size * 80
    if herringbone:
        u, v = x + y, y - x
        iu, iv = np.floor(u), np.floor(v)
        phase = (iu + iv) % 4
        horizontal = phase < 2
        bu, bv = iu - (phase == 1), iv - (phase == 3)
        a, b = u - bu, v - bv
        wa, wb = np.where(horizontal, 2, 1), np.where(horizontal, 1, 2)
        edge = np.minimum.reduce([a, wa - a, b, wb - b])
        base, mortar = (130, 108, 88), (91, 84, 71)
    else:
        u, v = x / 2, y / 1.25
        iv = np.floor(v); u += (iv % 2) * 0.5
        bu, bv = np.floor(u), iv
        a, b = u % 1, v % 1
        edge = np.minimum.reduce([a, 1 - a, b, 1 - b])
        base, mortar = (151, 145, 131), (105, 103, 93)
    variation = (np.sin(bu * 67.13 + bv * 11.97) * 43758.54) % 1 * 19 - 9.5
    grain = np.random.default_rng(1444 + herringbone).normal(0, 1.7, (size, size))
    colour = np.asarray(base)[None, None, :] + (variation + grain)[..., None]
    joints = np.clip(edge / 0.045, 0, 1)[..., None]
    colour = colour * joints + np.asarray(mortar)[None, None, :] * (1 - joints)
    return Image.fromarray(np.clip(colour, 0, 254).astype(np.uint8))


def landscape_texture(size, water=False):
    rng = np.random.default_rng(1466 + water)
    if water:
        y, x = np.mgrid[:size, :size]
        detail = np.sin(y / size * math.pi * 48 + np.sin(x / size * math.pi * 6) * 2) * 2
        detail += np.sin(y / size * math.pi * 18 - x / size * math.pi * 4) * 2
        base = (61, 84, 77)
    else:
        detail = rng.normal(0, 8, (size, size))
        # Periodic smoothing, so opposite edges meet without a visible seam.
        detail = sum(np.roll(np.roll(detail, dx, 0), dy, 1) for dx in range(-2, 3) for dy in range(-2, 3)) / 25
        detail += rng.normal(0, 2, (size, size))
        base = (100, 116, 72)
    return Image.fromarray(np.clip(np.asarray(base)[None, None, :] + detail[..., None], 0, 254).astype(np.uint8))


def connected_terrain(town, water, sides, quad, tri, uv):
    """Union the real OSM water and the game route's canal crossings, with continuous banks.
    Use spare road-pass slots through its surface atlas, leaving building/roof slots intact.
    """
    polygons = []
    for ring in water:
        if len(ring) >= 3:
            polygons.append(make_valid(Polygon([(x * 10, z * 10) for x, z in ring])))
    for i, s in sorted(set(sides) | {(i, s) for i in town.bridges for s in (-1, 1)}):
        start, end = (64, 564) if i in town.bridges else (172, 502)
        ps = [town.p(i, 0, s * start), town.p(i, 1, s * start), town.p(i, 1, s * end), town.p(i, 0, s * end)]
        polygons.append(make_valid(Polygon([(p[0], p[2]) for p in ps])))
    xs, zs = [p[0] for p in town.c], [p[1] for p in town.c]
    bounds = box(min(xs) - 2500, min(zs) - 2500, max(xs) + 2500, max(zs) + 2500)
    water_shape = unary_union(polygons).intersection(bounds).simplify(25, preserve_topology=True)
    # The authored street row can differ from OSM by a few metres at a rounded racing bend.
    # Its parcels must stay dry, otherwise a real-water polygon cuts through the houses' feet.
    parcels = unary_union([make_valid(Polygon(p)) for p in town.parcels])
    water_shape = water_shape.difference(parcels.buffer(2)).simplify(15, preserve_topology=True)
    bank_outer = water_shape.buffer(75, quad_segs=2).simplify(20, preserve_topology=True)
    bank = bank_outer.difference(water_shape)
    corridor = unary_union([make_valid(Polygon(p)) for p in town.road_corridor]).simplify(20, preserve_topology=True).buffer(8, quad_segs=1)
    land = bounds.difference(bank_outer.union(corridor))
    counts = {'ground': 0, 'banks': 0, 'water': 0}

    # The dike and hump parcels stand above town terrain. Close their exposed sides instead
    # of leaving the road/house pads floating over a sky-coloured slit from bank-level views.
    # All new faces start beyond the pavement, avoiding overlapping drivable road planes.
    raised = 0
    for i in range(town.n):
        if i in town.bridges or max(town.ground[i], town.ground[(i + 1) % town.n]) < 4:
            continue
        for side in (-1, 1):
            def point(t, off, high):
                x, y, z = town.p(i, t, side * off, -2)
                if not high:
                    y = -25.0 if water_shape.contains(Point(x, z)) else -1.0
                return (x, y, z)
            inner, crest, toe = 82.0, 177.0, 317.0
            faces = [
                ([point(0, inner, True), point(1, inner, True), point(1, crest, True), point(0, crest, True)], (0, 1, 0)),
                ([point(0, crest, True), point(1, crest, True), point(1, toe, False), point(0, toe, False)], (0, 1, 0)),
            ]
            for t, neighbour, sign in ((0, (i - 1) % town.n, -1), (1, (i + 1) % town.n, 1)):
                if neighbour in town.bridges:
                    faces.append(([point(t, inner, False), point(t, inner, True), point(t, crest, True), point(t, toe, False)], tuple(sign * x for x in town.fwd(i))))
            for vs, facing in faces:
                kind = 'road' if town.chunks.room('road', i) > 8 else 'land'
                if not town.chunks.room(kind, i):
                    kind = 'land' if kind == 'road' else 'road'
                atlas = 'surface' if kind == 'road' else 'land'
                town.chunks.add(kind, i, quad(vs, uv(atlas, 'grass'), (230, 240, 220), facing))
                raised += 1
    print('raised embankment faces', raised)

    def emit(shape, material, category, height):
        if shape.is_empty:
            return
        for face in constrained_delaunay_triangles(shape).geoms:
            if face.area < 1:
                continue
            coords = list(face.exterior.coords)[:3]
            center = face.centroid
            ci = min(range(town.n), key=lambda i: math.dist((center.x, center.y), town.c[i]))
            vs = [(x, height(x, z), z) for x, z in coords]
            kind = 'road' if town.chunks.room('road', ci) > 8 else 'land'
            if town.chunks.room(kind, ci) == 0:
                kind = 'land' if kind == 'road' else 'road'
                if town.chunks.room(kind, ci) == 0:
                    raise RuntimeError(f'No terrain slots near chunk {ci}; simplify the mesh instead of dropping ground')
            atlas = 'surface' if kind == 'road' else 'land'
            plane = tri(*vs, uv(atlas, material), (242, 245, 238), (0, 1, 0))
            if category == 'banks':
                # Height-based wetness follows the actual waterline and keeps the
                # collision mesh unchanged. Per-vertex colour avoids triangle-shaped bands.
                vertices, mapping, colour, indices = plane
                colours = []
                for _, y, _ in vertices:
                    wet = max(0, min(1, (-1-y)/24))
                    colours.append(tuple(round(c*(1-wet*(1-low))) for c,low in zip(colour,(.62,.52,.46))))
                plane = vertices, mapping, colours, indices
            town.chunks.add(kind, ci, plane)
            counts[category] += 1

    # Keep large ground faces local to the car's chunk window. A distant triangle must not
    # own the whole town floor, or the original engine will cull it on the other side of a lap.
    tile_size = 1800  # 180 m remains inside the 25-chunk view window; fewer redundant field cuts
    for x in range(math.floor(bounds.bounds[0] / tile_size) * tile_size, math.ceil(bounds.bounds[2]), tile_size):
        for z in range(math.floor(bounds.bounds[1] / tile_size) * tile_size, math.ceil(bounds.bounds[3]), tile_size):
            tile = box(x, z, x + tile_size, z + tile_size)
            emit(land.intersection(tile), 'grass', 'ground', lambda x, z: -1.0)
    emit(water_shape, 'water', 'water', lambda x, z: -25.0)
    emit(bank, 'grass', 'banks', lambda x, z: -25 + min(1, water_shape.distance(Point(x, z)) / 75) * 24)
    town.water_shape = water_shape
    print('connected terrain', counts)
    return counts
