"""Boxmeer-only, native movable street life. Artwork derives from the existing AI sheets."""
import math,struct,json,random
from PIL import Image,ImageDraw,ImageFont,ImageOps
from shapely.geometry import Point,LineString,Polygon
from shapely.ops import unary_union
COUNTS={'chair':12,'table':6,'bin':8,'board':8,'crate':8,'flowerpot':8,'carton':6}
CELLS={'wood':0,'metal':1,'green':2,'black':3,'board':4,'card':5,'pot':6,'flowers':7}
def uv(name):
 k=CELLS[name];x=k%4*128;y=k//4*128
 return [((x+1)/512,(y+127)/512),((x+127)/512,(y+127)/512),((x+127)/512,(y+1)/512),((x+1)/512,(y+1)/512)]
def artwork(src,out):
 land=Image.open(out/'bm_land.tga').convert('RGB');bouw=Image.open(out/'bm_bouw.tga').convert('RGB')
 atlas=Image.new('RGB',(512,512),(85,87,65))
 samples={'wood':land.crop((0,384,128,512)),'metal':land.crop((384,0,448,128)),'green':bouw.crop((256,256,512,512)),'black':bouw.crop((512,0,768,256)),'card':bouw.crop((0,0,256,256)),'pot':bouw.crop((256,0,512,256))}
 for name,image in samples.items():
  if name=='green':image=Image.blend(ImageOps.grayscale(image).convert('RGB'),Image.new('RGB',image.size,(35,75,50)),.86)
  if name=='card':image=Image.blend(ImageOps.grayscale(image).convert('RGB'),Image.new('RGB',image.size,(160,126,82)),.8)
  if name=='pot':image=Image.blend(image,Image.new('RGB',image.size,(157,81,49)),.78)
  k=CELLS[name];atlas.paste(image.resize((128,128)),(k%4*128,k//4*128))
 board=Image.new('RGB',(128,128),(29,48,43));d=ImageDraw.Draw(board);font=lambda n:ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',n)
 d.rectangle((3,3,124,124),outline=(183,158,109),width=6)
 for text,y,n in [('KOFFIE',22,23),('TERRAS',57,19),('OPEN',91,17)]:d.text(((128-d.textlength(text,font=font(n)))/2,y),text,font=font(n),fill=(242,229,195))
 atlas.paste(board,(0,128))
 flowers=Image.open(src/'generated/garden-plants.png').convert('RGBA');w,h=flowers.size;flowers=flowers.crop((0,h//2,w//2,h));tile=Image.new('RGBA',(128,128),(57,82,35,255));tile.alpha_composite(ImageOps.fit(flowers,(128,128)));atlas.paste(tile.convert('RGB'),(384,128))
 atlas.save(out/'bm_street.tga',compression=None)
 (out/'street-prop-sources.json').write_text(json.dumps({'sourceAtlases':['bm_land.tga','bm_bouw.tga'],'flowerSource':'generated/garden-plants.png','lettering':'Code-authored functional shop lettering','photographs':False,'nativeObjects':COUNTS},indent=2))
def models(b,out):
 def box(f,x0,x1,y0,y1,z0,z1,material):
  for points,n in [([(x0,y0,z0),(x1,y0,z0),(x1,y1,z0),(x0,y1,z0)],(0,0,-1)), ([(x1,y0,z1),(x0,y0,z1),(x0,y1,z1),(x1,y1,z1)],(0,0,1)), ([(x0,y0,z1),(x0,y0,z0),(x0,y1,z0),(x0,y1,z1)],(-1,0,0)), ([(x1,y0,z0),(x1,y0,z1),(x1,y1,z1),(x1,y1,z0)],(1,0,0)), ([(x0,y1,z0),(x1,y1,z0),(x1,y1,z1),(x0,y1,z1)],(0,1,0)), ([(x0,y0,z1),(x1,y0,z1),(x1,y0,z0),(x0,y0,z0)],(0,-1,0))]:f.append((points,uv(material),n))
 meshes={}
 f=[];box(f,-2.3,2.3,4.2,4.7,-2.3,2.3,'wood');box(f,-2.3,2.3,4.5,9,1.7,2.3,'wood')
 for x in[-1.8,1.8]:
  for z in[-1.8,1.8]:box(f,x-.25,x+.25,0,4.2,z-.25,z+.25,'metal')
 meshes['chair']=f
 f=[];box(f,-4.2,4.2,7,7.7,-3.6,3.6,'wood');box(f,-.6,.6,.5,7,-.6,.6,'metal');box(f,-3.4,3.4,0,.5,-.5,.5,'metal');box(f,-.5,.5,0,.5,-3,3,'metal');meshes['table']=f
 f=[];box(f,-3,3,1,9,-3,3,'green');box(f,-3.3,3.3,9,9.7,-3.3,3.4,'green');box(f,-2.7,2.7,8.4,9.1,3,4,'metal')
 for x in[-2.8,2.8]:box(f,x-.5,x+.5,0,2,1.6,3.6,'black')
 meshes['bin']=f
 f=[]
 for side in[-1,1]:
  # A-frame panels lean inwards, all edges closed.
  p=lambda x,y,z=0:(x,y,side*(2.8-y*.22)+z)
  outer=[p(-3.2,0),p(3.2,0),p(3.2,10),p(-3.2,10)];inner=[p(-3.2,0,-side*.3),p(3.2,0,-side*.3),p(3.2,10,-side*.3),p(-3.2,10,-side*.3)]
  mapping=uv('board');mapping=[mapping[1],mapping[0],mapping[3],mapping[2]] if side>0 else mapping
  f.append((outer,mapping,b.norm((0,.22,side))));f.append((inner,uv('wood'),b.norm((0,-.22,-side))))
  for a,c,N in[(0,1,(0,-1,0)),(1,2,(1,0,0)),(2,3,(0,1,0)),(3,0,(-1,0,0))]:f.append(([outer[a],outer[c],inner[c],inner[a]],uv('wood'),N))
 meshes['board']=f
 f=[];box(f,-3.5,3.5,0,.5,-2.6,2.6,'wood')
 for x in[-3.2,3.2]:
  for z in[-2.3,2.3]:box(f,x-.3,x+.3,.5,4.5,z-.3,z+.3,'wood')
 for y in[1,2.4,3.8]:
  for z in[-2.5,2.5]:box(f,-3.5,3.5,y,y+.7,z-.25,z+.25,'wood')
  for x in[-3.3,3.3]:box(f,x-.25,x+.25,y,y+.7,-2.4,2.4,'wood')
 meshes['crate']=f
 f=[];box(f,-3.8,3.8,0,4.8,-3.8,3.8,'pot');box(f,-4.2,4.2,4.8,5.6,-4.2,4.2,'pot');box(f,-3.6,3.6,5.6,7.4,-3.6,3.6,'flowers');meshes['flowerpot']=f
 f=[];box(f,-3.2,3.2,0,5.6,-2.8,2.8,'card');box(f,-.35,.35,5.6,5.65,-2.8,2.8,'wood');meshes['carton']=f
 old=b.OUT;b.OUT=str(out)
 try:
  for name,faces in meshes.items():b.save_prop_mesh('bm_'+name+'.d3d',faces)
 finally:b.OUT=old
 return meshes

def place(town,b,meshes):
 occupied=unary_union([Polygon(p) for p in town.parcels]);center=LineString(town.c+[town.c[0]]);placed=[]
 retail={'Spoorstraat','Steenstraat','Koorstraat','Marktstraat','Titus Brandsmaplein','Burgemeester Verkuijlstraat','Hoogkoorpassage','Carmelhof'}
 sites=[i for i in range(town.n) if town.street_names[i] in retail and not 7<=i<=13]
 residential=[i for i in range(town.n) if town.street_names[i] in {'Floralaan','Jacob Marisstraat','Jacob van Ruysdaelstraat','Manebiest'}]
 def put(name,i,t,side):
  p=town.p(i,t,side*86,b.KERB_HEIGHT+.05);shape=Point(p[0],p[2]).buffer(6.5)
  if center.distance(shape)<69 or shape.intersects(occupied) or shape.intersects(town.residential_clearance) or any(math.hypot(p[0]-o['position'][0],p[2]-o['position'][2])<8 for o in placed):return False
  f=town.fwd(i);base=-math.degrees(math.atan2(f[2],f[0]));yaw=base+(180 if side<0 else 0)
  if name=='chair':yaw=base+(-90 if t<.5 else 90)
  placed.append({'name':'BM_'+name.upper()+'_ANIM','model':'bm_'+name+'.d3d','type':22,'chunk':i,'position':list(p),'yaw':yaw,'street':town.street_names[i]});return True
 # Furniture comes in coherent terrace groups, rather than a random obstacle line.
 terrace_sites=[]
 for anchor in[3,16,245,270,295,308]:
  terrace_sites.extend(sorted(sites,key=lambda i:min((i-anchor)%town.n,(anchor-i)%town.n))[:4])
 for i in terrace_sites:
  if sum(o['model']=='bm_table.d3d' for o in placed)>=6:break
  for side in[-1,1]:
   before=len(placed)
   if put('table',i,.5,side) and put('chair',i,.42,side) and put('chair',i,.58,side):break
   del placed[before:]
 if sum(o['model']=='bm_table.d3d' for o in placed)!=6:raise RuntimeError('No room for six complete terraces')
 for name in['bin','board','crate','flowerpot','carton']:
  count=COUNTS[name];candidates=(residential+sites if name in['bin','flowerpot'] else sites)
  candidates=random.Random(917+list(COUNTS).index(name)).sample(candidates,len(candidates))
  for phase in range(3):
   for j,i in enumerate(candidates):
    if sum(o['model']=='bm_'+name+'.d3d' for o in placed)>=count:break
    # Spread each group around the route instead of filling the first street.
    if (j+phase)%3:continue
    for side in[-1,1]:
     if put(name,i,[.22,.78,.5][phase],side):break
  if sum(o['model']=='bm_'+name+'.d3d' for o in placed)!=count:raise RuntimeError('No safe placement for '+name)
 town.movable_street_objects=placed
 town.scenery_counts['movableStreetObjects']=len(placed);town.scenery_counts['movableTypes']=COUNTS
 return [struct.pack('<ii3f3f',o['chunk'],o['type'],*o['position'],0,o['yaw'],0)+o['name'].encode().ljust(32,b'\0')+struct.pack('<i',0) for o in placed]
