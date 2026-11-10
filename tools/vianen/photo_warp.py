"""Rectify one planar photographed facade before the game projects it onto a wall.

Control points run TL, TR, BR, BL around the *same plane*. Image bounding boxes,
roof silhouettes and protruding buttresses are not facade control points.
"""
import numpy as np
from PIL import Image


def homography(corners):
    """Map a unit square to four source-image points, using a projective mapping."""
    q = np.asarray(corners, dtype=float)
    if q.shape != (4, 2) or not np.isfinite(q).all():
        raise ValueError('Expected four finite facade corners: TL, TR, BR, BL')
    edges = np.roll(q, -1, axis=0) - q
    turns = edges[:, 0] * np.roll(edges[:, 1], -1) - edges[:, 1] * np.roll(edges[:, 0], -1)
    if not np.all(turns > 1e-8):
        raise ValueError('Facade corners must form a convex, clockwise image quad')
    # Normalise the source as well, so large photos do not make the solve ill-conditioned.
    origin = q.mean(axis=0)
    scale = np.max(np.abs(q - origin))
    normal = (q - origin) / scale
    rows, values = [], []
    for (x, y), (u, v) in zip(((0, 0), (1, 0), (1, 1), (0, 1)), normal):
        rows.extend(((x, y, 1, 0, 0, 0, -u*x, -u*y), (0, 0, 0, x, y, 1, -v*x, -v*y)))
        values.extend((u, v))
    h = np.append(np.linalg.solve(rows, values), 1).reshape(3, 3)
    h = np.array([[scale, 0, origin[0]], [0, scale, origin[1]], [0, 0, 1]]) @ h
    denominators = np.array([h[2] @ p for p in ((0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1))])
    if np.min(denominators) <= 1e-8:
        raise ValueError('Facade mapping crosses the projective horizon')
    return h / h[2, 2]


def rectify(image, corners, size):
    """Supersample a single homography; no bilinear quad warp or baked camera perspective."""
    w, h = size[0] * 2, size[1] * 2
    mapping = homography(corners) @ np.diag([1 / w, 1 / h, 1])
    data = (mapping / mapping[2, 2]).ravel()[:8]
    return image.transform((w, h), Image.Transform.PERSPECTIVE, data, Image.Resampling.BICUBIC).resize(size, Image.Resampling.LANCZOS)
