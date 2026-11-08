# Vianen

Two Vianen tracks, both additions of the port.

## Wenen as Vianen

Etappe 3, Wenen, keeps its track, its chase and its place in the Tour, and gets Vianen's looks. `python3 tools/vianen/reskin-wenen.py` writes `public/assets/vianen/wenen/`:

- **Road:** the grey asphalt becomes red brick klinkers; the white markings stay.
- **Walls:** each cell of the two facade atlases (`[texture2]` and `[texture3]` of `etappe3.ini`) gets a Vianen facade fitted to it. These are the Voorstraat rows, the Lekpoort and the Stadhuis.
- **Landmark objects:** the textures of Wenen's opera, parliament, museums and stock exchange show the Stadhuis, the Grote Kerk and the Lekpoort.
- **Unchanged:** cells with the magenta key colour (trees, lamps, statues), the grass texture, signs and the other objects.
- **Menu:** the track name image, the six slideshow pictures (a map of Vianen with the route through Lekpoort, Stadhuis and Grote Kerk, then Vianen photos), and the wait screen.

`source/host/vianen.js`:

- `renameWenen` renames track 3 to Vianen in `static.ini`, story texts included, and points the menu's pictures at the new files. It runs at start and changes memory only.
- `reskinWenenRace` runs before a race on track 3. It adds the textures and points `etappe3.ini`'s objects and the `raser.ini [MAPS]` row at them. After the race the row is put back, because `raser.ini` is saved.

The voice that announces the track still says "Wenen".

Checked on 2026-11-08: headless in Node, the race reads all eight new textures, drives, and puts the row back. In headless Chromium, the race and the Tour's track screen are in `evidence/vianen/wenen-*.png` and `menu-tour-track.png`.

## Vianen etappe (sketch)

A track the original never had, an earlier sketch: a loop through the old town of Vianen, an addition of the port and a first sketch. It is etappe 10, a slot the original reserves (`raser.ini [MAPS]` has rows 10 and 11) but never fills. It is offered in the multiplayer screens (`Vianen (schets)`), alone or with others, and directly with `?race=1&etappe=vianen`. The menu's own Tour and Quick Race do not list it.

## The route

About 920 m and 72 chunks. From the Grote Kerk end of Voorstraat north past the Stadhuis and through the Lekpoort, west along the dike, south down the parallel streets, and back east to the church. The streets come from OpenStreetMap; bends are rounded so that none is tighter than 26 m, so the loop follows the real streets only roughly.

## How it is made

`python3 tools/vianen/build-track.py` reads `source/assets/vianen/` and writes `public/assets/vianen/` and `public/assets/loading/e10*.png`:

- **Track files** in the original layouts (`original-game-decompiled/docs/formats/game-data.md`). `.rmp`: per chunk two road quads, two pavements and a facade on each side; at the Lekpoort, pillars and the tower over the road. `.pmp`: chunk positions and triggers: chunk 0 marker, start and finish on chunk 11, finish valid on chunk 12, so the start chunk is 10. `.dmp`: one waypoint per chunk and lane, the right lane with the race and the left one against it, as on the original tracks. `.omp`: the start banner and five pickups. `.cmp` and `.pth` are empty: no rails, no traffic or police paths.
- **Textures**, through `raser.ini [MAPS]` row 10. `vn_weg.tga` is the herringbone klinkers, `vn_gras.tga` the pavement, and `vn_gevel.tga` a 1024×1024 atlas of facades: the Lekpoort, the Stadhuis, the Grote Kerk, and eight rows of houses. All are cut from openly licensed Wikimedia Commons photos, and the black and white ones are tinted. Names not in `rcs.img` are read as loose files, so the archive is unchanged.
- **The slot.** `source/host/vianen.js` adds, in memory and not saved: the track files, `etappe10.ini` and `e10_anim.ini` (copies of Amsterdam's; its start fly-by markers are switched off), `opponent.ini` values for etappe 10 (Amsterdam's), and the `[MAPS]` row. The race reads the archive lists of Amsterdam, whose objects it places (`RaceRunner.load`). Records are kept under track 10.

Sources and licences: `public/assets/vianen/ATTRIBUTION.md`, `source/assets/vianen/README.md`.

## Checks

- `node tools/vianen/check-vianen.mjs --seconds 90`: Node, no renderer. Boots etappe 10 and lets the bot drive. On 2026-11-08 it lapped the track and finished in about 70 s, and the race wrote `finished=1` to `game.ini`.
- `node tools/vianen/shots.mjs`: screenshots at the start, the Stadhuis, the Lekpoort, the dike and the Grote Kerk, in headless Chromium with the bot at 4× speed. `evidence/vianen/`.
- `node tools/check-multiplayer-browser.mjs --players 2 --seconds 10 --track vianen`: a network race on Vianen, all checks passed.

## Known rough edges

A sketch: facades are flat walls with photos on them, without depth or roofs. The chunk count the HUD position uses stalls on parts of the lap. There is no traffic and no police path. In a race, the camera's start fly-by is off. Etappe 10's loading picture is the same for the 8-bit path. Only checked as above.
