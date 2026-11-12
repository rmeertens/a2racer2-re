"""Closed, collidable hedge volumes in open escape routes. Never close an authored street."""
import math
from shapely.geometry import Point,LineString,Polygon
from shapely.ops import unary_union
from shapely.strtree import STRtree

def add(town,b):
    buildings=unary_union([Polygon(p) for p in town.parcels])
    roads=[LineString(town.c+[town.c[0]]).buffer(95)]
    branches=[town.neighbourhood,*town.side_streets]
    side_roads=[road for s in branches for road in s['roads']]
    roads.extend(LineString(road).buffer(55) for road in side_roads)
    exclusion=unary_union(roads).union(buildings.buffer(5))
    walls=[];heights=[]
    for row in town.chunks.lists:
        for planes in row.values():
            for vertices,mapping,colours,indices in planes:
                if all(u>=4 for u,v in mapping):continue
                a,c,d=[vertices[i] for i in indices[:3]]
                u=[c[k]-a[k] for k in range(3)];v=[d[k]-a[k] for k in range(3)]
                n=(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]);length=math.sqrt(sum(x*x for x in n))
                if length<.01 or abs(n[1])/length>.25:continue
                low=min(p[1]for p in vertices);high=max(p[1]for p in vertices)
                if high-low<10:continue
                pairs=[(p,q)for p in vertices for q in vertices]
                p,q=max(pairs,key=lambda pq:math.hypot(pq[1][0]-pq[0][0],pq[1][2]-pq[0][2]))
                if math.hypot(p[0]-q[0],p[2]-q[2])<1:continue
                walls.append(LineString([(p[0],p[2]),(q[0],q[2])]))
                heights.append((low,high))
    tree=STRtree(walls);segments=[];occupied=[];skipped=0
    def blocked(ray,ground):
        return any(heights[k][0]<=ground+7 and heights[k][1]>=ground+12 for k in tree.query(ray,predicate='intersects'))
    def lines(shape):
        if shape.is_empty:return[]
        if shape.geom_type=='LineString':return[shape]
        return[g for g in shape.geoms if g.geom_type=='LineString']
    def volume(line,ground,reason,preferred):
        nonlocal skipped
        # Keep the complete shell near its own chunk; do not borrow distant collision lists.
        local=[(preferred+d)%town.n for d in[0,1,-1,2,-2,3,-3,4,-4]]
        if sum(b.LIMITS[kind]-len(town.chunks.lists[i][kind])for i in local for kind in['extra','land'])<6:
            skipped+=1;return
        a,c=line.coords[0],line.coords[-1];dx,dz=c[0]-a[0],c[1]-a[1];length=math.hypot(dx,dz)
        if length<18:return
        nx,nz=-dz/length,dx/length;width=7
        footprint=LineString([a,c]).buffer(width/2,cap_style=2)
        if footprint.intersects(exclusion)or any(footprint.intersection(p).area>1 for p in occupied):return
        ys=[ground(a)-1,ground(c)-1];base=[(a[0]-nx*width/2,ys[0],a[1]-nz*width/2),(c[0]-nx*width/2,ys[1],c[1]-nz*width/2),(c[0]+nx*width/2,ys[1],c[1]+nz*width/2),(a[0]+nx*width/2,ys[0],a[1]+nz*width/2)]
        height=20;top=[(x,y+height,z)for x,y,z in base];center=[sum(p[k] for p in base)/4+(height/2 if k==1 else 0)for k in range(3)];faces=[]
        def reserve(kind,plane):
            if not any(len(town.chunks.lists[i][kind])<b.LIMITS[kind]for i in local):
                kind='extra' if kind=='land' else 'land';plane=(plane[0],[(19/1024,35/1024)]*4 if kind=='extra' else b.uv('land','grass'),plane[2],plane[3])
            ci=next(i for i in local if len(town.chunks.lists[i][kind])<b.LIMITS[kind]);town.chunks.lists[ci][kind].append(plane);faces.append(plane)
        for k in range(4):
            j=(k+1)%4;points=[base[k],base[j],top[j],top[k]];mid=[sum(p[n]for p in points)/4 for n in range(3)];normal=b.norm((mid[0]-center[0],0,mid[2]-center[2]))
            # Classic mode samples a pale frame pixel from the original AI facade sheet,
            # tinted hedge green. The enhanced scene maps the existing AI leaf texture.
            reserve('extra',b.quad(points,[(19/1024,35/1024)]*4,(105,145,82),normal))
            walls.append(LineString([(base[k][0],base[k][2]),(base[j][0],base[j][2])]))
            heights.append((min(p[1]for p in points),max(p[1]for p in points)))
        reserve('land',b.quad(top,b.uv('land','grass'),(178,201,140),(0,1,0)))
        reserve('land',b.quad(base,b.uv('land','grass'),(90,110,75),(0,-1,0)))
        town.buildings.append({'chunk':preferred,'center':center,'height':height,'roof':0,'faces':faces,'boundary':'hedge'})
        tree_at=[center[0]+nx*12,ground((center[0],center[2])),center[2]+nz*12]
        plant_tree=len(segments)%9==0 and length>45 and not buildings.buffer(15).contains(Point(tree_at[0],tree_at[2]))
        segments.append({'chunk':preferred,'a':list(a),'b':list(c),'baseHeights':ys,'height':height,'thickness':width,'reason':reason,'tree':tree_at if plant_tree else None})
        occupied.append(footprint)
    def offer(line,ground,reason,chunk):
        for piece in lines(line.difference(exclusion.buffer(5))):
            # Limit a shell to 12 m so collision-list locality remains predictable.
            count=max(1,math.ceil(piece.length/120))
            for k in range(count):
                a=piece.interpolate(k/count,normalized=True);c=piece.interpolate((k+1)/count,normalized=True)
                volume(LineString([a,c]),ground,reason,chunk)
    # Street ends, especially De Meidoorn, get first claim on local collision space.
    nodes=[p for road in side_roads for p in road]
    for road in side_roads:
        for end in[0,len(road)-1]:
            p=road[end];q=road[1 if end==0 else -2]
            if sum(math.dist(p,r)<2 for r in nodes)>1 or LineString(town.c+[town.c[0]]).distance(Point(p))<130:continue
            dx,dz=p[0]-q[0],p[1]-q[1];length=math.hypot(dx,dz);dx/=length;dz/=length
            mid=(p[0]+dx*62,p[1]+dz*62);line=LineString([(mid[0]-dz*58,mid[1]+dx*58),(mid[0]+dz*58,mid[1]-dx*58)])
            offer(line,lambda p:0,'street end',town.near((mid[0]/10,mid[1]/10)))
    # Fill the actual openings between existing solid scenery, rather than laying a second ring everywhere.
    for i in range(town.n):
        length=math.dist(town.c[i],town.c[(i+1)%town.n]);steps=max(1,math.ceil(length/20))
        for side in[-1,1]:
            start=None
            def emit(t0,t1):
                a=town.bank_point(i,t0,side*180);c=town.bank_point(i,t1,side*180);dx,dz=c[0]-a[0],c[2]-a[2];den=dx*dx+dz*dz or 1
                ground=lambda p:a[1]+(c[1]-a[1])*max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[2])*dz)/den))
                offer(LineString([(a[0],a[2]),(c[0],c[2])]),ground,'circuit gap',i)
            for k in range(steps+1):
                missing=False
                if k<steps:
                    t=(k+.5)/steps;a=town.p(i,t,side*85);c=town.bank_point(i,t,side*230);g=town.bank_point(i,t,side*180)[1]
                    missing=not blocked(LineString([(a[0],a[2]),(c[0],c[2])]),g)
                if missing and start is None:start=k/steps
                if not missing and start is not None:emit(start,k/steps);start=None
    # Garden edges alongside each mapped side street, preserving all joining roads.
    for road in side_roads:
        for a,c in zip(road,road[1:]):
            dx,dz=c[0]-a[0],c[1]-a[1];length=math.hypot(dx,dz)
            if length<1:continue
            nx,nz=-dz/length,dx/length
            for side in[-1,1]:
                line=LineString([(a[0]+nx*side*82,a[1]+nz*side*82),(c[0]+nx*side*82,c[1]+nz*side*82)])
                count=max(1,math.ceil(length/80))
                for k in range(count):
                    p=line.interpolate(k/count,normalized=True);q=line.interpolate((k+1)/count,normalized=True);mid=line.interpolate((k+.5)/count,normalized=True);onroad=(mid.x-nx*side*82,mid.y-nz*side*82)
                    if blocked(LineString([onroad,(mid.x+nx*side*28,mid.y+nz*side*28)]),0):continue
                    chunk=town.near((mid.x/10,mid.y/10));offer(LineString([p,q]),lambda p:0,'side-street garden edge',chunk)
    tree=STRtree(walls);side_access=unary_union([LineString(r).buffer(55)for r in side_roads]);checked=0;covered=0;openings=[]
    for i in range(town.n):
        for side in[-1,1]:
            for t in[.2,.5,.8]:
                a=town.p(i,t,side*85);c=town.bank_point(i,t,side*230);ray=LineString([(a[0],a[2]),(c[0],c[2])])
                if ray.intersects(side_access):continue
                checked+=1;hit=blocked(ray,town.bank_point(i,t,side*180)[1]);covered+=hit
                if not hit:openings.append({'chunk':i,'side':side,'t':t})
    town.natural_boundaries={'newHedgeVolumes':len(segments),'treeGroups':sum(bool(s['tree'])for s in segments),'heightMetres':2,'segments':segments,'budgetSkipped':skipped,'escapeRayCoverage':{'checked':checked,'covered':covered,'fraction':covered/max(1,checked),'openings':openings}}
