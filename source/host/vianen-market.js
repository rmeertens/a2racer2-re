export const VIANEN_AWNINGS = [36,48,56,64].map(width => `VN_AWN${width}_ANIM`);
export const VIANEN_MARKET_PROPS = [
  ['vn_markt.d3d','VN_STALL_ANIM','Breakaway market stall','vn_markt.tga'],
  ['vn_marktdak.d3d','VN_CANOPY_ANIM','Falling market canopy','vn_markt.tga'],
  ['vn_marktpaal.d3d','VN_MKTPOLE_ANIM','Breakaway canopy pole','vn_markt.tga'],
  ...[36,48,56,64].map(width => [`vn_luifel${width}.d3d`,`VN_AWN${width}_ANIM`,'Breakaway shop awning','vn_markt.tga']),
];

// Only the new hanging Vianen props are held at their authored mounting pose.
// After their first native contact they are ordinary movable bodies forever.
export class VianenMounts {
  constructor(m, props) {
    this.m = m;
    const base = m.u32[0x715e50>>2], scene = m.u32[0x73b0d0>>2];
    this.mounts = props.filter(p=>p.mounted).map(prop=>{
      const car = base + prop.index*0xf0;
      const object = scene + m.i32[(car+0x24)>>2]*0xa9;
      const triggers=prop.name==='VN_CANOPY_ANIM' ? props.filter(p=>
        ['VN_STALL_ANIM','VN_MKTPOLE_ANIM'].includes(p.name) &&
        Math.hypot(p.position[0]-prop.position[0],p.position[2]-prop.position[2])<45
      ).map(p=>base+p.index*0xf0) : [];
      return { index:prop.index, car, object, body:m.u32[(car+0x10)>>2], triggers,
        pose:m.u8.slice(object+0x10,object+0x50), released:false };
    });
    this.scratch = this.mounts.length ? m.lowAlloc(80) : 0;
  }

  update() {
    const {m,scratch} = this;
    for(const mount of this.mounts) {
      if(mount.released) continue;
      if([mount.car,...mount.triggers].some(car=>m.i32[(car+0x2c)>>2]!==0)) {
        mount.released=true;
        // A coupled roof may be asleep when its support is struck. Wake it
        // through the same native operation used when car parts detach.
        m.call(0x4f32e0,[],m.u32[(mount.body+8)>>2]);
        continue;
      }
      m.u8.set(mount.pose,scratch+16);
      m.u8.set(mount.pose.subarray(48,60),scratch);
      // Native generic-body reset (vtable +0xC); never the vehicle/wheel reset.
      m.call(m.u32[(m.u32[mount.body>>2]+0xc)>>2],[scratch,scratch+16],mount.body);
      const core=m.u32[(m.u32[(mount.body+8)>>2]+0xa4)>>2];
      for(let k=0;k<3;k++) {
        m.f32[(core+0x94+k*4)>>2]=0;
        m.f32[(core+0xa4+k*4)>>2]=0;
      }
      m.u8.set(mount.pose,mount.object+0x10);
    }
  }
}
