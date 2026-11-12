"""Retire invisible sprite-card collisions; keep collision inside each visible 3D trunk."""
import math

def finalize(town,b,uv):
    original=getattr(town,'tree_scenery',[]);cards={id(p)for t in original for p in t['faces']}
    for row in town.chunks.lists:
        for kind in row:row[kind]=[p for p in row[kind]if id(p)not in cards]
    seeds=[]
    # Match the old renderer's deduplication and land-before-rail tree selection.
    for t in sorted(original,key=lambda t:not t['birch']):
        p=t['position']
        if not any(math.hypot(s['position'][0]-p[0],s['position'][2]-p[2])<3 and abs(s['position'][1]-p[1])<3 for s in seeds):seeds.append({k:v for k,v in t.items()if k!='faces'})
    colliders=0
    for index,t in enumerate(seeds):
        if t['height']<35:continue # These former planter sprites have no visible tree trunk.
        x,y,z=t['position'];height=t['height']*.9*.56;radius=t['height']*.9*.025
        # An inscribed tapered square stays inside the visible seven-sided cylinder,
        # including when that cylinder is rotated. It never reaches the leafy silhouette.
        low=radius*.60;high=low*.65
        base=[(x-low,y,z-low),(x+low,y,z-low),(x+low,y,z+low),(x-low,y,z+low)]
        top=[(x-high,y+height,z-high),(x+high,y+height,z-high),(x+high,y+height,z+high),(x-high,y+height,z+high)]
        faces=[];local=[(t['chunk']+d)%town.n for d in[0,1,-1,2,-2,3,-3,4,-4]]
        if sum(b.LIMITS[k]-len(town.chunks.lists[i][k])for i in local for k in['land','rail','extra'])<6:raise RuntimeError('No room for a complete visible tree trunk')
        def face(vertices,normal):
            kind=next(k for k in['land','rail','extra']if any(len(town.chunks.lists[i][k])<b.LIMITS[k]for i in local));ci=next(i for i in local if len(town.chunks.lists[i][kind])<b.LIMITS[kind])
            mapping=b.uv('land','wood')if kind=='land' else uv('white')if kind=='rail' else[(19/1024,35/1024)]*4
            p=b.quad(vertices,mapping,(160,130,95),normal);town.chunks.lists[ci][kind].append(p);faces.append(p)
        center=(x,y+height/2,z)
        for k in range(4):
            j=(k+1)%4;vs=[base[k],base[j],top[j],top[k]];mid=[sum(p[n]for p in vs)/4 for n in range(3)];face(vs,b.norm((mid[0]-x,0,mid[2]-z)))
        face(top,(0,1,0));face(base,(0,-1,0))
        town.buildings.append({'chunk':t['chunk'],'center':list(center),'height':height,'roof':0,'faces':faces,'boundary':'tree-trunk','treeIndex':index});colliders+=1
    town.native_trees=seeds;town.tree_collision_audit={'removedSpritePlanes':len(cards),'sourceTreeSites':len(seeds),'solidTrunks':colliders,'collision':'Tapered trunk shells inscribed inside the rendered cylinders; no leaf-card collision.'}
