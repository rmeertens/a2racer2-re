"""Pack original AI-generated art into the existing native atlas layouts.

Cropping/resampling is asset conversion only: every architectural/material source is the
saved built-in image-generation output. Functional lettering and paint stay code-authored.
"""
import hashlib,json
from PIL import Image,ImageDraw,ImageOps,ImageEnhance
from polish import PASS

FACADE_X=[0,313,626,941,1254]
# The generator varied row heights. Measure the actual wall boundaries, not assumed quarters.
FACADE_Y=[0,360,700,998,1254]
MATERIAL_NAMES=['brick','cream','slate','tiles','hedge','grass','asphalt','pavement',
                'paving','water','stone','white','green_wood','timber','solar','gravel']

def sources(src):
    return {key:Image.open(src/'generated'/f'{key}.png').convert('RGB')
            for key in ['facades','landmarks','materials']}

def facade(image,index):
    x,y=index%4,index//4
    # One-pixel insets omit dark panel separators; no photographed perspective to rectify.
    return image.crop((FACADE_X[x]+1,FACADE_Y[y]+1,FACADE_X[x+1]-1,FACADE_Y[y+1]-1))

def cell(image,index,columns=4):
    x,y=index%columns,index//columns
    size=image.width/columns
    return image.crop((round(x*size)+1,round(y*size)+1,round((x+1)*size)-1,round((y+1)*size)-1))

def repeat(image,size,nx=1,ny=1):
    """Match material scale to metres rather than stretching a few giant bricks over a wall."""
    w,h=size
    tile=image.resize((max(1,round(w/nx)),max(1,round(h/ny))),Image.Resampling.LANCZOS)
    result=Image.new('RGB',size)
    for y in range(0,h,tile.height):
        for x in range(0,w,tile.width):result.paste(tile,(x,y))
    return result

def build_textures(native,src,out,material_cells,streets):
    art=sources(src)
    materials={name:cell(art['materials'],i) for i,name in enumerate(MATERIAL_NAMES)}
    def material(name,size,nx=1,ny=1):return repeat(materials[name],size,nx,ny)
    def save(name,image):image.convert('RGB').save(out/name,format='TGA',compression=None)
    surface=Image.new('RGB',(512,512))
    surface.paste(material('paving',(256,256),4,10),(0,0))
    asphalt=material('asphalt',(256,256),2,5)
    ImageDraw.Draw(asphalt).rectangle((235,42,243,152),fill=(224,222,205))
    surface.paste(asphalt,(256,0))
    grass=ImageEnhance.Color(materials['grass']).enhance(.65)
    if PASS>=2:grass=ImageEnhance.Contrast(grass).enhance(.28)
    surface.paste(repeat(grass,(256,256),3,3),(0,256))
    surface.paste(material('water',(256,256),2,2),(256,256));save('bm_weg.tga',surface)
    land=Image.new('RGB',(512,512),(115,121,90))
    land.paste(material('pavement',(256,256),4,10),native.LAND['pavement'][:2])
    for name in ['tiles','slate']:
        land.paste(material(name,(128,128),3 if PASS>=8 else 4,4 if PASS>=8 else 5),native.LAND[name][:2])
    land.paste(repeat(grass,(128,128),3,3),native.LAND['grass'][:2])
    land.paste(material('water',(128,128),2,2),native.LAND['water'][:2])
    land.paste(material('solar',(128,128)),native.LAND['solar'][:2])
    for k,name in enumerate(streets):
        land.paste(native.street_sign(128,32,name),native.LAND[f'street{k}'][:2])
    if PASS>=4:
        foliage=Image.open(src/'generated/foliage.png').convert('RGBA')
        for name,index in [('willow',1),('birch',3)]:
            patch=cell(foliage,index,2).resize((128,128),Image.Resampling.LANCZOS)
            keyed=Image.new('RGB',(128,128),native.KEY);keyed.paste(patch.convert('RGB'),mask=patch.getchannel('A').point(lambda a:255 if a>=145 else 0));
            if PASS>=8:ImageDraw.Draw(keyed).rectangle((0,0,127,127),outline=native.KEY,width=3)
            land.paste(keyed,native.LAND[name][:2])
    if PASS>=5:
        clock=Image.new('RGB',(64,64),native.KEY);cd=ImageDraw.Draw(clock);cd.ellipse((3,3,60,60),fill=(226,218,188),outline=(41,45,43),width=3)
        import math
        for k in range(12):
            a=k*math.tau/12;cd.line((32+math.sin(a)*23,32-math.cos(a)*23,32+math.sin(a)*27,32-math.cos(a)*27),fill=(34,40,36),width=2)
        cd.line((32,32,32,13),fill=(35,40,37),width=2);cd.line((32,32,46,39),fill=(35,40,37),width=3)
        land.paste(clock,native.LAND['clock'][:2]);land.paste(material('green_wood',(64,64)),native.LAND['door'][:2])
    if PASS>=6:
        parking=material('asphalt',(128,128));pd=ImageDraw.Draw(parking);pd.line((12,12,12,118,116,118,116,12),fill=(220,220,204),width=2)
        land.paste(parking,native.LAND['parking'][:2]);land.paste(Image.new('RGB',(64,128),(57,65,62)),native.LAND['metal'][:2])
    if PASS>=7:land.paste(material('timber',(128,128),2,3),native.LAND['wood'][:2])
    save('bm_land.tga',land)
    fronts=Image.new('RGB',(1024,1024))
    for k in range(16):
        fronts.paste(facade(art['facades'],k).resize((256,256),Image.Resampling.LANCZOS),((k%4)*256,(k//4)*256))
    save('bm_gevel.tga',fronts)
    atlas=Image.new('RGB',(1024,1024),native.KEY)
    for name in ['brick','cream','white','slate','tiles','hedge']:
        repeat_x,repeat_y={'brick':(4,6)if PASS>=8 else (5,8),'cream':(2,2),'white':(4,6),
                           'slate':(4,5),'tiles':(4,5),'hedge':(3,2)}[name]
        atlas.paste(material(name,(256,256),repeat_x,repeat_y),material_cells[name][:2])
    for name,index in [('castle',0),('monastery',1),('tower',2),('church',3)]:
        atlas.paste(cell(art['landmarks'],index,2).resize((256,256),Image.Resampling.LANCZOS),material_cells[name][:2])
    atlas.paste(facade(art['facades'],3).resize((256,256),Image.Resampling.LANCZOS),material_cells['riche'][:2])
    window_source=facade(art['facades'],14)
    if PASS>=3:window_source=window_source.crop((8,18,216,104))
    atlas.paste(window_source.resize((256,256),Image.Resampling.LANCZOS),material_cells['window'][:2])
    if PASS>=4:
        foliage=Image.open(src/'generated/foliage.png').convert('RGBA');patch=cell(foliage,0,2).resize((256,256),Image.Resampling.LANCZOS)
        keyed=Image.new('RGB',(256,256),native.KEY);keyed.paste(patch.convert('RGB'),mask=patch.getchannel('A').point(lambda a:255 if a>=145 else 0));
        if PASS>=8:ImageDraw.Draw(keyed).rectangle((0,0,255,255),outline=native.KEY,width=4)
        atlas.paste(keyed,material_cells['tree'][:2])
    else:atlas.paste(native.tree_sprite(256,256,81),material_cells['tree'][:2])
    atlas.paste(native.lamp_sprite(128,256).resize((256,256),Image.Resampling.NEAREST),material_cells['lamp'][:2])
    from side_streets import STREETS
    for k,name in enumerate(STREETS):atlas.paste(native.street_sign(256,64,name),material_cells[f'side_street{k}'][:2])
    # Readable navigation remains deterministic typography, not generated lettering.
    sign=Image.new('RGB',(256,256),(27,60,109));d=ImageDraw.Draw(sign)
    from PIL import ImageFont
    font='/System/Library/Fonts/Supplemental/Arial.ttf'
    for text,y,size in [('BOXMEER',63,42),('Land van Cuijk',120,24),('MAASHEGGEN',179,24)]:
        f=ImageFont.truetype(font,size);d.text(((256-d.textlength(text,font=f))/2,y),text,font=f,fill=(242,229,201))
    atlas.paste(sign,material_cells['sign'][:2])
    chevron=Image.new('RGB',(256,256),(225,219,198));d=ImageDraw.Draw(chevron)
    for x in range(-140,400,120):d.polygon([(x,0),(x+65,0),(x+190,128),(x+65,255),(x,255),(x+125,128)],fill=(177,46,28))
    atlas.paste(chevron,material_cells['chevron'][:2]);save('bm_bouw.tga',atlas)
    if PASS>=8:save('bm_sky.tga',Image.open(src/'generated/sky.png').resize((512,512),Image.Resampling.LANCZOS))
    manifest={'tool':'Built-in image generation','photographicInputs':[],
              'sources':{key:{'file':f'generated/{key}.png','sha256':hashlib.sha256((src/'generated'/f'{key}.png').read_bytes()).hexdigest()}for key in [*art,*(['foliage']if PASS>=4 else []),*(['sky']if PASS>=8 else [])]},
              'prompts':['generated/prompts.json','generated/rework-prompts.json'],
              'facadeColumns':FACADE_X,'facadeRows':FACADE_Y,
              'landmarkCells':['castle','monastery','tower','church'],
              'materialCells':MATERIAL_NAMES,
              'codeAuthored':['street lettering','direction chevrons','parking and finish paint','sector gate lettering','menu name banner'],
              'menuImages':'Rendered from the generated map geometry and textures'}
    (src/'generated'/'packing.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (out/'texture-sources.json').write_text(json.dumps(manifest,indent=2)+'\n')
