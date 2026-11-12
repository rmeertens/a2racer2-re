"""Race landmarks, visible recovery barriers and non-colliding start-line paint."""
import math
from shapely.geometry import Point,LineString
from PIL import Image,ImageDraw,ImageFont

GATES=[('floralaan','FLORALAAN'),('maasheggen','MAASHEGGEN'),('centrum','CENTRUM'),('finish','BOXMEER')]

def artwork_and_models(b,out):
    image=Image.new('RGB',(512,512),(39,59,60));d=ImageDraw.Draw(image)
    for row,(_,text)in enumerate(GATES):
        y=row*64;d.rectangle((0,y,511,y+63),fill=(27,66,70));d.rectangle((0,y+56,511,y+63),fill=(227,190,100))
        f=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf',34)
        d.text(((512-d.textlength(text,font=f))/2,y+9),text,font=f,fill=(247,239,213))
    for y in range(256,320,16):
        for x in range(0,512,16):d.rectangle((x,y,x+15,y+15),fill=(235,231,212)if(x//16+y//16)%2 else (38,44,44))
    d.rectangle((0,448,511,511),fill=(58,65,63));image.save(out/'bm_route.tga',format='TGA',compression=None)
    def mapping(row):return[(.002,(row+1)/8-.002),(.998,(row+1)/8-.002),(.998,row/8+.002),(.002,row/8+.002)]
    def box(faces,x0,x1,y0,y1,z0,z1,row):
        for vs,N in [([(x0,y0,z0),(x1,y0,z0),(x1,y1,z0),(x0,y1,z0)],(0,0,-1)),([(x1,y0,z1),(x0,y0,z1),(x0,y1,z1),(x1,y1,z1)],(0,0,1)),([(x0,y0,z1),(x0,y0,z0),(x0,y1,z0),(x0,y1,z1)],(-1,0,0)),([(x1,y0,z0),(x1,y0,z1),(x1,y1,z1),(x1,y1,z0)],(1,0,0)),([(x0,y1,z0),(x1,y1,z0),(x1,y1,z1),(x0,y1,z1)],(0,1,0)),([(x0,y0,z1),(x1,y0,z1),(x1,y0,z0),(x0,y0,z0)],(0,-1,0))]:faces.append((vs,mapping(row),N))
    old=b.OUT;b.OUT=str(out)
    try:
        for row,(name,_)in enumerate(GATES):
            faces=[];box(faces,-98,-95,0,80,-1.5,1.5,7);box(faces,95,98,0,80,-1.5,1.5,7)
            box(faces,-98,98,80,104,-1.5,1.5,row)
            if name=='finish':faces.append(([(-65,.035,-9),(65,.035,-9),(65,.035,9),(-65,.035,9)],mapping(4),(0,1,0)))
            b.save_prop_mesh(f'bm_gate_{name}.d3d',faces)
    finally:b.OUT=old

def add(town,b,uv):
    turns=[]
    for i in range(town.n):
        a,c=town.fr[(i-1)%town.n][0],town.fr[(i+1)%town.n][0]
        angle=math.atan2(a[0]*c[1]-a[1]*c[0],a[0]*c[0]+a[1]*c[1])
        if abs(angle)>.22 and all(min(abs(i-j),town.n-abs(i-j))>12 for j,_ in turns):turns.append((i,angle))
    for i,angle in turns:
        side=1 if angle>0 else -1;k=(i-2)%town.n;p=town.p(k,.5,side*(b.ROAD+43),16);right=town.right(k);forward=town.fwd(k)
        if town.chunks.room('land',k)<12 or town.chunks.room('rail',k)<1:continue
        if any(town.residential_clearance.contains(Point(*town.p(k,t,side*(b.ROAD+43))[::2])) for t in [.27,.5,.73]):continue
        vs=[(p[0]-right[0]*20,p[1],p[2]-right[2]*20),(p[0]+right[0]*20,p[1],p[2]+right[2]*20),(p[0]+right[0]*20,p[1]+10,p[2]+right[2]*20),(p[0]-right[0]*20,p[1]+10,p[2]-right[2]*20)]
        u=uv('chevron')
        if side>0:u=[u[1],u[0],u[3],u[2]]
        town.chunks.add('rail',k,b.quad(vs,u,(245,245,235),tuple(-x for x in forward)))
        for t in [.27,.73]:
            leg=town.p(k,t,side*(b.ROAD+43));town.box(k,(leg[0],leg[2]),1,1,16,'metal')
    # Waist-height metal rail catches a missed outer line, well beyond the pavement.
    for i,angle in sorted(turns,key=lambda p:-abs(p[1]))[:4]:
        side=1 if angle>0 else -1
        for di in [-1,0,1]:
            k=(i+di)%town.n;a=town.bank_point(k,.5,side*165,3);f=town.fwd(k);yaw=math.atan2(f[2],f[0])
            if town.chunks.room('land',k)<6:continue
            if town.residential_clearance.intersects(LineString([(a[0]-f[0]*60,a[2]-f[2]*60),(a[0]+f[0]*60,a[2]+f[2]*60)])):continue
            town.box(k,(a[0],a[2]),120,1.5,5,'metal',yaw,base=a[1])
    town.racing_sectors=[{'key':'floralaan','name':'Floralaan','chunk':town.neighbourhood['entranceChunk']-12},
                         {'key':'maasheggen','name':'Maasheggen','chunk':int(town.n*.42)},
                         {'key':'centrum','name':'Centrum','chunk':int(town.n*.79)},
                         {'key':'finish','name':'Start / finish','chunk':11}]
    town.turn_markers=[i for i,_ in turns]
