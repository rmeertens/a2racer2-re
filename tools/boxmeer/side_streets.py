"""Floralaan's adjoining residential network, derived from shared OSM junction nodes.

Keep the source bends and connectivity. Fit junctions to the rounded racing Floralaan,
interpolating that displacement through each street rather than inventing straight stubs.
"""
import math
from shapely import constrained_delaunay_triangles
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

STREETS = ['De Azalea', 'De Tamarisk', 'De Acacia', 'De Jasmijn']


def plan(town, nodes, ways, main_road):
    flora = {k for w in ways if w.get('tags', {}).get('name', '').lower() == 'floralaan' for k in w['nodes']}
    groups = []
    for name in STREETS:
        selected = [w for w in ways if w.get('tags', {}).get('name', '').lower() == name.lower()]
        # Only retain components connected to Floralaan (Acacia has a separate southern way).
        linked = set(flora)
        retained = []
        while True:
            new = [w for w in selected if w not in retained and linked.intersection(w['nodes'])]
            if not new: break
            retained.extend(new)
            linked.update(k for w in new for k in w['nodes'])
        roots = sorted(flora.intersection(k for w in retained for k in w['nodes']))
        if not roots: raise RuntimeError(f'{name}: no Floralaan junction in OSM snapshot')
        shifts = []
        for root in roots:
            x,z = nodes[root]; source = Point(x*10,z*10)
            target = main_road.interpolate(main_road.project(source))
            shifts.append((source, (target.x-source.x,target.y-source.y)))
        def fitted(k):
            x,z = nodes[k]; p = Point(x*10,z*10)
            exact = next((d for origin,d in shifts if p.distance(origin)<.01),None)
            if exact is not None: return (p.x+exact[0],p.y+exact[1])
            weights = [1/max(1,p.distance(origin))**2 for origin,_ in shifts]
            delta = [sum(w*d[axis] for w,(_,d) in zip(weights,shifts))/sum(weights) for axis in (0,1)]
            return (p.x+delta[0],p.y+delta[1])
        roads = [list(LineString([fitted(k) for k in w['nodes'] if k in nodes]).simplify(3).coords) for w in retained]
        entrances = []
        for root in roots:
            w = next(w for w in retained if root in w['nodes']); index = w['nodes'].index(root)
            ordered = w['nodes'][index:] if index < len(w['nodes'])-1 else list(reversed(w['nodes'][:index+1]))
            path = LineString([fitted(k) for k in ordered]); a = fitted(root)
            ci = town.near((a[0]/10,a[1]/10)); inside = path.interpolate(min(140,path.length))
            entrances.append({'chunk':ci,'sourceNode':root,'position':[a[0],0,a[1]],'probe':[list(a),[inside.x,inside.y]]})
        groups.append({'name':name,'osmWays':[w['id'] for w in retained], 'roads':roads,'entrances':entrances,
                       'junctionAdjustmentsMetres':[[d[0]/10,d[1]/10] for _,d in shifts]})
    shape = unary_union([LineString(r).buffer(30,cap_style=2,join_style=2) for g in groups for r in g['roads']]).simplify(2,preserve_topology=True)
    # Rounded, wide mouths meet the race surface without tight curb pinches.
    mouths = [LineString(e['probe']).buffer(40,cap_style=2,join_style=2) for g in groups for e in g['entrances']]
    return groups, unary_union([shape,*mouths])


def add(town, b, uv, groups, shape, main_road, existing):
    verge = shape.buffer(14,join_style=2)
    surfaces = unary_union([Polygon(p) for p in town.road_corridor])
    # Remove existing pavement at every mouth, preserving original height and bevels.
    cut = shape.difference(existing)
    clipped=[]
    for ci,row in enumerate(town.chunks.lists):
        keep = []
        for plane in row['land']:
            vs = plane[0]; polygon = Polygon([(v[0],v[2]) for v in vs])
            if max(v[1] for v in vs)>2 or not polygon.is_valid or polygon.area<.1 or not polygon.intersects(cut):
                keep.append(plane); continue
            normal = b.cross(b.sub(vs[1],vs[0]),b.sub(vs[2],vs[0]))
            for tri in constrained_delaunay_triangles(polygon.difference(cut)).geoms:
                def point(x,z):
                    y=vs[0][1]-(normal[0]*(x-vs[0][0])+normal[2]*(z-vs[0][2]))/normal[1]
                    return (x,y,z)
                keep.append(b.closed_tri(*[point(x,z) for x,z in list(tri.exterior.coords)[:3]],b.uv('land','pavement'),(225,225,225),(0,1,0)))
        clipped.append((ci,keep))
    # Clipping one quad can create several triangles; redistribute them within
    # native limits instead of letting a single chunk's list grow past 24 faces.
    for row in town.chunks.lists:row['land'].clear()
    for ci,planes in clipped:
        for plane in planes:town.chunks.add('land',ci,plane)
    def emit(polygon, kind, mapping, height=0):
        for tri in constrained_delaunay_triangles(polygon).geoms:
            x,z=tri.centroid.coords[0];ci=town.near((x/10,z/10))
            town.chunks.add(kind,ci,b.closed_tri(*[(x,height,z) for x,z in list(tri.exterior.coords)[:3]],mapping,(245,245,240),(0,1,0)))
    emit(shape.difference(main_road.buffer(b.ROAD)).difference(existing),'road',b.uv('surface','plain_asphalt'))
    emit(verge.difference(shape).difference(surfaces).difference(existing),'land',b.uv('land','pavement'))
    # A simple grass foundation sits 10 cm below the streets. Exclude its hull from
    # the outer field mesh: triangulating every narrow verge twice wastes native slots.
    foundation=unary_union([verge,existing]).convex_hull
    emit(foundation,'road',b.uv('surface','grass'),-1)
    town.road_corridor.append(list(foundation.exterior.coords)[:-1])
    occupied = [Polygon(p) for p in town.parcels]
    # Low houses face the new streets; never place a house over another branch.
    all_roads = unary_union([shape,existing,main_road.buffer(120)])
    for slot,g in enumerate(groups):
        count=0
        for road in g['roads']:
            line=LineString(road)
            for distance in range(110,int(line.length)-55,135):
                p=line.interpolate(distance);a=line.interpolate(max(0,distance-2));c=line.interpolate(min(line.length,distance+2));yaw=math.atan2(c.y-a.y,c.x-a.x)
                for side in (-1,1):
                    if count>=8:continue
                    angle=yaw+(math.pi if side>0 else 0);co,si=math.cos(angle),math.sin(angle)
                    center=(p.x+math.sin(yaw)*side*75,p.y-math.cos(yaw)*side*75)
                    footprint=Polygon([(center[0]+co*x-si*z,center[1]+si*x+co*z)for x,z in [(-36,0),(36,0),(36,90),(-36,90)]])
                    if footprint.intersects(all_roads.buffer(12)) or any(footprint.intersects(q.buffer(8)) for q in occupied):continue
                    ci=town.near((center[0]/10,center[1]/10))
                    if town.chunks.room('rail',ci)<42 or town.chunks.room('land',ci)<50 or town.chunks.room('extra',ci)<6:continue
                    town.box(ci,center,72,90,45,'brick',angle,roof=34,facade=12+(count+slot)%4,side_roof=True)
                    occupied.append(footprint);count+=1
        g['houses']=count
        for entry in g['entrances']:
            ci=entry['chunk'];line=LineString(entry['probe']);a=line.coords[0]
            p=line.interpolate(min(100,line.length));dx,dz=p.x-a[0],p.y-a[1];length=math.hypot(dx,dz);dx,dz=dx/length,dz/length
            # Check the entire sign against both streets, including the rounded main-road bend.
            # A fixed offset from the side street alone placed Acacia's post in Floralaan.
            side_centres=unary_union([LineString(r)for group in groups for r in group['roads']])
            site=None
            for distance in[100,135,75,40]:
                point=line.interpolate(min(distance,line.length))
                for offset in[65,80,100,125,150]:
                    for side in[1,-1]:
                        xx,zz=point.x+dz*offset*side,point.y-dx*offset*side
                        board=LineString([(xx-dx*17,zz-dz*17),(xx+dx*17,zz+dz*17)]).buffer(2)
                        if board.distance(main_road)<110 or board.distance(side_centres)<55:continue
                        if any(board.intersects(q.buffer(3))for q in occupied):continue
                        site=(xx,zz);break
                    if site:break
                if site:break
            if site is None:raise RuntimeError('No clear street-name sign site for '+g['name'])
            x,z=site
            if not hasattr(town,'side_street_signs'):town.side_street_signs=[]
            town.side_street_signs.append({'name':g['name'],'chunk':ci,'position':[x,0,z],'boardEnds':[[x-dx*17,z-dz*17],[x+dx*17,z+dz*17]],'mainRoadClearanceMetres':board.distance(main_road)/10})
            vs=[(x-dx*17,27,z-dz*17),(x+dx*17,27,z+dz*17),(x+dx*17,33,z+dz*17),(x-dx*17,33,z-dz*17)]
            for sign in (-1,1):
                N=(dz*sign,0,-dx*sign);mapping=uv(f'side_street{slot}')
                if dx*-N[2]+dz*N[0]<0:mapping=[mapping[1],mapping[0],mapping[3],mapping[2]]
                town.chunks.add('rail',ci,b.quad([(a+N[0]*.1,y,c+N[2]*.1)for a,y,c in vs],mapping,(255,255,255),N))
            # White painted poles share the architecture atlas, leaving the
            # pavement/roof pass available for the denser junction geometry.
            corners=[(x-1,0,z-1),(x+1,0,z-1),(x+1,0,z+1),(x-1,0,z+1)]
            faces=[]
            for a,c,N in [(0,1,(0,0,-1)),(1,2,(1,0,0)),(2,3,(0,0,1)),(3,0,(-1,0,0))]:
                aa,cc=corners[a],corners[c]
                faces.append(town.face(ci,[aa,cc,(cc[0],27,cc[2]),(aa[0],27,aa[2])],'white',N))
            faces.append(town.face(ci,[(a,27,c) for a,_,c in corners],'white',(0,1,0)))
            town.buildings.append({'chunk':ci,'center':[x,12.15,z],'height':27,'roof':0,'faces':faces})
        e=g['entrances'][0];target=LineString(g['roads'][0]).interpolate(.5,normalized=True)
        town.landmarks.append({'name':g['name'],'chunk':e['chunk'],'position':[target.x,0,target.y], 'highlight':True,
                               'camera':{'eye':[e['position'][0],24,e['position'][2]],'target':[target.x,24,target.y]}})
    town.side_streets=groups
    return verge
