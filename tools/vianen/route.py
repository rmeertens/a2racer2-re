"""The Vianen loop from OpenStreetMap: shortest paths over the street graph between landmarks."""
import heapq, json, math

LAT0, LON0 = 51.994, 5.092
KX = math.cos(math.radians(LAT0)) * 111320.0
KZ = 110540.0
DRIVE = {'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'pedestrian', 'service', 'road'}
# Metres east and north of LAT0, LON0: Voorstraat from the Grote Kerk end north past the Stadhuis
# to the Lekpoort, west along the dike, then south down the parallel streets and back east.
TARGETS = [
    ('Voorstraat bij de Grote Kerk', 72.5, -194.0),
    ('Stadhuis', 20.0, 82.0),
    ('Lekpoort', -12.5, 191.7),
    ('Lekdijk', -83.0, 168.0),
    ('Hoek', -33.0, -54.0),
    ('Hoek west', -96.0, -69.0),
    ('Zuidkant', -70.0, -196.0),
]


def metres(lat, lon):
    return ((lon - LON0) * KX, (lat - LAT0) * KZ)


def load(path):
    d = json.load(open(path))
    nodes = {e['id']: metres(e['lat'], e['lon']) for e in d['elements'] if e['type'] == 'node' and 'lat' in e}
    ways = [e for e in d['elements'] if e['type'] == 'way']
    return nodes, ways


def graph(nodes, ways):
    g = {}
    for w in ways:
        if w.get('tags', {}).get('highway') not in DRIVE:
            continue
        ns = [n for n in w['nodes'] if n in nodes]
        for a, b in zip(ns, ns[1:]):
            d = math.dist(nodes[a], nodes[b])
            g.setdefault(a, []).append((b, d))
            g.setdefault(b, []).append((a, d))
    return g


def shortest(g, nodes, a, b, used):
    # Streets already on the loop cost more, so the loop does not drive back down them.
    dist = {a: 0}
    prev = {}
    q = [(0, a)]
    while q:
        d, n = heapq.heappop(q)
        if n == b:
            break
        if d > dist[n]:
            continue
        for m, w in g.get(n, []):
            cost = w * (8 if (n, m) in used or (m, n) in used else 1)
            if d + cost < dist.get(m, 1e18):
                dist[m] = d + cost
                prev[m] = n
                heapq.heappush(q, (d + cost, m))
    path = [b]
    while path[-1] != a:
        path.append(prev[path[-1]])
    return path[::-1]


def loop(osm_path):
    nodes, ways = load(osm_path)
    g = graph(nodes, ways)
    near = lambda p: min(g, key=lambda n: math.dist(nodes[n], p))
    stops = [near((x, z)) for _, x, z in TARGETS]
    used = set()
    route = []
    for a, b in zip(stops, stops[1:] + stops[:1]):
        part = shortest(g, nodes, a, b, used)
        used.update(zip(part, part[1:]))
        route += part if not route else part[1:]
    return [nodes[n] for n in route[:-1]], nodes, ways
