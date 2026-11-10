#!/usr/bin/env python3
"""Original, deterministic material impacts; mono PCM for the native sound mixer."""
import math
from pathlib import Path
import random
import struct
import wave

OUT = Path(__file__).resolve().parents[2] / 'public/assets/vianen'
RATE = 22050

def impact(material):
    rng = random.Random(761 + len(material))
    duration = dict(card=.48, wood=.34, rubber=.25, metal=.65)[material]
    samples, low = [], 0.0
    for i in range(round(duration*RATE)):
        t = i/RATE
        noise = rng.uniform(-1, 1)
        low += .18*(noise-low)
        if material == 'card':
            # A soft box-body thud followed by irregular crumpling/rustling.
            pulse = sum(a*math.exp(-max(0,t-at)*decay) for at,a,decay in
                        ((0,.65,35),(.055,.3,25),(.13,.23,25),(.23,.15,25)) if t>=at)
            value = (noise-low)*pulse + .32*math.sin(2*math.pi*96*t)*math.exp(-40*t)
        elif material == 'wood':
            value = sum(a*math.sin(2*math.pi*f*t)*math.exp(-d*t) for f,a,d in
                        ((185,.44,40),(423,.24,30),(870,.12,50)))
            value += (noise-low)*.5*math.exp(-90*t)
            for at,a in ((.075,.24),(.155,.12)):
                if t>=at:
                    value += a*(low+math.sin(2*math.pi*270*(t-at)))*math.exp(-65*(t-at))
        elif material == 'rubber':
            value = .68*math.sin(2*math.pi*(78*t-35*t*t))*math.exp(-36*t)
            value += low*.5*math.exp(-45*t) + (noise-low)*.12*math.exp(-100*t)
        else:
            value = sum(a*math.sin(2*math.pi*f*t)*math.exp(-d*t) for f,a,d in
                        ((318,.27,16),(731,.21,12),(1247,.14,14),(2131,.09,20),(3277,.04,24)))
            value += (noise-low)*.5*math.exp(-100*t)
        # Avoid a discontinuity at either end; leave headroom for simultaneous hits.
        fade = min(1,t/.0015,(duration-t)/.025)
        samples.append(round(max(-.86,min(.86,value*fade)) * 32767))
    return samples

def build():
    OUT.mkdir(parents=True,exist_ok=True)
    for material in ('card','wood','rubber','metal'):
        samples=impact(material)
        with wave.open(str(OUT/f'vn_{material}.wav'),'wb') as out:
            out.setparams((1,2,RATE,len(samples),'NONE','not compressed'))
            out.writeframes(struct.pack(f'<{len(samples)}h',*samples))

if __name__ == '__main__':
    build()
