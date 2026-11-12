"""Closed landmark architecture and grounds, kept away from the racing line."""
import math

def chapel(town,b,uv,i,center,yaw):
    x,z=center;n=6;radius=38;h=60;peak=100
    ring=[(x+math.cos(yaw+math.tau*k/n)*radius,0,z+math.sin(yaw+math.tau*k/n)*radius)for k in range(n)]
    faces=[]
    for k,a in enumerate(ring):
        c=ring[(k+1)%n];N=(a[0]+c[0]-2*x,0,a[2]+c[2]-2*z)
        faces.append(town.face(i,[a,c,(c[0],h,c[2]),(a[0],h,a[2])],'brick',N))
        plane=b.closed_tri((a[0],h,a[2]),(c[0],h,c[2]),(x,peak,z),b.uv('land','slate'),(235,235,235),(N[0],50,N[2]));town.chunks.add('land',i,plane);faces.append(plane)
    town.buildings.append({'chunk':i,'center':[x,h*.45,z],'height':h,'roof':peak-h,'faces':faces})
    town.box(i,(x-1,z-1),2,2,16,'cream',base=peak)
    town.box(i,(x-7,z-1),14,2,2,'cream',base=peak+10)

def decorate(town,b,uv,title,i,side,P,yaw):
    def block(x,z,w,d,h,mat='cream',base=0):
        p=P(x,0,z);return town.box(i,(p[0],p[2]),w,d,h,mat,yaw,base=base)
    if title=='Sint-Petrusbasiliek':
        # Stone stringcourses and four readable clock faces on the belfry.
        block(-125,20,98,98,3,base=255)
        for x0,z0,x1,z1 in [(-145,19,-105,19),(-145,116,-105,116),(-174,47,-174,87),(-76,47,-76,87)]:
            a=P(x0,300,z0);c=P(x1,300,z1);vs=[a,c,(c[0],c[1]+40,c[2]),(a[0],a[1]+40,a[2])]
            plane=b.quad(vs,b.two_sided_uv(b.uv('land','clock')),(255,255,255),(c[2]-a[2],0,a[0]-c[0]));town.chunks.add('land',i,plane)
        for dx in [-116,116]:block(dx,20,7,340,95,'brick')
    elif title=='Kasteel Boxmeer':
        # A real forecourt, with a framed entrance and a continuous drive.
        yard=[P(-285,0,-70),P(285,0,-70),P(285,0,0),P(-285,0,0)]
        town.chunks.add('road',i,b.quad(yard,b.uv('surface','road'),(238,238,228),(0,1,0)));town.road_corridor.append([(v[0],v[2])for v in yard])
        for dx in [-70,70]:block(dx,-65,12,12,43,'white')
        for dx in [-200,200]:block(dx,-55,120,10,9,'hedge')
    elif title=='De Weijer':
        # Park lawn, pond and limes beside the cultural centre.
        pond=[P(220,0,0),P(370,0,0),P(370,0,190),P(220,0,190)]
        town.extra_water.append([(v[0]/10,v[2]/10)for v in pond])
        for d in [-3,-1,1,3]:town.tree(i+d,.5,side*420,1.15,'tree')
        for d in [-2,0,2]:town.tree(i+d,.25,side*650,.9,'birch')
    elif title=='Karmelklooster':
        for dx in [-23,23]:block(dx,-32,8,32,32,'brick')
        block(0,-32,54,32,6,'brick',base=32)
        door=[P(-15,0,-.1),P(15,0,-.1),P(15,30,-.1),P(-15,30,-.1)]
        town.chunks.add('land',i,b.quad(door,b.uv('land','door'),(245,245,235),(math.sin(yaw),0,-math.cos(yaw))))
        court=[P(-180,0,-85),P(180,0,-85),P(180,0,0),P(-180,0,0)]
        town.chunks.add('road',i,b.quad(court,b.uv('surface','road'),(240,240,232),(0,1,0)));town.road_corridor.append([(v[0],v[2])for v in court])
