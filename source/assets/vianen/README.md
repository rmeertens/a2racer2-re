# Vianen sources

Inputs of `tools/vianen/build-track.py`, downloaded on 2026-11-08.

- `osm.json`: streets, buildings and places of Vianen from the Overpass API. © OpenStreetMap contributors, Open Database License 1.0, <https://www.openstreetmap.org/copyright>.
- `photos/` and `photos.json`: 1024 px thumbnails of Wikimedia Commons photos, each with its page, author and licence (CC BY 2.0, CC BY-SA 3.0, CC BY-SA 4.0). `candidates.json` lists more openly licensed Vianen photos on Commons, not downloaded.

Only openly licensed photos are used. The textures made from them carry the same licences: `public/assets/vianen/ATTRIBUTION.md`.

- `own/`: photos of Vianen by the repository owner, Roland Meertens, November 2026: the ten that `tools/vianen/build-track.py` uses for the facades, the Lekpoort, the Stadhuis, the Grote Kerk, the paving, the brick, and the canal's water and grass. Downscaled to 1600 px, without their metadata (no location). The phone originals stay out of git (`/photos/` in `.gitignore`).

Active building-photo crops are calibrated in the `OWN` dictionary in `tools/vianen/build-track.py`.
Each quad runs top-left, top-right, bottom-right, bottom-left around a single facade plane;
`tools/vianen/photo_warp.py` rectifies it before atlas packing. Use actual wall/cornice/plinth
intersections, excluding side walls and projecting buttresses. A rectangular photo crop retains
the camera's perspective and will skew the windows when applied to a wall. Focused checks:
`python3 tools/vianen/check-photo-warp.py`.

The roof dormer is rectified from the white corner house in `own/1439.jpg`; dormer
volumes and small brick chimneys follow photos 1439 and 1446. `posters/` contains the
CC0 2001 Jody Bernal reference portrait, generated portrait poster and exact prompt.
