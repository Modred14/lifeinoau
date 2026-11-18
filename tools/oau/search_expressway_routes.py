import json, math
from shapely.geometry import Polygon, LineString
from shapely.strtree import STRtree
o=json.load(open('public/data/oau-campus.json'))
B=[Polygon(b['pts']).buffer(0) for b in o['buildings']]; tree=STRtree(B)
W=[Polygon(a['pts']).buffer(0) for a in o['areas']['water']]
w,h=o['bounds']['x1'],o['bounds']['z1']
per=[]
for x in range(0,int(w)+1,60): per+= [(x,0),(x,h)]
for z in range(0,int(h)+1,60): per+= [(0,z),(w,z)]
res=[]
for i,a in enumerate(per):
  for b in per[i+1:]:
    dx,dz=b[0]-a[0],b[1]-a[1]; L=math.hypot(dx,dz)
    if L<3000: continue
    ux,uz=dx/L,dz/L; P=(a[0]-ux*480,a[1]-uz*480); Q=(b[0]+ux*480,b[1]+uz*480); line=LineString([P,Q])
    idx=tree.query(line.buffer(60)); d=min([line.distance(B[j]) for j in idx] or [999])
    if d-15.5>=24:
      lake=sum(line.intersection(x).length for x in W); res.append((round(L+960),round(d-15.5,1),round(lake),a,b,P,Q))
res.sort(key=lambda r:-r[0]); print(len(res),'lines >=24 m clear'); 
for r in res[:8]: print(r[:5])
print('>=4200:',[r[:5] for r in res if r[0]>=4200][:5])
print('lake>=300 best:',[r[:5] for r in sorted([r for r in res if r[2]>=300],key=lambda r:-r[0])][:4])
