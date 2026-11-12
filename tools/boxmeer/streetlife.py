"""Solid street furniture plus native movable traffic cones."""
import math
from shapely.geometry import Polygon,Point

def lamp(town,b,i,t,off):
    p=town.p(i,t,off);x,z=p[0],p[2]
    if town.residential_clearance.contains(Point(x,z)):return
    if town.chunks.room('land',i)<14:return
    town.box(i,(x-.4,z-.4),.8,.8,49,'metal')
    town.box(i,(x,z-2.5),8,5,1.2,'metal',base=49)
    # Warm glass underside, physically mounted to the closed housing.
    town.face(i,[(x-3.5,49,z-2),(x+3.5,49,z-2),(x+3.5,49,z+2),(x-3.5,49,z+2)],'cream',(0,-1,0))

def furniture(town,b,uv):
    for title in ['De Weijer','Rochuskapel','Sint-Petrusbasiliek']:
        mark=next(m for m in town.landmarks if m['name']==title);i=mark['chunk'];side=town.side(i,(mark['position'][0]/10,mark['position'][2]/10))
        for d in [-2,2]:
            k=(i+d)%town.n;p=town.p(k,.5,side*140);f=town.fwd(k);yaw=math.atan2(f[2],f[0])+(math.pi if side>0 else 0)
            if town.chunks.room('land',k)<25:continue
            P=town.box(k,(p[0],p[2]),22,6,1,'wood',yaw,base=4)
            back=P(0,0,5);town.box(k,(back[0],back[2]),22,1,7,'wood',yaw,base=5)
            for x in [-8,8]:
                leg=P(x,0,2);town.box(k,(leg[0],leg[2]),1,3,4,'metal',yaw)
        # Low planters and leafy inserts flank the public forecourt.
        for d in [-1,1]:
            k=(i+d)%town.n;p=town.p(k,.25,side*145)
            if town.chunks.room('rail',k)>10:
                town.box(k,(p[0],p[2]),9,9,5,'cream')
                town.tree(k,.25,side*145,.22,'willow')
    # A small, legible bus shelter on Floralaan with a closed roof and steel supports.
    preferred=town.neighbourhood['entranceChunk']-7
    site=None
    for k in sorted(range(town.n),key=lambda k:min(abs(k-preferred),town.n-abs(k-preferred))):
        if getattr(town,'street_names',[])[k]!='Floralaan' or town.chunks.room('land',k)<30 or town.chunks.room('rail',k)<1:continue
        before,after=town.fwd((k-1)%town.n),town.fwd((k+1)%town.n)
        if abs(math.atan2(before[0]*after[2]-before[2]*after[0],before[0]*after[0]+before[2]*after[2]))>.16:continue
        f=town.fwd(k);angle=math.atan2(f[2],f[0]);co,si=math.cos(angle),math.sin(angle)
        for side in (-1,1):
            p=town.p(k,.4,side*155)
            footprint=Polygon([(p[0]+co*x-si*z,p[2]+si*x+co*z)for x,z in [(-16,-2),(16,-2),(16,12),(-16,12)]])
            if footprint.intersects(town.residential_roads.buffer(8)) or any(footprint.intersects(Polygon(q)) for q in town.parcels):continue
            site=(k,p,angle);break
        if site:break
    if site is None:raise RuntimeError('No complete, unobstructed Floralaan bus shelter site')
    i,p,yaw=site;co,si=math.cos(yaw),math.sin(yaw)
    P=lambda x,y,z:(p[0]+co*x-si*z,y,p[2]+si*x+co*z)
    for x in [-13,13]:
        for z in [0,9]:
            a=P(x,0,z);town.box(i,(a[0],a[2]),.8,.8,24,'metal',yaw)
    top=P(0,0,-1);town.box(i,(top[0],top[2]),30,12,1,'metal',yaw,base=24)
    glass=[P(-12,3,9),P(12,3,9),P(12,23,9),P(-12,23,9)]
    town.chunks.add('rail',i,b.quad(glass,b.two_sided_uv(uv('window')),(180,200,210),(si,0,-co)))
    town.scenery_counts={'solidLamps':getattr(town,'lamp_count',0),'benchSites':3,'planterSites':3,'busShelters':1,'busShelterChunk':i,'movableCones':6}

def cone_mesh(b,out,uv):
    faces=[];ring=lambda r:[(math.cos(k*math.tau/8)*r,math.sin(k*math.tau/8)*r)for k in range(8)]
    for k,(x,z)in enumerate(ring(1.8)):
        X,Z=ring(1.8)[(k+1)%8];xx,zz=ring(.25)[k];XX,ZZ=ring(.25)[(k+1)%8]
        faces.append(([(x,.6,z),(X,.6,Z),(XX,7,ZZ),(xx,7,zz)],uv('chevron'),b.norm((x+X,0,z+Z))))
    for y,r,N in [(0,2.2,(0,-1,0)),(.6,2.2,(0,1,0))]:
        faces.append(([(-r,y,-r),(r,y,-r),(r,y,r),(-r,y,r)],uv('slate'),N))
    # Close the square rubber plinth sides and the cone tip.
    for a,c,N in [((-2.2,-2.2),(2.2,-2.2),(0,0,-1)),((2.2,-2.2),(2.2,2.2),(1,0,0)),((2.2,2.2),(-2.2,2.2),(0,0,1)),((-2.2,2.2),(-2.2,-2.2),(-1,0,0))]:
        faces.append(([(a[0],0,a[1]),(c[0],0,c[1]),(c[0],.6,c[1]),(a[0],.6,a[1])],uv('slate'),N))
    faces.append(([(-.25,7,-.25),(.25,7,-.25),(.25,7,.25),(-.25,7,.25)],uv('chevron'),(0,1,0)))
    old=b.OUT;b.OUT=str(out)
    try:b.save_prop_mesh('bm_cone.d3d',faces)
    finally:b.OUT=old
