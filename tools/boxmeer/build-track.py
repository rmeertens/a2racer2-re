#!/usr/bin/env python3
"""Reproducible Boxmeer native track. Reuses Vianen's binary/geometry primitives, not its town."""
import importlib.util,sys,os,json,math,struct,random
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFont,ImageOps
from shapely.geometry import Polygon,Point,LineString
from shapely.ops import unary_union
from polish import PASS, configure
from wayfinding import artwork_and_models as race_models, add as add_wayfinding
import movable
import natural_edges
import tree_collisions
from streetlife import lamp as street_lamp, furniture, cone_mesh
from landmarks import chapel as build_chapel, decorate as decorate_landmark
from neighbourhood import add_neighbourhood
from side_streets import plan as plan_side_streets, add as add_side_streets
from ai_textures import build_textures as build_ai_textures, sources as ai_sources, facade as ai_facade, cell as ai_cell
from presentation_art import build as build_presentation_art
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools/vianen'))
spec=importlib.util.spec_from_file_location('native',ROOT/'tools/vianen/build-track.py'); b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
configure(b)
SRC=ROOT/'source/assets/boxmeer'; OUT=ROOT/'public/assets/boxmeer'; OUT.mkdir(parents=True,exist_ok=True)
LAT,LON=51.650,5.947
KX=math.cos(math.radians(LAT))*111320
M=lambda lon,lat:((lon-LON)*KX,(lat-LAT)*110540)
FONT='/System/Library/Fonts/Supplemental/Arial.ttf'
def font(n):return ImageFont.truetype(FONT,n)
def write(name,data): (OUT/name).write_bytes(data)
def save(name,im):im.convert('RGB').save(OUT/name,compression=None)
def read_osm():
 j=json.loads((SRC/'osm.json').read_text()); nodes={e['id']:M(e['lon'],e['lat']) for e in j['elements'] if e['type']=='node'}
 return nodes,[e for e in j['elements'] if e['type']=='way']
nodes,ways=read_osm()
b.SURFACE['plain_asphalt']=(256,0,450,256)
b.LAND['solar']=(384,384,512,512)
b.LAND['willow']=(256,128,384,256)
b.LAND['birch']=(384,128,512,256)
b.LAND['clock']=(448,0,512,64)
b.LAND['door']=(448,64,512,128)
b.LAND['parking']=(256,384,384,512)
b.LAND['metal']=(384,0,448,128)
b.LAND['wood']=(0,384,128,512)
# All facade cells contain wall only; roofs and projecting details have separate geometry.
STREETS=['Spoorstraat','Steenstraat','Hoogendijk','Veerstraat','Egmond','Het Zand','Floralaan','De Meidoorn']
CELLS=['brick','cream','slate','tiles','tree','hedge','church','castle','monastery','riche','sign','lamp','tower','window','white','chevron']
MAT={k:((i%4)*256,(i//4)*256,(i%4+1)*256,(i//4+1)*256) for i,k in enumerate(CELLS)}
# The old lamp sprite cell is unused by the solid lamps; fit four readable street plates there.
for k in range(4):MAT[f'side_street{k}']=(768,512+k*64,1024,576+k*64)
def uv(name):
 x,y,X,Y=MAT[name];return [( (x+.8)/1024,(Y-.8)/1024),((X-.8)/1024,(Y-.8)/1024),((X-.8)/1024,(y+.8)/1024),((x+.8)/1024,(y+.8)/1024)]
def label(im,text,y,size=25,fill=(242,229,201)):
 d=ImageDraw.Draw(im);f=font(size)
 while d.textlength(text,font=f)>240:size-=1;f=font(size)
 d.text(((256-d.textlength(text,font=f))/2,y),text,font=f,fill=fill)
def window(d,x,y,w,h):
 d.rectangle((x-3,y-3,x+w+3,y+h+3),fill=(211,204,181));d.rectangle((x,y,x+w,y+h),fill=(44,64,71));d.polygon([(x+2,y+2),(x+w-2,y+2),(x+2,y+h-2)],fill=(87,113,122));d.line((x+w/2,y,x+w/2,y+h),fill=(224,218,196),width=3);d.line((x,y+h*.43,x+w,y+h*.43),fill=(224,218,196),width=3)

def textures():
 build_ai_textures(b,SRC,OUT,MAT,STREETS)
 build_presentation_art(SRC,OUT)

def facade_uv(k):
 x,y=(k%4)*.25,(k//4)*.25;e=.8/1024
 return [(x+e,y+.25-e),(x+.25-e,y+.25-e),(x+.25-e,y+e),(x+e,y+e)]
class Boxmeer(b.Town):
 def __init__(self,c):super().__init__(c);self.buildings=[];self.landmarks=[];self.extra_water=[]
 def bank_point(self,i,t,off,y=0):
  p=self.p(i,t,off,y)
  if not hasattr(self,'terrain_raised_profile'):return p
  _,crest,toe=self.terrain_raised_profile
  blend=max(0,min(1,(abs(off)-crest)/(toe-crest)))
  ground=self.ground[i%self.n]*(1-t)+self.ground[(i+1)%self.n]*t
  if ground<self.terrain_raised_threshold:return p
  return (p[0],(ground+b.KERB_HEIGHT)*(1-blend)-blend+y,p[2])
 def face(self,i,vs,material,normal,kind='rail',tint=(255,255,255)):
  if material in ['metal','wood']:kind='land'
  p=b.quad(vs,b.uv('land',material) if kind=='land' else uv(material),tint,normal);self.chunks.add(kind,i,p);return p
 def box(self,i,center,w,depth,h,material='brick',yaw=0,roof=0,facade=None,base=0,side_roof=False,hip=False,roof_material='slate'):
  # Local x along frontage, z into parcel. All exposed walls and gables close exactly.
  required_land=5 if material in ['metal','wood'] else (4 if roof and hip else 2 if roof else 1)
  if self.chunks.room('land',i)<required_land:raise RuntimeError(f'No room for complete {material} volume at {i}')
  x,z=center;co,si=math.cos(yaw),math.sin(yaw)
  P=lambda a,y,c:(x+co*a-si*c,y+base,z+si*a+co*c)
  normal=lambda a,c:(co*a-si*c,0,si*a+co*c)
  corners=[P(-w/2,0,0),P(w/2,0,0),P(w/2,0,depth),P(-w/2,0,depth)]
  poly=Polygon([(p[0],p[2]) for p in corners]);self.parcels.append(list(poly.exterior.coords)[:-1]);faces=[]
  for a,c,N in [(0,1,normal(0,-1)),(1,2,normal(1,0)),(2,3,normal(0,1)),(3,0,normal(-1,0))]:
   vs=[corners[a],corners[c],tuple(v+(h if k==1 else 0) for k,v in enumerate(corners[c])),tuple(v+(h if k==1 else 0) for k,v in enumerate(corners[a]))]
   if facade is not None and a in (0,2):
    p=b.quad(vs,facade_uv(facade),(255,255,255),N);self.chunks.add('extra',i,p);faces.append(p)
   else:faces.append(self.face(i,vs,material,N))
  if roof:
   l0,r0,l1,r1=P(-w/2,h,0),P(w/2,h,0),P(-w/2,h,depth),P(w/2,h,depth)
   if hip:
    inset=min(depth*.3,w*.45);a,c=P(0,h+roof,inset),P(0,h+roof,depth-inset)
    for verts,N in [([l0,l1,c,a],(-co,1,-si)),([a,c,r1,r0],(co,1,si))]:faces.append(self.face(i,verts,roof_material,N,'land'))
    for aa,bb,cc,N in [(l0,r0,a,normal(0,-1)),(r1,l1,c,normal(0,1))]:
     plane=b.closed_tri(aa,bb,cc,b.uv('land',roof_material),(235,235,235),N);self.chunks.add('land',i,plane);faces.append(plane)
    ends=[]
   elif side_roof:
    a,c=P(-w/2,h+roof,depth/2),P(w/2,h+roof,depth/2)
    faces.append(self.face(i,[l0,r0,c,a],roof_material,normal(0,-1),'land'));faces.append(self.face(i,[a,c,r1,l1],roof_material,normal(0,1),'land'))
    ends=[(l1,l0,a,normal(-1,0)),(r0,r1,c,normal(1,0))]
   else:
    a,c=P(0,h+roof,0),P(0,h+roof,depth)
    faces.append(self.face(i,[l0,l1,c,a],roof_material,(-co,1,-si),'land'));faces.append(self.face(i,[a,c,r1,r0],roof_material,(co,1,si),'land'))
    ends=[(l0,r0,a,normal(0,-1)),(r1,l1,c,normal(0,1))]
   for aa,bb,cc,N in ends:
    p=b.closed_tri(aa,bb,cc,uv('cream' if material in ['castle','cream'] else 'brick'),(255,255,255),N);self.chunks.add('rail',i,p);faces.append(p)
  else:faces.append(self.face(i,[P(-w/2,h,0),P(w/2,h,0),P(w/2,h,depth),P(-w/2,h,depth)],'grass' if material=='hedge' else material if material in ['wood','metal'] else 'slate',(0,1,0),'land'))
  if PASS>=8 and facade is not None and h>=48 and i%2==0 and self.chunks.room('land',i)>10:
   eave=[P(-w/2, h-.8,-.4),P(w/2,h-.8,-.4),P(w/2,h+.8,-.4),P(-w/2,h+.8,-.4)]
   self.chunks.add('land',i,b.quad(eave,b.uv('land','pavement'),(232,226,209),normal(0,-1)))
   gutter=[P(-w/2,h+.8,-.4),P(w/2,h+.8,-.4),P(w/2,h+.8,1.0),P(-w/2,h+.8,1.0)]
   self.chunks.add('land',i,b.quad(gutter,b.uv('land','metal'),(205,208,203),(0,1,0)))
  if PASS>=3 and facade is not None and h>=52 and w>=70 and i%3==0 and self.chunks.room('rail',i)>10:
   for side in [-1,1]:
    aa=P(side*(w/2+.05),20,depth*.28);bb=P(side*(w/2+.05),20,depth*.65)
    vs=[aa,bb,(bb[0],bb[1]+16,bb[2]),(aa[0],aa[1]+16,aa[2])]
    self.chunks.add('rail',i,b.quad(vs,uv('window'),(230,230,230),normal(side,0)))
  self.buildings.append({'chunk':i,'center':list(P(0,h*.45,depth/2)),'height':h,'roof':roof,'faces':faces})
  return P
 def tree(self,i,t,off,scale=1,species='tree'):
  # Three crossing cards retain foliage in rear and oblique views; trunks are scenery clear of lanes.
  off=math.copysign(max(abs(off),130),off)
  p=self.bank_point(i,t,off);w,h=100*scale,150*scale
  if hasattr(self,'residential_clearance') and self.residential_clearance.contains(Point(p[0],p[2])):return
  kind='land' if species in ['willow','birch'] else 'rail'
  if self.chunks.room(kind,i)<3:return
  mapping=b.uv('land',species)if kind=='land' else uv('tree')
  faces=[]
  for a in [0,math.pi/3,math.pi*2/3]:
   dx,dz=math.cos(a)*w/2,math.sin(a)*w/2
   vs=[(p[0]-dx,p[1],p[2]-dz),(p[0]+dx,p[1],p[2]+dz),(p[0]+dx,p[1]+h,p[2]+dz),(p[0]-dx,p[1]+h,p[2]-dz)]
   plane=b.quad(vs,b.two_sided_uv(mapping),(255,255,255),(dz,0,-dx));self.chunks.add(kind,i,plane);faces.append(plane)
  if not hasattr(self,'tree_scenery'):self.tree_scenery=[]
  self.tree_scenery.append({'chunk':i,'position':list(p),'height':h,'width':w,'birch':kind=='land','faces':faces})
 def hedge_strip(self,i,s,off=180,height=12):
  if self.chunks.room('rail',i)<5:return
  A=lambda t,d,y:self.bank_point(i,t,s*d,y)
  front=[A(0,off,0),A(1,off,0),A(1,off,height),A(0,off,height)]
  back=[A(1,off+12,0),A(0,off+12,0),A(0,off+12,height),A(1,off+12,height)]
  for vs,N in [(front,tuple(-s*x for x in self.right(i))),(back,tuple(s*x for x in self.right(i)))]:self.face(i,vs,'hedge',N)
  for t,N in [(0,tuple(-x for x in self.fwd(i))),(1,self.fwd(i))]:self.face(i,[A(t,off,0),A(t,off+12,0),A(t,off+12,height),A(t,off,height)],'hedge',N)
  self.face(i,[A(0,off,height),A(1,off,height),A(1,off+12,height),A(0,off+12,height)],'grass',(0,1,0),'land')
 def street_plate(self,i,t,off,slot):
  f=self.fwd(i);N=self.right(i);avoid=getattr(self,'street_name_avoid',LineString(self.c+[self.c[0]]).buffer(110));site=None
  for extra in[0,25,50,100,175,250]:
   candidate=math.copysign(max(abs(off),130)+extra,off);a=self.p(i,t,candidate,28)
   footprint=LineString([(a[0]-f[0]*15,a[2]-f[2]*15),(a[0]+f[0]*15,a[2]+f[2]*15)]).buffer(2)
   if footprint.intersects(avoid) or any(footprint.intersects(Polygon(p).buffer(2))for p in self.parcels):continue
   site=(a,candidate);break
  if site is None:return
  a,off=site
  if not hasattr(self,'street_name_signs'):self.street_name_signs=[]
  self.street_name_signs.append({'chunk':i,'slot':slot,'position':list(a),'mainRoadClearanceMetres':footprint.distance(LineString(self.c+[self.c[0]]))/10})
  vs=[(a[0]-f[0]*15,a[1],a[2]-f[2]*15),(a[0]+f[0]*15,a[1],a[2]+f[2]*15),(a[0]+f[0]*15,a[1]+4,a[2]+f[2]*15),(a[0]-f[0]*15,a[1]+4,a[2]-f[2]*15)]
  for side in [-1,1]:
   normal=tuple(side*x for x in N);shifted=[(x+normal[0]*.1,y,z+normal[2]*.1)for x,y,z in vs]
   self.chunks.add('land',i,b.quad(shifted,b.wall_uv('land',f'street{slot}',shifted,normal),(245,245,245),normal))
  post=self.p(i,t,off);self.box(i,(post[0]-.5,post[2]-.5),1,1,28,'metal',base=post[1])
 def board(self,i,material='sign',off=110):
  a=self.p(i,.5,off,28);fw=self.fwd(i);right=self.right(i);w=12;h=15
  vs=[(a[0]-right[0]*w,a[1],a[2]-right[2]*w),(a[0]+right[0]*w,a[1],a[2]+right[2]*w),(a[0]+right[0]*w,a[1]+h,a[2]+right[2]*w),(a[0]-right[0]*w,a[1]+h,a[2]-right[2]*w)]
  self.chunks.add('rail',i,b.quad(vs,b.two_sided_uv(uv(material)),(255,255,255),tuple(-x for x in fw)))

def build():
 route=json.loads((SRC/'route.json').read_text())['points'];lap=[M(*p) for p in route]
 # Restore the northern Floralaan bend from OSM. The sketched shortcut used to
 # collapse Acacia and Jasmijn onto Meidoorn's junction when fitted to the lap.
 flora_way=next(w for w in ways if w['id']==6891687)
 lap=lap[:10]+[nodes[k] for k in flora_way['nodes'][13:]]+lap[20:]
 fine=b.resample_step([(x*10,z*10) for x,z in b.chaikin(lap,2)],16)
 original=list(fine)
 for _ in range(600):
  if b.radius(fine)>=440:break
  fine=b.relax(fine,20)
  # Keep real junctions close to the street data while rounding tight corners.
  for k,(x,z) in enumerate(original):
   if x/10 < (5.941-LON)*KX and z/10 > (51.6537-LAT)*110540:
    dx,dz=fine[k][0]-x,fine[k][1]-z;distance=math.hypot(dx,dz)
    if distance>120:fine[k]=(x+dx*120/distance,z+dz*120/distance)
 c=b.resample_step(b.relax(b.resample_step(fine,128),32),128);town=Boxmeer(c);n=town.n
 if PASS>=10:
  # Begin the dike after the residential junctions, keeping all side-street
  # entrances at grade instead of meeting a rising main-road embankment.
  town.lift([50 if n*.40<=i<=n*.60 else 0 for i in range(n)],smooth=70)
  town.terrain_raised_profile=(b.WALK,b.WALK+40,b.WALK+180)
  town.terrain_raised_height=b.KERB_HEIGHT
  town.terrain_raised_threshold=.05
 road=LineString(c+[c[0]]);rng=random.Random(20261112)
 # Match rough sketch to nearby OSM roads for street names/surface character, preserving its shape.
 named=[]
 for w in ways:
  pts=[nodes[k] for k in w['nodes'] if k in nodes]
  if len(pts)>1 and w.get('tags',{}).get('highway') and w['tags'].get('name'):named.append((LineString([(x*10,z*10) for x,z in pts]),w['tags']['name']))
 names=[min(named,key=lambda v:v[0].distance(Point(p)))[1] for p in c]
 flora=town.near(M(5.9402065,51.655429))
 for i in range(flora-12,flora+10):names[i]='Floralaan'
 town.street_names=names
 town.has_road_dashes=lambda i:names[i] not in ['Steenstraat','Spoorstraat','Koorstraat']
 # Keep the race at grade; the geographical dike is represented by its open shoulders, not stunt ramps.
 for i in range(n):
  for s in [-1,1]:town.line[i,s]=100 if names[i] in ['Steenstraat','Spoorstraat'] else 110
 town.street()
 for i,name in enumerate(names):
  if PASS>=4:
   x,z=c[i];rural=(LAT+z/10/110540>51.6535 or (LON+x/10/KX>5.953 and LAT+z/10/110540>51.6495))and names[i]!='Floralaan'
   if rural:
    town.chunks.lists[i]['land']=[(vs,b.uv('land','grass'),(210,224,192),indices)for vs,_,colour,indices in town.chunks.lists[i]['land']]
  if name=='Floralaan':
   tile=b.uv('surface','plain_asphalt')
   for k in [0,1]:
    vs,_,colour,indices=town.chunks.lists[i]['road'][k]
    town.chunks.lists[i]['road'][k]=(vs,[tile[0],tile[3],tile[2],tile[1]],colour,indices)
 if PASS>=8:
  # Short road panels retain texture detail when the near plane crosses the road.
  for i in range(n):
   originals=town.chunks.lists[i]['road'][:2];town.chunks.lists[i]['road'][:2]=[]
   for vs,mapping,colour,indices in originals:
    L=lambda a,c,t:tuple(x+(y-x)*t for x,y in zip(a,c))
    divisions=4 if names[i] in ['Steenstraat','Spoorstraat','Koorstraat'] else 2
    for j in range(divisions):
     ta,tb=j/divisions,(j+1)/divisions
     vertices=[L(vs[0],vs[1],ta),L(vs[0],vs[1],tb),L(vs[3],vs[2],tb),L(vs[3],vs[2],ta)]
     # Reuse a four-metre longitudinal portion of the authored paving tile.
     part=[mapping[0],(mapping[1][0],mapping[0][1]+(mapping[1][1]-mapping[0][1])/divisions),(mapping[2][0],mapping[3][1]+(mapping[2][1]-mapping[3][1])/divisions),mapping[3]]
     town.chunks.add('road',i,(vertices,part,colour,indices))
 town.terrain_corridor_padding=0
 town.terrain_corridor_simplify=0
 for i in range(n):
  for s in [-1,1]:
   off=s*town.at(i,s);vs=[town.p(i,0,off,-1),town.p(i,1,off,-1),town.p(i,1,off,b.KERB_HEIGHT),town.p(i,0,off,b.KERB_HEIGHT)]
   town.chunks.add('land',i,b.quad(vs,b.uv('land','pavement'),(220,220,210),tuple(s*x for x in town.right(i))))
 # Landmark sites use recognisable silhouettes and deliberately face the nearby race approach.
 sites=[('Sint-Petrusbasiliek',5.95295,51.64702,'church'),('Kasteel Boxmeer',5.9571,51.6520,'castle'),('De Weijer',5.95067,51.64943,'monastery'),('Karmelklooster',5.9523,51.64725,'monastery'),('Rochuskapel',5.9451,51.6487,'church'),('Riche',5.951,51.64735,'riche')]
 reserves=[]
 for title,lon,lat,mat in sites:
  x,z=M(lon,lat);i=town.near((x,z));s=town.side(i,(x,z));fw=town.fwd(i);yaw=math.atan2(fw[2],fw[0]);p=town.p(i,.5,s*(town.at(i,s)+100));yaw+=math.pi if s>0 else 0
  # Move landmarks onto visible parcels: documented game-scale geography, not a survey.
  if title=='Sint-Petrusbasiliek':
   P=town.box(i,(p[0],p[2]),200,380,180,'church',yaw,roof=105)
   tp=P(-125,0,20);T=town.box(i,(tp[0],tp[2]),95,95,260,'brick',yaw)
   town.box(i,(tp[0],tp[2]),95,95,90,'tower',yaw,base=260)
   cap=[T(-47.5,350,0),T(47.5,350,0),T(47.5,350,95),T(-47.5,350,95)]
   tip=T(0,490,47.5)
   for k in range(4):
    aa,bb=cap[k],cap[(k+1)%4];N=b.norm((aa[0]+bb[0]-2*tip[0],100,aa[2]+bb[2]-2*tip[2]));town.chunks.add('rail',i,b.closed_tri(aa,bb,tip,uv('slate'),(255,255,255),N))
   cp=P(0,0,135);town.box(i,(cp[0],cp[2]),340,110,165,'church',yaw,roof=90)
  elif title=='Kasteel Boxmeer':
   P=town.box(i,(p[0],p[2]),400,160,115,'castle',yaw,roof=55,side_roof=True,hip=PASS>=5)
   for dx in [-230,170]:
    wp=P(dx,0,0);town.box(i,(wp[0],wp[2]),90,330,120,'cream',yaw,roof=45,hip=PASS>=5)
   cp=P(0,0,80);town.box(i,(cp[0],cp[2]),22,22,38,'cream',yaw,roof=40,base=160 if PASS>=5 else 210)
  elif title=='Rochuskapel':
   if PASS>=5:build_chapel(town,b,uv,i,(p[0],p[2]),yaw)
   else:town.box(i,(p[0],p[2]),60,65,65,'church',yaw,roof=45)
  else:P=town.box(i,(p[0],p[2]),320 if title=='Karmelklooster' and PASS>=5 else 260,130 if PASS>=5 else 160,84 if PASS>=5 else 100,mat,yaw,roof=32 if PASS>=5 else 70,side_roof=True)
  if PASS>=5 and title!='Rochuskapel':decorate_landmark(town,b,uv,title,i,s,P,yaw)
  for di in range(-4,5):reserves.append(((i+di)%n,s))
  town.landmarks.append({'name':title,'chunk':i,'position':[p[0],p[1],p[2]]})
 side_groups,side_shape=plan_side_streets(town,nodes,ways,road)
 neighbourhood = add_neighbourhood(town,b,uv,M,nodes,ways,road,reserved=side_shape,shortcut=False)
 neighbourhood=neighbourhood.union(add_side_streets(town,b,uv,side_groups,side_shape,road,neighbourhood))
 town.residential_roads=neighbourhood
 town.residential_clearance=neighbourhood.buffer(20)
 for group in side_groups:
  for entry in group['entrances']:
   ci=entry['chunk'];inside=entry['probe'][1];side=town.side(ci,(inside[0]/10,inside[1]/10))
   for di in range(-2,3):reserves.append(((ci+di)%n,side))
 if PASS>=7:
  for di in [-8,-7,-6]:reserves.append(((flora+di)%n,-1))
 # Town rows: individual complete volumes with authentic low residential scale in the west.
 corridor=road.buffer(125)
 for i,(x,z) in enumerate(c):
  lon=LON+x/10/KX;lat=LAT+z/10/110540
  rural=(lat>51.6535 or (lon>5.953 and lat>51.6495)) and names[i]!='Floralaan'
  for s in [-1,1]:
   if (i,s) in reserves or (s==1 and flora-5<=i<=flora+10):continue
   if rural:
    # Braided field hedges are low closed solids, leaving the long sightline open.
    if PASS>=4:town.hedge_strip(i,s,height=20+2*math.sin(i*.25))
    elif i%2==0:
     a=town.p(i,0,s*(180 if PASS>=2 else 125));f=town.fwd(i);yaw=math.atan2(f[2],f[0])+(math.pi if s>0 else 0)
     town.box(i,(a[0],a[2]),225,12,14,'hedge',yaw)
    if i%5==0:town.tree(i,.5,s*(300 if PASS>=2 else 230),1.0,'willow' if PASS>=4 else 'tree')
    if PASS>=4 and i%7==0:
     town.tree(i,.2,s*850,1.5,'birch');town.tree(i,.7,s*1080,1.8)
   else:
    if town.chunks.room('rail',i)<24 or town.chunks.room('land',i)<40 or town.chunks.room('extra',i)<4:continue
    if PASS>=3 and i%7==0:continue
    off=town.at(i,s)+(18 if i%4==0 else 0);p=town.p(i,.5,s*off);fw=town.fwd(i);yaw=math.atan2(fw[2],fw[0])+(math.pi if s>0 else 0)
    if i%9==0:town.tree(i,.3,s*(off+12),.8);continue
    if town.bent(i,s,off+100):continue
    central=names[i] in ['Steenstraat','Spoorstraat','Koorstraat']
    detached=not central and i%3==0
    off=town.at(i,s)+(rng.choice([25,40,55])if detached else rng.choice([0,4,8]))
    p=town.p(i,.5,s*off)
    frontage=math.dist(town.p(i,0,s*off),town.p(i,1,s*off))
    width=min(120,frontage*.96)if central and i%4!=0 else rng.choice([70,82,94])
    height=rng.choice([58,63,68])if central else rng.choice([48,54,59])
    depth=rng.choice([75,95,110]);co,si=math.cos(yaw),math.sin(yaw)
    footprint=Polygon([(p[0]+co*x-si*z,p[2]+si*x+co*z)for x,z in [(-width/2,0),(width/2,0),(width/2,depth),(-width/2,depth)]])
    if footprint.intersects(neighbourhood.buffer(12)):continue
    P=town.box(i,(p[0],p[2]),width,depth,height,'brick',yaw,roof=rng.choice([22,28,34]),facade=(i+s)%8+(0 if central else 8),side_roof=(i+s)%3!=0,hip=PASS>=3 and detached,roof_material='tiles' if PASS>=3 and i%4==0 else 'slate')
    if PASS>=3 and detached and town.chunks.room('rail',i)>14:
     g=P(-width*.3,0,-24);town.box(i,(g[0],g[2]),width*.35,8,7,'hedge',yaw)
     drive=[P(-8,0,-off+town.at(i,s)),P(16,0,-off+town.at(i,s)),P(16,0,0),P(-8,0,0)]
     town.chunks.add('road',i,b.quad(drive,b.uv('surface','plain_asphalt'),(240,240,230),(0,1,0)))
     town.road_corridor.append([(v[0],v[2])for v in drive])
    if i%4==0:town.tree(i,.15,s*67,.8)
  if i in [145,207]:town.board(i)
  if names[i] in STREETS and names[i]!=names[i-1] and i%4==0:
   if PASS>=6:town.street_plate(i,.5,b.ROAD+30,STREETS.index(names[i]))
   else:
    p=town.p(i,.5,90,32);f=town.fwd(i);vs=[(p[0]-f[0]*17,p[1],p[2]-f[2]*17),(p[0]+f[0]*17,p[1],p[2]+f[2]*17),(p[0]+f[0]*17,p[1]+4,p[2]+f[2]*17),(p[0]-f[0]*17,p[1]+4,p[2]-f[2]*17)]
    town.chunks.add('land',i,b.quad(vs,b.two_sided_uv(b.uv('land',f'street{STREETS.index(names[i])}')),(255,255,255),tuple(-x for x in town.right(i))))
  if PASS>=7 and i%5==0 and not rural:
   street_lamp(town,b,i,.7,(-1 if i%10==0 else 1)*(b.ROAD+35));town.lamp_count=getattr(town,'lamp_count',0)+1
  elif PASS<7 and i%3==0 and not rural:
   for s in [-1,1]:
    p=town.p(i,.7,s*98);vs=[(p[0]-7,0,p[2]),(p[0]+7,0,p[2]),(p[0]+7,65,p[2]),(p[0]-7,65,p[2])];town.chunks.add('rail',i,b.quad(vs,b.two_sided_uv(uv('lamp')),(255,255,255),(0,0,1)))
 if PASS>=7:furniture(town,b,uv)
 if PASS>=9:add_wayfinding(town,b,uv)
 if PASS>=10:
  crest=max(range(n),key=lambda i:town.ground[i]);raised=[i for i,h in enumerate(town.ground) if h>5]
  town.dike={'heightMetres':max(town.ground)/10,'uphillStartChunk':raised[0],
             'crestChunk':crest,'downhillEndChunk':raised[-1],
             'maximumGrade':max(abs(town.ground[(i+1)%n]-town.ground[i])/math.dist(c[i],c[(i+1)%n])for i in range(n))}
  eye=town.p(crest,.5,700,180);target=town.p(crest,.5,0,5)
  town.landmarks.append({'name':'Hoogendijk','chunk':crest,'position':list(target),
                         'camera':{'eye':list(eye),'target':list(target)}})
 # OSM backdrops: low sheds stay low, and no footprint may intersect the authored race corridor.
 back=0
 for w in ways:
  tags=w.get('tags',{});pts=[nodes[k] for k in w['nodes'] if k in nodes]
  if 'building' not in tags or len(pts)<4:continue
  poly=Polygon([(x*10,z*10) for x,z in pts])
  if not poly.is_valid or poly.area<2500 or poly.intersects(corridor.buffer(140)) or poly.intersects(neighbourhood.buffer(150)):continue
  x,z=poly.centroid.coords[0];i=town.near((x/10,z/10))
  if math.dist((x,z),c[i])>1400 or back>=(100 if PASS>=3 else 180):continue
  if town.chunks.room('rail',i)<16 or town.chunks.room('extra',i)<6 or town.chunks.room('land',i)<8:continue
  if any(poly.intersects(Polygon(p)) for p in town.parcels):continue
  rect=list(poly.minimum_rotated_rectangle.exterior.coords);w0=math.dist(rect[0],rect[1]);depth=math.dist(rect[1],rect[2]);yaw=math.atan2(rect[1][1]-rect[0][1],rect[1][0]-rect[0][0]);center=((rect[0][0]+rect[1][0])/2,(rect[0][1]+rect[1][1])/2)
  utility=tags['building'] in ['garage','garages','shed','outbuilding','industrial']
  h=28 if utility else min(120,float(tags.get('building:levels','2').split(';')[0]) *30)
  town.box(i,center,w0,depth,h,'brick',yaw,roof=12 if utility else 32,facade=None if utility else 8+back%8);back+=1
 water=[]
 for w in ways:
  if w.get('tags',{}).get('natural')=='water':
   pts=[nodes[k] for k in w['nodes'] if k in nodes]
   if len(pts)>3:water.append(pts)
 water.extend(town.extra_water)
 if PASS>=10:
  for i in range(n):
   if max(town.ground[i],town.ground[(i+1)%n])>town.terrain_raised_threshold:
    toe=town.terrain_raised_profile[2]
    town.road_corridor.append([town.p(i,0,-toe)[::2],town.p(i,1,-toe)[::2],town.p(i,1,toe)[::2],town.p(i,0,toe)[::2]])
 # Exact triangles close terrain edges; do not use the old apex-offset helper.
 if PASS>=2:
  def terrain_mapping(atlas,name,vertices):
   tile=1800;cx=sum(p[0]for p in vertices)/len(vertices);cz=sum(p[2]for p in vertices)/len(vertices)
   x0=math.floor(cx/tile)*tile;z0=math.floor(cz/tile)*tile;u=b.uv(atlas,name)
   return [(u[0][0]+max(0,min(1,(x-x0)/tile))*(u[1][0]-u[0][0]),u[2][1]+max(0,min(1,(z-z0)/tile))*(u[0][1]-u[2][1]))for x,y,z in vertices]
  town.terrain_mapping=terrain_mapping
  if PASS>=4:
   def field_colour(vertices,category,colour):
    if category!='ground':return colour
    x=sum(p[0]for p in vertices)/4;z=sum(p[2]for p in vertices)/4;k=(math.floor(x/1800)*7+math.floor(z/1800)*11)%5
    palette=[(1,1,1),(.86,.93,.8),(.91,.9,.77),(.77,.85,.68),(.96,.98,.9)]
    return tuple(round(v*f)for v,f in zip(colour,palette[k]))
   town.terrain_colour=field_colour
 terrain=b.connected_terrain(town,water,[],b.quad,b.closed_tri,b.uv)
 if PASS>=10:tree_collisions.finalize(town,b,uv)
 if PASS>=10:natural_edges.add(town,b)
 if town.chunks.dropped:raise RuntimeError(town.chunks.lost_at)
 chunks=[[row[k] for k in b.LIMITS] for row in town.chunks.lists];total=sum(len(p) for row in chunks for p in row)
 rmp=struct.pack('<iii',-1,total,n)
 for row in chunks:
  for ps in row:rmp+=struct.pack('<i',len(ps))+b''.join(b.pack_plane(p) for p in ps)
 write('boxmeer.rmp',rmp)
 dmp=struct.pack('<i',2*n);pmp=struct.pack('<i',n)
 for i in range(n):
  for lane,(off,nxt,prv) in enumerate([(b.LANE,(i+1)%n,(i-1)%n),(-b.LANE,(i-1)%n,(i+1)%n)]):
   p=town.p(i,0,off);dmp+=struct.pack('<iifffiiii',4,0,*p,nxt*2+lane,-1,-1,prv*2+lane)
  trig={0:(9,0),11:(13,14),12:(15,0)}.get(i,(0,0));pmp+=struct.pack('<3f2i',c[i][0],town.ground[i],c[i][1],*trig)+struct.pack('<iiiii',0,1,i*2+1,1,i*2)
 write('boxmeer.pmp',pmp);write('boxmeer.dmp',dmp);write('boxmeer.cmp',struct.pack('<i',0));write('boxmeer.pth',struct.pack('<ii',-1,0))
 def obj(i,t,name,y=5,off=0,yaw=None):
  p=town.p(i,0,off,y);f=town.fwd(i);return struct.pack('<ii3f3f',i,t,*p,0,math.degrees(math.atan2(f[2],f[0]))if yaw is None else yaw,0)+name.encode().ljust(32,b'\0')+struct.pack('<i',0)
 objs=[obj(11,12,'a_zepp00_ANIM',75)]
 for frac,name,off in [(.15,'pw_turbs_ANIM',-24),(.32,'pw_reps_ANIM',24),(.48,'pw_turbs_ANIM',-24),(.63,'pw_10pts_ANIM',24),(.78,'pw_turbb_ANIM',-24),(.90,'pw_reps_ANIM',24)]:objs.append(obj(int(n*frac),25,name,off=off))
 if PASS>=7:
  cone_mesh(b,OUT,uv)
  for k in [20,21,22,n//2,n//2+1,n//2+2]:objs.append(obj(k,2,'BM_CONE_ANIM',0,b.ROAD-4))
 if PASS>=9:
  race_models(b,OUT)
  for sector in town.racing_sectors:
   k=sector['chunk'];f=town.fr[k][0];objs.append(obj(k,0,'BM_GATE_'+sector['key'].upper(),0,yaw=math.degrees(math.atan2(f[0],f[1]))))
 if PASS>=10:objs.extend(movable.place(town,b,movable.models(b,OUT)))
 write('boxmeer.omp',struct.pack('<i',len(objs))+b''.join(objs))
 refs={id(p):[ci,pi,vi] for ci,row in enumerate(chunks) for pi,ps in enumerate(row) for vi,p in enumerate(ps)}
 json.dump([{**o,'faces':[refs[id(p)] for p in o['faces']]} for o in town.buildings],open(OUT/'buildings.json','w'))
 meta={'name':'Boxmeer','polishPass':PASS,'roadWidthMetres':b.ROAD/5,'maximumElevationMetres':max(town.ground)/10,'slot':11,'chunks':n,'start':10,'lengthMetres':round(sum(math.dist(c[i],c[(i+1)%n]) for i in range(n))/10),'planes':total,'minimumRadiusMetres':round(b.radius(c)/10,1),'buildings':len(town.buildings),'backdropBuildings':back,'landmarks':town.landmarks,'streets':names,'terrain':terrain,'neighbourhood':town.neighbourhood,'scenery':getattr(town,'scenery_counts',{}),'racingSectors':getattr(town,'racing_sectors',[]),'turnMarkers':getattr(town,'turn_markers',[])}
 meta['nativeTrees']=getattr(town,'native_trees',[])
 meta['treeCollisionAudit']=getattr(town,'tree_collision_audit',{})
 meta['naturalBoundaries']=getattr(town,'natural_boundaries',{})
 meta['streetNameSigns']=getattr(town,'street_name_signs',[])
 meta['sideStreetSigns']=getattr(town,'side_street_signs',[])
 meta['sideStreets']=town.side_streets
 meta['movableStreetObjects']=getattr(town,'movable_street_objects',[])
 if PASS>=10:meta['dike']=town.dike
 json.dump(meta,open(OUT/'boxmeer.json','w'),indent=2)
 textures();
 if PASS>=10:movable.artwork(SRC,OUT)
 menu(c,town.landmarks)
 if (SRC/'exploratory-views.json').exists():(OUT/'exploratory-views.json').write_text((SRC/'exploratory-views.json').read_text())
 if (SRC/'README.md').exists():(OUT/'ATTRIBUTION.md').write_text((SRC/'README.md').read_text())
 print(json.dumps({k:v for k,v in meta.items() if k not in ['streets','landmarks']},indent=2))

def menu(c,landmarks):
 out=OUT/'menu';out.mkdir(exist_ok=True)
 im=Image.new('RGB',(1000,700),(28,53,49));d=ImageDraw.Draw(im)
 xs,zs=zip(*c);scale=min(740/(max(xs)-min(xs)),560/(max(zs)-min(zs)));P=lambda x,z:(500+(x-(min(xs)+max(xs))/2)*scale,340-(z-(min(zs)+max(zs))/2)*scale)
 for w in ways:
  pts=[P(nodes[k][0]*10,nodes[k][1]*10) for k in w['nodes'] if k in nodes];t=w.get('tags',{})
  if len(pts)>1 and 'highway'in t:d.line(pts,fill=(74,94,78),width=2)
 lap=[P(*p) for p in c]+[P(*c[0])];d.line(lap,fill=(15,26,23),width=14);d.line(lap,fill=(240,177,73),width=7)
 for mark in landmarks:
  x,_,z=mark['position'];px,py=P(x,z);d.ellipse((px-5,py-5,px+5,py+5),fill=(246,228,185));d.text((px+9,py-10),mark['name'],font=font(18),fill=(244,235,211))
 d.text((35,28),'BOXMEER',font=font(48),fill=(245,229,194));d.text((35,88),'Maasheggen • kasteel • Steenstraat',font=font(22),fill=(175,199,173));im.save(OUT/'route-preview.png')
 banner=Image.new('RGBA',(246,40));bd=ImageDraw.Draw(banner);bd.text((52,1),'Boxmeer',font=font(30),fill=(206,236,52),stroke_width=2,stroke_fill=(24,40,8));banner.save(out/'trname11.png')
 mask=Image.open(ROOT/'public/assets/menu/qtc00_01.png').convert('RGBA').getchannel('A')
 for k in range(6):
  art=ai_sources(SRC)
  panels=[im,ai_cell(art['landmarks'],0,2),ai_cell(art['landmarks'],1,2),ai_cell(art['landmarks'],2,2),ai_facade(art['facades'],14),ai_facade(art['facades'],3)]
  preview=SRC/'menu-views'/f'{k}.png'
  image=ImageOps.fit(Image.open(preview)if PASS>=10 and k>0 and preview.exists()else panels[k],(250,250)).convert('RGBA');image.putalpha(mask);image.save(out/f'qtc011_{k:02}.png')
 hero=SRC/'menu-views/hero.png'
 loading=ImageOps.fit(Image.open(hero)if PASS>=10 and hero.exists()else ai_cell(ai_sources(SRC)['landmarks'],0,2),(640,480)).convert('RGB');d=ImageDraw.Draw(loading);d.rectangle((0,365,640,480),fill=(24,42,37));d.text((30,382),'BOXMEER',font=font(42),fill=(242,224,180));d.text((32,438),'Door het hart van de Maasheggen',font=font(19),fill=(201,213,192))
 for suffix in ['', '-8', '-lo']:loading.save(ROOT/f'public/assets/loading/e11{suffix}.png')
if __name__=='__main__':build()
