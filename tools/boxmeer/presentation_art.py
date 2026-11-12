"""Convert the original generated artwork into presentation textures and facade trim guides."""
import json,hashlib
from collections import deque
from PIL import Image,ImageFilter
import numpy as np

def build(src,out):
    original=src/'generated/garden-plants.png'
    if not original.exists():return
    plants=Image.open(original).convert('RGBA')
    plants.resize((1024,1024),Image.Resampling.LANCZOS).save(out/'bm_plants.tga',compression=None)
    w,h=plants.size
    leaves=plants.crop((int(w*.65),int(h*.66),int(w*.88),int(h*.88)))
    leaf=Image.new('RGBA',leaves.size,(72,94,36,255));leaf.alpha_composite(leaves)
    leaf.convert('RGB').resize((256,256),Image.Resampling.LANCZOS).save(out/'bm_leaves.tga',compression=None)
    atlas=Image.open(out/'bm_gevel.tga').convert('RGB');windows=[]
    for k in range(16):
        image=atlas.crop((k%4*256,k//4*256,k%4*256+256,k//4*256+256));a=np.asarray(image).astype(float)
        mask=(a.mean(2)>162)&((a.max(2)-a.min(2))<65)
        mask=np.asarray(Image.fromarray((mask*255).astype('uint8')).filter(ImageFilter.MaxFilter(3)))>0
        seen=np.zeros(mask.shape,dtype=bool);boxes=[]
        for y,x in zip(*np.where(mask)):
            if seen[y,x]:continue
            todo=deque([(int(x),int(y))]);seen[y,x]=True;xs=[];ys=[]
            while todo:
                xx,yy=todo.popleft();xs.append(xx);ys.append(yy)
                for nx,ny in [(xx-1,yy),(xx+1,yy),(xx,yy-1),(xx,yy+1)]:
                    if 0<=nx<256 and 0<=ny<256 and mask[ny,nx] and not seen[ny,nx]:seen[ny,nx]=True;todo.append((nx,ny))
            x0,x1,y0,y1=min(xs),max(xs),min(ys),max(ys);width,height=x1-x0,y1-y0
            if 16<width<112 and 24<height<130 and y1<200 and x0>3 and x1<252 and .25<width/height<2.5 and len(xs)>width*height*.12:boxes.append([x0,y0,x1,y1])
        windows.append(boxes[:8])
    (out/'facade-windows.json').write_text(json.dumps(windows))
    manifest={'source':'generated/garden-plants.png','sha256':hashlib.sha256(original.read_bytes()).hexdigest(),'outputs':['bm_plants.tga','bm_leaves.tga','facade-windows.json'],'facadeTrim':'White-frame bounds detected from the generated facade atlas; original images retained.'}
    (src/'generated/presentation-packing.json').write_text(json.dumps(manifest,indent=2)+'\n')

    (out/'presentation-sources.json').write_text(json.dumps(manifest,indent=2)+'\n')
