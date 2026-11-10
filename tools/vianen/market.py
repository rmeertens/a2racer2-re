"""Breakaway stalls and mounted shop awnings, using the existing street materials."""
import math
import os
from PIL import Image

AWNING_WIDTHS = (36, 48, 56, 64)
MARKET_CELLS = {'wood': (0, 0, 256, 256), 'awning': (256, 0, 512, 256),
                'produce': (0, 256, 256, 512), 'metal': (256, 256, 512, 512)}


def build_market_assets(out, save, uv, land_cells, building_cells):
    land = Image.open(os.path.join(out, 'vn_land.tga'))
    building = Image.open(os.path.join(out, 'vn_bouw.tga'))
    atlas = Image.new('RGB', (512, 512), (219, 217, 204))
    for name, source, cell in (('wood', land, land_cells['deck']),
                               ('awning', land, land_cells['awning']),
                               ('produce', building, building_cells['produce'])):
        atlas.paste(source.crop(cell).resize((256, 256), Image.Resampling.LANCZOS), MARKET_CELLS[name][:2])
    atlas.save(os.path.join(out, 'vn_markt.tga'), compression=None)

    def solid(faces, x0, x1, z0, z1, low0, low1, high0, high1, material, top=None):
        # A closed box/wedge. Each component has its own six outward faces.
        a,b,c,d = (x0,low0,z0),(x1,low0,z0),(x1,low1,z1),(x0,low1,z1)
        A,B,C,D = (x0,high0,z0),(x1,high0,z0),(x1,high1,z1),(x0,high1,z1)
        for points, normal, cell in (([a,b,B,A], (0,0,-1), material),
                                    ([c,d,D,C], (0,0,1), material),
                                    ([d,a,A,D], (-1,0,0), material),
                                    ([b,c,C,B], (1,0,0), material),
                                    ([A,B,C,D], (0,1,-(high1-high0)/(z1-z0)), top or material),
                                    ([d,c,b,a], (0,-1,(low1-low0)/(z1-z0)), material)):
            length = math.sqrt(sum(n*n for n in normal))
            faces.append((points, uv('market', cell), tuple(n/length for n in normal)))

    faces = []
    solid(faces, -36,36,-5,9,1,1,10,10,'wood','produce')
    save('vn_markt.d3d', faces)
    faces = []
    solid(faces,-39.8,39.8,-13,9,-1,4,0,5,'awning')
    solid(faces,-40,40,-13.3,-12.7,-.7,-.7,.3,.3,'metal')
    solid(faces,-40,40,8.7,9.3,4.3,4.3,5.3,5.3,'metal')
    save('vn_marktdak.d3d',faces)
    faces = []
    solid(faces,-.5,.5,-.5,.5,0,0,25,25,'metal')
    save('vn_marktpaal.d3d',faces)
    for width in AWNING_WIDTHS:
        faces = []
        solid(faces,-width/2,width/2,-6.75,6.75,-4.3,2.7,-3.5,3.5,'awning')
        # Narrow mounting bar. The cloth and bar fall together after contact.
        solid(faces,-width/2,width/2,6,7,-.5,-.5,4,4,'metal')
        save(f'vn_luifel{width}.d3d',faces)


def place_market_object(town, i, t, side, off, y, name, kind=3):
    forward = town.fwd(i)
    yaw = math.degrees(math.atan2(-forward[2],forward[0])) + (180 if side > 0 else 0)
    town.detail_objects.append((i,kind,town.p(i,t,side*off,y),yaw,name))
