#!/usr/bin/env python3
"""Focused photo/UV checks, including a synthetic perspective photograph of a colour grid."""
import importlib.util
from pathlib import Path
import unittest
import numpy as np
from PIL import Image, ImageDraw
from photo_warp import homography, rectify

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('track', HERE / 'build-track.py')
track = importlib.util.module_from_spec(spec)
spec.loader.exec_module(track)


class PhotoWarpChecks(unittest.TestCase):
    def test_recovers_perspective_grid_without_mirroring_or_diagonal_seam(self):
        # Independent synthetic camera: both horizontal and vertical edges converge.
        camera = np.array([[520, 130, 75], [-80, 430, 125], [0.45, -0.12, 1]])
        corners = []
        for x, y in ((0, 0), (1, 0), (1, 1), (0, 1)):
            p = camera @ [x, y, 1]
            corners.append(p[:2] / p[2])
        original = Image.new('RGB', (320, 480))
        draw = ImageDraw.Draw(original)
        colours = {}
        for y in range(6):
            for x in range(4):
                c = (35 + x * 55, 30 + y * 35, 50 + (x + y) * 19)
                draw.rectangle((x * 80, y * 80, (x + 1) * 80 - 1, (y + 1) * 80 - 1), fill=c)
                colours[x, y] = c
        inverse = np.diag([320, 480, 1]) @ np.linalg.inv(camera)
        photograph = original.transform((700, 650), Image.Transform.PERSPECTIVE,
                                         (inverse / inverse[2, 2]).ravel()[:8], Image.Resampling.BICUBIC)
        restored = rectify(photograph, corners, original.size)
        for (x, y), colour in colours.items():
            np.testing.assert_allclose(restored.getpixel((x * 80 + 40, y * 80 + 40)), colour, atol=2)
        # Check the middle of each edge as well, so a bilinear substitute cannot pass by
        # matching only the four corners while bending masonry between them.
        mapping = homography(corners)
        for x, y in ((0.5, 0), (1, 0.5), (0.5, 1), (0, 0.5), (0.5, 0.5)):
            expected, actual = camera @ [x, y, 1], mapping @ [x, y, 1]
            np.testing.assert_allclose(actual[:2] / actual[2], expected[:2] / expected[2], atol=1e-8)

    def test_rejects_crossed_degenerate_or_nonfinite_facades(self):
        for q in (((0, 0), (1, 1), (1, 0), (0, 1)),
                  ((0, 0), (1, 0), (2, 0), (0, 1)),
                  ((0, 0), (1, 0), (float('nan'), 1), (0, 1))):
            with self.assertRaises(ValueError):
                homography(q)

    def test_every_active_photo_is_valid_and_inside_the_source(self):
        names = [t['photo'] for t in track.HOUSE_TYPES if 'photo' in t]
        names += ['stadhuis', 'lekpoort', 'church', 'kerk2', 'arches', 'dormer']
        for name in names:
            with self.subTest(name=name):
                key, corners = track.OWN[name]
                self.assertTrue(all(0 <= p <= 1 for point in corners for p in point))
                homography(corners)
                image = track.own(name, (96, 128))
                self.assertEqual(image.size, (96, 128))

    def test_both_wall_directions_keep_cropped_uvs_in_the_same_photo_region(self):
        vs = [(0, 0, 0), (10, 0, 0), (10, 20, 0), (0, 20, 0)]
        front = track.wall_uv('bouw', 'stadhuis', vs, (0, 0, -1), u0=0.2, u1=0.7)
        rear = track.wall_uv('bouw', 'stadhuis', vs, (0, 0, 1), u0=0.2, u1=0.7)
        self.assertEqual(front, [rear[1], rear[0], rear[3], rear[2]])


if __name__ == '__main__':
    unittest.main()
