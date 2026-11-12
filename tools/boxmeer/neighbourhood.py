"""Floralaan / De Meidoorn, based on the OSM branching street and May 2025 Street View."""
import math
from polish import PASS
from shapely import constrained_delaunay_triangles
from shapely.geometry import Polygon, LineString, Point
from shapely.ops import unary_union


def add_neighbourhood(town, native, material_uv, metres, nodes, ways, main_road, reserved=None, shortcut=True):
    junction = metres(5.9402065, 51.655429)
    station = town.near(junction)
    start = town.p(station, .5, 0)
    anchor = town.p(station, .5, town.at(station,1))
    shift = (anchor[0]-junction[0]*10, anchor[2]-junction[1]*10)
    segments = []
    for way in ways:
        if way.get('tags', {}).get('name', '').lower() != 'de meidoorn':
            continue
        segments.append([(nodes[k][0]*10+shift[0], nodes[k][1]*10+shift[1])
                         for k in way['nodes'] if k in nodes])
    # Join the real branching layout to the rounded racing street, with no compulsory detour.
    segments.append([(start[0],start[2]),(anchor[0],anchor[2])])
    exit_station=(station+8)%town.n
    through = PASS>=6 and shortcut
    if through:
        exit_point=town.p(exit_station,.5,0)
        segments.insert(len(segments)-1,[segments[0][-1],(exit_point[0],exit_point[2])])
    shape = unary_union([LineString(s).buffer(45 if PASS>=2 and i==len(segments)-1 else 30, cap_style=2, join_style=2) for i,s in enumerate(segments)])
    verge = shape.buffer(16, join_style=2)
    main_surface = unary_union([Polygon(p) for p in town.road_corridor])
    asphalt = native.uv('surface', 'plain_asphalt')
    def emit(shape, kind, mapping, height):
        for triangle in constrained_delaunay_triangles(shape).geoms:
            coords=list(triangle.exterior.coords)[:3]
            x,z=triangle.centroid.coords[0];ci=town.near((x/10,z/10))
            town.chunks.add(kind,ci,native.closed_tri(*[(x,height,z)for x,z in coords],mapping,(245,245,240),(0,1,0)))
    # Clip the main street's sidewalk at the junction instead of laying two colliders atop it.
    for ci in sorted(set(range(station-2,station+3)) | (set(range(exit_station-2,exit_station+3))if through else set())):
        row=town.chunks.lists[ci%town.n]['land'];keep=[]
        for plane in row:
            vs=plane[0];poly=Polygon([(p[0],p[2])for p in vs])
            if not poly.is_valid or poly.area<.1 or not poly.intersects(shape):
                keep.append(plane);continue
            rest=poly.difference(shape)
            for triangle in constrained_delaunay_triangles(rest).geoms:
                coords=list(triangle.exterior.coords)[:3]
                # Preserve the original bevel profile rather than introducing a raised decal.
                a,c,d=vs[0],vs[1],vs[2]
                normal=native.cross(native.sub(c,a),native.sub(d,a))
                def y(x,z):return a[1]-(normal[0]*(x-a[0])+normal[2]*(z-a[2]))/normal[1] if abs(normal[1])>1e-8 else a[1]
                keep.append(native.closed_tri(*[(x,y(x,z),z)for x,z in coords],native.uv('land','pavement'),(225,225,225),(0,1,0)))
        row[:]=keep
    emit(shape.difference(main_road.buffer(native.ROAD)), 'road', asphalt, 0)
    emit(verge.difference(shape).difference(main_surface), 'land', native.uv('land','pavement'), 0)
    for poly in getattr(verge,'geoms',[verge]):town.road_corridor.append(list(poly.exterior.coords)[:-1])
    occupied=[];houses=0;carports=0;roof_panels=0
    # Low brick houses with white picture windows, deep roofs, carports and front gardens.
    for segment in (segments[:3]if PASS>=6 else segments[:-1]):
        line=LineString(segment)
        for distance in range(100, int(line.length)-40, 100):
            pt=line.interpolate(distance);ahead=line.interpolate(min(line.length,distance+1))
            before=line.interpolate(max(0,distance-1));dx,dz=ahead.x-before.x,ahead.y-before.y
            yaw=math.atan2(dz,dx)
            for side in [-1,1]:
                a=yaw+(math.pi if side>0 else 0);co,si=math.cos(a),math.sin(a)
                center=(pt.x+math.sin(yaw)*side*83,pt.y-math.cos(yaw)*side*83)
                w,depth=(72,98)if PASS>=6 else (68,92)
                footprint=Polygon([(center[0]+co*x-si*z,center[1]+si*x+co*z)for x,z in [(-w/2,0),(w/2,0),(w/2,depth),(-w/2,depth)]])
                if (reserved is not None and footprint.intersects(reserved.buffer(12))) or footprint.intersects(shape.buffer(35)) or footprint.intersects(main_road.buffer(120)) or any(footprint.intersects(p.buffer(6))for p in occupied):continue
                ci=town.near((center[0]/10,center[1]/10))
                if town.chunks.room('rail',ci)<22:continue
                height,roof=(45,38)if PASS>=6 else (48,40)
                P=town.box(ci,center,w,depth,height,'brick',a,roof=roof,facade=14,side_roof=True)
                occupied.append(footprint);houses+=1
                # Solar panels follow the front roof slope exactly and use the roof atlas.
                panel=[P(-25,height+roof*12/(depth/2)+.2,12),P(25,height+roof*12/(depth/2)+.2,12),P(25,height+roof*36/(depth/2)+.2,36),P(-25,height+roof*36/(depth/2)+.2,36)]
                town.chunks.add('land',ci,native.quad(panel,native.uv('land','solar'),(255,255,255),(si,1,-co)));roof_panels+=1
                # A thin, closed canopy and separate posts; no floating one-sided awning.
                port=P(12,0,-38)
                town.box(ci,(port[0],port[2]),48,34,1.2 if PASS>=6 else 3,'metal' if PASS>=6 else 'white',a,base=25)
                for xx in [-10,34]:
                    leg=P(xx,0,-34);town.box(ci,(leg[0],leg[2]),1 if PASS>=6 else 2,1 if PASS>=6 else 2,25,'metal' if PASS>=6 else 'brick',a)
                carports+=1
                garden=P(-28,0,-42)
                town.box(ci,(garden[0],garden[2]),22,10,9,'hedge',a)
                driveway=[P(0,0,-43),P(36,0,-43),P(36,0,0),P(0,0,0)]
                town.chunks.add('land' if PASS>=6 else 'road',ci,native.quad(driveway,native.uv('land','parking') if PASS>=6 else native.uv('surface','road'),(240,240,230),(0,1,0)))
    # Main-road and branch clearance also applies to the older entrance-name posts.
    town.street_name_avoid=unary_union([main_road.buffer(110),*[LineString(r).buffer(55)for r in segments],*([reserved.buffer(25)]if reserved is not None else[])])
    # Clear, correctly sized street plates on both sides of the entrance.
    for side,name,slot in [(-1,'Floralaan',6),(1,'De Meidoorn',7)]:
        if PASS>=6:
            town.street_plate(station,0,side*(native.ROAD+25),slot);continue
        p=town.p(station,.5,side*(native.ROAD+25),30);f=town.fwd(station)
        vs=[(p[0]-f[0]*18,p[1],p[2]-f[2]*18),(p[0]+f[0]*18,p[1],p[2]+f[2]*18),(p[0]+f[0]*18,p[1]+4.5,p[2]+f[2]*18),(p[0]-f[0]*18,p[1]+4.5,p[2]-f[2]*18)]
        town.chunks.add('land',station,native.quad(vs,native.two_sided_uv(native.uv('land',f'street{slot}')),(255,255,255),town.right(station)))
    destination=LineString(segments[1]).interpolate(.5,normalized=True)
    town.landmarks.extend([
        {'name':'Floralaan','chunk':station-4,'position':list(town.p(station-4,.5,0)),'highlight':True},
        {'name':'De Meidoorn','chunk':station,'position':[destination.x,0,destination.y],'highlight':True,
         'camera':{'eye':[start[0],22,start[2]],'target':[destination.x,25,destination.y]}}
    ])
    town.neighbourhood={'name':'De Meidoorn','parentStreet':'Floralaan','entranceChunk':station,
        'osmWays':[6854523,6854525,6854723],'translationWorld':list(shift),'roads':segments,
        'shortcutExitChunk':exit_station if through else None,'houses':houses,'carports':carports,'solarRoofs':roof_panels}
    return verge
