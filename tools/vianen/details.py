"""Small Vianen finishing details for native models and OMP placements."""
import math
from PIL import Image, ImageDraw


def detail_texture():
    image = Image.new('RGB', (256, 256), (255, 0, 127))
    d = ImageDraw.Draw(image)
    d.rectangle((3, 3, 124, 124), fill=(85, 88, 83), outline=(119, 121, 111), width=4)
    d.rectangle((12, 12, 115, 115), fill=(42, 48, 45))
    for x in range(18, 111, 13):
        d.rectangle((x, 17, x + 5, 110), fill=(15, 24, 22))
        d.line((x + 6, 17, x + 6, 110), fill=(93, 97, 87))
    d.ellipse((132, 4, 251, 123), fill=(79, 83, 76), outline=(115, 118, 106), width=4)
    d.ellipse((140, 12, 243, 115), outline=(35, 43, 37), width=3)
    for y in range(25, 107, 12):
        for x in range(153, 234, 12):
            if (x - 192) ** 2 + (y - 64) ** 2 < 44 ** 2:
                d.line((x - 3, y, x + 3, y), fill=(45, 53, 45), width=2)
    return image


def build_detail_models(save, uv):
    # OMP type zero: neither these flat decals nor canopy cards get a physics body.
    for filename, material, x, z in (('vn_put.d3d', 'drain', 2.5, 1.8),
                                    ('vn_deksel.d3d', 'cover', 3.5, 3.5)):
        save(filename, [([(-x, 0, -z), (x, 0, -z), (x, 0, z), (-x, 0, z)],
                         uv('detail', material), (0, 1, 0))])
    crown = [(-32, 45, 0), (32, 45, 0), (32, 104, 0), (-32, 104, 0)]
    save('vn_kruin.d3d', [(crown, uv('land', 'crown'), (0, 0, -1)),
                          (crown, uv('land', 'crown', u0=1, u1=0), (0, 0, 1))])
    faces = []
    def box(x0, x1, y0, y1, z0, z1, material):
        for p, n in (
            ([(x0,y0,z0),(x1,y0,z0),(x1,y1,z0),(x0,y1,z0)],(0,0,-1)),
            ([(x1,y0,z1),(x0,y0,z1),(x0,y1,z1),(x1,y1,z1)],(0,0,1)),
            ([(x0,y0,z1),(x0,y0,z0),(x0,y1,z0),(x0,y1,z1)],(-1,0,0)),
            ([(x1,y0,z0),(x1,y0,z1),(x1,y1,z1),(x1,y1,z0)],(1,0,0)),
            ([(x0,y1,z0),(x1,y1,z0),(x1,y1,z1),(x0,y1,z1)],(0,1,0)),
            ([(x0,y0,z1),(x1,y0,z1),(x1,y0,z0),(x0,y0,z0)],(0,-1,0)),
        ):
            faces.append((p, material, n))
    wood = uv('fun', 'wood', v0=.05, v1=.21)
    iron = uv('fun', 'cone', u0=.5, u1=.5, v0=.97, v1=.97)
    for x in (-6.5, 6.5):
        for z in (-2, 2):
            box(x-.35,x+.35,0,4.4,z-.35,z+.35,iron)
        box(x-.3,x+.3,4.2,10.1,2.5,3.1,iron)
    for z in (-2, 0, 2):
        box(-9,9,4.2,4.8,z-.85,z+.85,wood)
    for y in (5.5, 7.2, 8.9):
        box(-9,9,y,y+1.1,2.3,2.6,wood)
    save('vn_bank.d3d',faces)


def place_details(town):
    def place(i,t,off,y,name,kind,turn=0):
        a,b=town.p(i,0,off),town.p(i,1,off)
        yaw=math.degrees(math.atan2(-(b[2]-a[2]),b[0]-a[0]))+turn
        town.detail_objects.append((i,kind,town.p(i,t,off,y),yaw,name))
    for i in (5,12,19,24,62,66,84,91):
        if i in town.bridges or abs(town.ground[i]-town.ground[(i+1)%town.n])>.001:
            continue
        place(i,.25,(-1 if i%2 else 1)*12,.035,'VN_COVER_ANIM',0)
        for side in (-1,1):
            place(i,.5,side*62,1.035,'VN_DRAIN_ANIM',0)
    for k,i in enumerate((4,8,14,23)):
        side=-1 if k%2==0 else 1
        if (i,side) in town.skip or (i,side) in town.open_square or town.at(i,side)<160:
            continue
        place(i,.35,side*118,1,'VN_BENCH_ANIM',3,180 if side>0 else 0)
