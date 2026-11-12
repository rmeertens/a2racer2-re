"""Cumulative, reviewable Boxmeer improvement passes. No original-track settings change."""
import os
PASS = int(os.environ.get('BOXMEER_PASS', '10'))
assert 1 <= PASS <= 10

def configure(native):
    if PASS >= 1:
        native.ROAD = 65.0
        native.WALK = 110.0
        native.LANE = 31.0
    if PASS >= 2:
        native.KERB_HEIGHT = .5
        native.KERB_BEVEL = 10.0
        native.SURFACE['road'] = (3,3,253,253)
        native.SURFACE['marked_road'] = (259,3,509,253)
